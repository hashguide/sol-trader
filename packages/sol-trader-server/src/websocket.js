const clients = new Set()

export function registerWsHandler(app) {
  app.ws('/ws', (ws, req) => {
    clients.add(ws)
    ws.on('close', () => clients.delete(ws))
    ws.on('error', () => clients.delete(ws))
    ws.send(JSON.stringify({ type: 'connected', ts: Date.now() }))
  })
}

export function broadcast(data) {
  const msg = JSON.stringify({ ...data, ts: Date.now() })
  for (const client of clients) {
    try {
      if (client.readyState === 1) client.send(msg)
    } catch {
      clients.delete(client)
    }
  }
}

export function getClientCount() {
  return clients.size
}
