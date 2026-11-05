/** Shared contracts for the engine and the dashboard. No I/O. */

export type TradingMode = "paper" | "live";
export type SettingSource = "default" | "env" | "ui";
export type ChainId = "solana" | "ethereum" | "base" | "arbitrum" | "robinhood";
export type StrategyId = "trend" | "breakout" | "mean_reversion";
export type Regime = "trend" | "range" | "transition";
export type Side = "long" | "short";
export type Venue = "spot" | "perp";
export type ProviderId = "quicknode" | "alchemy" | "infura" | "public" | "custom";

export interface Bar {
  /** Unix seconds, bar open time. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** USD volume. */
  v: number;
}

export interface TokenRef {
  symbol: string;
  address: string;
  decimals: number;
}

export interface RiskLimits {
  riskPerTradePct: number;
  maxPositionPct: number;
  maxConcurrentPositions: number;
  maxChainExposurePct: number;
  maxTokenExposurePct: number;
  dailyDrawdownKillPct: number;
  totalDrawdownKillPct: number;
  maxSlippageBps: number;
  maxPriceImpactBps: number;
  /** Gas may not exceed this percent of conservative expected edge. */
  maxGasEdgePct: number;
  /** Prior used only for the pre-trade gas-versus-edge check. */
  conservativeWinRate: number;
  circuitBarMovePct: number;
  staleDataMinutes: number;
  quoteDivergencePct: number;
  emergencyExitSlippageBps: number;
}

export interface GateConfig {
  minExpectancyUsd: number;
  minProfitFactor: number;
  maxDrawdownPct: number;
  minTrades: number;
  minWalkForwardWindows: number;
  minProfitableWindowFraction: number;
  /** Fraction of the sensitivity grid that must also be profitable. */
  minStableGridFraction: number;
  paperMinTrades: number;
  paperMinProfitFactor: number;
  paperMaxDrawdownPct: number;
}

export interface Metrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  pnlUsd: number;
  expectancyUsd: number | null;
  profitFactor: number | null;
  maxDrawdownPct: number;
  sharpe: number | null;
  sortino: number | null;
  exposure: number;
  avgBarsHeld: number | null;
  feesUsd: number;
  gasUsd: number;
  slippageUsd: number;
}

export interface SimTrade {
  side: Side;
  strategy: StrategyId;
  venue: Venue;
  entryTime: number;
  exitTime: number;
  entryPx: number;
  exitPx: number;
  qty: number;
  notionalUsd: number;
  pnlUsd: number;
  feesUsd: number;
  gasUsd: number;
  slippageUsd: number;
  barsHeld: number;
  reason: string;
}

export interface EquityPoint {
  t: number;
  equity: number;
  drawdownPct: number;
}

export interface GateCheck {
  id: string;
  label: string;
  pass: boolean;
  actual: string;
  required: string;
}

export type PromotionStatus = "fail" | "backtest_pass_pending_paper" | "eligible";

export interface Promotion {
  status: PromotionStatus;
  liveEligible: boolean;
  checks: GateCheck[];
}

export const LIVE_CONFIRM = "ENABLE LIVE TRADING";

export const ASSUMPTIONS: string[] = [
  "Signals use closed 1h bars only. The forming hour is dropped so a candle cannot repaint.",
  "Backtest entries fill at the next bar open. Protective stops and take-profits are intrabar; if both are touched in one bar the stop fills first. A gap through the stop fills at the open.",
  "Pool fees are charged on both sides. Slippage is a base charge plus square-root participation against that bar's USD volume, and entries that would exceed the slippage cap are skipped. Protective exits always fill, with slippage capped at the emergency limit.",
  "Gas is a flat USD estimate per fill, not a historical gas series. It is intentionally conservative for L2s and Solana.",
  "Perp shorts (where Hyperliquid lists the coin) are 1x isolated. Funding is a constant 1 bp per 8 hours, not historical funding. Spot DEX venues cannot open a short. A short signal with no perp market stays flat and does not by itself close an existing long.",
  "Walk-forward uses non-overlapping 7-day out-of-sample windows after an 80-bar warmup. Parameters are pre-registered. A sensitivity grid is a stability check, not a search for the best result. Promotion uses out-of-sample trades only.",
  "Full-sample results overlap the test windows and are not a gate. Live trading also requires the paper record to agree with the backtest.",
];
