import { getDb } from './db.js'
import { analyzeMarketAndDecide, evaluateRisk } from './ai.js'
import { getTokenPrice, executeSwap, getQuote, getWalletBalance } from './jupiter.js'
import { broadcast } from './websocket.js'

const activeStrategies = new Map() // strategyId -> { interval, state }
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SOL_MINT = 'So11111111111111111111111111111111111111112'

export const STRATEGY_TYPES = {
  MOMENTUM: 'momentum',
  MEAN_REVERSION: 'mean_reversion',
  BREAKOUT: 'breakout',
  DCA: 'dca',
  GRID: 'grid',
  SCALP: 'scalp',
  SWING: 'swing',
  AI_DYNAMIC: 'ai_dynamic',
}

export async function startStrategy(strategyId) {
  const db = getDb()
  const strategy = db.prepare('SELECT * FROM strategies WHERE id = ?').get(strategyId)
  if (!strategy) throw new Error('Strategy not found')
  if (activeStrategies.has(strategyId)) return

  db.prepare("UPDATE strategies SET status = 'running', updated_at = datetime('now') WHERE id = ?").run(strategyId)
  broadcast({ type: 'strategy_update', strategyId, status: 'running' })

  const intervalMs = getStrategyInterval(strategy.type)
  const state = { lastPrices: {}, highWatermarks: {}, positions: {} }

  const run = async () => {
    try {
      await runStrategyTick(strategy, state)
    } catch (e) {
      console.error(`Strategy ${strategyId} error:`, e.message)
      broadcast({ type: 'strategy_error', strategyId, error: e.message })
    }
  }

  await run()
  const interval = setInterval(run, intervalMs)
  activeStrategies.set(strategyId, { interval, state })
}

export async function stopStrategy(strategyId) {
  const entry = activeStrategies.get(strategyId)
  if (entry) {
    clearInterval(entry.interval)
    activeStrategies.delete(strategyId)
  }
  const db = getDb()
  db.prepare("UPDATE strategies SET status = 'stopped', updated_at = datetime('now') WHERE id = ?").run(strategyId)
  broadcast({ type: 'strategy_update', strategyId, status: 'stopped' })
}

async function runStrategyTick(strategy, state) {
  const db = getDb()
  // Refresh strategy from DB (config might have changed)
  const fresh = db.prepare('SELECT * FROM strategies WHERE id = ?').get(strategy.id)
  if (!fresh || fresh.status !== 'running') {
    await stopStrategy(strategy.id)
    return
  }

  // Check expiry and stop conditions
  if (shouldStopStrategy(fresh)) {
    await stopStrategy(fresh.id)
    broadcast({ type: 'strategy_stopped', strategyId: fresh.id, reason: 'Stop condition met' })
    return
  }

  const tokens = JSON.parse(fresh.tokens || '[]')
  if (!tokens.length) return

  for (const tokenMint of tokens) {
    const tokenRow = db.prepare('SELECT * FROM watched_tokens WHERE mint = ?').get(tokenMint)
    if (!tokenRow) continue

    const price = await getTokenPrice(tokenMint)
    if (!price) continue

    // Store price history
    db.prepare('INSERT INTO market_data (token_mint, token_symbol, price) VALUES (?, ?, ?)').run(tokenMint, tokenRow.symbol, price)

    const priceHistory = db.prepare(
      'SELECT price, recorded_at as time FROM market_data WHERE token_mint = ? ORDER BY recorded_at DESC LIMIT 100'
    ).all(tokenMint).reverse()

    const position = db.prepare(
      "SELECT * FROM positions WHERE strategy_id = ? AND token_mint = ? AND status = 'open'"
    ).get(fresh.id, tokenMint)

    // Update trailing stop
    if (position && fresh.trailing_stop_pct) {
      await updateTrailingStop(fresh, position, price, state)
    }

    // Check stop loss / take profit on open positions
    if (position) {
      const shouldClose = checkStopConditions(fresh, position, price)
      if (shouldClose.close) {
        await executeStrategyTrade(fresh, tokenRow, 'close', position.size, price, shouldClose.reason, state)
        continue
      }
      // Update unrealized PnL
      const unrealized = (price - position.entry_price) * position.size * (position.side === 'long' ? 1 : -1)
      db.prepare('UPDATE positions SET current_price = ?, unrealized_pnl = ? WHERE id = ?').run(price, unrealized, position.id)
    }

    // Get AI decision
    const balance = fresh.mode === 'paper' ? fresh.paper_capital : await getWalletBalance()
    const decision = await analyzeMarketAndDecide({
      strategy: fresh,
      token: tokenRow,
      priceHistory,
      currentPrice: price,
      position,
      balance: balance || fresh.current_capital,
    })

    // Log AI signal
    db.prepare('INSERT INTO ai_signals (strategy_id, token_mint, token_symbol, signal, confidence, reasoning) VALUES (?, ?, ?, ?, ?, ?)').run(
      fresh.id, tokenMint, tokenRow.symbol, decision.action, decision.confidence, decision.reasoning
    )

    broadcast({ type: 'ai_signal', strategyId: fresh.id, token: tokenRow.symbol, signal: decision, price })

    if (decision.action === 'hold') continue
    if (decision.confidence < 60) continue

    const capitalToUse = fresh.current_capital * (Math.min(decision.size_pct || fresh.max_position_size, fresh.max_position_size) / 100)

    if ((decision.action === 'buy' || decision.action === 'sell') && !position) {
      await executeStrategyTrade(fresh, tokenRow, decision.action, capitalToUse, price, decision.reasoning, state)
    } else if (decision.action === 'close' && position) {
      await executeStrategyTrade(fresh, tokenRow, 'close', position.size, price, decision.reasoning, state)
    }

    // Update daily performance
    updateDailyPerformance(fresh.id)
  }
}

async function executeStrategyTrade(strategy, token, action, amount, price, reason, state) {
  const db = getDb()

  // Risk evaluation
  const riskCheck = await evaluateRisk(strategy, { side: action, token_symbol: token.symbol, price_in: price, amount_in: amount })
  if (!riskCheck.approved) {
    broadcast({ type: 'trade_blocked', strategyId: strategy.id, token: token.symbol, reason: riskCheck.reason })
    return
  }

  const trade = {
    strategy_id: strategy.id,
    token_mint: token.mint,
    token_symbol: token.symbol,
    side: action,
    mode: strategy.mode,
    amount_in: amount,
    price_in: price,
    status: 'pending',
    metadata: JSON.stringify({ reason, risk_score: riskCheck.risk_score }),
  }

  const tradeId = db.prepare(`
    INSERT INTO trades (strategy_id, token_mint, token_symbol, side, mode, amount_in, price_in, status, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(strategy.id, token.mint, token.symbol, action, strategy.mode, amount, price, 'pending', trade.metadata).lastInsertRowid

  broadcast({ type: 'trade_opened', strategyId: strategy.id, tradeId, token: token.symbol, side: action, price, amount })

  if (strategy.mode === 'paper') {
    await executePaperTrade(strategy, token, action, amount, price, tradeId, reason)
  } else {
    await executeLiveTrade(strategy, token, action, amount, price, tradeId)
  }
}

async function executePaperTrade(strategy, token, action, amount, price, tradeId, reason) {
  const db = getDb()

  try {
    const fees = amount * 0.0025 // simulated 0.25% fee
    const amountOut = action === 'buy' ? (amount - fees) / price : amount * price - fees

    if (action === 'buy' || action === 'sell') {
      db.prepare(`
        INSERT OR REPLACE INTO positions (strategy_id, token_mint, token_symbol, mode, side, size, entry_price, status)
        VALUES (?, ?, ?, 'paper', ?, ?, ?, 'open')
      `).run(strategy.id, token.mint, token.symbol, action === 'buy' ? 'long' : 'short', amountOut, price)

      const newCapital = (strategy.paper_capital || strategy.current_capital) - amount - fees
      db.prepare("UPDATE strategies SET paper_capital = ?, updated_at = datetime('now') WHERE id = ?").run(newCapital, strategy.id)
    } else if (action === 'close') {
      const position = db.prepare("SELECT * FROM positions WHERE strategy_id = ? AND token_mint = ? AND status = 'open'").get(strategy.id, token.mint)
      if (position) {
        const pnl = (price - position.entry_price) * position.size * (position.side === 'long' ? 1 : -1)
        const pnlPct = (pnl / (position.entry_price * position.size)) * 100
        db.prepare("UPDATE positions SET status = 'closed', closed_at = datetime('now'), current_price = ?, unrealized_pnl = 0 WHERE id = ?").run(price, position.id)

        const newCapital = (strategy.paper_capital || strategy.current_capital) + (position.entry_price * position.size) + pnl - fees
        db.prepare("UPDATE strategies SET paper_capital = ?, current_capital = ?, updated_at = datetime('now') WHERE id = ?").run(newCapital, newCapital, strategy.id)

        db.prepare("UPDATE trades SET status = 'filled', amount_out = ?, price_out = ?, pnl = ?, pnl_pct = ?, closed_at = datetime('now') WHERE id = ?").run(amountOut, price, pnl, pnlPct, tradeId)
        broadcast({ type: 'trade_closed', strategyId: strategy.id, tradeId, pnl, pnlPct, token: token.symbol })
        return
      }
    }

    db.prepare("UPDATE trades SET status = 'filled', amount_out = ? WHERE id = ?").run(amountOut, tradeId)
    broadcast({ type: 'trade_filled', strategyId: strategy.id, tradeId, mode: 'paper' })
  } catch (e) {
    db.prepare("UPDATE trades SET status = 'failed', error = ? WHERE id = ?").run(e.message, tradeId)
    broadcast({ type: 'trade_failed', strategyId: strategy.id, tradeId, error: e.message })
  }
}

async function executeLiveTrade(strategy, token, action, amount, price, tradeId) {
  const db = getDb()
  let retries = 3

  while (retries > 0) {
    try {
      const inputMint = action === 'buy' ? USDC_MINT : token.mint
      const outputMint = action === 'buy' ? token.mint : USDC_MINT
      const lamports = Math.floor(amount * 1e6) // USDC has 6 decimals

      const quote = await getQuote(inputMint, outputMint, lamports)
      const txHash = await executeSwap(quote, strategy.wallet_address)

      db.prepare("UPDATE trades SET status = 'filled', tx_hash = ?, amount_out = ? WHERE id = ?").run(txHash, parseFloat(quote.outAmount) / 1e9, tradeId)

      broadcast({ type: 'trade_filled', strategyId: strategy.id, tradeId, txHash, mode: 'live' })
      return
    } catch (e) {
      retries--
      if (retries === 0) {
        db.prepare("UPDATE trades SET status = 'failed', error = ? WHERE id = ?").run(e.message, tradeId)
        broadcast({ type: 'trade_failed', strategyId: strategy.id, tradeId, error: e.message, retriesExhausted: true })
      } else {
        broadcast({ type: 'trade_retry', strategyId: strategy.id, tradeId, retriesLeft: retries })
        await sleep(2000)
      }
    }
  }
}

function checkStopConditions(strategy, position, currentPrice) {
  if (!position) return { close: false }

  const pnlPct = ((currentPrice - position.entry_price) / position.entry_price) * 100 * (position.side === 'long' ? 1 : -1)

  if (strategy.stop_loss_pct && pnlPct <= -Math.abs(strategy.stop_loss_pct)) {
    return { close: true, reason: `Stop loss triggered at ${pnlPct.toFixed(2)}%` }
  }
  if (strategy.take_profit_pct && pnlPct >= strategy.take_profit_pct) {
    return { close: true, reason: `Take profit triggered at ${pnlPct.toFixed(2)}%` }
  }
  if (position.trailing_stop && currentPrice <= position.trailing_stop && position.side === 'long') {
    return { close: true, reason: `Trailing stop triggered at $${currentPrice}` }
  }
  return { close: false }
}

async function updateTrailingStop(strategy, position, currentPrice, state) {
  const db = getDb()
  const hwKey = `${position.id}`
  const hwm = state.highWatermarks[hwKey] || position.entry_price

  if (position.side === 'long' && currentPrice > hwm) {
    state.highWatermarks[hwKey] = currentPrice
    const newStop = currentPrice * (1 - strategy.trailing_stop_pct / 100)
    db.prepare('UPDATE positions SET trailing_stop = ? WHERE id = ?').run(newStop, position.id)
  }
}

function shouldStopStrategy(strategy) {
  if (strategy.expiry_at && new Date() > new Date(strategy.expiry_at)) return true
  if (strategy.profit_goal) {
    const pnl = (strategy.current_capital - strategy.initial_capital)
    if (pnl >= strategy.profit_goal) return true
  }
  const capital = strategy.mode === 'paper' ? strategy.paper_capital : strategy.current_capital
  if (capital <= strategy.initial_capital * 0.05) return true // Stop at 95% loss
  return false
}

function updateDailyPerformance(strategyId) {
  const db = getDb()
  const today = new Date().toISOString().split('T')[0]
  const stats = db.prepare(`
    SELECT 
      SUM(CASE WHEN pnl IS NOT NULL THEN pnl ELSE 0 END) as realized_pnl,
      COUNT(CASE WHEN status = 'filled' THEN 1 END) as trade_count,
      COUNT(CASE WHEN pnl > 0 THEN 1 END) as win_count,
      COUNT(CASE WHEN pnl < 0 THEN 1 END) as loss_count
    FROM trades WHERE strategy_id = ? AND date(opened_at) = ?
  `).get(strategyId, today)

  const strategy = db.prepare('SELECT * FROM strategies WHERE id = ?').get(strategyId)
  db.prepare(`
    INSERT INTO performance (strategy_id, date, realized_pnl, trade_count, win_count, loss_count, capital)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(strategy_id, date) DO UPDATE SET
      realized_pnl = excluded.realized_pnl,
      trade_count = excluded.trade_count,
      win_count = excluded.win_count,
      loss_count = excluded.loss_count,
      capital = excluded.capital
  `).run(strategyId, today, stats.realized_pnl || 0, stats.trade_count || 0, stats.win_count || 0, stats.loss_count || 0, strategy?.current_capital || 0)
}

function getStrategyInterval(type) {
  const intervals = {
    scalp: 15000,
    momentum: 30000,
    breakout: 60000,
    mean_reversion: 60000,
    dca: 300000,
    grid: 30000,
    swing: 300000,
    ai_dynamic: 45000,
  }
  return intervals[type] || 60000
}

export function getActiveStrategies() {
  return [...activeStrategies.keys()]
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
