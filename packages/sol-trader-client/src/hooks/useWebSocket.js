import { useEffect, useRef } from 'react'
import { useStore } from '../store'

export function useWebSocket() {
  const ws = useRef(null)
  const { setWsConnected, handleWsMessage } = useStore()

  useEffect(() => {
    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = `${protocol}//${window.location.host}/ws`
      ws.current = new WebSocket(url)

      ws.current.onopen = () => setWsConnected(true)
      ws.current.onclose = () => {
        setWsConnected(false)
        setTimeout(connect, 3000)
      }
      ws.current.onerror = () => ws.current?.close()
      ws.current.onmessage = (e) => {
        try {
          handleWsMessage(JSON.parse(e.data))
        } catch {}
      }
    }

    connect()
    return () => ws.current?.close()
  }, [])
}
