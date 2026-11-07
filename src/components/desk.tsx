"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Badge, Button, Input, Label, Toast } from "@/components/ui";
import { cn, money, signed, tone } from "@/lib/format";
import type { Snapshot } from "@/lib/types";
import { loadInspectorTab, loadSelectedPair, saveInspectorTab, saveSelectedPair, type DrawerId, type InspectorTab } from "@/lib/workspace";

type Phase = "loading" | "setup" | "login" | "ready" | "offline";
type Feedback = { tone: "info" | "good" | "bad"; text: string } | null;

interface Desk {
  snap: Snapshot | null;
  phase: Phase;
  offline: boolean;
  error: string | null;
  feedback: Feedback;
  busy: string | null;
  selectedPairId: string;
  setSelectedPairId: (id: string) => void;
  inspectorTab: InspectorTab;
  setInspectorTab: (tab: InspectorTab) => void;
  drawer: DrawerId;
  openDrawer: (id: DrawerId) => void;
  call: (path: string, init?: RequestInit) => Promise<unknown>;
  refresh: () => Promise<void>;
  run: (name: string, path: string, init?: RequestInit, ok?: string) => Promise<boolean>;
  setFeedback: (value: Feedback) => void;
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
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [selectedPairId, setSelectedPairIdState] = useState("sol-usdc");
  const [inspectorTab, setInspectorTabState] = useState<InspectorTab>("signal");
  const [drawer, setDrawer] = useState<DrawerId>(null);

  const setSelectedPairId = useCallback((id: string) => {
    setSelectedPairIdState(id);
    saveSelectedPair(id);
  }, []);

  const setInspectorTab = useCallback((tab: InspectorTab) => {
    setInspectorTabState(tab);
    saveInspectorTab(tab);
  }, []);

  const openDrawer = useCallback((id: DrawerId) => setDrawer(id), []);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (res.status === 401) {
      setPhase("login");
      return;
    }
    if (!res.ok) throw new Error("The engine refused the state request");
    const next = await res.json() as Snapshot;
    setSnap(next);
    setPhase("ready");
    setOffline(false);
    setSelectedPairIdState((current) => {
      if (next.pairs.some((pair) => pair.id === current)) return current;
      const stored = loadSelectedPair(next.pairs[0]?.id ?? "sol-usdc");
      return next.pairs.some((pair) => pair.id === stored) ? stored : (next.pairs[0]?.id ?? "sol-usdc");
    });
  }, []);

  useEffect(() => {
    setInspectorTabState(loadInspectorTab());
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

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 4500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

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

  const run = useCallback(async (name: string, path: string, init?: RequestInit, ok?: string) => {
    setBusy(name);
    setFeedback(null);
    try {
      await call(path, init);
      await refresh();
      if (ok) setFeedback({ tone: "good", text: ok });
      return true;
    } catch (err) {
      setFeedback({ tone: "bad", text: err instanceof Error ? err.message : "Request failed" });
      return false;
    } finally {
      setBusy(null);
    }
  }, [call, refresh]);

  const value = useMemo(() => ({
    snap, phase, offline, error, feedback, busy,
    selectedPairId, setSelectedPairId, inspectorTab, setInspectorTab,
    drawer, openDrawer, call, refresh, run, setFeedback,
  }), [snap, phase, offline, error, feedback, busy, selectedPairId, setSelectedPairId, inspectorTab, setInspectorTab, drawer, openDrawer, call, refresh, run]);

  return (
    <DeskContext.Provider value={value}>
      {phase === "loading" ? <Screen title="Opening the journal" body="Reading the book the engine already keeps." /> : null}
      {phase === "offline" ? (
        <Screen title="Engine unreachable" body="This page is only a window. Start the engine process, then retry. Nothing here can trade on its own.">
          <Button onClick={() => { setError(null); setPhase("loading"); setNonce((n) => n + 1); }}>Retry</Button>
        </Screen>
      ) : null}
      {phase === "setup" || phase === "login" ? <Auth phase={phase} onDone={() => { setPhase("loading"); setNonce((n) => n + 1); }} onError={setError} error={error} /> : null}
      {phase === "ready" && snap ? (
        <Frame snap={snap} offline={offline} feedback={feedback}>
          {children}
        </Frame>
      ) : null}
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

function Frame({ snap, offline, feedback, children }: { snap: Snapshot; offline: boolean; feedback: Feedback; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <a href="#workstation" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-brass focus:px-3 focus:py-2 focus:text-ink">Skip to workstation</a>
      <header className="sticky top-0 z-30 border-b border-line bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-3 py-2.5 sm:px-4">
          <Link href="/" className="font-serif text-2xl leading-none text-brass">Meridian</Link>
          <span className="hidden text-[11px] uppercase tracking-[0.16em] text-fog md:inline">Workstation</span>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <Badge tone={snap.engine.running ? "good" : "neutral"}>{snap.engine.running ? `Loop #${snap.engine.iteration}` : "Idle"}</Badge>
            <Badge tone={snap.engine.mode === "live" ? "live" : "warn"}>{snap.engine.mode}</Badge>
            {snap.engine.kill.engaged ? <Badge tone="bad">Killed</Badge> : null}
            {offline ? <Badge tone="bad">Stream down</Badge> : <Badge tone="good">Live feed</Badge>}
            <span className={cn("font-mono text-sm", tone(snap.engine.dayPnl))}>{signed(snap.engine.dayPnl)}</span>
            <span className="font-mono text-sm text-paper">{money(snap.engine.paperEquity)}</span>
          </div>
        </div>
        {feedback ? (
          <div className="mx-auto max-w-[1400px] px-3 pb-2 sm:px-4">
            <Toast tone={feedback.tone}>{feedback.text}</Toast>
          </div>
        ) : null}
      </header>
      <main id="workstation" className="mx-auto max-w-[1400px] px-2 py-3 sm:px-4 sm:py-4">{children}</main>
    </div>
  );
}
