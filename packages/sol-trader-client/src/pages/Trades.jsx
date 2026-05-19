import { useStore } from '../store'
import { format } from 'date-fns'

export function Trades() {
  const { trades, strategies } = useStore()

  const totalPnl = trades.reduce((s, t) => s + (t.pnl || 0), 0)
  const wins = trades.filter(t => t.pnl > 0).length
  const losses = trades.filter(t => t.pnl < 0).length

  return (
    <div className="flex-1 overflow-hidden flex flex-col p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Trade History</h1>
          <p className="font-mono text-[11px] text-gray-600 mt-0.5">{trades.length} trades · {wins}W / {losses}L · Total PnL: <span className={totalPnl >= 0 ? 'text-accent-green' : 'text-accent-red'}>${totalPnl.toFixed(2)}</span></p>
        </div>
      </div>

      <div className="panel flex-1 overflow-hidden flex flex-col">
        <div className="overflow-x-auto overflow-y-auto flex-1">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-bg-800 border-b border-border">
              <tr>
                {['TIME', 'STRATEGY', 'TOKEN', 'SIDE', 'MODE', 'AMOUNT IN', 'PRICE IN', 'PRICE OUT', 'P&L', 'P&L %', 'STATUS', 'TX'].map(h => (
                  <th key={h} className="px-4 py-3 font-mono text-[10px] text-gray-600 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-8 text-center font-mono text-xs text-gray-600">No trades yet</td></tr>
              ) : trades.map(t => {
                const pnl = t.pnl || 0
                const status = t.status
                return (
                  <tr key={t.id} className="border-b border-border/50 hover:bg-bg-700 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-[10px] text-gray-500 whitespace-nowrap">
                      {t.opened_at ? format(new Date(t.opened_at), 'MM/dd HH:mm') : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-gray-400">{t.strategy_name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold text-white">{t.token_symbol}</td>
                    <td className="px-4 py-2.5">
                      <span className={`font-mono text-[10px] px-2 py-0.5 rounded ${t.side === 'buy' || t.side === 'long' ? 'bg-accent-green/10 text-accent-green' : t.side === 'close' ? 'bg-gray-500/10 text-gray-400' : 'bg-accent-red/10 text-accent-red'}`}>
                        {t.side?.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={t.mode === 'paper' ? 'badge-paper' : 'badge-live'}>{t.mode}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-gray-400">${(t.amount_in || 0).toFixed(2)}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-gray-400">${(t.price_in || 0).toFixed(4)}</td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-gray-400">{t.price_out ? `$${t.price_out.toFixed(4)}` : '—'}</td>
                    <td className={`px-4 py-2.5 font-mono text-xs font-bold ${pnl > 0 ? 'pnl-positive' : pnl < 0 ? 'pnl-negative' : 'pnl-neutral'}`}>
                      {t.pnl != null ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : '—'}
                    </td>
                    <td className={`px-4 py-2.5 font-mono text-[10px] ${(t.pnl_pct || 0) > 0 ? 'pnl-positive' : (t.pnl_pct || 0) < 0 ? 'pnl-negative' : 'pnl-neutral'}`}>
                      {t.pnl_pct != null ? `${t.pnl_pct >= 0 ? '+' : ''}${t.pnl_pct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`font-mono text-[10px] px-2 py-0.5 rounded ${
                        status === 'filled' ? 'bg-accent-green/10 text-accent-green' :
                        status === 'failed' ? 'bg-accent-red/10 text-accent-red' :
                        status === 'pending' ? 'bg-accent-yellow/10 text-accent-yellow' :
                        'bg-gray-500/10 text-gray-400'
                      }`}>{status?.toUpperCase()}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[10px] text-gray-600">
                      {t.tx_hash ? (
                        <a href={`https://solscan.io/tx/${t.tx_hash}`} target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline">
                          {t.tx_hash.slice(0, 8)}...
                        </a>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
