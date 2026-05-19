import { useStore } from '../store'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import { format } from 'date-fns'

function StatCard({ label, value, sub, color = 'white', icon }) {
  return (
    <div className="stat-card">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-[10px] text-gray-600 tracking-wider mb-1">{label}</div>
          <div className={`font-mono text-xl font-bold ${color}`}>{value}</div>
          {sub && <div className="font-mono text-[10px] text-gray-500 mt-1">{sub}</div>}
        </div>
        {icon && <div className="text-2xl opacity-20">{icon}</div>}
      </div>
    </div>
  )
}

export function Dashboard() {
  const { strategies, positions, trades, perfSummary, performance, prices, tokens } = useStore()

  const totalPnl = perfSummary.reduce((s, p) => s + (p.total_pnl || 0), 0)
  const pnl24h = perfSummary.reduce((s, p) => s + (p.pnl_24h || 0), 0)
  const pnl7d = perfSummary.reduce((s, p) => s + (p.pnl_7d || 0), 0)
  const totalTrades = perfSummary.reduce((s, p) => s + (p.total_trades || 0), 0)
  const totalWins = perfSummary.reduce((s, p) => s + (p.total_wins || 0), 0)
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0.0'
  const running = strategies.filter(s => s.status === 'running').length

  // Chart data: aggregate by date
  const chartData = {}
  performance.forEach(p => {
    if (!chartData[p.date]) chartData[p.date] = { date: p.date, pnl: 0, trades: 0 }
    chartData[p.date].pnl += p.realized_pnl || 0
    chartData[p.date].trades += p.trade_count || 0
  })
  const chartArr = Object.values(chartData).slice(-30)

  const pnlColor = totalPnl >= 0 ? '#00ff88' : '#ff3b5c'
  const pnl24Color = pnl24h >= 0 ? '#00ff88' : '#ff3b5c'

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Dashboard</h1>
          <p className="font-mono text-[11px] text-gray-600 mt-0.5">
            {new Date().toLocaleString()} · {running} strategies active
          </p>
        </div>
        <div className="flex items-center gap-3">
          {strategies.filter(s => s.status === 'running').map(s => (
            <div key={s.id} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-green/10 rounded border border-accent-green/20">
              <div className="w-1.5 h-1.5 bg-accent-green rounded-full animate-pulse-green" />
              <span className="font-mono text-[10px] text-accent-green">{s.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-6 gap-4">
        <StatCard label="TOTAL P&L" value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`} color={totalPnl >= 0 ? 'text-accent-green' : 'text-accent-red'} icon="◈" sub="all time" />
        <StatCard label="24H P&L" value={`${pnl24h >= 0 ? '+' : ''}$${pnl24h.toFixed(2)}`} color={pnl24h >= 0 ? 'text-accent-green' : 'text-accent-red'} icon="⬡" sub="last 24 hours" />
        <StatCard label="7D P&L" value={`${pnl7d >= 0 ? '+' : ''}$${pnl7d.toFixed(2)}`} color={pnl7d >= 0 ? 'text-accent-green' : 'text-accent-red'} icon="▲" sub="last 7 days" />
        <StatCard label="WIN RATE" value={`${winRate}%`} color={parseFloat(winRate) >= 50 ? 'text-accent-green' : 'text-accent-red'} icon="◎" sub={`${totalWins}/${totalTrades} trades`} />
        <StatCard label="OPEN POSITIONS" value={positions.length} color="text-accent-yellow" icon="◉" sub={`${strategies.length} strategies`} />
        <StatCard label="STRATEGIES" value={`${running}/${strategies.length}`} color="text-accent-blue" icon="✦" sub="running/total" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* PnL Chart */}
        <div className="col-span-2 panel">
          <div className="panel-header">
            <span className="font-mono text-xs text-gray-400 tracking-wider">CUMULATIVE P&L (30D)</span>
          </div>
          <div className="p-4 h-48">
            {chartArr.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartArr}>
                  <defs>
                    <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={pnlColor} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={pnlColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: '#555' }} tickFormatter={d => d?.slice(5)} />
                  <YAxis tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: '#555' }} tickFormatter={v => `$${v.toFixed(0)}`} />
                  <Tooltip contentStyle={{ background: '#131419', border: '1px solid #1e2028', fontFamily: 'JetBrains Mono', fontSize: 11 }} labelStyle={{ color: '#888' }} formatter={v => [`$${v.toFixed(2)}`, 'P&L']} />
                  <Area type="monotone" dataKey="pnl" stroke={pnlColor} fill="url(#pnlGrad)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center font-mono text-xs text-gray-600">No performance data yet</div>
            )}
          </div>
        </div>

        {/* Per-Strategy Summary */}
        <div className="panel">
          <div className="panel-header">
            <span className="font-mono text-xs text-gray-400 tracking-wider">STRATEGY PERFORMANCE</span>
          </div>
          <div className="overflow-y-auto max-h-52">
            {perfSummary.length === 0 ? (
              <div className="p-4 font-mono text-xs text-gray-600">No strategies yet</div>
            ) : perfSummary.map(s => (
              <div key={s.id} className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0 hover:bg-bg-700 transition-colors">
                <div>
                  <div className="font-mono text-xs text-white">{s.name}</div>
                  <div className="font-mono text-[10px] text-gray-600">{s.type} · <span className={s.mode === 'paper' ? 'text-accent-blue' : 'text-accent-green'}>{s.mode}</span></div>
                </div>
                <div className="text-right">
                  <div className={`font-mono text-xs font-bold ${(s.total_pnl || 0) >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                    {(s.total_pnl || 0) >= 0 ? '+' : ''}${(s.total_pnl || 0).toFixed(2)}
                  </div>
                  <div className="font-mono text-[10px] text-gray-600">{s.total_trades || 0} trades</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Signals + Positions */}
      <div className="grid grid-cols-2 gap-4">
        <div className="panel">
          <div className="panel-header">
            <span className="font-mono text-xs text-gray-400 tracking-wider">OPEN POSITIONS</span>
          </div>
          <div className="overflow-y-auto max-h-48">
            {positions.length === 0 ? (
              <div className="p-4 font-mono text-xs text-gray-600">No open positions</div>
            ) : positions.map(p => {
              const pnl = p.unrealized_pnl || 0
              return (
                <div key={p.id} className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-1.5 h-1.5 rounded-full ${pnl >= 0 ? 'bg-accent-green' : 'bg-accent-red'}`} />
                    <div>
                      <span className="font-mono text-xs text-white">{p.token_symbol}</span>
                      <span className={`ml-2 font-mono text-[10px] ${p.side === 'long' ? 'text-accent-green' : 'text-accent-red'}`}>{p.side.toUpperCase()}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-mono text-xs font-bold ${pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
                      {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                    </div>
                    <div className="font-mono text-[10px] text-gray-600">{p.strategy_name} · {p.mode}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="font-mono text-xs text-gray-400 tracking-wider">TOKEN PRICES</span>
          </div>
          <div className="overflow-y-auto max-h-48">
            {tokens.map(t => {
              const p = prices[t.mint]
              return (
                <div key={t.mint} className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-0">
                  <div className="font-mono text-xs text-white">{t.symbol}</div>
                  <div className="font-mono text-xs text-gray-400">
                    {p ? `$${parseFloat(p.price).toFixed(p.price < 0.01 ? 8 : p.price < 1 ? 6 : 2)}` : '—'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
