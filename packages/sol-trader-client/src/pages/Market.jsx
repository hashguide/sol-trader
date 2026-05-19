import { useState, useEffect } from 'react'
import { useStore, api } from '../store'

export function Market() {
  const { tokens, prices, fetchTokens, addToken, removeToken, fetchPrices } = useStore()
  const [scanning, setScanning] = useState(false)
  const [scanResults, setScanResults] = useState([])
  const [addForm, setAddForm] = useState({ mint: '', symbol: '', name: '', decimals: 9 })
  const [tab, setTab] = useState('watched')

  const scan = async () => {
    setScanning(true)
    try {
      const { data } = await api.get('/market/scan')
      setScanResults(data)
      setTab('scan')
    } finally {
      setScanning(false)
    }
  }

  const addFromScan = async (token) => {
    await addToken({ mint: token.mint, symbol: token.symbol, name: token.name, decimals: 9 })
  }

  const addManual = async () => {
    if (!addForm.mint || !addForm.symbol) return
    await addToken(addForm)
    setAddForm({ mint: '', symbol: '', name: '', decimals: 9 })
  }

  const formatPrice = (p) => {
    if (!p) return '—'
    const n = parseFloat(p)
    if (n < 0.0001) return `$${n.toExponential(4)}`
    if (n < 0.01) return `$${n.toFixed(8)}`
    if (n < 1) return `$${n.toFixed(6)}`
    return `$${n.toFixed(2)}`
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Market Scanner</h1>
          <p className="font-mono text-[11px] text-gray-600 mt-0.5">Manage watched tokens and scan for opportunities</p>
        </div>
        <div className="flex gap-3">
          <button onClick={fetchPrices} className="btn-ghost">↻ Refresh Prices</button>
          <button onClick={scan} disabled={scanning} className="btn-primary">
            {scanning ? '⟳ Scanning...' : '◉ Market Scan'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-bg-800 border border-border rounded-lg p-1 w-fit">
        {['watched', 'scan', 'add'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded font-mono text-xs transition-all ${tab === t ? 'bg-accent-green/10 text-accent-green' : 'text-gray-500 hover:text-gray-300'}`}>
            {t === 'watched' ? `WATCHED (${tokens.length})` : t === 'scan' ? `SCAN RESULTS (${scanResults.length})` : 'ADD TOKEN'}
          </button>
        ))}
      </div>

      {tab === 'watched' && (
        <div className="panel">
          <table className="w-full text-left">
            <thead className="border-b border-border">
              <tr>
                {['SYMBOL', 'NAME', 'MINT', 'PRICE', ''].map(h => (
                  <th key={h} className="px-4 py-3 font-mono text-[10px] text-gray-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tokens.map(t => (
                <tr key={t.mint} className="border-b border-border/50 hover:bg-bg-700 transition-colors">
                  <td className="px-4 py-3 font-mono text-sm font-bold text-white">{t.symbol}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{t.name}</td>
                  <td className="px-4 py-3 font-mono text-[10px] text-gray-600">{t.mint.slice(0, 8)}...{t.mint.slice(-4)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-white">{formatPrice(prices[t.mint]?.price)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => removeToken(t.mint)} className="font-mono text-[10px] text-gray-600 hover:text-accent-red transition-colors">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'scan' && (
        <div className="panel">
          {scanResults.length === 0 ? (
            <div className="p-8 text-center font-mono text-xs text-gray-600">Run a scan to discover tokens</div>
          ) : (
            <table className="w-full text-left">
              <thead className="border-b border-border">
                <tr>
                  {['SYMBOL', 'NAME', 'PRICE', 'MINT', ''].map(h => (
                    <th key={h} className="px-4 py-3 font-mono text-[10px] text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scanResults.map(t => {
                  const watching = tokens.some(tok => tok.mint === t.mint)
                  return (
                    <tr key={t.mint} className="border-b border-border/50 hover:bg-bg-700 transition-colors">
                      <td className="px-4 py-3 font-mono text-sm font-bold text-white">{t.symbol}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{t.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-white">{formatPrice(t.price)}</td>
                      <td className="px-4 py-3 font-mono text-[10px] text-gray-600">{t.mint?.slice(0, 8)}...</td>
                      <td className="px-4 py-3">
                        {watching ? (
                          <span className="font-mono text-[10px] text-accent-green">✓ Watching</span>
                        ) : (
                          <button onClick={() => addFromScan(t)} className="font-mono text-[10px] text-accent-blue hover:text-white transition-colors">+ Watch</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'add' && (
        <div className="panel max-w-md">
          <div className="panel-header">
            <span className="font-mono text-xs text-gray-400">ADD TOKEN MANUALLY</span>
          </div>
          <div className="p-5 space-y-3">
            <div>
              <label className="font-mono text-[10px] text-gray-500 mb-1 block">TOKEN MINT ADDRESS</label>
              <input className="input-field font-mono text-[11px]" value={addForm.mint} onChange={e => setAddForm(f => ({ ...f, mint: e.target.value }))} placeholder="So11111111111111111111..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-mono text-[10px] text-gray-500 mb-1 block">SYMBOL</label>
                <input className="input-field" value={addForm.symbol} onChange={e => setAddForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))} placeholder="SOL" />
              </div>
              <div>
                <label className="font-mono text-[10px] text-gray-500 mb-1 block">NAME</label>
                <input className="input-field" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} placeholder="Solana" />
              </div>
            </div>
            <div>
              <label className="font-mono text-[10px] text-gray-500 mb-1 block">DECIMALS</label>
              <input className="input-field" type="number" value={addForm.decimals} onChange={e => setAddForm(f => ({ ...f, decimals: parseInt(e.target.value) }))} />
            </div>
            <button onClick={addManual} className="btn-primary w-full">+ Add Token</button>
          </div>
        </div>
      )}
    </div>
  )
}
