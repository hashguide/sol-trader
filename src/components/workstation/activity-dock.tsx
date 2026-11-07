"use client";

import { useState } from "react";
import { useDesk } from "@/components/desk";
import { Panel, Segmented } from "@/components/ui";
import { money, num, signed, tone, when } from "@/lib/format";
import type { ActivityTab } from "@/lib/workspace";

export function ActivityDock() {
  const { snap, selectedPairId, setSelectedPairId } = useDesk();
  const [tab, setTab] = useState<ActivityTab>("positions");
  if (!snap) return null;

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-fog">Book activity</div>
          <div className="text-sm text-paper">{snap.engine.mode} journal · not a fabricated feed</div>
        </div>
        <Segmented<ActivityTab>
          value={tab}
          onChange={setTab}
          options={[
            { id: "positions", label: `Open (${snap.positions.length})` },
            { id: "decisions", label: "Decisions" },
            { id: "trades", label: "Trades" },
          ]}
        />
      </div>

      {tab === "positions" ? (
        snap.positions.length === 0 ? (
          <p className="px-3 py-5 text-sm text-fog">Flat. No open paper or live position is in the journal.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-fog">
                <tr>
                  <th className="px-3 py-2 font-medium">Pair</th>
                  <th className="px-3 py-2 font-medium">Side</th>
                  <th className="px-3 py-2 font-medium">Strategy</th>
                  <th className="px-3 py-2 font-medium">Entry</th>
                  <th className="px-3 py-2 font-medium">Stop</th>
                  <th className="px-3 py-2 font-medium">Target</th>
                  <th className="px-3 py-2 font-medium">Notional</th>
                </tr>
              </thead>
              <tbody>
                {snap.positions.map((trade) => (
                  <tr key={trade.id} className="border-t border-line">
                    <td className="px-3 py-2">
                      <button type="button" className="text-left hover:text-brass" onClick={() => setSelectedPairId(trade.pairId)}>
                        {trade.pairId}{trade.pairId === selectedPairId ? " · selected" : ""}
                      </button>
                    </td>
                    <td className="px-3 py-2">{trade.side} {trade.venue}</td>
                    <td className="px-3 py-2">{trade.strategy}</td>
                    <td className="px-3 py-2 font-mono">{num(trade.entryPx, 4)}</td>
                    <td className="px-3 py-2 font-mono text-rose">{num(trade.stopPx, 4)}</td>
                    <td className="px-3 py-2 font-mono text-mint">{num(trade.takeProfitPx, 4)}</td>
                    <td className="px-3 py-2 font-mono">{money(trade.notionalUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === "decisions" ? (
        snap.decisions.length === 0 ? (
          <p className="px-3 py-5 text-sm text-fog">No decisions yet. Start the loop; rows persist while the desk is closed.</p>
        ) : (
          <ul className="max-h-64 divide-y divide-line overflow-y-auto">
            {[...snap.decisions].reverse().slice(0, 40).map((row) => (
              <li key={row.id} className="grid gap-1 px-3 py-2 sm:grid-cols-[9rem_1fr]">
                <button type="button" className="text-left text-xs text-fog hover:text-brass" onClick={() => setSelectedPairId(row.pairId)}>
                  {when(row.ts)} · {row.pairId}
                </button>
                <div>
                  <div className="text-sm">{row.taken ? "Taken" : "Not taken"} · {row.action}</div>
                  <div className="text-sm text-fog">{row.reason}</div>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "trades" ? (
        snap.trades.length === 0 ? (
          <p className="px-3 py-5 text-sm text-fog">No fills in this mode. Refused signals stay in decisions only.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-fog">
                <tr>
                  <th className="px-3 py-2 font-medium">Opened</th>
                  <th className="px-3 py-2 font-medium">Pair</th>
                  <th className="px-3 py-2 font-medium">Side</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">PnL</th>
                  <th className="px-3 py-2 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {snap.trades.map((trade) => (
                  <tr key={trade.id} className="border-t border-line">
                    <td className="px-3 py-2 text-fog">{when(trade.openedAt)}</td>
                    <td className="px-3 py-2">
                      <button type="button" className="hover:text-brass" onClick={() => setSelectedPairId(trade.pairId)}>{trade.pairId}</button>
                    </td>
                    <td className="px-3 py-2">{trade.strategy} {trade.side}</td>
                    <td className="px-3 py-2">{trade.status}</td>
                    <td className={`px-3 py-2 font-mono ${tone(trade.realizedPnlUsd)}`}>{trade.realizedPnlUsd == null ? money(trade.notionalUsd) : signed(trade.realizedPnlUsd)}</td>
                    <td className="px-3 py-2 text-fog">{trade.reasonClose ?? trade.reasonOpen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </Panel>
  );
}
