import express from 'express'
import { getDb } from './db.js'
import { startStrategy, stopStrategy, getActiveStrategies, STRATEGY_TYPES } from './engine.js'
import { chatWithAI, generateStrategyConfig } from './ai.js'
import { initSolana, getWalletAddress, scanTopTokens, getMultipleTokenPrices, getWalletBalance } from './jupiter.js'

const router = express.Router()

// ─── Config ──────────────────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM config').all()
  const config = {}
  rows.forEach(r => { config[r.key] = r.value })
  config.walletAddress = getWalletAddress()
  res.json(config)
})

router.post('/config', async (req, res) => {
  const db = getDb()
  const { rpc_url, private_key, ...rest } = req.body
  const upsert = db.prepare("INSERT INTO config (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")

  if (rpc_url) upsert.run('rpc_url', rpc_url)
  if (private_key) {
    upsert.run('private_key', private_key)
    const walletAddr = initSolana(rpc_url || db.prepare("SELECT value FROM config WHERE key='rpc_url'").get()?.value, private_key)
    upsert.run('wallet_address', walletAddr || '')
  }
  for (const [k, v] of Object.entries(rest)) upsert.run(k, String(v))

  res.json({ success: true, walletAddress: getWalletAddress() })
})

// ─── Strategies ──────────────────────────────────────────────────────────────
router.get('/strategies', (req, res) => {
  const db = getDb()
  const strategies = db.prepare('SELECT * FROM strategies ORDER BY created_at DESC').all()
  const active = getActiveStrategies()
  res.json(strategies.map(s => ({ ...s, isActive: active.includes(s.id), config: JSON.parse(s.config || '{}'), tokens: JSON.parse(s.tokens || '[]') })))
})

router.post('/strategies', async (req, res) => {
  const db = getDb()
  const { name, type, mode, tokens, initial_capital, stop_loss_pct, trailing_stop_pct, take_profit_pct, max_position_size, expiry_at, profit_goal, config } = req.body
  try {
    const aiConfig = await generateStrategyConfig(type, { stop_loss_pct, take_profit_pct })
    const finalConfig = { ...aiConfig, ...(config || {}) }

    const result = db.prepare(`
      INSERT INTO strategies (name, type, mode, tokens, initial_capital, current_capital, paper_capital, stop_loss_pct, trailing_stop_pct, take_profit_pct, max_position_size, expiry_at, profit_goal, config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, type, mode || 'paper', JSON.stringify(tokens || []), initial_capital || 100, initial_capital || 100, initial_capital || 100, stop_loss_pct || null, trailing_stop_pct || null, take_profit_pct || null, max_position_size || 10, expiry_at || null, profit_goal || null, JSON.stringify(finalConfig))

    res.json({ id: result.lastInsertRowid, config: finalConfig })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.put('/strategies/:id', (req, res) => {
  const db = getDb()
  const { id } = req.params
  const fields = req.body
  const sets = Object.entries(fields).filter(([k]) => !['id', 'created_at'].includes(k)).map(([k, v]) => `${k} = ?`).join(', ')
  const vals = Object.entries(fields).filter(([k]) => !['id', 'created_at'].includes(k)).map(([, v]) => typeof v === 'object' ? JSON.stringify(v) : v)
  db.prepare(`UPDATE strategies SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...vals, id)
  res.json({ success: true })
})

router.delete('/strategies/:id', async (req, res) => {
  const { id } = req.params
  await stopStrategy(parseInt(id))
  const db = getDb()
  db.prepare('DELETE FROM strategies WHERE id = ?').run(id)
  res.json({ success: true })
})

router.post('/strategies/:id/start', async (req, res) => {
  try {
    await startStrategy(parseInt(req.params.id))
    res.json({ success: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/strategies/:id/stop', async (req, res) => {
  await stopStrategy(parseInt(req.params.id))
  res.json({ success: true })
})

// ─── Trades ──────────────────────────────────────────────────────────────────
router.get('/trades', (req, res) => {
  const db = getDb()
  const { strategy_id, limit = 100, offset = 0 } = req.query
  let q = 'SELECT t.*, s.name as strategy_name FROM trades t JOIN strategies s ON t.strategy_id = s.id'
  const params = []
  if (strategy_id) { q += ' WHERE t.strategy_id = ?'; params.push(strategy_id) }
  q += ' ORDER BY t.opened_at DESC LIMIT ? OFFSET ?'
  params.push(parseInt(limit), parseInt(offset))
  res.json(db.prepare(q).all(...params))
})

// ─── Positions ───────────────────────────────────────────────────────────────
router.get('/positions', (req, res) => {
  const db = getDb()
  const positions = db.prepare(`
    SELECT p.*, s.name as strategy_name, s.mode FROM positions p
    JOIN strategies s ON p.strategy_id = s.id
    WHERE p.status = 'open' ORDER BY p.opened_at DESC
  `).all()
  res.json(positions)
})

// ─── Performance ─────────────────────────────────────────────────────────────
router.get('/performance', (req, res) => {
  const db = getDb()
  const { strategy_id, days = 30 } = req.query
  let q = `SELECT p.*, s.name as strategy_name FROM performance p JOIN strategies s ON p.strategy_id = s.id WHERE p.date >= date('now', '-${parseInt(days)} days')`
  const params = []
  if (strategy_id) { q += ' AND p.strategy_id = ?'; params.push(strategy_id) }
  q += ' ORDER BY p.date ASC'
  res.json(db.prepare(q).all(...params))
})

router.get('/performance/summary', (req, res) => {
  const db = getDb()
  const summary = db.prepare(`
    SELECT 
      s.id, s.name, s.mode, s.type, s.status,
      s.initial_capital, s.current_capital,
      COALESCE(SUM(p.realized_pnl), 0) as total_pnl,
      COALESCE(SUM(p.trade_count), 0) as total_trades,
      COALESCE(SUM(p.win_count), 0) as total_wins,
      COALESCE(SUM(p.loss_count), 0) as total_losses,
      COALESCE(SUM(CASE WHEN p.date >= date('now', '-1 day') THEN p.realized_pnl ELSE 0 END), 0) as pnl_24h,
      COALESCE(SUM(CASE WHEN p.date >= date('now', '-7 days') THEN p.realized_pnl ELSE 0 END), 0) as pnl_7d
    FROM strategies s
    LEFT JOIN performance p ON p.strategy_id = s.id
    GROUP BY s.id
  `).all()
  res.json(summary)
})

// ─── Market Data ─────────────────────────────────────────────────────────────
router.get('/market/tokens', (req, res) => {
  const db = getDb()
  res.json(db.prepare('SELECT * FROM watched_tokens WHERE is_active = 1').all())
})

router.get('/market/prices', async (req, res) => {
  const db = getDb()
  const tokens = db.prepare('SELECT mint FROM watched_tokens WHERE is_active = 1').all()
  const mints = tokens.map(t => t.mint)
  const prices = await getMultipleTokenPrices(mints)
  res.json(prices)
})

router.get('/market/scan', async (req, res) => {
  try {
    const tokens = await scanTopTokens(20)
    res.json(tokens)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/market/tokens', (req, res) => {
  const db = getDb()
  const { mint, symbol, name, decimals } = req.body
  db.prepare('INSERT OR REPLACE INTO watched_tokens (mint, symbol, name, decimals) VALUES (?, ?, ?, ?)').run(mint, symbol, name || symbol, decimals || 9)
  res.json({ success: true })
})

router.delete('/market/tokens/:mint', (req, res) => {
  const db = getDb()
  db.prepare('UPDATE watched_tokens SET is_active = 0 WHERE mint = ?').run(req.params.mint)
  res.json({ success: true })
})

router.get('/market/history/:mint', (req, res) => {
  const db = getDb()
  const { mint } = req.params
  const { limit = 200 } = req.query
  const data = db.prepare(
    'SELECT price, recorded_at FROM market_data WHERE token_mint = ? ORDER BY recorded_at DESC LIMIT ?'
  ).all(mint, parseInt(limit)).reverse()
  res.json(data)
})

// ─── AI Signals ──────────────────────────────────────────────────────────────
router.get('/signals', (req, res) => {
  const db = getDb()
  const { strategy_id, limit = 50 } = req.query
  let q = `SELECT sig.*, s.name as strategy_name FROM ai_signals sig JOIN strategies s ON sig.strategy_id = s.id`
  const params = []
  if (strategy_id) { q += ' WHERE sig.strategy_id = ?'; params.push(strategy_id) }
  q += ' ORDER BY sig.created_at DESC LIMIT ?'
  params.push(parseInt(limit))
  res.json(db.prepare(q).all(...params))
})

// ─── AI Chat ─────────────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
  try {
    const { message, context } = req.body
    const response = await chatWithAI(message, context)
    res.json({ response })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── Wallet ──────────────────────────────────────────────────────────────────
router.get('/wallet', async (req, res) => {
  const address = getWalletAddress()
  if (!address) return res.json({ address: null, balance: null })
  const balance = await getWalletBalance(address)
  res.json({ address, balance })
})

router.get('/strategy-types', (req, res) => {
  res.json(Object.values(STRATEGY_TYPES))
})

export default router
