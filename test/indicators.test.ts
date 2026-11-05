import { describe, expect, it } from "vitest";
import { adx, ema, rsi } from "../src/shared/indicators";
import type { Bar } from "../src/shared/types";

describe("indicators", () => {
  it("seeds EMA with an SMA and then applies the smoothing constant", () => {
    const values = [1, 2, 3, 4, 5];
    const out = ema(values, 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2);
    expect(out[3]).toBeCloseTo(3);
    expect(out[4]).toBeCloseTo(4);
  });

  it("computes Wilder RSI on a short series", () => {
    const values = [10, 11, 12, 11, 10, 9, 10, 12];
    const out = rsi(values, 3);
    expect(out[3]).not.toBeNull();
    expect(out[3] ?? 0).toBeGreaterThan(50);
    expect(out[5] ?? 100).toBeLessThan(40);
  });

  it("gives a smooth uptrend a higher ADX than a flat series", () => {
    const trend: Bar[] = [];
    const flat: Bar[] = [];
    for (let i = 0; i < 80; i += 1) {
      const px = 100 + i;
      trend.push({ t: i, o: px, h: px + 0.6, l: px - 0.2, c: px + 0.4, v: 1 });
      flat.push({ t: i, o: 100, h: 100.4, l: 99.6, c: 100 + (i % 2 === 0 ? 0.1 : -0.1), v: 1 });
    }
    const trendAdx = adx(trend, 14).at(-1) ?? 0;
    const flatAdx = adx(flat, 14).at(-1) ?? 0;
    expect(trendAdx).toBeGreaterThan(25);
    expect(flatAdx).toBeLessThan(trendAdx);
    expect(trendAdx).toBeLessThanOrEqual(100);
  });
});
