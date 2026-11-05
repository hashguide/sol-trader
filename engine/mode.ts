import { LIVE_CONFIRM, type TradingMode } from "../src/shared/types";

export interface ChainKeyStatus {
  id: string;
  tradingEnabled: boolean;
  address: string | null;
}

export type ModeDecision =
  | { ok: true; mode: TradingMode }
  | { ok: false; problems: string[] };

/**
 * Paper is the default operating mode. Live is refused unless every chain that
 * is allowed to trade has a validated key, and the caller repeats the confirm phrase.
 */
export function evaluateModeChange(input: {
  requested: TradingMode;
  confirm?: string;
  chains: ChainKeyStatus[];
}): ModeDecision {
  if (input.requested === "paper") return { ok: true, mode: "paper" };
  const problems: string[] = [];
  if (input.confirm !== LIVE_CONFIRM) {
    problems.push(`Live mode requires confirmation phrase "${LIVE_CONFIRM}"`);
  }
  const trading = input.chains.filter((c) => c.tradingEnabled);
  if (trading.length === 0) problems.push("No chain is enabled for trading");
  for (const chain of trading) {
    if (!chain.address) problems.push(`${chain.id} is enabled for trading but has no valid wallet key`);
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, mode: "live" };
}
