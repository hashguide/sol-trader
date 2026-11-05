export interface RpcEndpoint {
  id: string;
  provider: string;
  url: string;
  priority: number;
  source: "default" | "env" | "ui";
}

export interface RpcHealth {
  latencyMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  backoffUntil: number;
  lastSuccessAt: number | null;
  blockNumber: string | null;
  blockTimeMs: number | null;
  stale: boolean;
}

export interface RpcResponse {
  status: number;
  json: { result?: unknown; error?: { code?: number; message?: string } } | null;
}

export type RpcCall = (url: string, body: unknown, timeoutMs: number) => Promise<RpcResponse>;

export class RpcApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcApplicationError";
  }
}

const RATE_CODES = new Set([429, -32005, -32429, -32016, -32007]);

function isRateLimit(status: number, message: string, code?: number): boolean {
  if (status === 429 || status >= 500) return true;
  if (code != null && RATE_CODES.has(code)) return true;
  const m = message.toLowerCase();
  return m.includes("rate limit") || m.includes("too many") || m.includes("timeout") || m.includes("timed out") || m.includes("429");
}

export class RpcPool {
  readonly health = new Map<string, RpcHealth>();
  readonly timeoutMs: number;
  readonly staleAfterMs: number;

  constructor(
    readonly chainId: string,
    readonly endpoints: RpcEndpoint[],
    private readonly call: RpcCall,
    private readonly now: () => number = () => Date.now(),
    opts?: { timeoutMs?: number; staleAfterMs?: number },
  ) {
    this.timeoutMs = opts?.timeoutMs ?? 8_000;
    this.staleAfterMs = opts?.staleAfterMs ?? 90_000;
    if (endpoints.length === 0) {
      throw new Error(`No RPC endpoints configured for ${chainId}`);
    }
    for (const ep of endpoints) {
      this.health.set(ep.id, {
        latencyMs: null,
        lastError: null,
        consecutiveFailures: 0,
        backoffUntil: 0,
        lastSuccessAt: null,
        blockNumber: null,
        blockTimeMs: null,
        stale: false,
      });
    }
  }

  replaceEndpoints(next: RpcEndpoint[]): void {
    if (next.length === 0) throw new Error(`No RPC endpoints configured for ${this.chainId}`);
    this.endpoints.splice(0, this.endpoints.length, ...next);
    const ids = new Set(next.map((ep) => ep.id));
    for (const id of this.health.keys()) {
      if (!ids.has(id)) this.health.delete(id);
    }
    for (const ep of next) {
      if (this.health.has(ep.id)) continue;
      this.health.set(ep.id, {
        latencyMs: null,
        lastError: null,
        consecutiveFailures: 0,
        backoffUntil: 0,
        lastSuccessAt: null,
        blockNumber: null,
        blockTimeMs: null,
        stale: false,
      });
    }
  }

  snapshot(): Array<RpcEndpoint & RpcHealth> {
    return [...this.endpoints]
      .sort((a, b) => a.priority - b.priority)
      .map((ep) => ({ ...ep, ...(this.health.get(ep.id) as RpcHealth) }));
  }

  hasFreshEndpoint(): boolean {
    const t = this.now();
    return this.endpoints.some((ep) => {
      const h = this.health.get(ep.id);
      return Boolean(h && h.lastSuccessAt && !h.stale && h.backoffUntil <= t);
    });
  }

  /** Prefer healthy, then stale, and skip endpoints still in backoff. */
  rank(): RpcEndpoint[] {
    const t = this.now();
    const sorted = [...this.endpoints].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    const fresh: RpcEndpoint[] = [];
    const stale: RpcEndpoint[] = [];
    for (const ep of sorted) {
      const h = this.health.get(ep.id);
      if (!h || h.backoffUntil > t) continue;
      if (h.stale) stale.push(ep);
      else fresh.push(ep);
    }
    return [...fresh, ...stale];
  }

  private fail(ep: RpcEndpoint, message: string): void {
    const h = this.health.get(ep.id);
    if (!h) return;
    h.consecutiveFailures += 1;
    h.lastError = message;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(h.consecutiveFailures, 5));
    h.backoffUntil = this.now() + delay;
  }

  private succeed(ep: RpcEndpoint, latency: number): void {
    const h = this.health.get(ep.id);
    if (!h) return;
    h.consecutiveFailures = 0;
    h.backoffUntil = 0;
    h.lastError = null;
    h.latencyMs = latency;
    h.lastSuccessAt = this.now();
  }

  noteBlock(ep: RpcEndpoint, blockNumber: string, blockTimeMs: number | null): void {
    const h = this.health.get(ep.id);
    if (!h) return;
    h.blockNumber = blockNumber;
    h.blockTimeMs = blockTimeMs;
    h.stale = blockTimeMs != null && this.now() - blockTimeMs > this.staleAfterMs;
  }

  async request(method: string, params: unknown[]): Promise<unknown> {
    const errors: string[] = [];
    const ordered = this.rank();
    if (ordered.length === 0) {
      throw new Error(`All RPC endpoints for ${this.chainId} are in backoff or none are configured`);
    }
    for (const ep of ordered) {
      const started = this.now();
      try {
        const res = await this.call(ep.url, { jsonrpc: "2.0", id: 1, method, params }, this.timeoutMs);
        const latency = Math.max(0, this.now() - started);
        const message = res.json?.error?.message ?? "";
        if (res.json?.error && !isRateLimit(res.status, message, res.json.error.code)) {
          this.succeed(ep, latency);
          throw new RpcApplicationError(message || "RPC application error");
        }
        if (res.status === 429 || res.status >= 500 || res.json?.error || res.json == null) {
          const why = message || `HTTP ${res.status}`;
          this.fail(ep, why);
          errors.push(`${ep.provider}: ${why}`);
          continue;
        }
        this.succeed(ep, latency);
        return res.json.result;
      } catch (error) {
        if (error instanceof RpcApplicationError) throw error;
        const why = error instanceof Error ? error.message : "request failed";
        this.fail(ep, why);
        errors.push(`${ep.provider}: ${why}`);
      }
    }
    throw new Error(`All RPC endpoints failed for ${this.chainId}: ${errors.join("; ")}`);
  }
}

export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    u.search = "";
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last.length > 8) {
      parts[parts.length - 1] = `••••${last.slice(-4)}`;
      u.pathname = `/${parts.join("/")}`;
    }
    return u.toString();
  } catch {
    return "invalid-url";
  }
}
