"use client";

import { useEffect, useState } from "react";
import { useDesk } from "@/components/desk";
import { Badge, Button, Panel } from "@/components/ui";
import { num, pct, signed } from "@/lib/format";
import type { ResearchReport, SleeveReport } from "@/lib/types";

export default function ResearchPage() {
  const { snap, call, refresh } = useDesk();
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/backtests/latest", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) return;
        const body = await res.json() as { report?: ResearchReport; error?: string | null } | null;
        if (!cancelled) setReport(body?.report ?? null);
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the report"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [snap?.backtest?.id, snap?.backtest?.status]);

  if (!snap) return null;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await call("/api/backtests", { method: "POST" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl">Research</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-fog">
            Walk-forward uses the pre-registered parameters. A sleeve that fails stays failed. Live trading requires the paper gate as well; a green backtest is not permission to send orders.
          </p>
        </div>
        <Button disabled={busy || snap.researchRunning} onClick={() => void run()}>
          {snap.researchRunning ? "Running…" : busy ? "Starting…" : "Run walk-forward"}
        </Button>
      </div>
      {error ? <p className="text-sm text-rose">{error}</p> : null}
      {snap.backtest?.error ? <p className="text-sm text-rose">{snap.backtest.error}</p> : null}
      {loading ? <p className="text-sm text-fog">Loading the last report…</p> : null}
      {!loading && !report ? <Panel className="px-4 py-6 text-sm text-fog">No walk-forward is stored yet. Run one. It reads the cached hourly candles and writes the result into the same database the engine uses.</Panel> : null}
      {report?.pairs?.map((pair) => (
        <Panel key={pair.pairId}>
          <div className="border-b border-line px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-serif text-2xl">{pair.label} <span className="text-base text-fog">{pair.chain}</span></h2>
            </div>
            <p className="mt-1 text-sm text-fog">{pair.recommendation}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-fog">
                <tr>
                  <th className="px-4 py-2 font-medium">Sleeve</th>
                  <th className="px-4 py-2 font-medium">OOS PnL</th>
                  <th className="px-4 py-2 font-medium">Expectancy</th>
                  <th className="px-4 py-2 font-medium">PF</th>
                  <th className="px-4 py-2 font-medium">Max DD</th>
                  <th className="px-4 py-2 font-medium">Trades</th>
                  <th className="px-4 py-2 font-medium">Hold</th>
                  <th className="px-4 py-2 font-medium">Gate</th>
                </tr>
              </thead>
              <tbody>
                {pair.sleeves.map((sleeve) => <SleeveRow key={sleeve.strategy} sleeve={sleeve} />)}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
      {report?.assumptions ? (
        <Panel className="px-4 py-4">
          <h2 className="font-serif text-2xl">Assumptions that were not fitted</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-fog">
            {report.assumptions.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

function SleeveRow({ sleeve }: { sleeve: SleeveReport }) {
  const m = sleeve.outOfSample;
  const status = sleeve.gates.status;
  return (
    <tr className="border-t border-line align-top">
      <td className="px-4 py-2">{sleeve.strategy.replaceAll("_", " ")}</td>
      <td className="whitespace-nowrap px-4 py-2 font-mono">{signed(m.pnlUsd)}</td>
      <td className="whitespace-nowrap px-4 py-2 font-mono">{m.expectancyUsd == null ? "—" : signed(m.expectancyUsd)}</td>
      <td className="whitespace-nowrap px-4 py-2 font-mono">{m.profitFactor == null ? "—" : num(m.profitFactor, 2)}</td>
      <td className="whitespace-nowrap px-4 py-2 font-mono">{pct(m.maxDrawdownPct)}</td>
      <td className="whitespace-nowrap px-4 py-2 font-mono">{m.trades}</td>
      <td className="whitespace-nowrap px-4 py-2 font-mono">{m.avgBarsHeld == null ? "—" : `${num(m.avgBarsHeld, 1)}h`}</td>
      <td className="px-4 py-2">
        <Badge tone={status === "eligible" ? "good" : status === "backtest_pass_pending_paper" ? "warn" : "bad"}>
          {status === "eligible" ? "Live eligible" : status === "backtest_pass_pending_paper" ? "Paper only" : "Failed"}
        </Badge>
        <div className="mt-1 max-w-xs text-[11px] leading-4 text-fog">
          {sleeve.gates.checks.filter((check) => !check.pass).map((check) => check.actual).join(" · ") || "Every check passed, including paper"}
        </div>
      </td>
    </tr>
  );
}
