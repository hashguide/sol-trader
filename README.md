# Meridian

Meridian is a headless crypto trading engine with a desk in front of it. The engine is its own long-running process. It keeps the journal, the positions, and the loop whether or not a browser is connected. The desk is a window: when it opens it reads the stored book and subscribes to live updates. Settings saved in the desk are written to the same database and the running engine uses them on the next decision. RPC edits replace the live pool immediately.

Paper mode is the default. Nothing here is assumed to be profitable. The walk-forward below is the evidence, including the sleeves that fail.

## Architecture

Two processes, one repository, one database.

- `engine/main.ts` is the trader. It listens on `127.0.0.1:4471`, writes SQLite at `data/meridian.db`, and is the only process that can send an order.
- The Next.js desk listens on `127.0.0.1:4472` and proxies `/api` to the engine, so the session cookie stays on one origin. Server-sent events carry the snapshot.
- Closing the browser does not stop the loop. Stopping the loop is an explicit control, and that choice is stored (`desiredRunning`) so a restart resumes it.
- First boot does not trade. The engine stays up and idle until a desk password exists and someone starts the loop, or `ENGINE_AUTOSTART=true` is set after the password exists. A missing live key does not silently fall back to paper, and it does not crash the process.
- In Docker, the engine exiting stops the container. The desk exiting restarts only the desk. Compose publishes `127.0.0.1:4472` and restarts unless the container is stopped.

State lives in SQLite (WAL): settings, sessions, encrypted wallet keys, trades, the decision log, equity, alerts, and backtest reports. Wallet keys use AES-256-GCM. The master key is `SECRETS_KEY` or `data/secrets.key` (mode 0600). Logs redact private keys, passwords, and ciphertext. The desk never receives a key back after it is saved.

## Workstation desk

The desk is a single chart-centric workstation, not a stack of unrelated routes. Persistent status shows loop running/stopped, paper/live, stream health, and kill state. Pair selection drives the chart and a contextual inspector (signal, position, activity, gate). Positions and the decision journal sit in the activity dock. Research, risk, network/wallets, readiness, and system open as drawers (`/?panel=research`, etc.) or via ⌘K. Closing the browser does not stop the engine.

## Run locally


```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://127.0.0.1:4472](http://127.0.0.1:4472). The first visit asks for a password of at least 12 characters. Then start the loop from the book page. The engine is already running as a process before that click; the click is what lets it take risk.

```bash
npm test
npm run typecheck
npm run lint
npm run backtest
npm run paper:smoke
```

`npm run backtest` rewrites `reports/walk-forward.json` from `data/candles` and stores the same report in SQLite. `npm run paper:smoke` runs three paper iterations against public market data in a throwaway database and asserts that the live broker is not called.

## Docker and boot

```bash
docker compose up -d --build
```

The image seeds `data/candles` from the bundled research candles when the volume is empty. Set `DASHBOARD_PASSWORD` before `ENGINE_AUTOSTART=true`, or the loop stays idle until the desk password is created and the loop is started once. After that, `desiredRunning` survives restarts.

A host systemd unit is the same shape. `Restart=always` brings the engine back; the desk is not required.

```ini
[Service]
WorkingDirectory=/opt/meridian
ExecStart=/usr/bin/node dist/docker-entry.js
Restart=always
Environment=NODE_ENV=production
Environment=ENGINE_AUTOSTART=true
Environment=WEB_BIND=127.0.0.1
```

Build with `npm run build` first. `dist/docker-entry.js` starts the engine and `next start`.

## Chains and venues

| Chain | Chain id | Trading default | Notes |
| --- | --- | --- | --- |
| Solana | — | On | Jupiter spot. SOL shorts go to Hyperliquid. |
| Base | 8453 | On | Uniswap v3 for WETH, Aerodrome for AERO. |
| Arbitrum | 42161 | On | Uniswap v3 WETH/USDC, 5 bps pool. |
| Ethereum | 1 | Off | Adapter and balances work. Spot is off because L1 gas swamps a small book. Sends use Flashbots Protect unless `FLASHBOTS_PROTECT=false`. |
| Robinhood Chain | 4663 | Off | Mainnet was answering `eth_chainId` `0x1237` on 2026-11-05 at `https://rpc.mainnet.chain.robinhood.com`. The public RPC is rate limited. Pools exist and are thin. No router addresses are configured, so the chain cannot trade until those addresses are set. Enabling it is a config change. |

RPC order is QuickNode, Alchemy, Infura, then the public endpoint. Empty env vars are skipped. Failover covers HTTP 429, 5xx, rate-limit error codes, and timeouts. An application error such as a revert does not fail over. A chain with no endpoints is refused. Health, latency, and a redacted URL are on the Network page. A URL saved there replaces that chain's list on the running pool.

Spot routing is Jupiter on Solana, Uniswap v3 `quoteExactInputSingle` on Ethereum, Base, and Arbitrum, and Aerodrome `getAmountOut` for the AERO pool. Quotes are simulated before a live send, and a quote whose price impact exceeds the cap is thrown away before the transaction is built. A 0x route is not implemented. `ZEROX_API_KEY` is reserved.

Shorts: a spot DEX cannot open a short. If the coin is listed on Hyperliquid (SOL, ETH, AERO), a short is a 1x isolated IOC. RAY is not listed, so a RAY short signal stays flat and does not close an existing long. Stops in the journal are software stops. Hyperliquid orders are IOC, not trigger stops resting on the book. A gap through the stop fills at the next mark the engine sees.

Checked against the live endpoints on 2026-11-05, without sending a funded order:

- Base Uniswap v3 quoted 0.001 WETH to about 2.42 USDC.
- Aerodrome quoted 1 AERO to about 0.65 USDC.
- Jupiter lite API quoted 0.01 SOL to about 0.96 USDC, with no API key.
- An unfunded Hyperliquid IOC was rejected with `User or API Wallet … does not exist`, which means the signature was accepted far enough to identify the account. It was not a fill.

## Strategies

The regime router reads ADX. At or above 25 it tries trend, then breakout. At or below 18 it tries mean reversion. Between those it is a transition: no new entries, existing exits still run. Parameters are pre-registered and were not changed after the results below.

- Trend: EMA 20/50, ADX 14 with a minimum of 25, stop 2 ATR, target 3 ATR, trail 1.5 ATR, 48 bar maximum.
- Breakout: prior 20-bar Donchian, volume above 1.5 times the prior 20-bar average, same stop and target, 36 bar maximum.
- Mean reversion: RSI 14 at 30/70, Bollinger 20/2, stop 1.5 ATR, target the midline, exit if RSI returns to 55, 24 bar maximum.

The sensitivity grid is a stability check, not a search. Trend and the composite are re-run at ADX 22/25/28. Breakout volume multiplier at 1.3/1.5/1.8. Mean reversion oversold at 25/30/35. The middle value is the one that trades.

## Risk

Defaults, clamped if the desk sends something outside the range:

- 0.75% of equity at risk per trade, then a 10% position cap.
- 4 concurrent positions, 40% per chain, 15% per token group. Base WETH and Arbitrum WETH share the ETH group. The per-pair backtests do not model that overlap.
- Daily drawdown kill at 3%, total drawdown kill at 10%. Either one flattens and latches.
- Slippage cap 50 bps on entries, price impact cap 100 bps, emergency exit slippage 150 bps.
- Gas may not exceed 25% of a conservative edge that assumes a 45% win rate.
- A 15% bar move, a candle older than 120 minutes, or a mark more than 5% away from the last close blocks new entries. A bad print does not force a flatten.
- The kill switch blocks entries and flattens. `KILL_SWITCH=true` or a `data/KILL` file cannot be cleared from the desk.
- Live entries require the sleeve to be eligible unless `LIVE_OVERRIDE_GATES=true`. Leave that off. Paper may trade a sleeve that has not passed, so the paper record can accumulate.

## Promotion

A sleeve is live-eligible only when all of these hold: out-of-sample expectancy above 0, profit factor above 1.3, max drawdown under 15% with at least one trade, at least 30 trades, at least 4 walk-forward windows, at least 55% of windows profitable, at least 67% of the sensitivity grid stable, and a paper record of at least 10 trades with profit factor above 1.1 and drawdown under 15%. Status is `fail`, `backtest_pass_pending_paper`, or `eligible`. No sleeve is eligible yet, because none has the paper record.

Fills in the backtest: signal on the close, entry at the next open. If stop and target are both touched in a bar, the stop fills. Fees are charged both sides. Slippage is 5 bps plus `0.1 * sqrt(notional / bar volume)`. Gas is a flat estimate: Solana $0.05, Base $0.03, Arbitrum $0.08, Ethereum $1.50, Robinhood $0.02. Perp funding is a constant 1 bp per 8 hours, not historical funding. Windows are 7 days, non-overlapping, after 80 warmup bars. The full sample overlaps those windows and is not a gate.

## Walk-forward, 5 Nov 2026

4,995 closed hourly bars per pair, from GeckoTerminal, cached in `data/candles`. About 208 days and 29 out-of-sample windows. Costs are included in the PnL. These parameters were not retuned after the table was produced.

| Pair | Sleeve | OOS PnL | Expectancy | Profit factor | Max DD | Trades | Gate |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| SOL/USDC | trend | −$324 | −$4.10 | 0.33 | 4.0% | 79 | fail |
| SOL/USDC | breakout | −$389 | −$3.04 | 0.62 | 4.3% | 128 | fail |
| SOL/USDC | mean reversion | +$282 | +$3.72 | 1.45 | 1.5% | 76 | paper only |
| SOL/USDC | composite | −$365 | −$2.50 | 0.62 | 4.5% | 146 | fail |
| RAY/USDC | trend | +$161 | +$80.35 | — | 0.1% | 2 | fail |
| RAY/USDC | breakout | +$60 | +$6.72 | 1.32 | 1.0% | 9 | fail |
| RAY/USDC | mean reversion | $0 | — | — | 0% | 0 | fail |
| RAY/USDC | composite | +$222 | +$20.18 | 2.18 | 0.8% | 11 | fail |
| WETH/USDC Base | trend | −$138 | −$3.95 | 0.29 | 1.5% | 35 | fail |
| WETH/USDC Base | breakout | −$437 | −$3.10 | 0.50 | 4.7% | 141 | fail |
| WETH/USDC Base | mean reversion | −$428 | −$3.63 | 0.60 | 5.4% | 118 | fail |
| WETH/USDC Base | composite | −$576 | −$4.72 | 0.30 | 6.0% | 122 | fail |
| WETH/USDC Arbitrum | trend | +$778 | +$2.94 | 4.82 | 0.8% | 265 | paper only |
| WETH/USDC Arbitrum | breakout | −$47 | −$15.63 | 0.00 | 0.5% | 3 | fail |
| WETH/USDC Arbitrum | mean reversion | +$26 | +$12.78 | — | 0% | 2 | fail |
| WETH/USDC Arbitrum | composite | +$778 | +$2.94 | 4.82 | 0.8% | 265 | paper only |
| AERO/USDC | trend | −$42 | −$21.14 | 0.00 | 0.5% | 2 | fail |
| AERO/USDC | breakout | −$379 | −$12.62 | 0.46 | 4.3% | 30 | fail |
| AERO/USDC | mean reversion | −$260 | −$11.83 | 0.53 | 3.4% | 22 | fail |
| AERO/USDC | composite | −$188 | −$9.89 | 0.52 | 2.9% | 19 | fail |

A dash profit factor means every trade won, which is not a pass when the sample is two trades. SOL mean reversion won 43 of 76, held 7.7 hours on average, and still netted positive after $82 of fees, $8 of gas, and $291 of modeled slippage. The sensitivity grid at RSI 25/30/35 stayed positive. That is the result worth watching.

Arbitrum WETH trend also cleared the backtest gates, and the composite equals it because the router took the same trades. Read it skeptically. Average hold is 0.7 hours, win rate is 89%, exposure is 3.6%, and modeled slippage is $1,701 against $778 of net profit. The Sharpe of 12.9 is what a smooth, rarely invested equity curve produces. Same-bar stops and targets assume that if only the target was touched, the path reached it. Paper has to reproduce the expectancy before this sleeve deserves size. Base WETH, the same asset at a 30 bps fee instead of 5 bps, lost money. The fee difference is a real part of the story, not a reason to ignore the hold time.

## What to paper trade

Paper only:

1. SOL/USDC mean reversion. This is the sleeve to watch. Hold time and costs look like a strategy rather than a scalp, and the grid did not flip sign.
2. Arbitrum WETH/USDC trend, as a confirmation exercise, not as a strategy to size. If paper expectancy is near zero or the hold time stays under an hour, drop it.

Do not paper the composites except as a record of the router. The SOL composite lost money because trend and breakout overwhelmed mean reversion. The Arbitrum composite passed by copying the trend sleeve.

Do not go live. No sleeve has a paper record, so none is eligible. Do not lower the gates to make the table greener.

## What is implemented, and what is not

Implemented: RPC failover, Solana and EVM adapters, Jupiter, Uniswap v3, and Aerodrome quotes, Hyperliquid IOC signing, paper and live mode with a confirmation phrase, the risk checks, software stops, walk-forward, the decision journal, encrypted keys, alerts to a webhook or Telegram, and the desk.

Not implemented, on purpose until they are needed: Birdeye candles, a 0x route, and GoPlus token checks. Universe screening uses liquidity, volume, pool age, and a honeypot/tax flag when a caller supplies one. Trending-pool scans do not yet attach a third-party honeypot score. Live restart compares an open spot position to the wallet balance and an open perp to the Hyperliquid book, records the difference, and does not rewrite the journal on a failed or partial read. Historical funding and historical gas are not in the fill model.

## Going live

Do this only after a sleeve is `eligible` on the research page. Then:

1. Create dedicated hot wallets. One Solana key. One EVM key is enough for Base and Arbitrum if you accept a shared key; per-chain keys are better. Do not use a vault key.
2. Fund only trading capital. Spot needs USDC plus a little native gas (SOL, and ETH on Base and on Arbitrum). Ethereum stays off unless a position is large enough to clear the gas check.
3. For shorts, the EVM key is the Hyperliquid account. Fund it on Hyperliquid, separate from the spot USDC. SOL, ETH, and AERO have markets. RAY does not.
4. Do not fund Robinhood Chain. It is not enabled.
5. Put the keys in the environment or paste them once into the Network page. The desk stores the ciphertext and shows the address.

```bash
SOLANA_PRIVATE_KEY=
BASE_PRIVATE_KEY=
ARBITRUM_PRIVATE_KEY=
# or a single EVM_PRIVATE_KEY for every EVM chain that has no specific key
RPC_SOLANA_QUICKNODE=
RPC_BASE_QUICKNODE=
RPC_ARBITRUM_QUICKNODE=
# Alchemy and Infura are optional fallbacks: RPC_<CHAIN>_ALCHEMY, RPC_<CHAIN>_INFURA
TRADING_MODE=live
```

6. On the desk, switch to live and type `ENABLE LIVE TRADING`. Start stays refused if any chain with trading enabled has no key, or if a perp market is on and no EVM key can sign.
7. Keep `LIVE_OVERRIDE_GATES` unset. Keep the daily and total drawdown kills. Start with the default 0.75% risk and the 10% position cap, on the eligible pair only. Turn the other pairs off.

Every variable the process reads is listed in `.env.example`.

## Adding an EVM chain

Add a `ChainConfig` to `CHAINS` in `engine/config.ts` with the chain id, public RPC, gas estimate, and Uniswap v3 quoter and router addresses. Add pairs to `PAIRS`. The adapter, the failover pool, and the desk pick the chain up from that list. No second implementation is required for another Uniswap v3 L2. Leave `tradingEnabled` false until a quote has been checked against the chain's own router and the pool passes the universe screen. Robinhood is the current example of a chain that is wired and deliberately not trading.
