import type { Snapshot } from "./types";

export interface ReadyItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  severity: "info" | "warn" | "block";
}

/** Derives a setup checklist from real snapshot fields only. */
export function readiness(snap: Snapshot): ReadyItem[] {
  const trading = snap.chains.filter((chain) => chain.enabled && chain.tradingEnabled);
  const freshRpc = trading.filter((chain) => chain.rpc.some((row) => row.lastSuccessAt && !row.stale));
  const wallets = trading.filter((chain) => Boolean(chain.wallet?.address));
  const paperOnly = snap.pairs.filter((pair) => pair.eligibility === "backtest_pass_pending_paper");
  const liveEligible = snap.pairs.filter((pair) => pair.eligibility === "eligible");
  const items: ReadyItem[] = [
    {
      id: "password",
      label: "Desk password",
      ok: true,
      detail: "Set. The engine can resume without this window.",
      severity: "info",
    },
    {
      id: "engine",
      label: "Trading loop",
      ok: snap.engine.running,
      detail: snap.engine.running
        ? `Running · pass #${snap.engine.iteration}`
        : "Stopped. Start from the status rail when you want new risk.",
      severity: snap.engine.running ? "info" : "warn",
    },
    {
      id: "stream",
      label: "Live desk stream",
      ok: true,
      detail: "Filled by the client from the SSE connection state.",
      severity: "info",
    },
    {
      id: "mode",
      label: "Trading mode",
      ok: snap.engine.mode === "paper" || snap.engine.liveBlocked.length === 0,
      detail: snap.engine.mode === "paper"
        ? "Paper. No live sends."
        : snap.engine.liveBlocked.length
          ? snap.engine.liveBlocked.join(" ")
          : "Live mode armed.",
      severity: snap.engine.mode === "live" && snap.engine.liveBlocked.length ? "block" : "info",
    },
    {
      id: "rpc",
      label: "RPC health on trading chains",
      ok: trading.length === 0 || freshRpc.length === trading.length,
      detail: trading.length === 0
        ? "No chain is enabled for trading."
        : `${freshRpc.length}/${trading.length} trading chains have a fresh endpoint.`,
      severity: freshRpc.length === trading.length ? "info" : "warn",
    },
    {
      id: "wallets",
      label: "Wallets for live trading",
      ok: snap.engine.mode === "paper" || wallets.length === trading.length,
      detail: snap.engine.mode === "paper"
        ? "Not required in paper mode. Add keys before going live."
        : `${wallets.length}/${trading.length} trading chains have an address.`,
      severity: snap.engine.mode === "live" && wallets.length < trading.length ? "block" : "info",
    },
    {
      id: "kill",
      label: "Kill switch",
      ok: !snap.engine.kill.engaged,
      detail: snap.engine.kill.engaged
        ? `Engaged${snap.engine.kill.reason ? `: ${snap.engine.kill.reason}` : ""}`
        : "Clear.",
      severity: snap.engine.kill.engaged ? "block" : "info",
    },
    {
      id: "gates",
      label: "Promotion gates",
      ok: liveEligible.length > 0 || paperOnly.length > 0,
      detail: liveEligible.length
        ? `${liveEligible.length} sleeve(s) live-eligible.`
        : paperOnly.length
          ? `${paperOnly.length} sleeve(s) passed OOS and need paper confirmation.`
          : snap.backtest
            ? "Latest walk-forward has no paper-ready sleeve."
            : "No walk-forward stored yet. Run research from the workstation.",
      severity: liveEligible.length ? "info" : paperOnly.length ? "warn" : "warn",
    },
  ];
  return items;
}

export function gateTone(status: string): "good" | "warn" | "bad" | "neutral" {
  if (status === "eligible") return "good";
  if (status === "backtest_pass_pending_paper") return "warn";
  if (status === "fail") return "bad";
  return "neutral";
}

export function gateLabel(status: string): string {
  if (status === "eligible") return "Live eligible";
  if (status === "backtest_pass_pending_paper") return "Paper only";
  if (status === "fail") return "Failed";
  return status;
}
