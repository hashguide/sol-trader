import { describe, expect, it } from "vitest";
import { screenPool } from "../engine/market";

describe("universe screen", () => {
  it("rejects thin, young, and taxed pools and passes a mature liquid pool", () => {
    const now = Date.parse("2026-11-05T00:00:00Z");
    const bad = screenPool({
      liquidityUsd: 10_000,
      volume24hUsd: 1_000,
      createdAtMs: now - 2 * 86_400_000,
      nowMs: now,
      honeypot: true,
      sellTaxPct: 15,
    });
    expect(bad.pass).toBe(false);
    expect(bad.reasons.length).toBeGreaterThan(2);
    const good = screenPool({
      liquidityUsd: 2_000_000,
      volume24hUsd: 400_000,
      createdAtMs: now - 40 * 86_400_000,
      nowMs: now,
      honeypot: false,
      sellTaxPct: 0,
    });
    expect(good.pass).toBe(true);
  });
});
