import type { EquityPoint, Metrics, SimTrade } from "./types";

export function maxDrawdownPct(equity: readonly { equity: number }[]): number {
  let peak = equity[0]?.equity ?? 0;
  let maxDd = 0;
  for (const point of equity) {
    if (point.equity > peak) peak = point.equity;
    if (peak > 0) {
      const dd = ((peak - point.equity) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

export function equityCurveFromMarks(marks: readonly { t: number; equity: number }[]): EquityPoint[] {
  let peak = marks[0]?.equity ?? 0;
  return marks.map((m) => {
    if (m.equity > peak) peak = m.equity;
    const drawdownPct = peak > 0 ? ((peak - m.equity) / peak) * 100 : 0;
    return { t: m.t, equity: m.equity, drawdownPct };
  });
}

/** Annualized Sharpe and Sortino from a per-bar equity curve. `barsPerYear` is 24*365 for 1h bars. */
export function computeMetrics(
  trades: readonly SimTrade[],
  equity: readonly EquityPoint[],
  barsInMarket: number,
  barsObserved: number,
  barsPerYear = 24 * 365,
): Metrics {
  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd <= 0);
  const pnlUsd = trades.reduce((s, t) => s + t.pnlUsd, 0);
  const feesUsd = trades.reduce((s, t) => s + t.feesUsd, 0);
  const gasUsd = trades.reduce((s, t) => s + t.gasUsd, 0);
  const slippageUsd = trades.reduce((s, t) => s + t.slippageUsd, 0);
  const grossWin = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : trades.length > 0 && grossWin > 0 ? null : 0;
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i += 1) {
    const prev = equity[i - 1]?.equity ?? 0;
    const cur = equity[i]?.equity ?? prev;
    if (prev > 0) returns.push(cur / prev - 1);
  }
  let sharpe: number | null = null;
  let sortino: number | null = null;
  if (returns.length > 2) {
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const sd = Math.sqrt(variance);
    if (sd > 0) sharpe = (mean / sd) * Math.sqrt(barsPerYear);
    const downside = returns.filter((r) => r < 0);
    if (downside.length > 0) {
      const downVar = downside.reduce((s, r) => s + r * r, 0) / downside.length;
      const downSd = Math.sqrt(downVar);
      if (downSd > 0) sortino = (mean / downSd) * Math.sqrt(barsPerYear);
    } else if (mean > 0) sortino = null;
  }
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : null,
    pnlUsd,
    expectancyUsd: trades.length ? pnlUsd / trades.length : null,
    profitFactor,
    maxDrawdownPct: maxDrawdownPct(equity),
    sharpe,
    sortino,
    exposure: barsObserved > 0 ? barsInMarket / barsObserved : 0,
    avgBarsHeld: trades.length ? trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length : null,
    feesUsd,
    gasUsd,
    slippageUsd,
  };
}

export function fmt(n: number | null, digits = 2): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (!Number.isFinite(n)) return "inf";
  return n.toFixed(digits);
}
