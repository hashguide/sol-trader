import { simulate, type CostModel } from "./backtest";
import { computeMetrics } from "./metrics";
import { OOS_WINDOW_BARS, WARMUP_BARS, applySensitivity, sensitivitySpec, type StrategyParams } from "./params";
import type { Bar, EquityPoint, GateCheck, GateConfig, Metrics, Promotion, SimTrade } from "./types";

export type SleeveId = "trend" | "breakout" | "mean_reversion" | "composite";

export interface WindowReport {
  testFrom: number;
  testTo: number;
  metrics: Metrics;
  pnlUsd: number;
}

export interface SleeveReport {
  strategy: SleeveId;
  /** Full sample overlaps the test windows. It is not a promotion gate. */
  fullSample: Metrics;
  outOfSample: Metrics;
  windows: WindowReport[];
  sensitivity: { value: number; expectancyUsd: number | null; profitFactor: number | null; trades: number }[];
  sensitivityLabel: string;
  gates: Promotion;
  trades: SimTrade[];
  equity: EquityPoint[];
  skipped: { reason: string; count: number }[];
}

export interface PaperStats {
  trades: number;
  expectancyUsd: number | null;
  profitFactor: number | null;
  maxDrawdownPct: number;
}

function check(id: string, label: string, pass: boolean, actual: string, required: string): GateCheck {
  return { id, label, pass, actual, required };
}

function fmt(n: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (!Number.isFinite(n)) return "inf";
  return n.toFixed(digits);
}

export function evaluatePromotion(
  oos: Metrics,
  windows: WindowReport[],
  sensitivityPassFraction: number,
  gates: GateConfig,
  paper: PaperStats | null,
): Promotion {
  const checks: GateCheck[] = [];
  const expectancy = oos.expectancyUsd;
  checks.push(check(
    "expectancy",
    "Positive expectancy after costs",
    expectancy != null && expectancy > gates.minExpectancyUsd,
    expectancy == null ? "no trades" : `$${fmt(expectancy)} / trade`,
    `> $${gates.minExpectancyUsd.toFixed(2)}`,
  ));
  const pfPass = oos.profitFactor == null
    ? oos.wins > 0 && oos.losses === 0
    : oos.profitFactor > gates.minProfitFactor;
  checks.push(check(
    "profit_factor",
    "Profit factor",
    pfPass,
    oos.profitFactor == null ? (oos.trades ? "no losing trades" : "no trades") : fmt(oos.profitFactor),
    `> ${gates.minProfitFactor}`,
  ));
  checks.push(check(
    "drawdown",
    "Max drawdown",
    oos.trades > 0 && oos.maxDrawdownPct < gates.maxDrawdownPct,
    `${fmt(oos.maxDrawdownPct)}%`,
    `< ${gates.maxDrawdownPct}%`,
  ));
  checks.push(check(
    "trades",
    "Sample size",
    oos.trades >= gates.minTrades,
    String(oos.trades),
    `>= ${gates.minTrades}`,
  ));
  const profitable = windows.filter((w) => w.pnlUsd > 0).length;
  const fraction = windows.length ? profitable / windows.length : 0;
  checks.push(check(
    "windows",
    "Walk-forward windows",
    windows.length >= gates.minWalkForwardWindows,
    String(windows.length),
    `>= ${gates.minWalkForwardWindows}`,
  ));
  checks.push(check(
    "window_stability",
    "Profitable out-of-sample windows",
    windows.length > 0 && fraction >= gates.minProfitableWindowFraction,
    windows.length ? `${profitable}/${windows.length} (${(fraction * 100).toFixed(0)}%)` : "none",
    `>= ${(gates.minProfitableWindowFraction * 100).toFixed(0)}%`,
  ));
  checks.push(check(
    "parameter_stability",
    "Stable across the pre-registered grid",
    sensitivityPassFraction >= gates.minStableGridFraction,
    `${(sensitivityPassFraction * 100).toFixed(0)}% of grid points profitable`,
    `>= ${(gates.minStableGridFraction * 100).toFixed(0)}%`,
  ));

  const backtestPass = checks.every((c) => c.pass);
  const paperResult = paperCheck(paper, gates);
  checks.push(paperResult);
  if (!backtestPass) return { status: "fail", liveEligible: false, checks };
  if (!paper || paper.trades < gates.paperMinTrades) {
    return { status: "backtest_pass_pending_paper", liveEligible: false, checks };
  }
  if (!paperResult.pass) return { status: "fail", liveEligible: false, checks };
  return { status: "eligible", liveEligible: true, checks };
}

function paperCheck(paper: PaperStats | null, gates: GateConfig): GateCheck {
  if (!paper || paper.trades < gates.paperMinTrades) {
    return check(
      "paper",
      "Paper trading agrees with the backtest",
      false,
      paper ? `${paper.trades} paper trades so far` : "no paper trades yet",
      `>= ${gates.paperMinTrades} trades, positive expectancy, profit factor > ${gates.paperMinProfitFactor}, drawdown < ${gates.paperMaxDrawdownPct}%`,
    );
  }
  const pass = paper.expectancyUsd != null
    && paper.expectancyUsd > 0
    && paper.profitFactor != null
    && paper.profitFactor > gates.paperMinProfitFactor
    && paper.maxDrawdownPct < gates.paperMaxDrawdownPct;
  return check(
    "paper",
    "Paper trading agrees with the backtest",
    pass,
    `n=${paper.trades}, expectancy ${paper.expectancyUsd == null ? "—" : `$${fmt(paper.expectancyUsd)}`}, pf ${fmt(paper.profitFactor)}, dd ${fmt(paper.maxDrawdownPct)}%`,
    `expectancy > 0, profit factor > ${gates.paperMinProfitFactor}, drawdown < ${gates.paperMaxDrawdownPct}%`,
  );
}

interface Walk {
  trades: SimTrade[];
  equity: EquityPoint[];
  windows: WindowReport[];
  skipped: { reason: string; count: number }[];
}

function walk(bars: Bar[], params: StrategyParams, costs: CostModel, startEquity: number): Walk {
  const windows: WindowReport[] = [];
  const trades: SimTrade[] = [];
  const equity: EquityPoint[] = [];
  const skipped = new Map<string, number>();
  let carried = startEquity;
  let cursor = WARMUP_BARS;
  while (cursor + OOS_WINDOW_BARS <= bars.length) {
    const from = cursor;
    const to = cursor + OOS_WINDOW_BARS;
    const sliceStart = Math.max(0, from - WARMUP_BARS);
    const slice = bars.slice(sliceStart, to);
    const recordFrom = from - sliceStart;
    const result = simulate({
      bars: slice,
      params,
      costs,
      startEquity: carried,
      recordFrom,
      recordTo: slice.length,
    });
    windows.push({
      testFrom: bars[from]?.t ?? 0,
      testTo: bars[Math.min(bars.length - 1, to - 1)]?.t ?? 0,
      metrics: result.metrics,
      pnlUsd: result.metrics.pnlUsd,
    });
    trades.push(...result.trades);
    equity.push(...result.equity.slice(recordFrom));
    const last = result.equity[result.equity.length - 1]?.equity;
    if (last != null) carried = last;
    for (const s of result.skipped) skipped.set(s.reason, (skipped.get(s.reason) ?? 0) + s.count);
    cursor = to;
  }
  return {
    trades,
    equity,
    windows,
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
  };
}

function summarize(trades: SimTrade[], equity: EquityPoint[], windowBars: number): Metrics {
  const inMarket = trades.reduce((s, t) => s + t.barsHeld, 0);
  return computeMetrics(trades, equity, inMarket, windowBars);
}

export function researchSleeve(
  bars: Bar[],
  base: StrategyParams,
  costs: CostModel,
  sleeve: SleeveId,
  gates: GateConfig,
  paper: PaperStats | null,
  startEquity = 10_000,
): SleeveReport {
  const spec = sensitivitySpec(sleeve);
  const primaryValue = sleeve === "breakout"
    ? base.breakout.volMult
    : sleeve === "mean_reversion"
      ? base.meanReversion.oversold
      : base.regime.trendAdx;
  const primary = applySensitivity(sleeve, base, primaryValue);
  const oos = walk(bars, primary, costs, startEquity);
  const full = simulate({
    bars,
    params: primary,
    costs,
    startEquity,
    recordFrom: WARMUP_BARS,
    recordTo: bars.length,
  });
  const oosMetrics = summarize(oos.trades, oos.equity, oos.windows.length * OOS_WINDOW_BARS);
  const sensitivity = spec.values.map((value) => {
    const params = applySensitivity(sleeve, base, value);
    const run = walk(bars, params, costs, startEquity);
    const metrics = summarize(run.trades, run.equity, run.windows.length * OOS_WINDOW_BARS);
    return {
      value,
      expectancyUsd: metrics.expectancyUsd,
      profitFactor: metrics.profitFactor,
      trades: metrics.trades,
    };
  });
  const stable = sensitivity.filter((s) => (s.expectancyUsd ?? -1) > 0 && (s.profitFactor == null ? s.trades > 0 : s.profitFactor > 1) && s.trades >= 10).length;
  const fraction = sensitivity.length ? stable / sensitivity.length : 0;
  return {
    strategy: sleeve,
    fullSample: full.metrics,
    outOfSample: oosMetrics,
    windows: oos.windows,
    sensitivity,
    sensitivityLabel: spec.label,
    gates: evaluatePromotion(oosMetrics, oos.windows, fraction, gates, paper),
    trades: oos.trades,
    equity: oos.equity.filter((_, i) => i % 6 === 0 || i === oos.equity.length - 1),
    skipped: oos.skipped,
  };
}
