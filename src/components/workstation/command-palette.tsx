"use client";

import { useEffect, useMemo, useState } from "react";
import { useDesk } from "@/components/desk";
import { Dialog, Input } from "@/components/ui";
import { COMMANDS, type CommandId } from "@/lib/workspace";

export function CommandPalette() {
  const { snap, openDrawer, run, busy } = useDesk();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [killArmed, setKillArmed] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
        setQuery("");
        setKillArmed(false);
      }
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COMMANDS.filter((item) => !q || `${item.label} ${item.hint} ${item.keywords}`.toLowerCase().includes(q));
  }, [query]);

  async function runCommand(id: CommandId) {
    if (!snap) return;
    if (id === "start") {
      setOpen(false);
      await run("start", "/api/engine/start", { method: "POST" }, "Loop started.");
      return;
    }
    if (id === "stop") {
      setOpen(false);
      await run("stop", "/api/engine/stop", { method: "POST" }, "Loop stopped.");
      return;
    }
    if (id === "flatten") {
      setOpen(false);
      await run("flat", "/api/engine/flatten", { method: "POST" }, "Flatten requested.");
      return;
    }
    if (id === "kill") {
      if (!killArmed) {
        setKillArmed(true);
        setQuery("");
        return;
      }
      setOpen(false);
      setKillArmed(false);
      await run("kill", "/api/kill", {
        method: "POST",
        body: JSON.stringify({ engaged: !snap.engine.kill.engaged, reason: snap.engine.kill.engaged ? "cleared from command palette" : "manual kill from command palette" }),
      }, snap.engine.kill.engaged ? "Kill cleared." : "Kill engaged.");
      return;
    }
    setOpen(false);
    openDrawer(id === "research" || id === "risk" || id === "network" || id === "setup" || id === "system" ? id : null);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen} title={killArmed ? "Confirm kill switch" : "Command palette"}>
      <p className="mb-3 text-sm text-fog">
        {killArmed
          ? `Press Enter on “${snap?.engine.kill.engaged ? "Clear kill" : "Engage kill"}” again, or Esc to cancel.`
          : "Jump to engine controls and drawers without hunting routes. ⌘K / Ctrl+K."}
      </p>
      <Input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter commands…"
        aria-label="Filter commands"
        onKeyDown={(event) => {
          if (event.key === "Enter" && items[0]) {
            event.preventDefault();
            void runCommand(items[0].id);
          }
        }}
      />
      <ul className="mt-3 max-h-64 overflow-y-auto">
        {(killArmed ? COMMANDS.filter((item) => item.id === "kill") : items).map((item) => (
          <li key={item.id}>
            <button
              type="button"
              disabled={busy !== null}
              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-panel-2"
              onClick={() => void runCommand(item.id)}
            >
              <span>{killArmed ? (snap?.engine.kill.engaged ? "Clear kill switch" : "Engage kill switch") : item.label}</span>
              <span className="text-xs text-fog">{item.hint}</span>
            </button>
          </li>
        ))}
        {!killArmed && items.length === 0 ? <li className="px-2 py-3 text-sm text-fog">No matching commands.</li> : null}
      </ul>
    </Dialog>
  );
}
