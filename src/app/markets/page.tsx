"use client";

import { useEffect, useState } from "react";
import { PriceChart, type ChartPayload } from "@/components/price-chart";
import { useDesk } from "@/components/desk";
import { Badge, Panel } from "@/components/ui";
import { cn, num } from "@/lib/format";

export default function MarketsPage() {
  const { snap } = useDesk();
  const [pairId, setPairId] = useState("sol-usdc");
  const [chart, setChart] = useState<ChartPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/chart/${pairId}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json() as ChartPayload & { error?: string };
        if (!res.ok) throw new Error(body.error || "Chart unavailable");
        if (!cancelled) setChart(body);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Chart unavailable");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pairId, snap?.engine.iteration]);

  if (!snap) return null;
  const pair = snap.pairs.find((row) => row.id === pairId) ?? snap.pairs[0];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-4xl">Markets</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-fog">
          Closed hourly bars, the two EMAs, and the Bollinger band. Arrows are journal entries. Circles are exits. Dashed lines are the live stop and target when a position is open.
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto">
        {snap.pairs.map((row) => (
          <button key={row.id} type="button" onClick={() => setPairId(row.id)} className={cn("rounded-md border px-3 py-2 text-left text-sm", row.id === pair?.id ? "border-brass bg-panel text-paper" : "border-line text-fog")}>
            <div>{row.label}</div>
            <div className="text-[11px] uppercase tracking-wide">{row.chain}</div>
          </button>
        ))}
      </div>
      {pair ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Read label="Regime" value={pair.regime ?? "No bar yet"} />
          <Read label="ADX / RSI" value={`${num(pair.indicators.adx, 1)} / ${num(pair.indicators.rsi, 1)}`} />
          <Read label="Shorts" value={pair.shortMode === "hyperliquid-perp" ? `Hyperliquid ${pair.perpCoin}` : "Spot stays flat"} />
          <Read label="Signal" value={pair.lastSignal ?? "—"} />
        </div>
      ) : null}
      <Panel>
        {loading ? <p className="p-6 text-sm text-fog">Loading candles…</p> : null}
        {error ? <p className="p-6 text-sm text-rose">{error}</p> : null}
        {!loading && !error && chart ? (
          <>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="text-sm text-fog">Source {chart.source}{chart.warning ? ` · ${chart.warning}` : ""}</div>
              <Badge>EMA 20 / 50 · BB 20</Badge>
            </div>
            <PriceChart data={chart} />
          </>
        ) : null}
      </Panel>
    </div>
  );
}

function Read({ label, value }: { label: string; value: string }) {
  return (
    <Panel className="px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-fog">{label}</div>
      <div className="mt-1 text-sm text-paper">{value}</div>
    </Panel>
  );
}
