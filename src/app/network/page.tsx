"use client";

import { useState } from "react";
import { useDesk } from "@/components/desk";
import { Badge, Button, Input, Label, Panel } from "@/components/ui";
import { when } from "@/lib/format";

export default function NetworkPage() {
  const { snap, call, refresh } = useDesk();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!snap) return null;

  async function act(path: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      await call(path, init);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl">Network and wallets</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-fog">
            Endpoint URLs are stored by the engine and applied to the running pool immediately. After save, the desk only shows a redacted URL. A private key is encrypted locally and is never sent back to this page.
          </p>
        </div>
        <Button variant="quiet" disabled={busy} onClick={() => void act("/api/balances/refresh", { method: "POST" })}>Refresh balances</Button>
      </div>
      {error ? <p className="text-sm text-rose">{error}</p> : null}
      {snap.chains.map((chain) => (
        <Panel key={chain.id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl">{chain.name}</h2>
              <p className="mt-1 text-xs text-fog">{chain.note}</p>
            </div>
            <Badge tone={chain.rpc.some((row) => row.lastSuccessAt && !row.stale) ? "good" : "neutral"}>
              {chain.rpc.some((row) => row.lastSuccessAt && !row.stale) ? "Fresh endpoint" : "No fresh probe"}
            </Badge>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-fog">
                <tr>
                  <th className="py-2 font-medium">Provider</th>
                  <th className="py-2 font-medium">URL</th>
                  <th className="py-2 font-medium">Priority</th>
                  <th className="py-2 font-medium">Latency</th>
                  <th className="py-2 font-medium">Health</th>
                  <th className="py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {chain.rpc.length === 0 ? (
                  <tr><td className="py-3 text-fog" colSpan={6}>No endpoints. The engine will refuse this chain until one is added.</td></tr>
                ) : chain.rpc.map((row) => (
                  <tr key={row.id} className="border-t border-line">
                    <td className="py-2">{row.provider}</td>
                    <td className="py-2 font-mono text-xs">{row.url}</td>
                    <td className="py-2 font-mono">{row.priority}</td>
                    <td className="py-2 font-mono">{row.latencyMs == null ? "—" : `${row.latencyMs} ms`}</td>
                    <td className="py-2 text-xs text-fog">
                      {row.stale ? "Stale block. " : ""}
                      {row.lastError ? row.lastError : row.lastSuccessAt ? `ok ${when(row.lastSuccessAt)}` : "not probed"}
                      {row.blockNumber ? ` · ${row.blockNumber}` : ""}
                    </td>
                    <td className="py-2 text-right">
                      <Button size="sm" variant="ghost" disabled={busy || chain.rpc.length < 2} onClick={() => void act(`/api/rpc/${chain.id}/endpoints/${encodeURIComponent(row.id)}`, { method: "DELETE" })}>Remove</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <EndpointForm disabled={busy} onAdd={(body) => act(`/api/rpc/${chain.id}/endpoints`, { method: "POST", body: JSON.stringify(body) })} />
          <Wallet chain={chain.id} address={chain.wallet?.address ?? null} source={chain.wallet?.source ?? null} native={chain.balances?.native ?? null} nativeSymbol={chain.nativeSymbol} quote={chain.balances?.quote ?? null} quoteSymbol={chain.balances?.quoteSymbol ?? "USDC"} balanceError={chain.balances?.error ?? null} disabled={busy} onSave={(privateKey) => act("/api/wallets", { method: "POST", body: JSON.stringify({ chain: chain.id, privateKey }) })} onDelete={() => act(`/api/wallets/${chain.id}`, { method: "DELETE" })} />
        </Panel>
      ))}
    </div>
  );
}

function EndpointForm({ disabled, onAdd }: { disabled: boolean; onAdd: (body: { provider: string; url: string; priority: number }) => void }) {
  const [provider, setProvider] = useState("quicknode");
  const [url, setUrl] = useState("");
  const [priority, setPriority] = useState(10);
  return (
    <form className="mt-4 grid gap-2 sm:grid-cols-[10rem_1fr_6rem_auto]" onSubmit={(event) => { event.preventDefault(); onAdd({ provider, url, priority }); setUrl(""); }}>
      <select className="h-9 rounded-md border border-line bg-ink px-2 text-sm" value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Provider">
        <option value="quicknode">QuickNode</option>
        <option value="alchemy">Alchemy</option>
        <option value="infura">Infura</option>
        <option value="custom">Custom</option>
      </select>
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="RPC URL" />
      <Input className="font-mono" value={String(priority)} onChange={(e) => setPriority(Number(e.target.value) || priority)} aria-label="Priority" />
      <Button type="submit" variant="quiet" disabled={disabled || url.trim() === ""}>Add endpoint</Button>
    </form>
  );
}

function Wallet({ chain, address, source, native, nativeSymbol, quote, quoteSymbol, balanceError, disabled, onSave, onDelete }: { chain: string; address: string | null; source: string | null; native: string | null; nativeSymbol: string; quote: string | null; quoteSymbol: string; balanceError: string | null; disabled: boolean; onSave: (key: string) => void; onDelete: () => void }) {
  const [key, setKey] = useState("");
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="text-sm">Wallet</div>
      {address ? (
        <div className="mt-1 font-mono text-xs text-fog">{address} · {source}</div>
      ) : (
        <p className="mt-1 text-sm text-fog">No key saved. Env vars are used when present and are shown here only as an address.</p>
      )}
      <div className="mt-2 text-sm">
        {native == null && quote == null ? "Balances appear after a probe, and only when a key is present." : `${native ?? "—"} ${nativeSymbol}${quote != null ? ` · ${quote} ${quoteSymbol}` : ""}`}
      </div>
      {balanceError ? <p className="mt-1 text-xs text-rose">{balanceError}</p> : null}
      <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); onSave(key); setKey(""); }}>
        <div className="flex-1">
          <Label htmlFor={`${chain}-key`}>Private key, entered once</Label>
          <Input id={`${chain}-key`} className="mt-1" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={chain === "solana" ? "base58 or JSON bytes" : "0x hex"} />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" disabled={disabled || key.trim() === ""}>Save key</Button>
          {address && source === "ui" ? <Button type="button" variant="ghost" disabled={disabled} onClick={onDelete}>Remove</Button> : null}
        </div>
      </form>
    </div>
  );
}
