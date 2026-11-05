import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { CHAINS } from "../config";
import { Store } from "../db";
import { EvmAdapter } from "../evm";
import { Hyperliquid } from "../hyperliquid";
import { LiveBroker } from "../live";
import { PublicMarketData } from "../market";
import { buildPools, TradingRuntime } from "../runtime";
import { loadMasterKey, hashPassword } from "../secrets";
import type { ChainId } from "../../src/shared/types";

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const scratch = mkdtempSync(path.join(tmpdir(), "meridian-paper-"));
const store = new Store(path.join(scratch, "meridian.db"));
store.setMeta("password", hashPassword("paper-smoke-pass"));
const master = loadMasterKey(scratch);
const pools = buildPools(null);
const evm = new Map<ChainId, EvmAdapter>();
for (const chain of CHAINS) {
  if (chain.kind !== "evm") continue;
  const pool = pools.get(chain.id);
  if (pool) evm.set(chain.id, new EvmAdapter(chain, pool));
}
const { SolanaAdapter } = await import("../solana");
const solanaChain = CHAINS.find((c) => c.id === "solana");
const solanaPool = pools.get("solana");
const solana = solanaChain && solanaPool ? new SolanaAdapter(solanaChain, solanaPool) : null;
const perps = new Hyperliquid();
const live = new LiveBroker(evm, solana, perps, () => null, () => null);
const runtime = new TradingRuntime(store, dataDir, new PublicMarketData(dataDir), pools, evm, solana, perps, live, master);
let sends = 0;
const original = live.spot.bind(live);
live.spot = async (...args) => { sends += 1; return original(...args); };
console.log("paper smoke: three iterations, public market data, no keys");
for (let i = 1; i <= 3; i += 1) {
  const started = Date.now();
  await runtime.runOnce();
  console.log(`iteration ${i} in ${Date.now() - started}ms  equity ${runtime.snapshot().engine.paperEquity.toFixed(2)}  decisions ${runtime.snapshot().decisions.length}`);
}
const snap = runtime.snapshot();
console.log(`mode ${snap.engine.mode} running-flag ${snap.engine.running} liveSends ${sends} pairs ${snap.pairs.map((p) => `${p.id}:${p.regime ?? "n/a"}`).join(", ")}`);
if (snap.engine.mode !== "paper") throw new Error("smoke left paper mode");
if (sends !== 0) throw new Error("paper smoke called the live broker");
console.log("paper smoke ok");
store.close();
