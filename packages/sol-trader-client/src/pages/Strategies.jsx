import { useState } from 'react'
import { useStore } from '../store'

const STRATEGY_TYPES = ['momentum', 'mean_reversion', 'breakout', 'dca', 'grid', 'scalp', 'swing', 'ai_dynamic']

function StrategyModal({ onClose }) {
  const { createStrategy, tokens } = useStore()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '', type: 'ai_dynamic', mode: 'paper',
    initial_capital: 100, max_position_size: 10,
    stop_loss_pct: 5, trailing_stop_pct: '', take_profit_pct: 15,
    expiry_at: '', profit_goal: '',
    tokens: tokens.slice(0, 2).map(t => t.mint),
  })

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const toggleToken = (mint) => {
    set('tokens', form.tokens.includes(mint) ? form.tokens.filter(m => m !== mint) : [...form.tokens, mint])
  }

  const submit = async () => {
    if (!form.name || !form.type) return
    setLoading(true)
    try {
      await createStrategy({
        ...form,
        stop_loss_pct: form.stop_loss_pct || null,
        trailing_stop_pct: form.trailing_stop_pct || null,
        take_profit_pct: form.take_profit_pct || null,
        expiry_at: form.expiry_at || null,
        profit_goal: form.profit_goal || null,
      })
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 animate-fade-in">
      <div className="bg-bg-800 border border-border rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="panel-header sticky top-0 bg-bg-800 z-10">
          <span className="font-display font-semibold">New Strategy</span>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-mono text-[10px] text-gray-500 mb-1 block">NAME</label>
              <input className="input-field" value={form.name} onChange={e => set('name', e.target.value)} placeholder="My Strategy" />
            </div>
            <div>
              <label className="font-mono text-[10px] text-gray-500 mb-1 block">TYPE</label>
              <select className="select-field" value={form.type} onChange={e => set('type', e.target.value)}>
                {STRATEGY_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ').toUpperCase()}</option>)}
              </select>
            </div>
          </div>

          {/* Mode selector */}
          <div>
            <label className="font-mono text-[10px] text-gray-500 mb-2 block">TRADING MODE</label>
            <div className="flex gap-2">
              <button
                onClick={() => set('mode', 'paper')}
                className={`flex-1 py-3 rounded border font-mono text-xs transition-all ${form.mode === 'paper' ? 'bg-accent-blue/10 border-accent-blue text-accent-blue' : 'border-border text-gray-500 hover:border-gray-500'}`}
              >
                📄 PAPER
                <div className="text-[9px] mt-0.5 opacity-70">Simulated trades, no real funds</div>
              </button>
              <button
                onClick={() => set('mode', 'live')}
                className={`flex-1 py-3 rounded border font-mono text-xs transition-all ${form.mode === 'live' ? 'bg-accent-green/10 border-accent-green text-accent-green' : 'border-border text-gray-500 hover:border-gray-500'}`}
              >
                ⚡ LIVE
                <div className="text-[9px] mt-0.5 opacity-70">Real funds, real trades</div>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-mono text-[10px] text-gray-500 mb-1 block">INITIAL CAPITAL ($)</label>
              <input className="input-field" type="number" value={form.initial_capital} onChange={e => set('initial_capital', parseFloat(e.target.value))} />
            </div>
            <div>
              <label className="font-mono text-[10px] text-gray-500 mb-1 block">MAX POSITION SIZE (%)</label>
              <input className="input-field" type="number" value={form.max_position_size} onChange={e => set('max_position_size', parseFloat(e.target.value))} min="1" max="100" />
            </div>
          </div>

          {/* Risk controls */}
          <div className="p-3 bg-bg-700 rounded-lg border border-border">
            <div className="font-mono text-[10px] text-gray-500 mb-3">RISK CONTROLS</div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="font-mono text-[10px] text-gray-600 mb-1 block">STOP LOSS %</label>
                <input className="input-field text-accent-red" type="number" value={form.stop_loss_pct} onChange={e => set('stop_loss_pct', e.target.value)} placeholder="5" />
              </div>
              <div>
                <label className="font-mono text-[10px] text-gray-600 mb-1 block">TRAILING STOP %</label>
                <input className="input-field text-accent-yellow" type="number" value={form.trailing_stop_pct} onChange={e => set('trailing_stop_pct', e.target.value)} placeholder="3" />
              </div>
              <div>
                <label className="font-mono text-[10px] text-gray-600 mb-1 block">TAKE PROFIT %</label>
                <input className="input-field text-accent-green" type="number" value={form.take_profit_pct} onChange={e => set('take_profit_pct', e.target.value)} placeholder="15" />
              </div>
            </div>
          </div>

          {/* Stop conditions */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-mono text-[10px] text-gray-500 mb-1 block">PROFIT GOAL ($) <span className="text-gray-600">optional</span></label>
              <input className="input-field" type="number" value={form.profit_goal} onChange={e => set('profit_goal', e.target.value)} placeholder="Auto-stop at profit" />
            </div>
            <div>
              <label className="font-mono text-[10px] text-gray-500 mb-1 block">EXPIRY <span className="text-gray-600">optional</span></label>
              <input className="input-field" type="datetime-local" value={form.expiry_at} onChange={e => set('expiry_at', e.target.value)} />
            </div>
          </div>

          {/* Token selection */}
          <div>
            <label className="font-mono text-[10px] text-gray-500 mb-2 block">TOKENS TO WATCH</label>
            <div className="flex flex-wrap gap-2">
              {tokens.map(t => (
                <button
                  key={t.mint}
                  onClick={() => toggleToken(t.mint)}
                  className={`px-3 py-1.5 rounded font-mono text-xs border transition-all ${form.tokens.includes(t.mint) ? 'bg-accent-green/10 border-accent-green text-accent-green' : 'border-border text-gray-500 hover:border-gray-500'}`}
                >
                  {t.symbol}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border flex gap-3">
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
          <button onClick={submit} disabled={loading || !form.name} className="btn-primary flex-1">
            {loading ? 'Creating...' : '✦ Create Strategy'}
          </button>
        </div>
      </div>
    </div>
  )
}

function StrategyCard({ strategy }) {
  const { startStrategy, stopStrategy, deleteStrategy } = useStore()
  const [confirming, setConfirming] = useState(false)
  const config = typeof strategy.config === 'string' ? JSON.parse(strategy.config || '{}') : strategy.config
  const running = strategy.status === 'running'
  const pnl = (strategy.current_capital - strategy.initial_capital)
  const pnlPct = ((pnl / strategy.initial_capital) * 100)
  const capital = strategy.mode === 'paper' ? strategy.paper_capital : strategy.current_capital

  return (
    <div className={`panel animate-slide-in ${running ? 'glow-green' : ''}`}>
      <div className="panel-header">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${running ? 'bg-accent-green animate-pulse-green' : 'bg-gray-600'}`} />
          <div>
            <div className="font-display font-semibold text-sm">{strategy.name}</div>
            <div className="font-mono text-[10px] text-gray-600">{strategy.type.replace(/_/g, ' ').toUpperCase()}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={strategy.mode === 'paper' ? 'badge-paper' : 'badge-live'}>
            {strategy.mode === 'paper' ? '📄' : '⚡'} {strategy.mode.toUpperCase()}
          </span>
          <span className={running ? 'badge-running' : 'badge-stopped'}>
            {running ? '▶ RUNNING' : '■ STOPPED'}
          </span>
        </div>
      </div>

      <div className="p-4 grid grid-cols-4 gap-3">
        <div>
          <div className="font-mono text-[10px] text-gray-600">CAPITAL</div>
          <div className="font-mono text-sm text-white">${(capital || 0).toFixed(2)}</div>
        </div>
        <div>
          <div className="font-mono text-[10px] text-gray-600">P&L</div>
          <div className={`font-mono text-sm font-bold ${pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
            {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
            <span className="text-[10px] ml-1">({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)</span>
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] text-gray-600">RISK CONTROLS</div>
          <div className="font-mono text-[10px] text-gray-400 space-y-0.5">
            {strategy.stop_loss_pct && <div>SL: <span className="text-accent-red">{strategy.stop_loss_pct}%</span></div>}
            {strategy.trailing_stop_pct && <div>TS: <span className="text-accent-yellow">{strategy.trailing_stop_pct}%</span></div>}
            {strategy.take_profit_pct && <div>TP: <span className="text-accent-green">{strategy.take_profit_pct}%</span></div>}
          </div>
        </div>
        <div>
          <div className="font-mono text-[10px] text-gray-600">TOKENS</div>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {(typeof strategy.tokens === 'string' ? JSON.parse(strategy.tokens || '[]') : strategy.tokens || []).slice(0, 4).map(mint => (
              <span key={mint} className="font-mono text-[9px] bg-bg-600 px-1.5 py-0.5 rounded text-gray-400">•</span>
            ))}
          </div>
        </div>
      </div>

      {config?.description && (
        <div className="px-4 pb-3">
          <p className="font-mono text-[10px] text-gray-600 bg-bg-700 rounded px-3 py-2">{config.description}</p>
        </div>
      )}

      <div className="px-4 py-3 border-t border-border flex items-center gap-2">
        {running ? (
          <button onClick={() => stopStrategy(strategy.id)} className="btn-danger">■ STOP</button>
        ) : (
          <button onClick={() => startStrategy(strategy.id)} className="btn-primary">▶ START</button>
        )}
        {confirming ? (
          <>
            <button onClick={() => { deleteStrategy(strategy.id); setConfirming(false) }} className="btn-danger text-[10px]">Confirm Delete</button>
            <button onClick={() => setConfirming(false)} className="btn-ghost">Cancel</button>
          </>
        ) : (
          <button onClick={() => setConfirming(true)} className="btn-ghost">Delete</button>
        )}
        {strategy.profit_goal && <span className="font-mono text-[10px] text-gray-600 ml-auto">Goal: ${strategy.profit_goal}</span>}
        {strategy.expiry_at && <span className="font-mono text-[10px] text-gray-600">Expires: {new Date(strategy.expiry_at).toLocaleDateString()}</span>}
      </div>
    </div>
  )
}

export function Strategies() {
  const { strategies } = useStore()
  const [showModal, setShowModal] = useState(false)

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Strategies</h1>
          <p className="font-mono text-[11px] text-gray-600 mt-0.5">
            {strategies.filter(s => s.status === 'running').length} running · {strategies.length} total · Run multiple simultaneously
          </p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary">
          + New Strategy
        </button>
      </div>

      {strategies.length === 0 ? (
        <div className="panel p-12 text-center">
          <div className="text-4xl mb-4 opacity-20">◈</div>
          <div className="font-display font-semibold text-gray-500 mb-2">No strategies yet</div>
          <p className="font-mono text-xs text-gray-600 mb-6">Create your first trading strategy to get started</p>
          <button onClick={() => setShowModal(true)} className="btn-primary">+ Create First Strategy</button>
        </div>
      ) : (
        <div className="space-y-4">
          {strategies.map(s => <StrategyCard key={s.id} strategy={s} />)}
        </div>
      )}

      {showModal && <StrategyModal onClose={() => setShowModal(false)} />}
    </div>
  )
}
