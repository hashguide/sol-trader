"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SystemRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/?panel=system"); }, [router]);
  return <p className="text-sm text-fog">Opening system…</p>;
}
