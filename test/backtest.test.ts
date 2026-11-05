import { describe, expect, it } from "vitest";
import { simulate, type CostModel } from "../src/shared/backtest";
import { DEFAULT_STRATEGY_PARAMS } from "../src/shared/params";
import type { Signal } from "../src/shared/strategy";
import type { Bar } from "../src/shared/types";

const costs: CostModel = {
  feeBps: 10,
  gasUsd: 0.05,
  baseSlippageBps: 0,
  impactCoeff: 0,
  fundingBpsPer8h: 0,
  allowPerpShort: true,
  venueForShort: "perp",
};

function flat(n: number, price: number, low = price, high = price): Bar[] {
  return Array.from({ length: n }, (_, i) => ({
    t: 1_700_000_000 + i * 3600,
    o: price,
    h: high,
    l: low,
    c: price,
    v: 5_000_000,
  }));
}

function hold(i: number, close: number): Signal {
  return {
    action: "hold",
    strategy: null,
    regime: "transition",
    stop: null,
    takeProfit: null,
    trailingAtrMult: null,
    maxHoldBars: null,
    reason: "hold",
    indicators: {
      emaFast: null, emaSlow: null, adx: null, rsi: null, atr: null, atrPct: null,
      bbMid: null, bbUpper: null, bbLower: null, donchianHigh: null, donchianLow: null, volSma: null, close,
    },
  };
}

describe("fill model", () => {
  it("fills the next open, charges both-side fees and gas, and books the long pnl", () => {
    const bars = flat(14, 100);
    for (let i = 6; i < bars.length; i += 1) {
      const b = bars[i]!;
      b.o = 110;
      b.h = 111;
      b.l = 109;
      b.c = 110;
    }
    const result = simulate({
      bars,
      params: DEFAULT_STRATEGY_PARAMS,
      costs,
      startEquity: 10_000,
      signalFn: (i, open) => {
        const close = bars[i]?.c ?? 0;
        if (!open && i === 5) {
          return {
            ...hold(i, close),
            action: "enter_long",
            strategy: "trend",
            stop: 90,
            takeProfit: 150,
            trailingAtrMult: null,
            maxHoldBars: 40,
            reason: "test entry",
          };
        }
        if (open && i === 10) return { ...hold(i, close), action: "exit_long", strategy: "trend", reason: "test exit" };
        return hold(i, close);
      },
    });
    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0]!;
    expect(trade.entryPx).toBeCloseTo(110);
    expect(trade.exitPx).toBeCloseTo(110);
    // Notional is capped at 10% of equity = 1000. Fees 10 bps each side of ~1000, gas 0.05 twice.
    expect(trade.feesUsd).toBeGreaterThan(0.5);
    expect(trade.gasUsd).toBeCloseTo(0.1);
    expect(trade.pnlUsd).toBeLessThan(0);
    expect(trade.pnlUsd).toBeGreaterThan(-5);
  });

  it("fills a stop before the target when both are touched, at a worse gap open", () => {
    const bars = flat(8, 100);
    const entry = bars[4]!;
    entry.o = 100;
    entry.h = 100;
    entry.l = 100;
    entry.c = 100;
    const crash = bars[5]!;
    crash.o = 80;
    crash.h = 130;
    crash.l = 70;
    crash.c = 90;
    const result = simulate({
      bars,
      params: DEFAULT_STRATEGY_PARAMS,
      costs: { ...costs, feeBps: 0, gasUsd: 0 },
      startEquity: 10_000,
      signalFn: (i) => {
        if (i === 3) {
          return { ...hold(i, 100), action: "enter_long", strategy: "breakout", stop: 95, takeProfit: 120, maxHoldBars: 10, reason: "enter" };
        }
        return hold(i, bars[i]?.c ?? 0);
      },
    });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.reason).toContain("stop");
    expect(result.trades[0]?.exitPx).toBeCloseTo(80);
    expect(result.trades[0]?.pnlUsd).toBeLessThan(0);
  });
});
