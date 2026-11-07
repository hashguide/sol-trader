"use client";

import { Suspense } from "react";
import { WorkstationShell } from "@/components/workstation/shell";

export default function HomePage() {
  return (
    <Suspense fallback={<p className="text-sm text-fog">Loading workstation…</p>}>
      <WorkstationShell />
    </Suspense>
  );
}
