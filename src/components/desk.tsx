"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Badge, Button, Input, Label } from "@/components/ui";
import { cn, money, signed, tone } from "@/lib/format";
import type { Snapshot } from "@/lib/types";

type Phase = "loading" | "setup" | "login" | "ready" | "offline";

interface Desk {
  snap: Snapshot | null;
  phase: Phase;
  offline: boolean;
  error: string | null;
  call: (path: string, init?: RequestInit) => Promise<unknown>;
  refresh: () => Promise<void>;
}

const DeskContext = createContext<Desk | null>(null);

export function useDesk(): Desk {
  const value = useContext(DeskContext);
  if (!value) throw new Error("useDesk outside the desk");
  return value;
}

export function DeskProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (res.status === 401) {
      setPhase("login");
      return;
    }
    if (!res.ok) throw new Error("The engine refused the state request");
    setSnap(await res.json() as Snapshot);
    setPhase("ready");
    setOffline(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let stream: EventSource | null = null;
    (async () => {
      try {
        const statusRes = await fetch("/api/auth/status", { cache: "no-store" });
        if (!statusRes.ok) throw new Error("status");
        const status = await statusRes.json() as { needsSetup: boolean; authenticated: boolean };
        if (cancelled) return;
        if (status.needsSetup) {
          setPhase("setup");
          return;
        }
        if (!status.authenticated) {
          setPhase("login");
          return;
        }
        await refresh();
        if (cancelled) return;
        stream = new EventSource("/api/stream");
        stream.addEventListener("snapshot", (event) => {
          const message = event as MessageEvent<string>;
          setSnap(JSON.parse(message.data) as Snapshot);
          setOffline(false);
        });
        stream.onerror = () => setOffline(true);
      } catch {
        if (!cancelled) setPhase("offline");
      }
    })();
    return () => {
      cancelled = true;
      stream?.close();
    };
  }, [nonce, refresh]);

  const call = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({})) as { error?: string };
    if (res.status === 401) {
      setPhase("login");
      throw new Error("Sign in required");
    }
    if (!res.ok) throw new Error(body.error || "The engine rejected that");
    return body;
  }, []);

  return (
    <DeskContext.Provider value={{ snap, phase, offline, error, call, refresh }}>
      {phase === "loading" ? <Screen title="Opening the journal" body="Reading the book the engine already keeps." /> : null}
      {phase === "offline" ? (
        <Screen title="Engine unreachable" body="This page is only a window. Start the engine process, then retry. Nothing here can trade on its own.">
          <Button onClick={() => { setError(null); setPhase("loading"); setNonce((n) => n + 1); }}>Retry</Button>
        </Screen>
      ) : null}
      {phase === "setup" || phase === "login" ? <Auth phase={phase} onDone={() => { setPhase("loading"); setNonce((n) => n + 1); }} onError={setError} error={error} /> : null}
      {phase === "ready" && snap ? <Frame snap={snap} offline={offline}>{children}</Frame> : null}
    </DeskContext.Provider>
  );
}

function Screen({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-md">
        <div className="font-serif text-4xl text-brass">Meridian</div>
        <h1 className="mt-6 font-serif text-3xl text-paper">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-fog">{body}</p>
        {children ? <div className="mt-6">{children}</div> : null}
      </div>
    </div>
  );
}

function Auth({ phase, onDone, onError, error }: { phase: "setup" | "login"; onDone: () => void; onError: (value: string | null) => void; error: string | null }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const setup = phase === "setup";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    onError(null);
    if (setup && password !== again) {
      onError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(setup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Could not sign in");
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={setup ? "Set the desk password" : "Sign in"}
      body={setup
        ? "The engine is idle until this password exists. After that it can keep trading with this window closed. Twelve characters minimum. It is stored as a scrypt hash."
        : "The book is on the engine, not in this browser. Sign in to read it and to change settings the running process will pick up."}
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" className="mt-1" type="password" autoComplete={setup ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} />
        </div>
        {setup ? (
          <div>
            <Label htmlFor="again">Repeat</Label>
            <Input id="again" className="mt-1" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required minLength={12} />
          </div>
        ) : null}
        {error ? <p className="text-sm text-rose">{error}</p> : null}
        <Button type="submit" disabled={busy}>{busy ? "Checking…" : setup ? "Set password" : "Enter"}</Button>
      </form>
    </Screen>
  );
}

const NAV = [
  { href: "/", label: "Book" },
  { href: "/markets", label: "Markets" },
  { href: "/journal", label: "Journal" },
  { href: "/research", label: "Research" },
  { href: "/risk", label: "Risk" },
  { href: "/network", label: "Network" },
  { href: "/system", label: "System" },
];

function Frame({ snap, offline, children }: { snap: Snapshot; offline: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const kill = snap.engine.kill.engaged;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link href="/" className="font-serif text-2xl leading-none text-brass">Meridian</Link>
          <span className="hidden text-[11px] uppercase tracking-[0.16em] text-fog sm:inline">Desk</span>
          <div className="ml-auto flex items-center gap-2">
            {offline ? <Badge tone="bad">stream down</Badge> : null}
            <Badge tone={snap.engine.mode === "live" ? "live" : "warn"}>{snap.engine.mode}</Badge>
            {kill ? <Badge tone="bad">killed</Badge> : null}
            <span className={cn("font-mono text-sm", tone(snap.engine.dayPnl))}>{signed(snap.engine.dayPnl)}</span>
            <span className="font-mono text-sm text-paper">{money(snap.engine.paperEquity)}</span>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl flex-wrap gap-1 px-3 pb-2">
          {NAV.map((item) => {
            const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={cn("rounded-md px-3 py-1.5 text-sm", active ? "bg-panel-2 text-paper" : "text-fog hover:text-paper")}>
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
