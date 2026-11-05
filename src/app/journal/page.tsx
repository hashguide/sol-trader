"use client";

import { useDesk } from "@/components/desk";
import { Badge, Panel } from "@/components/ui";
import { money, num, signed, tone, when } from "@/lib/format";

export default function JournalPage() {
  const { snap } = useDesk();
  if (!snap) return null;
  const decisions = [...snap.decisions].reverse();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-4xl">Journal</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-fog">
          Every pass writes why a trade was taken or refused, including risk blocks. These rows were stored while the desk was closed.
        </p>
      </div>
      <Panel>
        <div className="border-b border-line px-4 py-3"><h2 className="font-serif text-2xl">Decisions</h2></div>
        {decisions.length === 0 ? <p className="px-4 py-6 text-sm text-fog">No decisions yet. Start the loop and the next closed bar will land here.</p> : (
          <ul className="divide-y divide-line">
            {decisions.slice(0, 80).map((row) => (
              <li key={row.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_1fr]">
                <div className="text-xs text-fog">{when(row.ts)} · {row.mode}</div>
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>{row.pairId}</span>
                    <Badge tone={row.taken ? "good" : "neutral"}>{row.taken ? "taken" : "not taken"}</Badge>
                    <span className="text-fog">{row.action}</span>
                  </div>
                  <p className="mt-1 text-sm text-fog">{row.reason}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel>
        <div className="border-b border-line px-4 py-3"><h2 className="font-serif text-2xl">Trades</h2></div>
        {snap.trades.length === 0 ? <p className="px-4 py-6 text-sm text-fog">No fills in this mode. A refused signal stays in the decision log and does not become a trade.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-fog">
                <tr>
                  <th className="px-4 py-2 font-medium">Opened</th>
                  <th className="px-4 py-2 font-medium">Pair</th>
                  <th className="px-4 py-2 font-medium">Side</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Entry</th>
                  <th className="px-4 py-2 font-medium">Exit</th>
                  <th className="px-4 py-2 font-medium">PnL</th>
                  <th className="px-4 py-2 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {snap.trades.map((trade) => (
                  <tr key={trade.id} className="border-t border-line">
                    <td className="px-4 py-2 text-fog">{when(trade.openedAt)}</td>
                    <td className="px-4 py-2">{trade.pairId}</td>
                    <td className="px-4 py-2">{trade.strategy} {trade.side}</td>
                    <td className="px-4 py-2">{trade.status}</td>
                    <td className="px-4 py-2 font-mono">{num(trade.entryPx, 4)}</td>
                    <td className="px-4 py-2 font-mono">{trade.exitPx == null ? "—" : num(trade.exitPx, 4)}</td>
                    <td className={`px-4 py-2 font-mono ${tone(trade.realizedPnlUsd)}`}>{trade.realizedPnlUsd == null ? money(trade.notionalUsd) : signed(trade.realizedPnlUsd)}</td>
                    <td className="px-4 py-2 text-fog">{trade.reasonClose ?? trade.reasonOpen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
