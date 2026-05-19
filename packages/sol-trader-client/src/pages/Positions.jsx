import { useStore } from '../store'

export function Positions() {
  const { positions, prices } = useStore()

  return (
    <div className="flex-1 overflow-hidden flex flex-col p-6">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">Open Positions</h1>
        <p className="font-mono text-[11px] text-gray-600 mt-0.5">{positions.length} open positions across all strategies</p>
      </div>

      {positions.length === 0 ? (
        <div className="panel p-12 text-center">
          <div className="text-4xl mb-4 opacity-20">◎</div>
          <div className="font-display font-semibold text-gray-500">No open positions</div>
        </div>
      ) : (
        <div className="panel flex-1 overflow-auto">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-bg-800 border-b border-border">
              <tr>
                {['TOKEN', 'STRATEGY', 'MODE', 'SIDE', 'SIZE', 'ENTRY', 'CURRENT', 'UNREALIZED PnL', 'STOP LOSS', 'TRAILING STOP', 'TAKE PROFIT', 'OPENED'].map(h => (
                  <th key={h} className="px-4 py-3 font-mono text-[10px] text-gray-600 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map(p => {
                const priceData = prices[p.token_mint]
                const currentPrice = priceData?.price || p.current_price
                const pnl = p.unrealized_pnl || 0
                const pnlPct = p.entry_price ? ((currentPrice - p.entry_price) / p.entry_price * 100 * (p.side === 'long' ? 1 : -1)) : 0

                return (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-bg-700 transition-colors">
                    <td className="px-4 py-3 font-mono text-sm font-bold text-white">{p.token_symbol}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400">{p.strategy_name}</td>
                    <td className="px-4 py-3">
                      <span className={p.mode === 'paper' ? 'badge-paper' : 'badge-live'}>{p.mode}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-mono text-xs font-bold ${p.side === 'long' ? 'text-accent-green' : 'text-accent-red'}`}>
                        {p.side?.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-300">{p.size?.toFixed(4)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-300">${p.entry_price?.toFixed(4)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-white">{currentPrice ? `$${parseFloat(currentPrice).toFixed(4)}` : '—'}</td>
                    <td className="px-4 py-3">
                      <div className={`font-mono text-xs font-bold ${pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                        {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                      </div>
                      <div className={`font-mono text-[10px] ${pnlPct >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                        {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-accent-red">{p.stop_loss ? `$${p.stop_loss.toFixed(4)}` : '—'}</td>
                    <td className="px-4 py-3 font-mono text-[10px] text-accent-yellow">{p.trailing_stop ? `$${p.trailing_stop.toFixed(4)}` : '—'}</td>
                    <td className="px-4 py-3 font-mono text-[10px] text-accent-green">{p.take_profit ? `$${p.take_profit.toFixed(4)}` : '—'}</td>
                    <td className="px-4 py-3 font-mono text-[10px] text-gray-600 whitespace-nowrap">
                      {p.opened_at ? new Date(p.opened_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
