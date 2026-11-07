"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function NetworkRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/?panel=network"); }, [router]);
  return <p className="text-sm text-fog">Opening network & wallets…</p>;
}
