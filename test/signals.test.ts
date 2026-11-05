import { describe, expect, it } from "vitest";
import { cloneParams, DEFAULT_STRATEGY_PARAMS } from "../src/shared/params";
import { computeSeries, signalAt } from "../src/shared/strategy";
import type { Bar } from "../src/shared/types";

function bar(t: number, c: number, v = 100_000, range = 0.004): Bar {
  return { t, o: c * (1 - range / 2), h: c * (1 + range), l: c * (1 - range), c, v };
}

describe("strategy signals", () => {
  it("emits a long trend entry when a pullback reclaims the fast EMA in an uptrend", () => {
    const bars: Bar[] = [];
    let px = 100;
    for (let i = 0; i < 80; i += 1) {
      px *= 1.008;
      bars.push(bar(i * 3600, px));
    }
    for (let i = 0; i < 8; i += 1) {
      px *= 0.975;
      bars.push(bar(bars.length * 3600, px));
    }
    px *= 1.12;
    bars.push(bar(bars.length * 3600, px, 180_000, 0.01));
    const params = cloneParams(DEFAULT_STRATEGY_PARAMS);
    params.force = "trend";
    const series = computeSeries(bars, params);
    const signals = bars.map((_, i) => signalAt(series, i, null, params));
    const entry = signals.find((s) => s.action === "enter_long");
    expect(entry).toBeTruthy();
    expect(entry?.strategy).toBe("trend");
    expect(entry?.stop).toBeLessThan(entry?.indicators.close ?? 0);
    expect(entry?.takeProfit).toBeGreaterThan(entry?.indicators.close ?? 0);
  });

  it("emits a breakout long when price leaves the prior range on volume", () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 40; i += 1) bars.push(bar(i * 3600, 100 + (i % 2 === 0 ? 0.2 : -0.2), 10_000, 0.002));
    bars.push(bar(40 * 3600, 110, 40_000, 0.01));
    const params = cloneParams(DEFAULT_STRATEGY_PARAMS);
    params.force = "breakout";
    const series = computeSeries(bars, params);
    const last = signalAt(series, bars.length - 1, null, params);
    expect(last.action).toBe("enter_long");
    expect(last.strategy).toBe("breakout");
  });

  it("emits a mean-reversion long at a lower-band stretch in a range", () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 50; i += 1) bars.push(bar(i * 3600, 100 + (i % 2 ? 0.15 : -0.15), 80_000, 0.002));
    bars.push(bar(50 * 3600, 92, 90_000, 0.01));
    const params = cloneParams(DEFAULT_STRATEGY_PARAMS);
    params.force = "mean_reversion";
    const series = computeSeries(bars, params);
    const entry = signalAt(series, bars.length - 1, null, params);
    expect(entry?.strategy).toBe("mean_reversion");
    expect(entry?.reason.toLowerCase()).toContain("bollinger");
  });

  it("does not open a new trade in the transition band when the regime router is on", () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 90; i += 1) {
      const c = 100 + 3 * Math.sin(i / 4) + (i % 5 === 0 ? 1.2 : -0.4);
      bars.push(bar(i * 3600, c, 50_000, 0.004));
    }
    const params = cloneParams(DEFAULT_STRATEGY_PARAMS);
    params.regime.trendAdx = 30;
    params.regime.rangeAdx = 10;
    params.trend.adxMin = 30;
    const series = computeSeries(bars, params);
    const last = signalAt(series, bars.length - 1, null, params);
    expect(last.action).toBe("hold");
    expect(last.regime).toBe("transition");
  });
});
