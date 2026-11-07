"use client";

import { useDesk } from "@/components/desk";
import { Badge, Button, Panel, Segmented } from "@/components/ui";
import { money, num, signed, tone, when } from "@/lib/format";
import { gateLabel, gateTone } from "@/lib/readiness";
import type { InspectorTab } from "@/lib/workspace";

export function Inspector() {
  const { snap, selectedPairId, inspectorTab, setInspectorTab, openDrawer } = useDesk();
  if (!snap) return null;
  const pair = snap.pairs.find((row) => row.id === selectedPairId);
  const position = snap.positions.find((row) => row.pairId === selectedPairId) ?? null;
  const decisions = snap.decisions.filter((row) => row.pairId === selectedPairId).slice(-8).reverse();
  const trades = snap.trades.filter((row) => row.pairId === selectedPairId).slice(0, 6);

  return (
    <Panel className="flex min-h-[280px] flex-col" aria-label="Pair inspector">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-fog">Inspector</div>
          <div className="text-sm text-paper">{pair?.label ?? selectedPairId}</div>
        </div>
        <Segmented<InspectorTab>
          value={inspectorTab}
          onChange={setInspectorTab}
          options={[
            { id: "signal", label: "Signal" },
            { id: "position", label: "Position" },
            { id: "activity", label: "Activity" },
            { id: "research", label: "Gate" },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-sm">
        {inspectorTab === "signal" ? (
          <div className="space-y-3">
            <Row label="Regime" value={pair?.regime ?? "No closed-bar read yet"} />
            <Row label="Last signal" value={pair?.lastSignal ?? "—"} />
            <Row label="ADX / RSI" value={`${num(pair?.indicators.adx ?? null, 1)} / ${num(pair?.indicators.rsi ?? null, 1)}`} />
            <Row label="EMA 20 / 50" value={`${num(pair?.indicators.emaFast ?? null, 4)} / ${num(pair?.indicators.emaSlow ?? null, 4)}`} />
            <Row label="ATR" value={num(pair?.indicators.atr ?? null, 4)} />
            <p className="text-xs leading-5 text-fog">
              Reasons come from the engine decision log for this pair. Nothing here is invented when the loop has not evaluated a bar.
            </p>
            {decisions[0] ? (
              <div className="rounded-md border border-line bg-ink px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge tone={decisions[0].taken ? "good" : "neutral"}>{decisions[0].taken ? "taken" : "not taken"}</Badge>
                  <span className="text-fog">{decisions[0].action}</span>
                </div>
                <p className="mt-1 text-fog">{decisions[0].reason}</p>
                <p className="mt-1 text-[11px] text-fog">{when(decisions[0].ts)} · {decisions[0].mode}</p>
              </div>
            ) : (
              <p className="text-fog">No decisions for this pair yet. Start the loop to accumulate them.</p>
            )}
          </div>
        ) : null}

        {inspectorTab === "position" ? (
          position ? (
            <div className="space-y-2">
              <Row label="Side" value={`${position.mode} ${position.side} · ${position.venue}`} />
              <Row label="Strategy" value={position.strategy} />
              <Row label="Entry" value={num(position.entryPx, 4)} />
              <Row label="Stop" value={num(position.stopPx, 4)} />
              <Row label="Target" value={num(position.takeProfitPx, 4)} />
              <Row label="Notional" value={money(position.notionalUsd)} />
              <Row label="Opened" value={when(position.openedAt)} />
              <p className="text-xs text-fog">Unrealized PnL is not estimated here beyond the book equity mark. Entry/stop/target are journal fields.</p>
            </div>
          ) : (
            <p className="text-fog">No open position for this pair in the current mode.</p>
          )
        ) : null}

        {inspectorTab === "activity" ? (
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-[11px] uppercase tracking-wide text-fog">Recent decisions</h3>
              {decisions.length === 0 ? <p className="text-fog">None yet.</p> : (
                <ul className="space-y-2">
                  {decisions.map((row) => (
                    <li key={row.id} className="rounded-md border border-line px-2 py-1.5">
                      <div className="flex gap-2 text-xs text-fog">{when(row.ts)} · {row.action} · {row.taken ? "taken" : "skipped"}</div>
                      <div className="text-fog">{row.reason}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-[11px] uppercase tracking-wide text-fog">Trades</h3>
              {trades.length === 0 ? <p className="text-fog">No fills for this pair in the current mode.</p> : (
                <ul className="space-y-2">
                  {trades.map((trade) => (
                    <li key={trade.id} className="rounded-md border border-line px-2 py-1.5">
                      <div className="flex justify-between gap-2">
                        <span>{trade.strategy} {trade.side}</span>
                        <span className={tone(trade.realizedPnlUsd)}>{trade.realizedPnlUsd == null ? money(trade.notionalUsd) : signed(trade.realizedPnlUsd)}</span>
                      </div>
                      <div className="text-xs text-fog">{trade.status} · {when(trade.openedAt)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {inspectorTab === "research" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone={gateTone(pair?.eligibility ?? "not tested")}>{gateLabel(pair?.eligibility ?? "not tested")}</Badge>
              <span className="text-fog">{snap.engine.mode} book</span>
            </div>
            <p className="text-xs leading-5 text-fog">
              Gate status comes from the latest stored walk-forward composite (or matching sleeve). Historical OOS results are not paper PnL and not live PnL.
            </p>
            <Row label="Latest report" value={snap.backtest ? `${snap.backtest.status} · ${when(snap.backtest.createdAt)}` : "None stored"} />
            <Button size="sm" variant="quiet" onClick={() => openDrawer("research")}>Open research workflow</Button>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-fog">{label}</div>
      <div className="mt-0.5 text-paper">{value}</div>
    </div>
  );
}
