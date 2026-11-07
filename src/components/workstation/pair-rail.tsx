"use client";

import { useDesk } from "@/components/desk";
import { Badge } from "@/components/ui";
import { cn, num } from "@/lib/format";
import { gateLabel, gateTone } from "@/lib/readiness";

export function PairRail() {
  const { snap, selectedPairId, setSelectedPairId } = useDesk();
  if (!snap) return null;

  return (
    <aside className="flex max-h-[40vh] flex-col rounded-lg border border-line bg-panel lg:max-h-none" aria-label="Pairs">
      <div className="border-b border-line px-3 py-2">
        <div className="text-[11px] uppercase tracking-wide text-fog">Universe</div>
        <div className="text-sm text-paper">Select a pair to drive the chart and inspector</div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {snap.pairs.map((pair) => {
          const active = pair.id === selectedPairId;
          const position = snap.positions.find((row) => row.pairId === pair.id);
          return (
            <li key={pair.id}>
              <button
                type="button"
                onClick={() => setSelectedPairId(pair.id)}
                className={cn(
                  "flex w-full flex-col gap-1 border-b border-line px-3 py-2.5 text-left transition-colors",
                  active ? "bg-panel-2" : "hover:bg-panel-2/60",
                )}
                aria-current={active ? "true" : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-paper">{pair.label}</span>
                  <span className="font-mono text-sm text-fog">{pair.price == null ? "—" : num(pair.price, 4)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] uppercase tracking-wide text-fog">{pair.chain}</span>
                  {!pair.enabled ? <Badge>off</Badge> : null}
                  <Badge tone={gateTone(pair.eligibility)}>{gateLabel(pair.eligibility)}</Badge>
                  {position ? <Badge tone="warn">{position.side}</Badge> : null}
                </div>
                <div className="truncate text-xs text-fog">{pair.regime ?? "No regime yet"} · {pair.lastSignal ?? "Waiting for a closed bar"}</div>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
