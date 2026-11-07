"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Journal activity lives in the workstation dock. */
export default function JournalRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/"); }, [router]);
  return <p className="text-sm text-fog">Opening book activity on the workstation…</p>;
}
