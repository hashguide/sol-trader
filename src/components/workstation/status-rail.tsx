"use client";

import { useState } from "react";
import { useDesk } from "@/components/desk";
import { Button, Dialog } from "@/components/ui";
import { cn, when } from "@/lib/format";
import { readiness } from "@/lib/readiness";

export function StatusRail() {
  const { snap, busy, offline, run, openDrawer } = useDesk();
  const [killOpen, setKillOpen] = useState(false);
  if (!snap) return null;
  const engine = snap.engine;
  const ready = readiness(snap);
  const blocks = ready.filter((item) => !item.ok && item.severity === "block");
  const warns = ready.filter((item) => !item.ok && item.severity === "warn");

  return (
    <section className="rounded-lg border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="mr-auto min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-fog">Engine</div>
          <div className="truncate text-sm text-paper">
            {engine.running
              ? `Running · last pass ${when(engine.lastLoopAt)} · ${Math.round(engine.loopIntervalMs / 1000)}s cadence`
              : "Stopped · history and settings stay in the journal"}
          </div>
        </div>
        {engine.running
          ? <Button size="sm" variant="quiet" disabled={busy !== null} onClick={() => void run("stop", "/api/engine/stop", { method: "POST" }, "Loop stopped. desiredRunning is false.")}>{busy === "stop" ? "Stopping…" : "Stop"}</Button>
          : <Button size="sm" disabled={busy !== null} onClick={() => void run("start", "/api/engine/start", { method: "POST" }, "Loop started. Closing this window will not stop it.")}>{busy === "start" ? "Starting…" : "Start"}</Button>}
        <Button size="sm" variant="quiet" disabled={busy !== null} onClick={() => void run("flat", "/api/engine/flatten", { method: "POST" }, "Flatten requested.")}>Flatten</Button>
        <Button size="sm" variant="danger" onClick={() => setKillOpen(true)}>{engine.kill.engaged ? "Kill on" : "Kill"}</Button>
        <Button size="sm" variant="ghost" onClick={() => openDrawer("setup")}>Readiness</Button>
        <Button size="sm" variant="ghost" className="hidden sm:inline-flex" onClick={() => openDrawer("risk")}>Risk</Button>
        <Button size="sm" variant="ghost" className="hidden sm:inline-flex" onClick={() => openDrawer("network")}>Network</Button>
        <Button size="sm" variant="ghost" onClick={() => openDrawer("research")}>Research…</Button>
        <Button size="sm" variant="ghost" className="hidden md:inline-flex" onClick={() => openDrawer("system")}>System</Button>
        <kbd className="hidden rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-fog lg:inline">⌘K</kbd>
      </div>
      <div className="grid gap-2 px-3 py-2 text-xs text-fog sm:grid-cols-3">
        <div className={cn(offline && "text-rose")}>{offline ? "Desk stream disconnected. The engine may still be trading." : "Desk stream connected. Reopening recovers the journal."}</div>
        <div>{engine.mode === "paper" ? "Paper book of record" : engine.liveBlocked.length ? `Live blocked: ${engine.liveBlocked[0]}` : "Live mode — real sends"} · source {snap.settings.modeSource}</div>
        <div className={blocks.length ? "text-rose" : warns.length ? "text-brass" : "text-mint"}>
          {blocks.length ? `${blocks.length} blocking readiness item(s)` : warns.length ? `${warns.length} readiness warning(s)` : "Readiness clear for current mode"}
        </div>
      </div>
      {engine.lastError ? <p className="border-t border-line px-3 py-2 text-sm text-rose">Last engine error: {engine.lastError}</p> : null}
      <Dialog open={killOpen} onOpenChange={setKillOpen} title={engine.kill.engaged ? "Clear the kill switch" : "Engage the kill switch"}>
        <p className="text-sm leading-6 text-fog">
          {engine.kill.engaged
            ? `The kill is on${engine.kill.reason ? `: ${engine.kill.reason}` : ""}. Clearing it lets the engine take new risk again. A kill held by KILL_SWITCH or data/KILL cannot be cleared here.`
            : "This flattens every open position in the current mode and blocks new entries. Exits still run. The engine process stays up."}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setKillOpen(false)}>Cancel</Button>
          <Button
            variant={engine.kill.engaged ? "default" : "danger"}
            disabled={busy === "kill"}
            onClick={() => {
              setKillOpen(false);
              void run("kill", "/api/kill", {
                method: "POST",
                body: JSON.stringify({ engaged: !engine.kill.engaged, reason: engine.kill.engaged ? "cleared from the desk" : "manual kill from the desk" }),
              }, engine.kill.engaged ? "Kill cleared." : "Kill engaged and flatten requested.");
            }}
          >
            {engine.kill.engaged ? "Clear kill" : "Flatten and kill"}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
