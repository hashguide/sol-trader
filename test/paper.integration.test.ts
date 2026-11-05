import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChainId } from "../src/shared/types";
import type { Bar } from "../src/shared/types";
import { CHAINS } from "../engine/config";
import { Store } from "../engine/db";
import { Hyperliquid } from "../engine/hyperliquid";
import { LiveBroker } from "../engine/live";
import type { MarketData } from "../engine/market";
import { buildPools, TradingRuntime } from "../engine/runtime";
import { hashPassword, loadMasterKey } from "../engine/secrets";

process.env.MERIDIAN_SKIP_PROBE = "1";

function trendBars(nowMs: number): Bar[] {
  const bars: Bar[] = [];
  let px = 100;
  const lastOpen = Math.floor(nowMs / 1000 / 3600) * 3600 - 3600;
  const start = lastOpen - 100 * 3600;
  const push = (c: number, v = 20_000_000) => {
    const t = start + bars.length * 3600;
    bars.push({ t, o: c * 0.998, h: c * 1.004, l: c * 0.996, c, v });
  };
  for (let i = 0; i < 80; i += 1) {
    px *= 1.008;
    push(px);
  }
  for (let i = 0; i < 8; i += 1) {
    px *= 0.975;
    push(px);
  }
  px *= 1.12;
  push(px, 25_000_000);
  return bars;
}

class FixtureMarket implements MarketData {
  constructor(private bars: Bar[]) {}
  calls = 0;
  async getBars() {
    this.calls += 1;
    return { bars: this.bars, source: "fixture" };
  }
  async getMark() {
    const last = this.bars[this.bars.length - 1];
    return { price: last?.c ?? null, source: "fixture", liquidityUsd: 5_000_000, volume24hUsd: 2_000_000 };
  }
  crash() {
    const last = this.bars[this.bars.length - 1];
    if (!last) return;
    const c = last.c * 0.8;
    this.bars = [...this.bars, { t: last.t + 3600, o: c, h: c * 1.01, l: c * 0.99, c, v: 20_000_000 }];
  }
}

describe("paper trading loop", () => {
  const dirs: string[] = [];
  afterEach(() => {
    delete process.env.TRADING_MODE;
  });

  function boot(market: MarketData) {
    const dir = mkdtempSync(path.join(tmpdir(), "meridian-"));
    dirs.push(dir);
    const store = new Store(path.join(dir, "meridian.db"));
    store.setMeta("password", hashPassword("integration-password"));
    const master = loadMasterKey(dir);
    const pools = buildPools(null);
    const perps = new Hyperliquid();
    let liveSends = 0;
    const live = new LiveBroker(new Map(), null, perps, () => null, () => null);
    live.spot = async () => { liveSends += 1; throw new Error("paper must not send"); };
    live.perp = async () => { liveSends += 1; throw new Error("paper must not send"); };
    const runtime = new TradingRuntime(store, dir, market, pools, new Map(), null, perps, live, master);
    return { store, runtime, sends: () => liveSends };
  }

  it("runs three paper iterations, journals the decision, and never calls the live broker", async () => {
    const market = new FixtureMarket(trendBars(Date.now()));
    const { store, runtime, sends } = boot(market);
    store.saveOverrides({
      chains: Object.fromEntries(CHAINS.map((c) => [c.id, { enabled: c.id === "solana", tradingEnabled: c.id === "solana" }])) as Partial<Record<ChainId, { enabled: boolean; tradingEnabled: boolean }>>,
      pairs: { "sol-usdc": { enabled: true }, "ray-usdc": { enabled: false }, "base-weth-usdc": { enabled: false }, "arb-weth-usdc": { enabled: false }, "base-aero-usdc": { enabled: false } },
      strategyEnabled: { trend: true, breakout: false, mean_reversion: false },
    });
    await runtime.runOnce();
    await runtime.runOnce();
    await runtime.runOnce();
    const snap = runtime.snapshot();
    expect(snap.engine.mode).toBe("paper");
    expect(snap.decisions.length).toBeGreaterThanOrEqual(3);
    expect(sends()).toBe(0);
    expect(market.calls).toBe(3);
    const restarted = new TradingRuntime(store, store.file.replace(/meridian\.db$/, ""), market, buildPools(null), new Map(), null, new Hyperliquid(), new LiveBroker(new Map(), null, new Hyperliquid(), () => null), loadMasterKey(path.dirname(store.file)));
    const again = restarted.snapshot();
    expect(again.engine.mode).toBe("paper");
    expect(again.decisions.length).toBe(snap.decisions.length);
    store.setMeta("desiredRunning", "true");
    restarted.halt();
    expect(store.meta("desiredRunning")).toBe("true");
    restarted.stop();
    expect(store.meta("desiredRunning")).toBe("false");
    store.close();
  });

  it("refuses to start live mode when wallet keys are missing", async () => {
    process.env.TRADING_MODE = "live";
    const market = new FixtureMarket(trendBars(Date.now()));
    const { store, runtime } = boot(market);
    await runtime.start();
    expect(runtime.running).toBe(false);
    expect(runtime.lastError ?? "").toMatch(/wallet|key/i);
    store.close();
  });
});
