"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RiskRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/?panel=risk"); }, [router]);
  return <p className="text-sm text-fog">Opening risk & routing…</p>;
}
