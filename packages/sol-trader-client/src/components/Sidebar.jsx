import { useStore } from '../store'

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '⬡' },
  { id: 'strategies', label: 'Strategies', icon: '◈' },
  { id: 'positions', label: 'Positions', icon: '◎' },
  { id: 'trades', label: 'Trade History', icon: '⟳' },
  { id: 'market', label: 'Market', icon: '◉' },
  { id: 'chart', label: 'Charts', icon: '▲' },
  { id: 'chat', label: 'AI Chat', icon: '✦' },
  { id: 'config', label: 'Config', icon: '⚙' },
]

export function Sidebar() {
  const { activeTab, setActiveTab, wsConnected, strategies, positions } = useStore()
  const running = strategies.filter(s => s.status === 'running').length

  return (
    <aside className="w-[200px] flex-shrink-0 bg-bg-900 border-r border-border flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border">
        <div className="font-display font-bold text-lg tracking-widest text-white">
          NEX<span className="text-accent-green">US</span>
        </div>
        <div className="font-mono text-[10px] text-gray-600 mt-0.5 tracking-wider">SOLANA TRADING</div>
      </div>

      {/* Status */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-accent-green animate-pulse-green' : 'bg-accent-red'}`} />
          <span className="font-mono text-[10px] text-gray-500">{wsConnected ? 'CONNECTED' : 'OFFLINE'}</span>
        </div>
        {running > 0 && (
          <div className="flex items-center gap-2 mt-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-accent-blue animate-pulse" />
            <span className="font-mono text-[10px] text-gray-500">{running} RUNNING</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 overflow-y-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-150
              ${activeTab === tab.id
                ? 'bg-accent-green/10 text-accent-green border-r-2 border-accent-green'
                : 'text-gray-500 hover:text-gray-300 hover:bg-bg-700'
              }`}
          >
            <span className="text-base w-5 text-center">{tab.icon}</span>
            <span className="font-mono text-xs tracking-wider">{tab.label.toUpperCase()}</span>
          </button>
        ))}
      </nav>

      {/* Open Positions count */}
      {positions.length > 0 && (
        <div className="px-4 py-3 border-t border-border">
          <div className="font-mono text-[10px] text-gray-600">OPEN POSITIONS</div>
          <div className="font-mono text-lg font-bold text-accent-yellow mt-0.5">{positions.length}</div>
        </div>
      )}
    </aside>
  )
}
