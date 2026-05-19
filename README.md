# NEXUS — Solana AI Trading Bot

A full-stack Solana trading bot with AI-powered strategy management, paper trading, live trading via Jupiter, real-time charts, and an AI chat interface.

## Architecture

```
solana-trading-bot/
├── server/          # Express + WebSocket backend
│   └── src/
│       ├── index.js      # Entry point
│       ├── db.js         # SQLite schema & queries
│       ├── engine.js     # Strategy engine (event-based)
│       ├── ai.js         # Anthropic AI integration
│       ├── jupiter.js    # Jupiter DEX + price APIs
│       ├── routes.js     # REST API endpoints
│       └── websocket.js  # Real-time event broadcasting
└── client/          # React + Vite frontend
    └── src/
        ├── App.jsx
        ├── store/        # Zustand global state
        ├── hooks/        # useWebSocket
        ├── components/   # Sidebar, Header, Notifications
        └── pages/        # Dashboard, Strategies, Trades, etc.
```

## Setup

### 1. Install dependencies

```bash
npm install
cd server && npm install
cd ../client && npm install
```

### 2. Configure environment

```bash
cp server/.env.example server/.env
# Edit server/.env — add your ANTHROPIC_API_KEY
```

### 3. Development

```bash
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001/api
- WebSocket: ws://localhost:3001/ws

### 4. Production build

```bash
npm run build     # Builds client into server/public
npm run start     # Serves everything from port 3001
```

## Configuration (via UI)

Go to **Config** tab and enter:
- **RPC URL** — Use a fast RPC (Helius, QuickNode, Alchemy recommended)
- **Private Key** — Base58 encoded key for live trading

> ⚠️ Always use a **dedicated trading wallet** with only the funds you intend to trade.

## Strategy Types

| Type | Description |
|------|-------------|
| `ai_dynamic` | Full AI decision-making every 45s |
| `momentum` | Follow price momentum with AI confirmation |
| `mean_reversion` | Buy dips, sell pumps |
| `breakout` | Enter on price level breaks |
| `scalp` | Quick entries/exits, 15s intervals |
| `swing` | Longer holds, 5min intervals |
| `dca` | Dollar cost averaging |
| `grid` | Grid trading strategy |

## Trading Modes

### Paper Trading
- No real funds used
- Simulates 0.25% fee
- Tracks virtual capital separately
- Perfect for backtesting strategies

### Live Trading
- Executes real swaps via Jupiter v6
- Automatic retry (3x) on failures
- AI risk assessment before every trade
- Event-based confirmation system

## Risk Controls Per Strategy

- **Stop Loss %** — Auto-close at X% loss
- **Trailing Stop %** — Dynamic stop that follows price up
- **Take Profit %** — Auto-close at X% gain
- **Max Position Size %** — Limit per-trade capital usage
- **Profit Goal $** — Auto-stop strategy when reached
- **Expiry** — Auto-stop strategy at date/time
- **Capital floor** — Auto-stops at 95% loss

## API Reference

```
GET  /api/strategies           List all strategies
POST /api/strategies           Create strategy
PUT  /api/strategies/:id       Update strategy
DEL  /api/strategies/:id       Delete strategy
POST /api/strategies/:id/start Start strategy
POST /api/strategies/:id/stop  Stop strategy

GET  /api/trades               Trade history
GET  /api/positions            Open positions
GET  /api/performance          Performance by date
GET  /api/performance/summary  Summary per strategy

GET  /api/market/tokens        Watched tokens
POST /api/market/tokens        Add token
DEL  /api/market/tokens/:mint  Remove token
GET  /api/market/prices        Current prices
GET  /api/market/scan          Scan for top tokens
GET  /api/market/history/:mint Price history

POST /api/chat                 AI chat
GET  /api/signals              AI signals log
GET  /api/wallet               Wallet info
POST /api/config               Save config
```

## WebSocket Events

```
connected          — WS connection established
strategy_update    — Strategy status changed
strategy_error     — Strategy encountered error
trade_opened       — New trade initiated
trade_filled       — Trade executed successfully
trade_closed       — Position closed with PnL
trade_failed       — Trade execution failed
trade_retry        — Retrying failed trade
trade_blocked      — Trade blocked by risk check
ai_signal          — AI generated a signal
```

## Disclaimer

This software is for educational purposes. Trading cryptocurrencies involves significant risk. Never trade with funds you cannot afford to lose. Always test strategies in paper mode first.
