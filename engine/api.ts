import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { evaluateModeChange } from "./mode";
import { hashPassword, verifyPassword, encryptSecret, parseWalletKey } from "./secrets";
import type { Store } from "./db";
import type { TradingRuntime } from "./runtime";
import { CHAINS, PAIRS, endpointsForChain, type UiOverrides } from "./config";
import { LIVE_CONFIRM, type ChainId, type StrategyId } from "../src/shared/types";
import { screenPool } from "./market";
import { logger } from "./log";

const COOKIE = "meridian_session";

export function createApp(runtime: TradingRuntime, store: Store, master: Buffer) {
  const app = new Hono();
  const failures = new Map<string, { n: number; until: number }>();

  app.use("/api/*", async (c, next) => {
    const path = c.req.path;
    if (path === "/api/health" || path.startsWith("/api/auth/")) return next();
    const token = getCookie(c, COOKIE);
    if (!token || !store.validSession(token)) return c.json({ error: "Sign in required" }, 401);
    return next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, service: "meridian-engine" }));

  app.get("/api/auth/status", (c) => c.json({
    needsSetup: !store.meta("password"),
    authenticated: Boolean(getCookie(c, COOKIE) && store.validSession(getCookie(c, COOKIE) ?? "")),
  }));

  app.post("/api/auth/setup", async (c) => {
    if (store.meta("password")) return c.json({ error: "A password is already set" }, 409);
    const body = await c.req.json().catch(() => ({})) as { password?: string };
    if (!body.password || body.password.length < 12) return c.json({ error: "Use at least 12 characters" }, 400);
    store.setMeta("password", hashPassword(body.password));
    const token = randomBytes(32).toString("hex");
    store.saveSession(token, 7 * 24 * 3600 * 1000);
    setCookie(c, COOKIE, token, { httpOnly: true, path: "/", sameSite: "Lax", maxAge: 7 * 24 * 3600 });
    return c.json({ ok: true });
  });

  app.post("/api/auth/login", async (c) => {
    const ip = c.req.header("x-forwarded-for") ?? "local";
    const lock = failures.get(ip);
    if (lock && lock.until > Date.now()) return c.json({ error: "Too many attempts. Wait a minute." }, 429);
    const stored = store.meta("password");
    if (!stored) return c.json({ error: "Set a password first" }, 409);
    const body = await c.req.json().catch(() => ({})) as { password?: string };
    if (!body.password || !verifyPassword(body.password, stored)) {
      const next = { n: (lock?.n ?? 0) + 1, until: 0 };
      if (next.n >= 5) next.until = Date.now() + 60_000;
      failures.set(ip, next);
      return c.json({ error: "Wrong password" }, 401);
    }
    failures.delete(ip);
    const token = randomBytes(32).toString("hex");
    store.saveSession(token, 7 * 24 * 3600 * 1000);
    setCookie(c, COOKIE, token, { httpOnly: true, path: "/", sameSite: "Lax", maxAge: 7 * 24 * 3600 });
    return c.json({ ok: true });
  });

  app.post("/api/auth/logout", (c) => {
    const token = getCookie(c, COOKIE);
    if (token) store.dropSession(token);
    deleteCookie(c, COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/state", (c) => c.json(runtime.snapshot()));
  app.get("/api/stream", (c) => streamSSE(c, async (stream) => {
    const send = async () => {
      await stream.writeSSE({ event: "snapshot", data: JSON.stringify(runtime.snapshot()) });
    };
    await send();
    const unsub = runtime.onChange(() => { void send(); });
    try {
      while (true) {
        await stream.sleep(15_000);
        await stream.writeSSE({ event: "ping", data: "{}" });
      }
    } finally {
      unsub();
    }
  }));

  app.post("/api/engine/start", async (c) => {
    await runtime.start();
    runtime.notify();
    return c.json({ ok: true, running: runtime.running, error: runtime.lastError });
  });
  app.post("/api/engine/stop", (c) => {
    runtime.stop();
    runtime.notify();
    return c.json({ ok: true });
  });
  app.post("/api/engine/flatten", async (c) => {
    await runtime.flattenAll("manual flatten");
    return c.json({ ok: true });
  });

  app.post("/api/mode", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { mode?: "paper" | "live"; confirm?: string };
    if (body.mode !== "paper" && body.mode !== "live") return c.json({ error: "mode must be paper or live" }, 400);
    const decision = evaluateModeChange({
      requested: body.mode,
      confirm: body.confirm,
      chains: CHAINS.map((chain) => ({
        id: chain.id,
        tradingEnabled: runtime.settings().chains[chain.id]?.tradingEnabled ?? false,
        address: runtime.walletAddress(chain.id),
      })),
    });
    if (!decision.ok) return c.json({ error: decision.problems.join(" ") }, 400);
    const overrides = store.overrides() ?? {};
    overrides.mode = body.mode;
    store.saveOverrides(overrides);
    logger.info({ mode: body.mode }, "trading mode changed");
    runtime.notify();
    return c.json({ ok: true, mode: body.mode, confirmPhrase: body.mode === "live" ? LIVE_CONFIRM : null });
  });

  app.post("/api/kill", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { engaged?: boolean; reason?: string };
    try {
      runtime.setKill(Boolean(body.engaged), body.reason ?? (body.engaged ? "manual kill from the dashboard" : "cleared from the dashboard"), "ui");
      if (body.engaged) await runtime.flattenAll("kill switch");
      runtime.notify();
      return c.json({ ok: true, kill: runtime.killState() });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "kill switch unchanged" }, 400);
    }
  });

  app.put("/api/risk", async (c) => {
    const body = await c.req.json() as UiOverrides["risk"];
    const overrides = store.overrides() ?? {};
    overrides.risk = { ...overrides.risk, ...body };
    store.saveOverrides(overrides);
    runtime.notify();
    return c.json({ ok: true, risk: runtime.settings().risk });
  });

  app.put("/api/gates", async (c) => {
    const body = await c.req.json() as UiOverrides["gates"];
    const overrides = store.overrides() ?? {};
    overrides.gates = { ...overrides.gates, ...body };
    store.saveOverrides(overrides);
    runtime.notify();
    return c.json({ ok: true, gates: runtime.settings().gates });
  });

  app.put("/api/loop", async (c) => {
    const body = await c.req.json() as { loopIntervalMs?: number; paperStartingEquity?: number; overrideGates?: boolean };
    const overrides = store.overrides() ?? {};
    if (body.loopIntervalMs) overrides.loopIntervalMs = body.loopIntervalMs;
    if (body.paperStartingEquity) overrides.paperStartingEquity = body.paperStartingEquity;
    if (typeof body.overrideGates === "boolean") overrides.overrideGates = body.overrideGates;
    store.saveOverrides(overrides);
    runtime.notify();
    return c.json({ ok: true, settings: runtime.settings() });
  });

  app.put("/api/chains/:id", async (c) => {
    const id = c.req.param("id") as ChainId;
    if (!CHAINS.some((chain) => chain.id === id)) return c.json({ error: "unknown chain" }, 404);
    const body = await c.req.json() as { enabled?: boolean; tradingEnabled?: boolean };
    const overrides = store.overrides() ?? {};
    overrides.chains = { ...overrides.chains, [id]: { ...overrides.chains?.[id], ...body } };
    store.saveOverrides(overrides);
    runtime.notify();
    return c.json({ ok: true });
  });

  app.put("/api/pairs/:id", async (c) => {
    const id = c.req.param("id");
    if (!PAIRS.some((pair) => pair.id === id)) return c.json({ error: "unknown pair" }, 404);
    const body = await c.req.json() as { enabled?: boolean };
    const overrides = store.overrides() ?? {};
    overrides.pairs = { ...overrides.pairs, [id]: { enabled: Boolean(body.enabled) } };
    store.saveOverrides(overrides);
    runtime.notify();
    return c.json({ ok: true });
  });

  app.put("/api/strategies/:id", async (c) => {
    const id = c.req.param("id") as StrategyId;
    if (!["trend", "breakout", "mean_reversion"].includes(id)) return c.json({ error: "unknown strategy" }, 404);
    const body = await c.req.json() as { enabled?: boolean };
    const overrides = store.overrides() ?? {};
    overrides.strategyEnabled = { ...overrides.strategyEnabled, [id]: Boolean(body.enabled) };
    store.saveOverrides(overrides);
    runtime.notify();
    return c.json({ ok: true });
  });

  app.put("/api/rpc/:chain", async (c) => {
    const chain = c.req.param("chain") as ChainId;
    if (!CHAINS.some((row) => row.id === chain)) return c.json({ error: "unknown chain" }, 404);
    const body = await c.req.json() as { endpoints?: { provider: "quicknode" | "alchemy" | "infura" | "public" | "custom"; url: string; priority: number }[] };
    const overrides = store.overrides() ?? {};
    overrides.rpc = { ...overrides.rpc, [chain]: body.endpoints ?? [] };
    store.saveOverrides(overrides);
    try {
      runtime.reloadRpc(chain);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "RPC list was saved but the running pool rejected it" }, 400);
    }
    await runtime.probeNow(chain);
    return c.json({ ok: true });
  });

  app.post("/api/rpc/:chain/endpoints", async (c) => {
    const chain = c.req.param("chain") as ChainId;
    if (!CHAINS.some((row) => row.id === chain)) return c.json({ error: "unknown chain" }, 404);
    const body = await c.req.json().catch(() => ({})) as { provider?: "quicknode" | "alchemy" | "infura" | "public" | "custom"; url?: string; priority?: number };
    const url = body.url?.trim() ?? "";
    let parsed: URL;
    try { parsed = new URL(url); } catch { return c.json({ error: "Enter a full http or https URL" }, 400); }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return c.json({ error: "Enter a full http or https URL" }, 400);
    const provider = body.provider ?? "custom";
    const overrides = store.overrides() ?? {};
    const current = endpointsForChain(chain, overrides);
    overrides.rpc = {
      ...overrides.rpc,
      [chain]: [
        ...current.map((ep) => ({ provider: ep.provider, url: ep.url, priority: ep.priority })),
        { provider, url: parsed.toString(), priority: Number.isFinite(body.priority) ? Number(body.priority) : 15 },
      ],
    };
    store.saveOverrides(overrides);
    runtime.reloadRpc(chain);
    await runtime.probeNow(chain);
    return c.json({ ok: true });
  });

  app.delete("/api/rpc/:chain/endpoints/:id", async (c) => {
    const chain = c.req.param("chain") as ChainId;
    const id = decodeURIComponent(c.req.param("id"));
    if (!CHAINS.some((row) => row.id === chain)) return c.json({ error: "unknown chain" }, 404);
    const overrides = store.overrides() ?? {};
    const current = endpointsForChain(chain, overrides);
    const next = current.filter((ep) => ep.id !== id);
    if (next.length === current.length) return c.json({ error: "endpoint not found" }, 404);
    if (next.length === 0) return c.json({ error: "A chain needs at least one endpoint" }, 400);
    overrides.rpc = { ...overrides.rpc, [chain]: next.map((ep) => ({ provider: ep.provider, url: ep.url, priority: ep.priority })) };
    store.saveOverrides(overrides);
    runtime.reloadRpc(chain);
    await runtime.probeNow(chain);
    return c.json({ ok: true });
  });

  app.get("/api/wallets", (c) => c.json({
    wallets: runtime.snapshot().chains.map((chain) => {
      const row = chain as { id: string; wallet: { address: string; source: string } | null; nativeSymbol: string };
      return { chain: row.id, address: row.wallet?.address ?? null, source: row.wallet?.source ?? null, nativeSymbol: row.nativeSymbol };
    }),
  }));

  app.post("/api/wallets", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { chain?: ChainId; privateKey?: string };
    if (!body.chain || !body.privateKey) return c.json({ error: "chain and privateKey are required" }, 400);
    try {
      const parsed = parseWalletKey(body.chain, body.privateKey);
      const sealed = encryptSecret(parsed.material, master);
      store.saveWallet(body.chain, parsed.address, sealed.iv, sealed.tag, sealed.ciphertext);
      logger.info({ chain: body.chain, address: parsed.address }, "wallet saved");
      void runtime.refreshBalances().finally(() => runtime.notify());
      return c.json({ ok: true, address: parsed.address });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid key" }, 400);
    }
  });

  app.delete("/api/wallets/:chain", (c) => {
    store.deleteWallet(c.req.param("chain"));
    runtime.notify();
    return c.json({ ok: true });
  });

  app.post("/api/balances/refresh", async (c) => {
    await runtime.refreshBalances();
    runtime.notify();
    return c.json({ ok: true });
  });

  app.get("/api/journal", (c) => c.json({
    trades: store.recentTrades(runtime.settings().mode, 400),
    decisions: store.recentDecisions(400),
  }));

  app.get("/api/chart/:pair", async (c) => {
    try {
      return c.json(await runtime.chart(c.req.param("pair")));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "chart failed" }, 404);
    }
  });

  app.post("/api/backtests", async (c) => {
    try {
      const id = await runtime.startResearch();
      return c.json({ ok: true, id });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "could not start" }, 409);
    }
  });

  app.get("/api/backtests/latest", (c) => c.json(store.latestBacktest()));

  app.get("/api/universe", async (c) => {
    const network = c.req.query("network") ?? "solana";
    try {
      const res = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/trending_pools`, {
        headers: { accept: "application/json;version=20230302", "user-agent": "meridian/0.1" },
      });
      if (!res.ok) return c.json({ error: `geckoterminal ${res.status}` }, 502);
      const body = await res.json() as { data?: { attributes: { name: string; address: string; reserve_in_usd: string; volume_usd?: { h24?: string }; pool_created_at?: string } }[] };
      const now = Date.now();
      const rows = (body.data ?? []).map((pool) => {
        const attrs = pool.attributes;
        const screened = screenPool({
          liquidityUsd: Number(attrs.reserve_in_usd ?? 0),
          volume24hUsd: Number(attrs.volume_usd?.h24 ?? 0),
          createdAtMs: attrs.pool_created_at ? Date.parse(attrs.pool_created_at) : null,
          nowMs: now,
        });
        return { name: attrs.name, pool: attrs.address, network, ...screened, liquidityUsd: Number(attrs.reserve_in_usd ?? 0), volume24hUsd: Number(attrs.volume_usd?.h24 ?? 0) };
      });
      return c.json({ rows });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "universe scan failed" }, 502);
    }
  });

  return app;
}

export function listen(app: Hono, host: string, port: number): void {
  serve({ fetch: app.fetch, hostname: host, port }, (info) => {
    logger.info({ host: info.address, port: info.port }, "engine API listening");
  });
}
