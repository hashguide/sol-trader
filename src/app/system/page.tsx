"use client";

import { useState } from "react";
import { useDesk } from "@/components/desk";
import { Badge, Button, Panel } from "@/components/ui";
import { when } from "@/lib/format";

interface UniverseRow {
  name: string;
  pool: string;
  pass: boolean;
  reasons: string[];
}

export default function SystemPage() {
  const { snap } = useDesk();
  const [rows, setRows] = useState<UniverseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [network, setNetwork] = useState("solana");
  const [loading, setLoading] = useState(false);
  if (!snap) return null;

  async function scan(next = network) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/universe?network=${encodeURIComponent(next)}`, { cache: "no-store" });
      const body = await res.json() as { rows?: UniverseRow[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Scan failed");
      setRows(body.rows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-4xl">System</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-fog">
          Alerts, the last reconciliation, and a read of trending pools. The allowlisted research pairs skip this screen. Anything else has to clear liquidity, age, and tax checks before it can be added by hand.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Panel className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-fog">Engine</div>
          <div className="mt-2 text-sm">{snap.engine.running ? `Loop ${snap.engine.iteration}, every ${Math.round(snap.engine.loopIntervalMs / 1000)}s` : "Idle. desiredRunning is off, so a reboot will not resume until you start it."}</div>
        </Panel>
        <Panel className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-fog">Alerts route</div>
          <div className="mt-2 text-sm">{snap.settings.alertWebhookSource === "none" ? "No webhook configured. Alerts still land in this feed." : `Webhook from ${snap.settings.alertWebhookSource}`}</div>
        </Panel>
        <Panel className="p-4">
          <div className="text-[11px] uppercase tracking-wide text-fog">Research</div>
          <div className="mt-2 text-sm">{snap.backtest ? `${snap.backtest.status} · ${when(snap.backtest.createdAt)}` : "No report stored"}</div>
        </Panel>
      </div>
      <Panel>
        <div className="border-b border-line px-4 py-3"><h2 className="font-serif text-2xl">Alerts</h2></div>
        {snap.alerts.length === 0 ? <p className="px-4 py-6 text-sm text-fog">No alerts. Trades, kill-switch changes, and loop errors show up here and, when configured, on Telegram or the webhook.</p> : (
          <ul className="divide-y divide-line">
            {snap.alerts.slice().reverse().map((alert) => (
              <li key={alert.id} className="px-4 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <Badge tone={alert.level === "error" || alert.level === "kill" ? "bad" : alert.level === "trade" ? "good" : "neutral"}>{alert.level}</Badge>
                  <span>{alert.title}</span>
                  <span className="text-xs text-fog">{when(alert.ts)}</span>
                </div>
                <p className="mt-1 text-sm text-fog">{alert.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel className="p-4">
        <h2 className="font-serif text-2xl">Reconciliation</h2>
        {snap.engine.reconciled.length === 0 ? <p className="mt-2 text-sm text-fog">Reconciliation runs when the loop starts. Until then there is nothing to compare.</p> : (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-fog">
            {snap.engine.reconciled.map((line) => <li key={line}>{line}</li>)}
          </ul>
        )}
      </Panel>
      <Panel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-2xl">Universe scan</h2>
          <div className="flex gap-2">
            <select className="h-9 rounded-md border border-line bg-ink px-2 text-sm" value={network} onChange={(e) => setNetwork(e.target.value)} aria-label="Network">
              <option value="solana">Solana</option>
              <option value="base">Base</option>
              <option value="arbitrum">Arbitrum</option>
              <option value="eth">Ethereum</option>
            </select>
            <Button variant="quiet" disabled={loading} onClick={() => void scan()}>{loading ? "Scanning…" : "Scan trending"}</Button>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-rose">{error}</p> : null}
        {rows == null ? <p className="mt-3 text-sm text-fog">Not scanned this session.</p> : rows.length === 0 ? <p className="mt-3 text-sm text-fog">The feed returned no pools.</p> : (
          <ul className="mt-3 divide-y divide-line">
            {rows.map((row) => (
              <li key={row.pool} className="py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span>{row.name}</span>
                  <Badge tone={row.pass ? "good" : "bad"}>{row.pass ? "passes" : "blocked"}</Badge>
                </div>
                {row.reasons.length ? <div className="text-xs text-fog">{row.reasons.join(" · ")}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel className="p-4">
        <h2 className="font-serif text-2xl">What the fills assume</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-fog">
          {snap.assumptions.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </Panel>
    </div>
  );
}
