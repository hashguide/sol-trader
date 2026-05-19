import Anthropic from '@anthropic-ai/sdk'
import { getDb } from './db.js'

const client = new Anthropic()

export async function analyzeMarketAndDecide({ strategy, token, priceHistory, currentPrice, position, balance }) {
  const systemPrompt = `You are NEXUS, an expert Solana DeFi trading AI. You analyze market conditions and make precise trading decisions.

Strategy type: ${strategy.type}
Mode: ${strategy.mode} (${strategy.mode === 'paper' ? 'PAPER TRADING - No real funds at risk' : 'LIVE TRADING - Real funds'})
Available capital: $${balance?.toFixed(2)}
Token: ${token.symbol}
Current price: $${currentPrice}
Stop loss: ${strategy.stop_loss_pct ? strategy.stop_loss_pct + '%' : 'None'}
Trailing stop: ${strategy.trailing_stop_pct ? strategy.trailing_stop_pct + '%' : 'None'}
Take profit: ${strategy.take_profit_pct ? strategy.take_profit_pct + '%' : 'None'}
Max position size: ${strategy.max_position_size}% of capital

Respond ONLY with valid JSON:
{
  "action": "buy" | "sell" | "hold" | "close",
  "confidence": 0-100,
  "size_pct": 1-100,
  "reasoning": "brief explanation",
  "risk_level": "low" | "medium" | "high",
  "indicators": { "trend": "bullish|bearish|neutral", "momentum": "strong|weak|neutral", "support": number, "resistance": number }
}`

  const priceStr = priceHistory?.slice(-20).map(p => `${p.time}: $${p.price}`).join('\n') || 'No history'
  const positionStr = position
    ? `Current position: ${position.side} ${position.size} at $${position.entry_price} (unrealized PnL: $${position.unrealized_pnl?.toFixed(2)})`
    : 'No open position'

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Strategy: ${strategy.name} (${strategy.type})\n${positionStr}\n\nPrice history (recent):\n${priceStr}\n\nMake a trading decision for ${token.symbol} at $${currentPrice}.`,
      }],
    })

    const text = msg.content[0].text.trim()
    const clean = text.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch (e) {
    console.error('AI decision error:', e.message)
    return { action: 'hold', confidence: 0, reasoning: 'AI analysis failed', risk_level: 'high' }
  }
}

export async function generateStrategyConfig(strategyType, userPrefs = {}) {
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Generate optimal config JSON for a Solana trading strategy.
Type: ${strategyType}
User preferences: ${JSON.stringify(userPrefs)}

Return ONLY valid JSON with these fields:
{
  "description": "strategy description",
  "indicators": ["RSI", "MACD", etc],
  "entry_conditions": ["condition1", ...],
  "exit_conditions": ["condition1", ...],
  "recommended_stop_loss_pct": number,
  "recommended_trailing_stop_pct": number,
  "recommended_take_profit_pct": number,
  "recommended_position_size_pct": number,
  "best_timeframe": "1m|5m|15m|1h",
  "risk_rating": "low|medium|high",
  "notes": "additional notes"
}`,
      }],
    })
    const text = msg.content[0].text.trim().replace(/```json|```/g, '').trim()
    return JSON.parse(text)
  } catch {
    return {}
  }
}

export async function chatWithAI(userMessage, context) {
  const db = getDb()
  const strategies = db.prepare('SELECT * FROM strategies').all()
  const recentTrades = db.prepare(`
    SELECT t.*, s.name as strategy_name FROM trades t
    JOIN strategies s ON t.strategy_id = s.id
    ORDER BY t.opened_at DESC LIMIT 20
  `).all()
  const positions = db.prepare('SELECT * FROM positions WHERE status = ?').all('open')
  const perf = db.prepare(`
    SELECT strategy_id, SUM(realized_pnl) as total_pnl, SUM(trade_count) as trades,
    SUM(win_count) as wins FROM performance GROUP BY strategy_id
  `).all()

  const systemPrompt = `You are NEXUS, an AI trading assistant for a Solana DeFi trading bot.
You have access to real-time trading data and can answer questions about performance, strategies, and market conditions.

Current state:
- Active strategies: ${strategies.filter(s => s.status === 'running').length}/${strategies.length}
- Open positions: ${positions.length}
- Recent trades: ${recentTrades.length}

Strategies: ${JSON.stringify(strategies.map(s => ({ id: s.id, name: s.name, type: s.type, mode: s.mode, status: s.status, capital: s.current_capital })))}

Recent trades: ${JSON.stringify(recentTrades.slice(0, 5).map(t => ({ symbol: t.token_symbol, side: t.side, pnl: t.pnl, status: t.status, strategy: t.strategy_name })))}

Performance: ${JSON.stringify(perf)}

Open positions: ${JSON.stringify(positions.map(p => ({ symbol: p.token_symbol, side: p.side, unrealized_pnl: p.unrealized_pnl })))}

${context?.priceData ? `Current prices: ${JSON.stringify(context.priceData)}` : ''}

Be concise, use numbers and data. Format financial values with $ and %.`

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })
    return msg.content[0].text
  } catch (e) {
    return `AI unavailable: ${e.message}`
  }
}

export async function evaluateRisk(strategy, trade) {
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: `Risk check for trade:
Strategy: ${strategy.name} (${strategy.type})
Trade: ${trade.side} ${trade.token_symbol} at $${trade.price_in}
Size: $${trade.amount_in}
Capital: $${strategy.current_capital}

Return JSON: { "approved": true/false, "risk_score": 0-100, "reason": "brief" }`,
      }],
    })
    const text = msg.content[0].text.trim().replace(/```json|```/g, '').trim()
    return JSON.parse(text)
  } catch {
    return { approved: true, risk_score: 50, reason: 'Risk check unavailable' }
  }
}
