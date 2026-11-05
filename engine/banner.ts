import type { ChainConfig, RuntimeSettings } from "./config";

export function renderBanner(input: {
  settings: RuntimeSettings;
  chains: ChainConfig[];
  wallets: { chain: string; address: string; source: string }[];
  kill: { engaged: boolean; reason: string | null };
  liveBlocked: string[];
}): string {
  const active = input.chains.filter((c) => input.settings.chains[c.id]?.enabled);
  const lines = [
    "================ MERIDIAN ================",
    `mode: ${input.settings.mode.toUpperCase()} (${input.settings.modeSource})`,
    `chains: ${active.map((c) => `${c.name}${input.settings.chains[c.id]?.tradingEnabled ? "" : " [watch]"}`).join(", ") || "none"}`,
    `wallets: ${input.wallets.length ? input.wallets.map((w) => `${w.chain} ${w.address} (${w.source})`).join(" | ") : "none"}`,
    `risk: ${input.settings.risk.riskPerTradePct}% per trade, max position ${input.settings.risk.maxPositionPct}%, concurrent ${input.settings.risk.maxConcurrentPositions}, chain ${input.settings.risk.maxChainExposurePct}%, token ${input.settings.risk.maxTokenExposurePct}%`,
    `drawdown kills: daily ${input.settings.risk.dailyDrawdownKillPct}%, total ${input.settings.risk.totalDrawdownKillPct}%`,
    `slippage cap ${input.settings.risk.maxSlippageBps} bps, impact cap ${input.settings.risk.maxPriceImpactBps} bps`,
    `kill switch: ${input.kill.engaged ? `ENGAGED (${input.kill.reason ?? "manual"})` : "off"}`,
    `paper equity seed: $${input.settings.paperStartingEquity}`,
  ];
  if (input.liveBlocked.length) lines.push(`LIVE BLOCKED: ${input.liveBlocked.join("; ")}`);
  lines.push("======================================");
  return lines.join("\n");
}
