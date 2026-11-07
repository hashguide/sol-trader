"use client";

import { useEffect, useState } from "react";
import { useDesk } from "@/components/desk";
import { Badge, Button, Dialog, Input, Label, Sheet, Switch } from "@/components/ui";
import { money, num, pct, signed, when } from "@/lib/format";
import { readiness } from "@/lib/readiness";
import type { GateConfig, ResearchReport, RiskLimits, SleeveReport } from "@/lib/types";

const LIVE_CONFIRM = "ENABLE LIVE TRADING";

const RISK_FIELDS: { key: keyof RiskLimits; label: string }[] = [
  { key: "riskPerTradePct", label: "Risk per trade %" },
  { key: "maxPositionPct", label: "Max position %" },
  { key: "maxConcurrentPositions", label: "Max concurrent" },
  { key: "maxChainExposurePct", label: "Max chain %" },
  { key: "maxTokenExposurePct", label: "Max token %" },
  { key: "dailyDrawdownKillPct", label: "Daily DD kill %" },
  { key: "totalDrawdownKillPct", label: "Total DD kill %" },
  { key: "maxSlippageBps", label: "Max slippage bps" },
  { key: "maxPriceImpactBps", label: "Max impact bps" },
  { key: "maxGasEdgePct", label: "Max gas / edge %" },
  { key: "circuitBarMovePct", label: "Circuit bar %" },
  { key: "staleDataMinutes", label: "Stale minutes" },
  { key: "quoteDivergencePct", label: "Quote divergence %" },
  { key: "emergencyExitSlippageBps", label: "Emergency exit bps" },
];

const GATE_FIELDS: { key: keyof GateConfig; label: string }[] = [
  { key: "minExpectancyUsd", label: "Min expectancy $" },
  { key: "minProfitFactor", label: "Min PF" },
  { key: "maxDrawdownPct", label: "Max DD %" },
  { key: "minTrades", label: "Min trades" },
  { key: "minProfitableWindowFraction", label: "Profitable windows" },
  { key: "minStableGridFraction", label: "Stable grid" },
  { key: "paperMinTrades", label: "Paper min trades" },
  { key: "paperMinProfitFactor", label: "Paper min PF" },
  { key: "paperMaxDrawdownPct", label: "Paper max DD %" },
];

export function WorkstationDrawers() {
  const { snap, drawer, openDrawer, run, busy, offline } = useDesk();
  const [liveOpen, setLiveOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    if (drawer !== "research") return;
    let cancelled = false;
    setReportLoading(true);
    fetch("/api/backtests/latest", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const body = await res.json() as { report?: ResearchReport } | null;
        if (!cancelled) setReport(body?.report ?? null);
      })
      .finally(() => { if (!cancelled) setReportLoading(false); });
    return () => { cancelled = true; };
  }, [drawer, snap?.backtest?.id, snap?.backtest?.status]);

  if (!snap) return null;
  const close = () => openDrawer(null);

  return (
    <>
      <Sheet open={drawer === "setup"} onOpenChange={(open) => !open && close()} title="Readiness guide" description="Checks use the live journal and chain health. Nothing here invents balances or PnL.">
        <SetupBody offline={offline} onOpen={openDrawer} />
      </Sheet>

      <Sheet open={drawer === "research"} onOpenChange={(open) => !open && close()} title="Research workflow" description="Walk-forward is historical OOS evidence. Paper confirmation is separate. Live eligibility requires both." wide>
        <div className="space-y-4">
          <div className="rounded-md border border-line bg-ink px-3 py-2 text-sm text-fog">
            1. Run walk-forward → 2. Paper sleeves marked paper-only → 3. Live only when a sleeve is eligible. Do not retune after seeing numbers.
          </div>
          <Button
            disabled={busy !== null || snap.researchRunning}
            onClick={() => void run("research", "/api/backtests", { method: "POST" }, "Walk-forward started. Results land in the journal when finished.")}
          >
            {snap.researchRunning ? "Running…" : busy === "research" ? "Starting…" : "Run walk-forward"}
          </Button>
          {snap.backtest?.error ? <p className="text-sm text-rose">{snap.backtest.error}</p> : null}
          {reportLoading ? <p className="text-sm text-fog">Loading the last report…</p> : null}
          {!reportLoading && !report ? <p className="text-sm text-fog">No walk-forward stored yet.</p> : null}
          {report?.pairs?.map((pair) => (
            <div key={pair.pairId} className="rounded-lg border border-line">
              <div className="border-b border-line px-3 py-2">
                <div className="font-medium">{pair.label} <span className="text-fog">{pair.chain}</span></div>
                <p className="text-xs text-fog">{pair.recommendation}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-fog">
                    <tr>
                      <th className="px-3 py-2 font-medium">Sleeve</th>
                      <th className="px-3 py-2 font-medium">OOS PnL</th>
                      <th className="px-3 py-2 font-medium">PF</th>
                      <th className="px-3 py-2 font-medium">Trades</th>
                      <th className="px-3 py-2 font-medium">Gate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pair.sleeves.map((sleeve) => <SleeveRow key={sleeve.strategy} sleeve={sleeve} />)}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </Sheet>

      <Sheet open={drawer === "risk"} onOpenChange={(open) => !open && close()} title="Risk & routing" description="Saves write into the engine database and apply on the next decision." wide>
        <div className="space-y-5">
          <section className="space-y-2">
            <h3 className="font-serif text-xl">Mode</h3>
            <p className="text-sm text-fog">Current {snap.settings.mode} from {snap.settings.modeSource}. Live needs the confirmation phrase and keys on every trading chain.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant={snap.settings.mode === "paper" ? "default" : "quiet"} onClick={() => void run("mode", "/api/mode", { method: "POST", body: JSON.stringify({ mode: "paper" }) }, "Paper mode saved.")}>Paper</Button>
              <Button variant={snap.settings.mode === "live" ? "danger" : "quiet"} onClick={() => { setPhrase(""); setLiveOpen(true); }}>Live…</Button>
            </div>
            {snap.settings.overrideGates ? <p className="text-sm text-rose">Gate override is on. Leave it off unless you intentionally bypass promotion.</p> : null}
          </section>
          <NumberForm title="Limits" fields={RISK_FIELDS} initial={snap.settings.risk} onSubmit={(risk) => void run("risk", "/api/risk", { method: "PUT", body: JSON.stringify(risk) }, "Risk limits saved.")} />
          <NumberForm title="Promotion gates" fields={GATE_FIELDS} initial={snap.settings.gates} onSubmit={(gates) => void run("gates", "/api/gates", { method: "PUT", body: JSON.stringify(gates) }, "Gates saved.")} />
          <Cadence
            seconds={Math.round(snap.settings.loopIntervalMs / 1000)}
            equity={snap.settings.paperStartingEquity}
            overrideGates={snap.settings.overrideGates}
            onSave={(body) => void run("loop", "/api/loop", { method: "PUT", body: JSON.stringify(body) }, "Cadence saved.")}
          />
          <section className="space-y-2">
            <h3 className="font-serif text-xl">Chains</h3>
            {snap.chains.map((chain) => (
              <div key={chain.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line px-3 py-2">
                <div className="min-w-32">
                  <div>{chain.name}</div>
                  <div className="text-[11px] text-fog">{chain.productionReady ? "Production ready" : "Not production ready"}</div>
                </div>
                <Toggle label={`${chain.name} enabled`} checked={chain.enabled} onChange={(enabled) => void run(`chain-${chain.id}`, `/api/chains/${chain.id}`, { method: "PUT", body: JSON.stringify({ enabled }) }, `${chain.name} updated.`)} />
                <Toggle label={`${chain.name} trading`} checked={chain.tradingEnabled} onChange={(tradingEnabled) => void run(`trade-${chain.id}`, `/api/chains/${chain.id}`, { method: "PUT", body: JSON.stringify({ tradingEnabled }) }, `${chain.name} trading updated.`)} />
              </div>
            ))}
          </section>
          <section className="space-y-2">
            <h3 className="font-serif text-xl">Pairs & sleeves</h3>
            {snap.pairs.map((pair) => (
              <div key={pair.id} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                <div>
                  <div>{pair.label}</div>
                  <div className="text-[11px] text-fog">{pair.chain}</div>
                </div>
                <Toggle label={pair.label} checked={pair.enabled} onChange={(enabled) => void run(`pair-${pair.id}`, `/api/pairs/${pair.id}`, { method: "PUT", body: JSON.stringify({ enabled }) }, `${pair.label} updated.`)} />
              </div>
            ))}
            {(["trend", "breakout", "mean_reversion"] as const).map((id) => (
              <div key={id} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                <div className="capitalize">{id.replaceAll("_", " ")}</div>
                <Toggle label={id} checked={snap.settings.strategy.enabled[id]} onChange={(enabled) => void run(`strat-${id}`, `/api/strategies/${id}`, { method: "PUT", body: JSON.stringify({ enabled }) }, `${id} updated.`)} />
              </div>
            ))}
          </section>
        </div>
      </Sheet>

      <Sheet open={drawer === "network"} onOpenChange={(open) => !open && close()} title="Network & wallets" description="RPC edits apply to the running pool immediately. Keys are encrypted and never returned." wide>
        <NetworkBody />
      </Sheet>

      <Sheet open={drawer === "system"} onOpenChange={(open) => !open && close()} title="System" description="Alerts, reconciliation notes, and fill assumptions from the engine.">
        <SystemBody />
      </Sheet>

      <Dialog open={liveOpen} onOpenChange={setLiveOpen} title="Switch to live trading">
        <p className="text-sm leading-6 text-fog">Live sends real orders. Type <span className="font-mono text-paper">{LIVE_CONFIRM}</span>.</p>
        <Input className="mt-3" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setLiveOpen(false)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={phrase !== LIVE_CONFIRM}
            onClick={() => {
              setLiveOpen(false);
              void run("live", "/api/mode", { method: "POST", body: JSON.stringify({ mode: "live", confirm: phrase }) }, "Live mode saved. Start still refuses without keys.");
            }}
          >
            Enable live
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function SetupBody({ offline, onOpen }: { offline: boolean; onOpen: (id: "research" | "risk" | "network" | "system" | "setup" | null) => void }) {
  const { snap } = useDesk();
  if (!snap) return null;
  const items = readiness(snap).map((item) => item.id === "stream"
    ? { ...item, ok: !offline, detail: offline ? "SSE stream is down. Reopen or retry; the engine may still be trading." : "SSE stream connected." }
    : item);
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="rounded-md border border-line px-3 py-2">
          <div className="flex items-center gap-2">
            <Badge tone={item.ok ? "good" : item.severity === "block" ? "bad" : "warn"}>{item.ok ? "ok" : item.severity}</Badge>
            <span className="text-sm text-paper">{item.label}</span>
          </div>
          <p className="mt-1 text-sm text-fog">{item.detail}</p>
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-2">
        <Button size="sm" variant="quiet" onClick={() => onOpen("network")}>Fix network / wallets</Button>
        <Button size="sm" variant="quiet" onClick={() => onOpen("research")}>Run research</Button>
        <Button size="sm" variant="quiet" onClick={() => onOpen("risk")}>Review risk</Button>
      </div>
    </div>
  );
}

function SleeveRow({ sleeve }: { sleeve: SleeveReport }) {
  const m = sleeve.outOfSample;
  const status = sleeve.gates.status;
  return (
    <tr className="border-t border-line align-top">
      <td className="px-3 py-2">{sleeve.strategy.replaceAll("_", " ")}</td>
      <td className="whitespace-nowrap px-3 py-2 font-mono">{signed(m.pnlUsd)}</td>
      <td className="whitespace-nowrap px-3 py-2 font-mono">{m.profitFactor == null ? "—" : num(m.profitFactor, 2)}</td>
      <td className="whitespace-nowrap px-3 py-2 font-mono">{m.trades}</td>
      <td className="px-3 py-2">
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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center gap-2 text-sm text-fog">
      <Switch checked={checked} onCheckedChange={onChange} label={label} />
      <span>{checked ? "On" : "Off"}</span>
    </div>
  );
}

function NumberForm<T extends object>({ title, fields, initial, onSubmit }: { title: string; fields: { key: keyof T & string; label: string }[]; initial: T; onSubmit: (value: T) => void }) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => { setDraft(initial); }, [initial]);
  return (
    <section>
      <h3 className="font-serif text-xl">{title}</h3>
      <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSubmit(draft); }}>
        {fields.map((field) => (
          <div key={field.key}>
            <Label htmlFor={field.key}>{field.label}</Label>
            <Input id={field.key} className="mt-1 font-mono" inputMode="decimal" value={String(draft[field.key] ?? "")} onChange={(event) => {
              const value = Number(event.target.value);
              setDraft((current) => ({ ...current, [field.key]: Number.isFinite(value) ? value : current[field.key] }));
            }} />
          </div>
        ))}
        <div className="flex items-end"><Button type="submit">Save {title.toLowerCase()}</Button></div>
      </form>
    </section>
  );
}

function Cadence({ seconds, equity, overrideGates, onSave }: { seconds: number; equity: number; overrideGates: boolean; onSave: (body: { loopIntervalMs: number; paperStartingEquity: number; overrideGates: boolean }) => void }) {
  const [loop, setLoop] = useState(seconds);
  const [paper, setPaper] = useState(equity);
  const [override, setOverride] = useState(overrideGates);
  useEffect(() => { setLoop(seconds); setPaper(equity); setOverride(overrideGates); }, [seconds, equity, overrideGates]);
  return (
    <section>
      <h3 className="font-serif text-xl">Cadence</h3>
      <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSave({ loopIntervalMs: loop * 1000, paperStartingEquity: paper, overrideGates: override }); }}>
        <div>
          <Label htmlFor="loop">Loop seconds</Label>
          <Input id="loop" className="mt-1 font-mono" value={String(loop)} onChange={(e) => setLoop(Number(e.target.value) || loop)} />
        </div>
        <div>
          <Label htmlFor="equity">Paper starting equity</Label>
          <Input id="equity" className="mt-1 font-mono" value={String(paper)} onChange={(e) => setPaper(Number(e.target.value) || paper)} />
        </div>
        <div className="sm:col-span-2 flex items-center justify-between gap-4 rounded-md border border-line px-3 py-2">
          <div>
            <div className="text-sm">Override promotion gates</div>
            <div className="text-xs text-fog">Leaves failed sleeves eligible for live. Leave off.</div>
          </div>
          <Switch checked={override} onCheckedChange={setOverride} label="Override promotion gates" />
        </div>
        <Button type="submit">Save cadence</Button>
      </form>
    </section>
  );
}

function NetworkBody() {
  const { snap, busy, run, call, refresh, setFeedback } = useDesk();
  if (!snap) return null;

  async function act(path: string, init: RequestInit, ok: string) {
    try {
      await call(path, init);
      await refresh();
      setFeedback({ tone: "good", text: ok });
    } catch (err) {
      setFeedback({ tone: "bad", text: err instanceof Error ? err.message : "Request failed" });
    }
  }

  return (
    <div className="space-y-5">
      <Button size="sm" variant="quiet" disabled={busy !== null} onClick={() => void run("balances", "/api/balances/refresh", { method: "POST" }, "Balance refresh requested.")}>Refresh balances</Button>
      {snap.chains.map((chain) => (
        <section key={chain.id} className="rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-serif text-xl">{chain.name}</h3>
              <p className="text-xs text-fog">{chain.note}</p>
            </div>
            <Badge tone={chain.rpc.some((row) => row.lastSuccessAt && !row.stale) ? "good" : "neutral"}>
              {chain.rpc.some((row) => row.lastSuccessAt && !row.stale) ? "Fresh endpoint" : "No fresh probe"}
            </Badge>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-fog">
                <tr>
                  <th className="py-1 font-medium">Provider</th>
                  <th className="py-1 font-medium">URL</th>
                  <th className="py-1 font-medium">Latency</th>
                  <th className="py-1 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {chain.rpc.map((row) => (
                  <tr key={row.id} className="border-t border-line">
                    <td className="py-1.5">{row.provider}</td>
                    <td className="py-1.5 font-mono text-xs">{row.url}</td>
                    <td className="py-1.5 font-mono">{row.latencyMs == null ? "—" : `${row.latencyMs} ms`}</td>
                    <td className="py-1.5 text-right">
                      <Button size="sm" variant="ghost" disabled={busy !== null || chain.rpc.length < 2} onClick={() => void act(`/api/rpc/${chain.id}/endpoints/${encodeURIComponent(row.id)}`, { method: "DELETE" }, "Endpoint removed.")}>Remove</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <EndpointForm disabled={busy !== null} onAdd={(body) => void act(`/api/rpc/${chain.id}/endpoints`, { method: "POST", body: JSON.stringify(body) }, "Endpoint added and probed.")} />
          <WalletForm
            chain={chain.id}
            address={chain.wallet?.address ?? null}
            source={chain.wallet?.source ?? null}
            native={chain.balances?.native ?? null}
            nativeSymbol={chain.nativeSymbol}
            quote={chain.balances?.quote ?? null}
            quoteSymbol={chain.balances?.quoteSymbol ?? "USDC"}
            balanceError={chain.balances?.error ?? null}
            disabled={busy !== null}
            onSave={(privateKey) => void act("/api/wallets", { method: "POST", body: JSON.stringify({ chain: chain.id, privateKey }) }, "Wallet saved. Key is not shown again.")}
            onDelete={() => void act(`/api/wallets/${chain.id}`, { method: "DELETE" }, "Wallet removed.")}
          />
        </section>
      ))}
    </div>
  );
}

function EndpointForm({ disabled, onAdd }: { disabled: boolean; onAdd: (body: { provider: string; url: string; priority: number }) => void }) {
  const [provider, setProvider] = useState("quicknode");
  const [url, setUrl] = useState("");
  const [priority, setPriority] = useState(10);
  return (
    <form className="mt-3 grid gap-2 sm:grid-cols-[9rem_1fr_5rem_auto]" onSubmit={(event) => { event.preventDefault(); onAdd({ provider, url, priority }); setUrl(""); }}>
      <select className="h-9 rounded-md border border-line bg-ink px-2 text-sm" value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Provider">
        <option value="quicknode">QuickNode</option>
        <option value="alchemy">Alchemy</option>
        <option value="infura">Infura</option>
        <option value="custom">Custom</option>
      </select>
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="RPC URL" />
      <Input className="font-mono" value={String(priority)} onChange={(e) => setPriority(Number(e.target.value) || priority)} aria-label="Priority" />
      <Button type="submit" variant="quiet" disabled={disabled || url.trim() === ""}>Add</Button>
    </form>
  );
}

function WalletForm(props: { chain: string; address: string | null; source: string | null; native: string | null; nativeSymbol: string; quote: string | null; quoteSymbol: string; balanceError: string | null; disabled: boolean; onSave: (key: string) => void; onDelete: () => void }) {
  const [key, setKey] = useState("");
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="text-sm">Wallet</div>
      {props.address ? <div className="mt-1 font-mono text-xs text-fog">{props.address} · {props.source}</div> : <p className="mt-1 text-sm text-fog">No key saved. Env vars still work when present.</p>}
      <div className="mt-2 text-sm">
        {props.native == null && props.quote == null ? "Balances appear after a probe when a key is present." : `${props.native ?? "—"} ${props.nativeSymbol}${props.quote != null ? ` · ${props.quote} ${props.quoteSymbol}` : ""}`}
      </div>
      {props.balanceError ? <p className="mt-1 text-xs text-rose">{props.balanceError}</p> : null}
      <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); props.onSave(key); setKey(""); }}>
        <div className="flex-1">
          <Label htmlFor={`${props.chain}-key`}>Private key, entered once</Label>
          <Input id={`${props.chain}-key`} className="mt-1" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={props.chain === "solana" ? "base58 or JSON bytes" : "0x hex"} />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" disabled={props.disabled || key.trim() === ""}>Save key</Button>
          {props.address && props.source === "ui" ? <Button type="button" variant="ghost" disabled={props.disabled} onClick={props.onDelete}>Remove</Button> : null}
        </div>
      </form>
    </div>
  );
}

function SystemBody() {
  const { snap, offline } = useDesk();
  if (!snap) return null;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <Info label="Engine" value={snap.engine.running ? `Loop ${snap.engine.iteration}, every ${Math.round(snap.engine.loopIntervalMs / 1000)}s` : "Idle"} />
        <Info label="Desk stream" value={offline ? "Disconnected" : "Connected"} />
        <Info label="Alerts route" value={snap.settings.alertWebhookSource === "none" ? "No webhook · feed still local" : `Webhook from ${snap.settings.alertWebhookSource}`} />
        <Info label="Research" value={snap.backtest ? `${snap.backtest.status} · ${when(snap.backtest.createdAt)}` : "No report stored"} />
      </div>
      <section>
        <h3 className="font-serif text-xl">Alerts</h3>
        {snap.alerts.length === 0 ? <p className="mt-2 text-fog">No alerts yet.</p> : (
          <ul className="mt-2 max-h-48 divide-y divide-line overflow-y-auto">
            {snap.alerts.slice().reverse().map((alert) => (
              <li key={alert.id} className="py-2">
                <div className="flex items-center gap-2">
                  <Badge tone={alert.level === "error" || alert.level === "kill" ? "bad" : alert.level === "trade" ? "good" : "neutral"}>{alert.level}</Badge>
                  <span>{alert.title}</span>
                  <span className="text-xs text-fog">{when(alert.ts)}</span>
                </div>
                <p className="text-fog">{alert.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="font-serif text-xl">Reconciliation</h3>
        {snap.engine.reconciled.length === 0 ? <p className="mt-2 text-fog">Runs when the loop starts.</p> : (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-fog">
            {snap.engine.reconciled.map((line) => <li key={line}>{line}</li>)}
          </ul>
        )}
      </section>
      <section>
        <h3 className="font-serif text-xl">Fill assumptions</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-fog">
          {snap.assumptions.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>
      <section>
        <h3 className="font-serif text-xl">Book equity</h3>
        <p className="mt-2 text-fog">{money(snap.engine.paperEquity)} · day {signed(snap.engine.dayPnl)} · DD {pct(snap.engine.drawdownPct)}</p>
        <Equity points={snap.equity} />
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-fog">{label}</div>
      <div className="mt-1 text-paper">{value}</div>
    </div>
  );
}

function Equity({ points }: { points: { t: number; equity: number }[] }) {
  if (points.length < 2) return <p className="mt-2 text-fog">Equity curve starts after the first mark.</p>;
  const width = 480;
  const height = 120;
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
    <div className="mt-2">
      {flat ? <p className="mb-1 text-xs text-fog">Unchanged at {money(points[points.length - 1]?.equity)}. No fill has moved the book yet.</p> : null}
      <svg viewBox={`0 0 ${width} ${height}`} className="h-28 w-full">
        <path d={path} fill="none" stroke="#e0b15a" strokeWidth="2" />
      </svg>
    </div>
  );
}
