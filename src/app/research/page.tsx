"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ResearchRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/?panel=research"); }, [router]);
  return <p className="text-sm text-fog">Opening the research workflow…</p>;
}
