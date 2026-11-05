import path from "node:path";
import { createApp, listen } from "./api";
import { renderBanner } from "./banner";
import { CHAINS, resolveSettings } from "./config";
import { Store } from "./db";
import { EvmAdapter } from "./evm";
import { Hyperliquid } from "./hyperliquid";
import { resolveKey } from "./keys";
import { LiveBroker } from "./live";
import { logger } from "./log";
import { PublicMarketData } from "./market";
import { buildPools, TradingRuntime } from "./runtime";
import { hashPassword, loadMasterKey } from "./secrets";
import type { ChainId } from "../src/shared/types";

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const store = new Store(path.join(dataDir, "meridian.db"));
const master = loadMasterKey(dataDir);

if (process.env.DASHBOARD_PASSWORD && !store.meta("password")) {
  store.setMeta("password", hashPassword(process.env.DASHBOARD_PASSWORD));
  logger.info("dashboard password loaded from DASHBOARD_PASSWORD");
}

const settings = resolveSettings(store.overrides());
const pools = buildPools(store.overrides());
const evm = new Map<ChainId, EvmAdapter>();
for (const chain of CHAINS) {
  if (chain.kind !== "evm") continue;
  const pool = pools.get(chain.id);
  if (!pool) {
    logger.error(`${chain.name} has no RPC endpoints`);
    continue;
  }
  evm.set(chain.id, new EvmAdapter(chain, pool));
}
const solanaPool = pools.get("solana");
const solanaChain = CHAINS.find((c) => c.id === "solana");
if (!solanaPool || !solanaChain) {
  logger.error("Solana has no RPC endpoints. Paper trading can still read cached candles; live Solana sends will fail.");
}
const { SolanaAdapter } = await import("./solana");
const solana = solanaPool && solanaChain ? new SolanaAdapter(solanaChain, solanaPool) : null;
const perps = new Hyperliquid();
const keyFor = (chain: ChainId) => {
  try { return resolveKey(store, master, chain); } catch { return null; }
};
const live = new LiveBroker(evm, solana, perps, keyFor, () =>
  keyFor("ethereum") ?? keyFor("base") ?? keyFor("arbitrum") ?? keyFor("robinhood"));
const runtime = new TradingRuntime(store, dataDir, new PublicMarketData(dataDir), pools, evm, solana, perps, live, master);

logger.info(`\n${renderBanner({
  settings,
  chains: CHAINS,
  wallets: CHAINS.flatMap((chain) => {
    const key = keyFor(chain.id);
    return key ? [{ chain: chain.id, address: key.address, source: key.source }] : [];
  }),
  kill: runtime.killState(),
  liveBlocked: runtime.liveBlockers(),
})}`);

if (settings.mode === "live" && runtime.liveBlockers().length) {
  logger.error({ problems: runtime.liveBlockers() }, "LIVE MODE REFUSED. The process will stay up so the dashboard can show the reason, and it will not send orders.");
}

const app = createApp(runtime, store, master);
const host = process.env.ENGINE_BIND ?? "127.0.0.1";
const port = Number(process.env.ENGINE_PORT ?? 4471);
listen(app, host, port);

const autostart = store.meta("desiredRunning") === "true" || process.env.ENGINE_AUTOSTART === "true";
if (autostart && store.meta("password")) {
  if (settings.mode === "live" && runtime.liveBlockers().length) {
    logger.error("autostart skipped because live mode is blocked");
  } else {
    void runtime.start();
  }
} else if (!store.meta("password")) {
  logger.info("trading is idle until a dashboard password is set and the engine is started");
} else {
  logger.info("trading is idle. Start it from the dashboard; that choice is remembered across restarts.");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    runtime.halt();
    store.close();
    process.exit(0);
  });
}
