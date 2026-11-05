import type { GateConfig, RiskLimits, StrategyId } from "./types";

export interface TrendParams {
  fast: number;
  slow: number;
  adxPeriod: number;
  adxMin: number;
  atrPeriod: number;
  stopAtr: number;
  tpAtr: number;
  trailAtr: number;
  maxHold: number;
  minAtrPct: number;
  maxAtrPct: number;
}

export interface BreakoutParams {
  lookback: number;
  volLookback: number;
  volMult: number;
  atrPeriod: number;
  stopAtr: number;
  tpAtr: number;
  trailAtr: number;
  maxHold: number;
  minAtrPct: number;
  maxAtrPct: number;
}

export interface MeanRevParams {
  rsiPeriod: number;
  oversold: number;
  overbought: number;
  bbPeriod: number;
  bbStd: number;
  adxPeriod: number;
  stopAtr: number;
  maxHold: number;
  exitRsi: number;
  maxAtrPct: number;
}

export interface StrategyParams {
  trend: TrendParams;
  breakout: BreakoutParams;
  meanReversion: MeanRevParams;
  regime: { trendAdx: number; rangeAdx: number };
  enabled: Record<StrategyId, boolean>;
  /** Isolated sleeve test. Null runs the regime composite. */
  force: StrategyId | null;
}

/** Pre-registered. Do not retune these after seeing results. */
export const DEFAULT_STRATEGY_PARAMS: StrategyParams = {
  trend: {
    fast: 20,
    slow: 50,
    adxPeriod: 14,
    adxMin: 25,
    atrPeriod: 14,
    stopAtr: 2,
    tpAtr: 3,
    trailAtr: 1.5,
    maxHold: 48,
    minAtrPct: 0.15,
    maxAtrPct: 8,
  },
  breakout: {
    lookback: 20,
    volLookback: 20,
    volMult: 1.5,
    atrPeriod: 14,
    stopAtr: 2,
    tpAtr: 3,
    trailAtr: 1.5,
    maxHold: 36,
    minAtrPct: 0.15,
    maxAtrPct: 8,
  },
  meanReversion: {
    rsiPeriod: 14,
    oversold: 30,
    overbought: 70,
    bbPeriod: 20,
    bbStd: 2,
    adxPeriod: 14,
    stopAtr: 1.5,
    maxHold: 24,
    exitRsi: 55,
    maxAtrPct: 8,
  },
  regime: { trendAdx: 25, rangeAdx: 18 },
  enabled: { trend: true, breakout: true, mean_reversion: true },
  force: null,
};

export const DEFAULT_RISK: RiskLimits = {
  riskPerTradePct: 0.75,
  maxPositionPct: 10,
  maxConcurrentPositions: 4,
  maxChainExposurePct: 40,
  maxTokenExposurePct: 15,
  dailyDrawdownKillPct: 3,
  totalDrawdownKillPct: 10,
  maxSlippageBps: 50,
  maxPriceImpactBps: 100,
  maxGasEdgePct: 25,
  conservativeWinRate: 0.45,
  circuitBarMovePct: 15,
  staleDataMinutes: 120,
  quoteDivergencePct: 5,
  emergencyExitSlippageBps: 150,
};

export const DEFAULT_GATES: GateConfig = {
  minExpectancyUsd: 0,
  minProfitFactor: 1.3,
  maxDrawdownPct: 15,
  minTrades: 30,
  minWalkForwardWindows: 4,
  minProfitableWindowFraction: 0.55,
  minStableGridFraction: 0.67,
  paperMinTrades: 10,
  paperMinProfitFactor: 1.1,
  paperMaxDrawdownPct: 15,
};

export const WARMUP_BARS = 80;
export const OOS_WINDOW_BARS = 24 * 7;
export const PAPER_STARTING_EQUITY = 10_000;

export function cloneParams(p: StrategyParams): StrategyParams {
  return structuredClone(p);
}

export type SleeveId = StrategyId | "composite";

/** Sensitivity values include the default. They are a stability check, not a search. */
export function sensitivitySpec(sleeve: SleeveId): { label: string; values: number[] } {
  if (sleeve === "breakout") return { label: "breakout volume multiple", values: [1.3, 1.5, 1.8] };
  if (sleeve === "mean_reversion") return { label: "RSI oversold", values: [25, 30, 35] };
  return { label: "ADX trend threshold", values: [22, 25, 28] };
}

export function applySensitivity(sleeve: SleeveId, params: StrategyParams, value: number): StrategyParams {
  const next = cloneParams(params);
  if (sleeve === "breakout") next.breakout.volMult = value;
  else if (sleeve === "mean_reversion") {
    next.meanReversion.oversold = value;
    next.meanReversion.overbought = 100 - value;
  } else {
    next.regime.trendAdx = value;
    next.regime.rangeAdx = Math.max(10, value - 7);
    next.trend.adxMin = value;
  }
  if (sleeve !== "composite") next.force = sleeve;
  else next.force = null;
  return next;
}
