import { describe, expect, it } from "vitest";
import { LIVE_CONFIRM } from "../src/shared/types";
import { evaluateModeChange } from "../engine/mode";

describe("mode switching", () => {
  it("defaults a paper request to paper without keys", () => {
    const decision = evaluateModeChange({
      requested: "paper",
      chains: [{ id: "solana", tradingEnabled: true, address: null }],
    });
    expect(decision).toEqual({ ok: true, mode: "paper" });
  });

  it("refuses live mode without the confirmation phrase or a key on a trading chain", () => {
    const missing = evaluateModeChange({
      requested: "live",
      chains: [
        { id: "solana", tradingEnabled: true, address: null },
        { id: "base", tradingEnabled: true, address: "0xabc" },
        { id: "robinhood", tradingEnabled: false, address: null },
      ],
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.problems.join(" ")).toContain(LIVE_CONFIRM);
      expect(missing.problems.join(" ")).toContain("solana");
      expect(missing.problems.join(" ")).not.toContain("robinhood");
    }
  });

  it("accepts live mode when every trading chain has a key and the phrase matches", () => {
    const ok = evaluateModeChange({
      requested: "live",
      confirm: LIVE_CONFIRM,
      chains: [
        { id: "solana", tradingEnabled: true, address: "So11111111111111111111111111111111111111112" },
        { id: "base", tradingEnabled: true, address: "0x0000000000000000000000000000000000000001" },
        { id: "ethereum", tradingEnabled: false, address: null },
      ],
    });
    expect(ok).toEqual({ ok: true, mode: "live" });
  });
});
