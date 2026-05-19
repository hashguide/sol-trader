import { useStore } from '../store'

const typeConfig = {
  trade_opened: { icon: '▶', color: 'text-accent-blue', label: 'Trade Opened' },
  trade_filled: { icon: '✓', color: 'text-accent-green', label: 'Trade Filled' },
  trade_closed: { icon: '◼', color: 'text-accent-green', label: 'Trade Closed' },
  trade_failed: { icon: '✕', color: 'text-accent-red', label: 'Trade Failed' },
  trade_retry: { icon: '↺', color: 'text-accent-yellow', label: 'Retrying' },
  trade_blocked: { icon: '⊘', color: 'text-accent-orange', label: 'Trade Blocked' },
  strategy_update: { icon: '◈', color: 'text-accent-purple', label: 'Strategy Update' },
  strategy_error: { icon: '!', color: 'text-accent-red', label: 'Strategy Error' },
  strategy_stopped: { icon: '■', color: 'text-gray-400', label: 'Strategy Stopped' },
  ai_signal: { icon: '✦', color: 'text-accent-yellow', label: 'AI Signal' },
}

export function NotificationPanel() {
  const { notifications, dismissNotification, wsConnected } = useStore()

  return (
    <div className="w-[260px] flex-shrink-0 bg-bg-900 border-l border-border flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <span className="font-mono text-[10px] text-gray-500 tracking-wider">LIVE EVENTS</span>
        <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-accent-green animate-pulse-green' : 'bg-gray-600'}`} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="p-4 text-center font-mono text-[10px] text-gray-700 mt-8">
            <div className="text-2xl mb-2 opacity-20">⬡</div>
            Waiting for events...
          </div>
        ) : notifications.map(n => {
          const cfg = typeConfig[n.type] || { icon: '•', color: 'text-gray-400', label: n.type }
          return (
            <div key={n.id} className="border-b border-border/50 px-3 py-2.5 hover:bg-bg-800 transition-colors animate-slide-in">
              <div className="flex items-start gap-2">
                <span className={`${cfg.color} text-[11px] mt-0.5`}>{cfg.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className={`font-mono text-[10px] ${cfg.color} font-semibold`}>{cfg.label}</div>
                  {n.token && <div className="font-mono text-[9px] text-gray-500 mt-0.5">{n.token} {n.side ? `· ${n.side.toUpperCase()}` : ''}</div>}
                  {n.pnl != null && (
                    <div className={`font-mono text-[10px] font-bold mt-0.5 ${n.pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                      {n.pnl >= 0 ? '+' : ''}${n.pnl.toFixed(2)}
                    </div>
                  )}
                  {n.signal && <div className="font-mono text-[9px] text-gray-600 mt-0.5">{n.signal.action?.toUpperCase()} · {n.signal.confidence}% confidence</div>}
                  {n.error && <div className="font-mono text-[9px] text-accent-red mt-0.5 truncate">{n.error}</div>}
                  {n.reasoning && <div className="font-mono text-[9px] text-gray-600 mt-0.5 line-clamp-2">{n.reasoning}</div>}
                  <div className="font-mono text-[9px] text-gray-700 mt-1">{new Date(n.ts).toLocaleTimeString()}</div>
                </div>
                <button onClick={() => dismissNotification(n.id)} className="text-gray-700 hover:text-gray-400 text-[10px] flex-shrink-0">✕</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
