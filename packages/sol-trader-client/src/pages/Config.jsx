import { useState, useEffect } from 'react'
import { useStore } from '../store'

export function Config() {
  const { config, wallet, saveConfig, fetchWallet } = useStore()
  const [form, setForm] = useState({ rpc_url: '', private_key: '' })
  const [saved, setSaved] = useState(false)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    setForm({ rpc_url: config.rpc_url || '', private_key: '' })
  }, [config])

  const save = async () => {
    const toSave = { rpc_url: form.rpc_url }
    if (form.private_key) toSave.private_key = form.private_key
    await saveConfig(toSave)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="font-display text-2xl font-bold">Configuration</h1>
        <p className="font-mono text-[11px] text-gray-600 mt-0.5">Wallet, RPC, and bot settings</p>
      </div>

      {/* Wallet Status */}
      <div className="panel">
        <div className="panel-header">
          <span className="font-mono text-xs text-gray-400 tracking-wider">WALLET STATUS</span>
        </div>
        <div className="p-5">
          {wallet.address ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-accent-green animate-pulse-green" />
                <span className="font-mono text-xs text-accent-green">WALLET CONNECTED</span>
              </div>
              <div>
                <div className="font-mono text-[10px] text-gray-600 mb-1">ADDRESS</div>
                <div className="font-mono text-sm bg-bg-700 px-3 py-2 rounded border border-border text-gray-300 break-all">{wallet.address}</div>
              </div>
              {wallet.balance != null && (
                <div>
                  <div className="font-mono text-[10px] text-gray-600 mb-1">SOL BALANCE</div>
                  <div className="font-mono text-xl font-bold text-white">{wallet.balance?.toFixed(4)} SOL</div>
                </div>
              )}
              <a href={`https://solscan.io/account/${wallet.address}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[10px] text-accent-blue hover:underline">View on Solscan →</a>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-gray-600" />
              <span className="font-mono text-xs text-gray-600">No wallet configured</span>
            </div>
          )}
        </div>
      </div>

      {/* Connection Settings */}
      <div className="panel">
        <div className="panel-header">
          <span className="font-mono text-xs text-gray-400 tracking-wider">CONNECTION</span>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="font-mono text-[10px] text-gray-500 mb-1 block">RPC URL</label>
            <input
              className="input-field"
              value={form.rpc_url}
              onChange={e => setForm(f => ({ ...f, rpc_url: e.target.value }))}
              placeholder="https://api.mainnet-beta.solana.com"
            />
            <p className="font-mono text-[9px] text-gray-700 mt-1">Use a dedicated RPC for better performance (Helius, QuickNode, etc.)</p>
          </div>

          <div>
            <label className="font-mono text-[10px] text-gray-500 mb-1 block">PRIVATE KEY (Base58)</label>
            <div className="relative">
              <input
                className="input-field pr-16"
                type={showKey ? 'text' : 'password'}
                value={form.private_key}
                onChange={e => setForm(f => ({ ...f, private_key: e.target.value }))}
                placeholder="Enter to update wallet..."
              />
              <button onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-gray-600 hover:text-gray-400">
                {showKey ? 'HIDE' : 'SHOW'}
              </button>
            </div>
            <div className="flex items-start gap-2 mt-2 p-3 bg-accent-red/5 border border-accent-red/20 rounded">
              <span className="text-accent-red mt-0.5">⚠</span>
              <p className="font-mono text-[9px] text-gray-500">Your private key is stored locally in the SQLite database and never transmitted externally. Use a dedicated trading wallet with limited funds.</p>
            </div>
          </div>

          <button onClick={save} className="btn-primary">
            {saved ? '✓ Saved' : 'Save Configuration'}
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="panel p-5 space-y-3">
        <div className="font-mono text-[10px] text-gray-500 tracking-wider">SYSTEM INFO</div>
        <div className="space-y-2 font-mono text-xs">
          <div className="flex justify-between text-gray-500">
            <span>API</span><span className="text-gray-400">http://localhost:3001</span>
          </div>
          <div className="flex justify-between text-gray-500">
            <span>WebSocket</span><span className="text-gray-400">ws://localhost:3001/ws</span>
          </div>
          <div className="flex justify-between text-gray-500">
            <span>Jupiter API</span><span className="text-gray-400">jup.ag/v6</span>
          </div>
          <div className="flex justify-between text-gray-500">
            <span>AI Model</span><span className="text-gray-400">claude-sonnet-4</span>
          </div>
          <div className="flex justify-between text-gray-500">
            <span>Database</span><span className="text-gray-400">SQLite (local)</span>
          </div>
        </div>
      </div>
    </div>
  )
}
