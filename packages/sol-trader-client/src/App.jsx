import { useEffect } from 'react'
import { useStore } from './store'
import { useWebSocket } from './hooks/useWebSocket'
import { Sidebar } from './components/Sidebar'
import { Header } from './components/Header'
import { NotificationPanel } from './components/NotificationPanel'
import { Dashboard } from './pages/Dashboard'
import { Strategies } from './pages/Strategies'
import { Trades } from './pages/Trades'
import { Positions } from './pages/Positions'
import { Market } from './pages/Market'
import { Chart } from './pages/Chart'
import { Chat } from './pages/Chat'
import { Config } from './pages/Config'

export default function App() {
  const { activeTab, initAll, fetchPrices, fetchPositions, fetchStrategies } = useStore()
  useWebSocket()

  useEffect(() => {
    initAll()
    // Refresh prices every 30s, positions every 15s
    const priceInterval = setInterval(fetchPrices, 30000)
    const posInterval = setInterval(fetchPositions, 15000)
    const stratInterval = setInterval(fetchStrategies, 10000)
    return () => {
      clearInterval(priceInterval)
      clearInterval(posInterval)
      clearInterval(stratInterval)
    }
  }, [])

  const pages = {
    dashboard: Dashboard,
    strategies: Strategies,
    positions: Positions,
    trades: Trades,
    market: Market,
    chart: Chart,
    chat: Chat,
    config: Config,
  }

  const Page = pages[activeTab] || Dashboard

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex overflow-hidden bg-bg-950">
          <Page />
        </main>
        <NotificationPanel />
      </div>
    </div>
  )
}
