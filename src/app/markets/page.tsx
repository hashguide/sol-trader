"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useDesk } from "@/components/desk";

/** Markets is now the chart stage on the workstation. */
export default function MarketsRedirect() {
  const router = useRouter();
  const { selectedPairId } = useDesk();
  useEffect(() => {
    router.replace(`/?pair=${encodeURIComponent(selectedPairId)}`);
  }, [router, selectedPairId]);
  return <p className="text-sm text-fog">Opening the chart stage…</p>;
}
