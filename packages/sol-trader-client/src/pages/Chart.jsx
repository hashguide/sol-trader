import { useEffect, useRef, useState } from 'react'
import { useStore, api } from '../store'

function computeRSI(prices, period = 14) {
  if (prices.length < period + 1) return []
  const rsi = []
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1]
    if (diff > 0) gains += diff; else losses += Math.abs(diff)
  }
  let avgGain = gains / period
  let avgLoss = losses / period
  rsi.push(100 - 100 / (1 + avgGain / (avgLoss || 0.0001)))
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1]
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period
    rsi.push(100 - 100 / (1 + avgGain / (avgLoss || 0.0001)))
  }
  return rsi
}

function computeEMA(prices, period) {
  if (prices.length < period) return []
  const k = 2 / (period + 1)
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period
  const result = [ema]
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k)
    result.push(ema)
  }
  return result
}

function computeBollingerBands(prices, period = 20) {
  const result = []
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1)
    const mean = slice.reduce((a, b) => a + b, 0) / period
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period)
    result.push({ upper: mean + 2 * std, middle: mean, lower: mean - 2 * std })
  }
  return result
}

export function Chart() {
  const { tokens, prices } = useStore()
  const chartRef = useRef(null)
  const [selectedToken, setSelectedToken] = useState(tokens[0]?.mint || '')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [indicator, setIndicator] = useState('none')

  useEffect(() => {
    if (tokens.length && !selectedToken) setSelectedToken(tokens[0]?.mint)
  }, [tokens])

  useEffect(() => {
    if (!selectedToken) return
    setLoading(true)
    api.get(`/market/history/${selectedToken}`, { params: { limit: 300 } })
      .then(({ data }) => setHistory(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [selectedToken])

  const tokenInfo = tokens.find(t => t.mint === selectedToken)
  const currentPrice = prices[selectedToken]?.price

  const chartData = history.map((h, i) => ({
    time: new Date(h.recorded_at).getTime(),
    price: parseFloat(h.price),
    index: i,
  }))

  const priceArr = chartData.map(d => d.price)
  const rsiData = computeRSI(priceArr)
  const ema20Data = computeEMA(priceArr, 20)
  const ema50Data = computeEMA(priceArr, 50)
  const bbData = computeBollingerBands(priceArr)

  const minPrice = priceArr.length ? Math.min(...priceArr) * 0.995 : 0
  const maxPrice = priceArr.length ? Math.max(...priceArr) * 1.005 : 1

  // Simple SVG chart since we can't use DOM manipulation for lightweight-charts
  const W = 800, H = 280
  const toX = (i) => (i / (chartData.length - 1)) * W
  const toY = (p) => H - ((p - minPrice) / (maxPrice - minPrice)) * H

  const pricePoints = chartData.map((d, i) => `${toX(i)},${toY(d.price)}`).join(' ')

  const ema20Start = priceArr.length - ema20Data.length
  const ema20Points = ema20Data.map((v, i) => `${toX(ema20Start + i)},${toY(v)}`).join(' ')

  const ema50Start = priceArr.length - ema50Data.length
  const ema50Points = ema50Data.map((v, i) => `${toX(ema50Start + i)},${toY(v)}`).join(' ')

  const bbStart = priceArr.length - bbData.length
  const bbUpperPoints = bbData.map((v, i) => `${toX(bbStart + i)},${toY(v.upper)}`).join(' ')
  const bbLowerPoints = bbData.map((v, i) => `${toX(bbStart + i)},${toY(v.lower)}`).join(' ')
  const bbLowerReverse = bbData.map((v, i) => `${toX(bbStart + bbData.length - 1 - i)},${toY(bbData[bbData.length - 1 - i].lower)}`).join(' ')

  const lastRsi = rsiData[rsiData.length - 1]

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Charts</h1>
          <p className="font-mono text-[11px] text-gray-600 mt-0.5">Price history with technical indicators</p>
        </div>
        <div className="flex gap-3">
          <select className="select-field w-36" value={selectedToken} onChange={e => setSelectedToken(e.target.value)}>
            {tokens.map(t => <option key={t.mint} value={t.mint}>{t.symbol}</option>)}
          </select>
          <select className="select-field w-36" value={indicator} onChange={e => setIndicator(e.target.value)}>
            <option value="none">No Indicator</option>
            <option value="ema">EMA 20/50</option>
            <option value="bb">Bollinger Bands</option>
            <option value="rsi">RSI</option>
          </select>
        </div>
      </div>

      {/* Price header */}
      <div className="panel p-4 flex items-center gap-6">
        <div>
          <div className="font-mono text-[10px] text-gray-600">TOKEN</div>
          <div className="font-display font-bold text-xl">{tokenInfo?.symbol || '—'}</div>
        </div>
        <div>
          <div className="font-mono text-[10px] text-gray-600">CURRENT PRICE</div>
          <div className="font-mono text-xl font-bold text-white">{currentPrice ? `$${parseFloat(currentPrice).toFixed(4)}` : '—'}</div>
        </div>
        {history.length >= 2 && (() => {
          const first = parseFloat(history[0]?.price || 0)
          const last = parseFloat(history[history.length - 1]?.price || 0)
          const chg = ((last - first) / first) * 100
          return (
            <div>
              <div className="font-mono text-[10px] text-gray-600">CHANGE ({history.length} bars)</div>
              <div className={`font-mono text-lg font-bold ${chg >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</div>
            </div>
          )
        })()}
        {lastRsi != null && (
          <div>
            <div className="font-mono text-[10px] text-gray-600">RSI (14)</div>
            <div className={`font-mono text-lg font-bold ${lastRsi > 70 ? 'text-accent-red' : lastRsi < 30 ? 'text-accent-green' : 'text-gray-300'}`}>{lastRsi.toFixed(1)}</div>
          </div>
        )}
        <div className="ml-auto font-mono text-[10px] text-gray-600">{history.length} data points</div>
      </div>

      {/* Main chart */}
      <div className="panel p-4">
        <div className="font-mono text-[10px] text-gray-600 mb-3">PRICE CHART</div>
        {loading ? (
          <div className="h-[280px] flex items-center justify-center font-mono text-xs text-gray-600">Loading...</div>
        ) : chartData.length < 2 ? (
          <div className="h-[280px] flex items-center justify-center font-mono text-xs text-gray-600">Not enough data — start a strategy to collect price history</div>
        ) : (
          <div className="overflow-hidden rounded">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 280, background: '#0c0d10' }}>
              {/* Grid lines */}
              {[0.25, 0.5, 0.75].map(pct => (
                <line key={pct} x1="0" y1={H * pct} x2={W} y2={H * pct} stroke="#1e2028" strokeWidth="1" />
              ))}
              {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => (
                <text key={i} x="4" y={H * pct + 4} fill="#555" fontSize="9" fontFamily="JetBrains Mono">
                  ${(minPrice + (maxPrice - minPrice) * (1 - pct)).toFixed(4)}
                </text>
              ))}

              {/* Bollinger Bands */}
              {indicator === 'bb' && bbData.length > 1 && (
                <>
                  <polygon points={`${bbUpperPoints} ${bbLowerReverse}`} fill="rgba(77,158,255,0.05)" />
                  <polyline points={bbUpperPoints} fill="none" stroke="#4d9eff" strokeWidth="0.8" strokeDasharray="3,3" />
                  <polyline points={bbLowerPoints} fill="none" stroke="#4d9eff" strokeWidth="0.8" strokeDasharray="3,3" />
                </>
              )}

              {/* EMA lines */}
              {indicator === 'ema' && (
                <>
                  {ema20Data.length > 1 && <polyline points={ema20Points} fill="none" stroke="#ffcc00" strokeWidth="1" />}
                  {ema50Data.length > 1 && <polyline points={ema50Points} fill="none" stroke="#a855f7" strokeWidth="1" />}
                </>
              )}

              {/* Price gradient fill */}
              <defs>
                <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00ff88" stopOpacity="0.15" />
                  <stop offset="100%" stopColor="#00ff88" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon
                points={`0,${H} ${pricePoints} ${W},${H}`}
                fill="url(#chartFill)"
              />
              <polyline points={pricePoints} fill="none" stroke="#00ff88" strokeWidth="1.5" />
            </svg>
          </div>
        )}
        {indicator === 'ema' && <div className="flex gap-4 mt-2">
          <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-yellow-400" /><span className="font-mono text-[10px] text-gray-500">EMA 20</span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-0.5 bg-purple-500" /><span className="font-mono text-[10px] text-gray-500">EMA 50</span></div>
        </div>}
      </div>

      {/* RSI panel */}
      {indicator === 'rsi' && rsiData.length > 2 && (
        <div className="panel p-4">
          <div className="font-mono text-[10px] text-gray-600 mb-3">RSI (14)</div>
          <svg viewBox={`0 0 ${W} 80`} className="w-full" style={{ height: 80, background: '#0c0d10' }}>
            <line x1="0" y1={80 * (1 - 70 / 100)} x2={W} y2={80 * (1 - 70 / 100)} stroke="#ff3b5c" strokeWidth="0.5" strokeDasharray="3,3" />
            <line x1="0" y1={80 * (1 - 30 / 100)} x2={W} y2={80 * (1 - 30 / 100)} stroke="#00ff88" strokeWidth="0.5" strokeDasharray="3,3" />
            <line x1="0" y1={80 * 0.5} x2={W} y2={80 * 0.5} stroke="#333" strokeWidth="0.5" />
            <polyline
              points={rsiData.map((v, i) => `${(i / (rsiData.length - 1)) * W},${80 * (1 - v / 100)}`).join(' ')}
              fill="none" stroke="#4d9eff" strokeWidth="1.5"
            />
          </svg>
          <div className="flex justify-between mt-1">
            <span className="font-mono text-[9px] text-gray-600">RSI 14</span>
            <span className="font-mono text-[9px] text-accent-red">Overbought: 70</span>
            <span className="font-mono text-[9px] text-accent-green">Oversold: 30</span>
          </div>
        </div>
      )}
    </div>
  )
}
