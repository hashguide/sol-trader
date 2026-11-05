"use client";

import { useState } from "react";
import { useDesk } from "@/components/desk";
import { Button, Dialog, Input, Label, Panel, Switch } from "@/components/ui";
import type { GateConfig, RiskLimits } from "@/lib/types";

const LIVE_CONFIRM = "ENABLE LIVE TRADING";

const RISK_FIELDS: { key: keyof RiskLimits; label: string }[] = [
  { key: "riskPerTradePct", label: "Risk per trade %" },
  { key: "maxPositionPct", label: "Max position %" },
  { key: "maxConcurrentPositions", label: "Max concurrent" },
  { key: "maxChainExposurePct", label: "Max chain %" },
  { key: "maxTokenExposurePct", label: "Max token %" },
  { key: "dailyDrawdownKillPct", label: "Daily drawdown kill %" },
  { key: "totalDrawdownKillPct", label: "Total drawdown kill %" },
  { key: "maxSlippageBps", label: "Max slippage bps" },
  { key: "maxPriceImpactBps", label: "Max impact bps" },
  { key: "maxGasEdgePct", label: "Max gas / edge %" },
  { key: "circuitBarMovePct", label: "Circuit bar move %" },
  { key: "staleDataMinutes", label: "Stale data minutes" },
  { key: "quoteDivergencePct", label: "Quote divergence %" },
  { key: "emergencyExitSlippageBps", label: "Emergency exit bps" },
];

const GATE_FIELDS: { key: keyof GateConfig; label: string }[] = [
  { key: "minExpectancyUsd", label: "Min expectancy $" },
  { key: "minProfitFactor", label: "Min profit factor" },
  { key: "maxDrawdownPct", label: "Max drawdown %" },
  { key: "minTrades", label: "Min trades" },
  { key: "minProfitableWindowFraction", label: "Profitable windows" },
  { key: "minStableGridFraction", label: "Stable grid" },
  { key: "paperMinTrades", label: "Paper min trades" },
  { key: "paperMinProfitFactor", label: "Paper min PF" },
  { key: "paperMaxDrawdownPct", label: "Paper max DD %" },
];

export default function RiskPage() {
  const { snap, call, refresh } = useDesk();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  if (!snap) return null;
  const { settings } = snap;

  async function save(path: string, body: unknown, ok: string) {
    setError(null);
    setNote(null);
    try {
      await call(path, { method: path === "/api/mode" ? "POST" : "PUT", body: JSON.stringify(body) });
      await refresh();
      setNote(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-4xl">Risk and routing</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-fog">
          Saves write into the engine database and apply on the next decision. The loop does not need this page to stay open. The server clamps numbers into its allowed ranges.
        </p>
      </div>
      {error ? <p className="text-sm text-rose">{error}</p> : null}
      {note ? <p className="text-sm text-mint">{note}</p> : null}

      <Panel className="p-4">
        <h2 className="font-serif text-2xl">Mode</h2>
        <p className="mt-2 text-sm text-fog">Current mode is {settings.mode}, from {settings.modeSource}. Paper is the default. Live refuses to start without a key on every chain that is enabled for trading.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant={settings.mode === "paper" ? "default" : "quiet"} onClick={() => void save("/api/mode", { mode: "paper" }, "Paper mode is saved. The running engine uses it on the next pass.")}>Paper</Button>
          <Button variant={settings.mode === "live" ? "danger" : "quiet"} onClick={() => { setPhrase(""); setLiveOpen(true); }}>Live</Button>
        </div>
        {settings.overrideGates ? <p className="mt-3 text-sm text-rose">Gate override is on. Live entries are no longer required to pass the promotion checks.</p> : null}
      </Panel>

      <NumberForm
        title="Limits"
        fields={RISK_FIELDS}
        initial={settings.risk}
        onSubmit={(risk) => save("/api/risk", risk, "Risk limits saved.")}
      />
      <NumberForm
        title="Promotion gates"
        fields={GATE_FIELDS}
        initial={settings.gates}
        onSubmit={(gates) => save("/api/gates", gates, "Gates saved. They apply to the next walk-forward and to live eligibility.")}
      />

      <Panel className="space-y-4 p-4">
        <h2 className="font-serif text-2xl">Cadence</h2>
        <Cadence
          seconds={Math.round(settings.loopIntervalMs / 1000)}
          equity={settings.paperStartingEquity}
          overrideGates={settings.overrideGates}
          onSave={(body) => save("/api/loop", body, "Loop settings saved.")}
        />
      </Panel>

      <Panel className="divide-y divide-line">
        <div className="px-4 py-3"><h2 className="font-serif text-2xl">Chains</h2></div>
        {snap.chains.map((chain) => (
          <div key={chain.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
            <div className="min-w-40">
              <div>{chain.name}</div>
              <div className="text-xs text-fog">{chain.productionReady ? "Production ready" : "Not production ready"}</div>
            </div>
            <Toggle label="Enabled" checked={chain.enabled} onChange={(enabled) => void save(`/api/chains/${chain.id}`, { enabled }, `${chain.name} updated.`)} />
            <Toggle label="Trading" checked={chain.tradingEnabled} onChange={(tradingEnabled) => void save(`/api/chains/${chain.id}`, { tradingEnabled }, `${chain.name} trading updated.`)} />
            <p className="text-xs text-fog">{chain.note}</p>
          </div>
        ))}
      </Panel>

      <Panel className="divide-y divide-line">
        <div className="px-4 py-3"><h2 className="font-serif text-2xl">Pairs and sleeves</h2></div>
        {snap.pairs.map((pair) => (
          <div key={pair.id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <div>{pair.label}</div>
              <div className="text-xs text-fog">{pair.chain} · shorts {pair.shortMode === "hyperliquid-perp" ? `via ${pair.perpCoin}` : "stay flat"}</div>
            </div>
            <Toggle label={`${pair.label} enabled`} checked={pair.enabled} onChange={(enabled) => void save(`/api/pairs/${pair.id}`, { enabled }, `${pair.label} updated.`)} />
          </div>
        ))}
        {(["trend", "breakout", "mean_reversion"] as const).map((id) => (
          <div key={id} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="capitalize">{id.replaceAll("_", " ")}</div>
            <Toggle label={id} checked={settings.strategy.enabled[id]} onChange={(enabled) => void save(`/api/strategies/${id}`, { enabled }, `${id} updated.`)} />
          </div>
        ))}
      </Panel>

      <Dialog open={liveOpen} onOpenChange={setLiveOpen} title="Switch to live trading">
        <p className="text-sm leading-6 text-fog">Live sends real orders. Type <span className="font-mono text-paper">{LIVE_CONFIRM}</span> to confirm. Missing keys keep the engine from starting.</p>
        <Input className="mt-3" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setLiveOpen(false)}>Cancel</Button>
          <Button variant="danger" disabled={phrase !== LIVE_CONFIRM} onClick={() => { setLiveOpen(false); void save("/api/mode", { mode: "live", confirm: phrase }, "Live mode is saved. Start will still refuse if a trading chain has no key."); }}>Enable live</Button>
        </div>
      </Dialog>
    </div>
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
  const [draft, setDraft] = useState<T>(initial);
  return (
    <Panel className="p-4">
      <h2 className="font-serif text-2xl">{title}</h2>
      <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(event) => { event.preventDefault(); onSubmit(draft); }}>
        {fields.map((field) => (
          <div key={field.key}>
            <Label htmlFor={field.key}>{field.label}</Label>
            <Input id={field.key} className="mt-1 font-mono" inputMode="decimal" value={String(draft[field.key] ?? "")} onChange={(event) => {
              const value = Number(event.target.value);
              setDraft((current) => ({ ...current, [field.key]: Number.isFinite(value) ? value : current[field.key] }));
            }} />
          </div>
        ))}
        <div className="flex items-end">
          <Button type="submit">Save {title.toLowerCase()}</Button>
        </div>
      </form>
    </Panel>
  );
}

function Cadence({ seconds, equity, overrideGates, onSave }: { seconds: number; equity: number; overrideGates: boolean; onSave: (body: { loopIntervalMs: number; paperStartingEquity: number; overrideGates: boolean }) => void }) {
  const [loop, setLoop] = useState(seconds);
  const [paper, setPaper] = useState(equity);
  const [override, setOverride] = useState(overrideGates);
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSave({ loopIntervalMs: loop * 1000, paperStartingEquity: paper, overrideGates: override }); }}>
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
          <div className="text-xs text-fog">Leaves failed sleeves eligible for live orders. Leave this off.</div>
        </div>
        <Switch checked={override} onCheckedChange={setOverride} label="Override promotion gates" />
      </div>
      <Button type="submit">Save cadence</Button>
    </form>
  );
}
