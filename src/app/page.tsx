"use client";

import { useState } from "react";
import { Badge, Button, Dialog, Panel, Stat } from "@/components/ui";
import { useDesk } from "@/components/desk";
import { money, num, pct, signed, tone, when } from "@/lib/format";

export default function BookPage() {
  const { snap, call, refresh } = useDesk();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [killOpen, setKillOpen] = useState(false);
  if (!snap) return null;
  const engine = snap.engine;

  async function run(name: string, path: string, init?: RequestInit) {
    setBusy(name);
    setError(null);
    try {
      await call(path, init);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl text-paper">The book</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-fog">
            The engine is its own process. Closing this window does not flatten positions or stop the loop.
            What you see is the journal it has been writing the whole time.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {engine.running
            ? <Button variant="quiet" disabled={busy !== null} onClick={() => run("stop", "/api/engine/stop", { method: "POST" })}>{busy === "stop" ? "Stopping…" : "Stop loop"}</Button>
            : <Button disabled={busy !== null} onClick={() => run("start", "/api/engine/start", { method: "POST" })}>{busy === "start" ? "Starting…" : "Start loop"}</Button>}
          <Button variant="quiet" disabled={busy !== null} onClick={() => run("flat", "/api/engine/flatten", { method: "POST" })}>Flatten</Button>
          <Button variant="danger" onClick={() => setKillOpen(true)}>{engine.kill.engaged ? "Kill is on" : "Kill switch"}</Button>
        </div>
      </div>

      {error ? <p className="text-sm text-rose">{error}</p> : null}
      {engine.lastError ? <p className="text-sm text-rose">Last engine error: {engine.lastError}</p> : null}
      {engine.liveBlocked.length ? (
        <Panel className="px-4 py-3 text-sm text-rose">{engine.liveBlocked.join(" ")}</Panel>
      ) : null}

      <Panel className="grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
        <Stat label="Equity" value={money(engine.paperEquity)} />
        <Stat label="Day PnL" value={signed(engine.dayPnl)} className={tone(engine.dayPnl)} />
        <Stat label="Drawdown" value={pct(engine.drawdownPct)} className={engine.drawdownPct > 0 ? "text-rose" : undefined} />
        <Stat label="Loop" value={engine.running ? `#${engine.iteration}` : "Idle"} />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-2xl">Equity</h2>
            <span className="text-xs text-fog">{engine.running ? `Last pass ${when(engine.lastLoopAt)}` : "Loop is stopped. History stays here."}</span>
          </div>
          <Equity points={snap.equity} />
        </Panel>
        <Panel className="p-4">
          <h2 className="font-serif text-2xl">Startup banner</h2>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-fog">{snap.banner}</pre>
        </Panel>
      </div>

      <Panel>
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-serif text-2xl">Open positions</h2>
        </div>
        {snap.positions.length === 0 ? (
          <p className="px-4 py-6 text-sm text-fog">The book is flat. No open paper or live position is in the journal.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-fog">
                <tr>
                  <th className="px-4 py-2 font-medium">Pair</th>
                  <th className="px-4 py-2 font-medium">Side</th>
                  <th className="px-4 py-2 font-medium">Strategy</th>
                  <th className="px-4 py-2 font-medium">Entry</th>
                  <th className="px-4 py-2 font-medium">Stop</th>
                  <th className="px-4 py-2 font-medium">Target</th>
                  <th className="px-4 py-2 font-medium">Notional</th>
                </tr>
              </thead>
              <tbody>
                {snap.positions.map((trade) => (
                  <tr key={trade.id} className="border-t border-line">
                    <td className="px-4 py-2">{trade.pairId}</td>
                    <td className="px-4 py-2">{trade.mode} {trade.side} {trade.venue}</td>
                    <td className="px-4 py-2">{trade.strategy}</td>
                    <td className="px-4 py-2 font-mono">{num(trade.entryPx, 4)}</td>
                    <td className="px-4 py-2 font-mono text-rose">{num(trade.stopPx, 4)}</td>
                    <td className="px-4 py-2 font-mono text-mint">{num(trade.takeProfitPx, 4)}</td>
                    <td className="px-4 py-2 font-mono">{money(trade.notionalUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel>
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-serif text-2xl">Universe</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-fog">
              <tr>
                <th className="px-4 py-2 font-medium">Pair</th>
                <th className="px-4 py-2 font-medium">Mark</th>
                <th className="px-4 py-2 font-medium">Regime</th>
                <th className="px-4 py-2 font-medium">ADX</th>
                <th className="px-4 py-2 font-medium">RSI</th>
                <th className="px-4 py-2 font-medium">Gate</th>
                <th className="px-4 py-2 font-medium">Last read</th>
              </tr>
            </thead>
            <tbody>
              {snap.pairs.map((pair) => (
                <tr key={pair.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <div>{pair.label}</div>
                    <div className="text-xs text-fog">{pair.chain} · {pair.dex} · {pair.feeBps} bps · {pair.enabled ? "on" : "off"}</div>
                  </td>
                  <td className="px-4 py-2 font-mono">{pair.price == null ? "—" : num(pair.price, 4)}</td>
                  <td className="px-4 py-2">{pair.regime ?? "—"}</td>
                  <td className="px-4 py-2 font-mono">{num(pair.indicators.adx, 1)}</td>
                  <td className="px-4 py-2 font-mono">{num(pair.indicators.rsi, 1)}</td>
                  <td className="px-4 py-2"><Gate status={pair.eligibility} /></td>
                  <td className="px-4 py-2 text-fog">{pair.lastSignal ?? "Waiting for a closed bar"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <KillDialog open={killOpen} engaged={engine.kill.engaged} reason={engine.kill.reason} busy={busy === "kill"} onOpenChange={setKillOpen} onConfirm={(engaged) => {
        setKillOpen(false);
        void run("kill", "/api/kill", { method: "POST", body: JSON.stringify({ engaged, reason: engaged ? "manual kill from the desk" : "cleared from the desk" }) });
      }} />
    </div>
  );
}

function Gate({ status }: { status: string }) {
  if (status === "eligible") return <Badge tone="good">Live eligible</Badge>;
  if (status === "backtest_pass_pending_paper") return <Badge tone="warn">Paper only</Badge>;
  if (status === "fail") return <Badge tone="bad">Failed</Badge>;
  return <Badge>{status}</Badge>;
}

function Equity({ points }: { points: { t: number; equity: number }[] }) {
  if (points.length < 2) {
    return <p className="py-10 text-sm text-fog">The equity curve starts after the engine records its first mark. Starting paper equity is still the book value above.</p>;
  }
  const width = 640;
  const height = 160;
  const min = Math.min(...points.map((point) => point.equity));
  const max = Math.max(...points.map((point) => point.equity));
  const flat = max - min < 0.01;
  const path = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const span = max - min || 1;
    const y = height - ((point.equity - min) / span) * (height - 12) - 6;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <div>
      {flat ? <p className="mb-2 text-xs text-fog">Unchanged at {money(points[points.length - 1]?.equity)}. No fill has moved the book yet.</p> : null}
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full">
        <path d={path} fill="none" stroke="#e0b15a" strokeWidth="2" />
      </svg>
    </div>
  );
}

function KillDialog({ open, engaged, reason, busy, onOpenChange, onConfirm }: { open: boolean; engaged: boolean; reason: string | null; busy: boolean; onOpenChange: (open: boolean) => void; onConfirm: (engaged: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={engaged ? "Clear the kill switch" : "Engage the kill switch"}>
      <p className="text-sm leading-6 text-fog">
        {engaged
          ? `The kill is on${reason ? `: ${reason}` : ""}. Clearing it lets the engine take new risk again. A kill held by KILL_SWITCH or the data/KILL file cannot be cleared from here.`
          : "This flattens every open position in the current mode and blocks new entries. Exits still run. The engine process stays up."}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="quiet" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant={engaged ? "default" : "danger"} disabled={busy} onClick={() => onConfirm(!engaged)}>{engaged ? "Clear kill" : "Flatten and kill"}</Button>
      </div>
    </Dialog>
  );
}
