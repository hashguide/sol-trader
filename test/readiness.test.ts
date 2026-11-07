import { describe, expect, it } from "vitest";
import { gateLabel, gateTone, readiness } from "../src/lib/readiness";
import type { Snapshot } from "../src/lib/types";

function snap(partial: Partial<Snapshot> & { engine: Snapshot["engine"] }): Snapshot {
  return {
    now: 1,
    banner: "banner",
    settings: {
      mode: "paper",
      modeSource: "default",
      loopIntervalMs: 60_000,
      paperStartingEquity: 10_000,
      risk: {} as Snapshot["settings"]["risk"],
      gates: {} as Snapshot["settings"]["gates"],
      strategy: { enabled: { trend: true, breakout: true, mean_reversion: true } },
      chains: {},
      pairs: {},
      overrideGates: false,
      alertWebhookSource: "none",
    },
    assumptions: [],
    chains: [],
    pairs: [],
    positions: [],
    trades: [],
    decisions: [],
    equity: [],
    alerts: [],
    backtest: null,
    researchRunning: false,
    ...partial,
  };
}

describe("readiness", () => {
  it("flags a stopped loop and missing research without inventing live eligibility", () => {
    const items = readiness(snap({
      engine: {
        running: false,
        mode: "paper",
        modeSource: "default",
        kill: { engaged: false, reason: null, source: null },
        loopIntervalMs: 60_000,
        iteration: 0,
        lastLoopAt: null,
        lastError: null,
        liveBlocked: [],
        paperEquity: 10_000,
        dayPnl: 0,
        drawdownPct: 0,
        reconciled: [],
      },
    }));
    expect(items.find((item) => item.id === "engine")?.ok).toBe(false);
    expect(items.find((item) => item.id === "gates")?.detail).toMatch(/No walk-forward/);
    expect(gateTone("backtest_pass_pending_paper")).toBe("warn");
    expect(gateLabel("eligible")).toBe("Live eligible");
  });

  it("blocks live mode when the engine reports blockers", () => {
    const items = readiness(snap({
      engine: {
        running: true,
        mode: "live",
        modeSource: "ui",
        kill: { engaged: false, reason: null, source: null },
        loopIntervalMs: 60_000,
        iteration: 3,
        lastLoopAt: 1,
        lastError: null,
        liveBlocked: ["base is enabled for trading but has no valid wallet key"],
        paperEquity: 10_000,
        dayPnl: 0,
        drawdownPct: 0,
        reconciled: [],
      },
    }));
    expect(items.find((item) => item.id === "mode")?.ok).toBe(false);
    expect(items.find((item) => item.id === "mode")?.severity).toBe("block");
  });
});
