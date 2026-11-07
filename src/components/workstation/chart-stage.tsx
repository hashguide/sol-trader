"use client";

import { useEffect, useState } from "react";
import { useDesk } from "@/components/desk";
import { PriceChart, type ChartPayload } from "@/components/price-chart";
import { Badge, Panel } from "@/components/ui";
import { num } from "@/lib/format";

export function ChartStage() {
  const { snap, selectedPairId } = useDesk();
  const [chart, setChart] = useState<ChartPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/chart/${selectedPairId}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json() as ChartPayload & { error?: string };
        if (!res.ok) throw new Error(body.error || "Chart unavailable");
        if (!cancelled) setChart(body);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setChart(null);
          setError(err instanceof Error ? err.message : "Chart unavailable");
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedPairId, snap?.engine.iteration, snap?.engine.lastLoopAt]);

  if (!snap) return null;
  const pair = snap.pairs.find((row) => row.id === selectedPairId);

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-3 py-2">
        <div>
          <div className="font-serif text-2xl text-paper">{pair?.label ?? selectedPairId}</div>
          <div className="mt-1 text-xs text-fog">
            {pair ? `${pair.chain} · ${pair.dex} · ${pair.feeBps} bps · shorts ${pair.shortMode === "hyperliquid-perp" ? `via ${pair.perpCoin}` : "stay flat"}` : "Unknown pair"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>{pair?.regime ?? "regime —"}</Badge>
          <Badge>ADX {num(pair?.indicators.adx ?? null, 1)}</Badge>
          <Badge>RSI {num(pair?.indicators.rsi ?? null, 1)}</Badge>
          {chart ? <Badge>Source {chart.source}</Badge> : null}
        </div>
      </div>
      {loading ? <p className="p-6 text-sm text-fog">Loading candles from the engine…</p> : null}
      {error ? <p className="p-6 text-sm text-rose">{error}</p> : null}
      {!loading && !error && chart ? (
        <>
          {chart.warning ? <p className="border-b border-line px-3 py-2 text-xs text-brass">{chart.warning}</p> : null}
          <PriceChart data={chart} />
        </>
      ) : null}
    </Panel>
  );
}
