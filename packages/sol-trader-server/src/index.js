import express from 'express'
import expressWs from 'express-ws'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { getDb } from './db.js'
import { initSolana } from './jupiter.js'
import { registerWsHandler } from './websocket.js'
import routes from './routes.js'

config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3001

const app = express()
expressWs(app)

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:3001'] }))
app.use(express.json())


registerWsHandler(app)

// API routes
app.use('/api', routes)

// Serve built client in production
const publicDir = path.join(__dirname, '../public')
app.use(express.static(publicDir))
app.get('*', (req, res) => {
  const indexPath = path.join(publicDir, 'index.html')
  res.sendFile(indexPath, err => {
    if (err) res.status(404).send('Build the client first: npm run build --workspace=client')
  })
})

// Init from saved config
const db = getDb()
const cfg = {}
db.prepare('SELECT key, value FROM config').all().forEach(r => { cfg[r.key] = r.value })

if (cfg.private_key) {
  const addr = initSolana(cfg.rpc_url, cfg.private_key)
  if (addr) console.log(`🔑 Wallet loaded: ${addr}`)
}

app.listen(PORT, () => {
  console.log(`🚀 NEXUS Trading Bot Server running on http://localhost:${PORT}`)
  console.log(`📊 API: http://localhost:${PORT}/api`)
  console.log(`🔌 WebSocket: ws://localhost:${PORT}/ws`)
})

process.on('unhandledRejection', err => console.error('Unhandled rejection:', err))
