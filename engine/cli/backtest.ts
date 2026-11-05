import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { CHAINS, PAIRS, resolveSettings } from "../config";
import { Store } from "../db";
import { PublicMarketData } from "../market";
import { researchSleeve } from "../../src/shared/gates";
import { ASSUMPTIONS } from "../../src/shared/types";
import { fmt } from "../../src/shared/metrics";

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const store = new Store(path.join(dataDir, "meridian.db"));
const settings = resolveSettings(store.overrides());
const market = new PublicMarketData(dataDir);
const sleeves = ["trend", "breakout", "mean_reversion", "composite"] as const;
const reportPairs = [];

for (const pair of PAIRS) {
  const loaded = await market.getBars(pair, Date.now());
  const chain = CHAINS.find((c) => c.id === pair.chain);
  const costs = {
    feeBps: pair.feeBps,
    gasUsd: chain?.gasUsd ?? 0,
    baseSlippageBps: 5,
    impactCoeff: 0.1,
    fundingBpsPer8h: pair.perpCoin ? 1 : 0,
    allowPerpShort: Boolean(pair.perpCoin),
    venueForShort: pair.perpCoin ? "perp" as const : "spot" as const,
  };
  const results = sleeves.map((sleeve) => researchSleeve(loaded.bars, settings.strategy, costs, sleeve, settings.gates, null, settings.paperStartingEquity));
  reportPairs.push({
    pairId: pair.id,
    label: `${pair.base.symbol}/${pair.quote.symbol}`,
    chain: pair.chain,
    bars: loaded.bars.length,
    from: loaded.bars[0]?.t ?? null,
    to: loaded.bars.at(-1)?.t ?? null,
    source: loaded.source,
    sleeves: results,
  });
  console.log(`\n${pair.base.symbol}/${pair.quote.symbol} on ${pair.chain}  bars=${loaded.bars.length} source=${loaded.source}`);
  for (const sleeve of results) {
    const m = sleeve.outOfSample;
    console.log(
      `  ${sleeve.strategy.padEnd(16)} OOS pnl $${fmt(m.pnlUsd)}  exp $${fmt(m.expectancyUsd)}  pf ${fmt(m.profitFactor)}  dd ${fmt(m.maxDrawdownPct)}%  n ${m.trades}  sharpe ${fmt(m.sharpe)}  gate ${sleeve.gates.status}`,
    );
  }
}

const report = { generatedAt: Date.now(), assumptions: ASSUMPTIONS, pairs: reportPairs };
mkdirSync(path.join(process.cwd(), "reports"), { recursive: true });
const file = path.join(process.cwd(), "reports", "walk-forward.json");
writeFileSync(file, JSON.stringify(report));
store.saveBacktest(`cli_${Date.now()}`, "done", report, null);
console.log(`\nWrote ${file}`);
store.close();
