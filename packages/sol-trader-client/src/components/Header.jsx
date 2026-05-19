import { useStore } from '../store'

export function Header() {
  const { wallet, prices, tokens, wsConnected } = useStore()

  const solPrice = prices?.['So11111111111111111111111111111111111111112']?.price

  return (
    <header className="h-10 bg-bg-900 border-b border-border flex items-center px-4 gap-6 flex-shrink-0">
      {/* Ticker */}
      <div className="flex-1 overflow-hidden relative">
        <div className="flex gap-8 animate-none">
          {tokens.slice(0, 8).map(t => {
            const p = prices[t.mint]
            if (!p) return null
            const price = parseFloat(p.price)
            return (
              <div key={t.mint} className="flex items-center gap-2 flex-shrink-0">
                <span className="font-mono text-[10px] text-gray-500">{t.symbol}</span>
                <span className="font-mono text-[10px] text-white">${price < 0.01 ? price.toFixed(8) : price < 1 ? price.toFixed(4) : price.toFixed(2)}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Wallet */}
      {wallet.address && (
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-accent-green" />
          <span className="font-mono text-[10px] text-gray-500">{wallet.address.slice(0, 4)}...{wallet.address.slice(-4)}</span>
          {wallet.balance != null && <span className="font-mono text-[10px] text-gray-400">{wallet.balance?.toFixed(3)} SOL</span>}
        </div>
      )}

      {/* WS Status */}
      <div className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-accent-green animate-pulse-green' : 'bg-accent-red'}`} />
        <span className="font-mono text-[10px] text-gray-600">{wsConnected ? 'LIVE' : 'OFFLINE'}</span>
      </div>
    </header>
  )
}
