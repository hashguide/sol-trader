import { describe, expect, it } from "vitest";
import { DEFAULT_RISK } from "../src/shared/params";
import { assessRisk, sizePosition, type RiskContext } from "../src/shared/risk";

function ctx(over: Partial<RiskContext> = {}): RiskContext {
  return {
    limits: DEFAULT_RISK,
    killEngaged: false,
    equityUsd: 10_000,
    cashUsd: 10_000,
    dayStartEquity: 10_000,
    highWatermark: 10_000,
    positions: [],
    order: {
      pairId: "sol-usdc",
      chain: "solana",
      tokenGroup: "SOL",
      side: "long",
      entry: 100,
      stop: 95,
      takeProfit: 112,
      slippageBps: 10,
      priceImpactBps: 10,
      gasUsd: 0.05,
      intent: "entry",
    },
    dataOk: true,
    eligible: true,
    overrideGates: false,
    mode: "paper",
    ...over,
  };
}

describe("sizing", () => {
  it("risks a fixed fraction of equity and then applies the position cap", () => {
    const sized = sizePosition({
      equityUsd: 10_000,
      cashUsd: 10_000,
      entry: 100,
      stop: 95,
      side: "long",
      riskPerTradePct: 1,
      maxPositionPct: 10,
    });
    expect(sized.ok).toBe(true);
    if (sized.ok) {
      expect(sized.riskUsd).toBeCloseTo(100);
      expect(sized.stopDistancePct).toBeCloseTo(0.05);
      // Uncapped notional would be 100 / 0.05 = 2000, cap is 10% = 1000.
      expect(sized.notionalUsd).toBeCloseTo(1000);
      expect(sized.qty).toBeCloseTo(10);
    }
  });

  it("rejects a long whose stop is above the entry", () => {
    const sized = sizePosition({
      equityUsd: 10_000,
      cashUsd: 10_000,
      entry: 100,
      stop: 101,
      side: "long",
      riskPerTradePct: 1,
      maxPositionPct: 10,
    });
    expect(sized.ok).toBe(false);
  });
});

describe("risk rules", () => {
  it("blocks entries when the kill switch is on but still allows exits", () => {
    const blocked = assessRisk(ctx({ killEngaged: true }));
    expect(blocked.ok).toBe(false);
    const exit = assessRisk(ctx({
      killEngaged: true,
      order: { ...ctx().order, intent: "exit" },
    }));
    expect(exit.ok).toBe(true);
  });

  it("latches a daily drawdown kill", () => {
    const decision = assessRisk(ctx({ equityUsd: 9_600, dayStartEquity: 10_000 }));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.kill).toBe(true);
  });

  it("rejects a missing stop, excess slippage, chain exposure, and gas that eats the edge", () => {
    expect(assessRisk(ctx({ order: { ...ctx().order, stop: null } })).ok).toBe(false);
    expect(assessRisk(ctx({ order: { ...ctx().order, slippageBps: 80 } })).ok).toBe(false);
    const crowded = assessRisk(ctx({
      positions: [
        { pairId: "a", chain: "solana", tokenGroup: "OTHER", notionalUsd: 3_500 },
      ],
    }));
    expect(crowded.ok).toBe(false);
    if (!crowded.ok) expect(crowded.reason).toContain("solana");
    const gassy = assessRisk(ctx({ order: { ...ctx().order, gasUsd: 50 } }));
    expect(gassy.ok).toBe(false);
    if (!gassy.ok) expect(gassy.reason.toLowerCase()).toContain("gas");
  });

  it("refuses a live entry that has not passed the promotion gate", () => {
    const decision = assessRisk(ctx({ mode: "live", eligible: false }));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain("not eligible");
    expect(assessRisk(ctx({ mode: "live", eligible: false, overrideGates: true })).ok).toBe(true);
  });

  it("blocks new risk when the data circuit is open", () => {
    const decision = assessRisk(ctx({ dataOk: false, dataProblem: "last bar moved 22%" }));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toContain("22%");
  });
});
