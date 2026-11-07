"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useDesk } from "@/components/desk";
import { ActivityDock } from "@/components/workstation/activity-dock";
import { ChartStage } from "@/components/workstation/chart-stage";
import { CommandPalette } from "@/components/workstation/command-palette";
import { WorkstationDrawers } from "@/components/workstation/drawers";
import { Inspector } from "@/components/workstation/inspector";
import { PairRail } from "@/components/workstation/pair-rail";
import { StatusRail } from "@/components/workstation/status-rail";
import type { DrawerId } from "@/lib/workspace";

const PANEL_MAP: Record<string, DrawerId> = {
  research: "research",
  risk: "risk",
  network: "network",
  system: "system",
  setup: "setup",
};

export function WorkstationShell() {
  const { snap, openDrawer, setSelectedPairId } = useDesk();
  const params = useSearchParams();

  useEffect(() => {
    const panel = params.get("panel");
    if (panel && panel in PANEL_MAP) openDrawer(PANEL_MAP[panel] ?? null);
    const pair = params.get("pair");
    if (pair && snap?.pairs.some((row) => row.id === pair)) setSelectedPairId(pair);
  }, [params, openDrawer, setSelectedPairId, snap?.pairs]);

  if (!snap) return null;

  return (
    <div className="space-y-3">
      <StatusRail />
      <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
        <PairRail />
        <div className="space-y-3">
          <ChartStage />
          <ActivityDock />
        </div>
        <Inspector />
      </div>
      <p className="px-1 text-xs text-fog">
        Closing this window does not stop the engine. ⌘K opens commands. Deep links like <code className="font-mono">/?panel=research</code> still open drawers.
      </p>
      <WorkstationDrawers />
      <CommandPalette />
    </div>
  );
}
