import { describe, expect, it } from "vitest";
import { RpcApplicationError, RpcPool, type RpcCall, type RpcEndpoint } from "../engine/rpc/pool";

function endpoints(): RpcEndpoint[] {
  return [
    { id: "a", provider: "quicknode", url: "https://qn.example/a", priority: 10, source: "env" },
    { id: "b", provider: "alchemy", url: "https://alchemy.example/b", priority: 20, source: "env" },
    { id: "c", provider: "public", url: "https://public.example/c", priority: 100, source: "default" },
  ];
}

describe("RPC failover", () => {
  it("skips a rate-limited primary and uses the next endpoint", async () => {
    const seen: string[] = [];
    const call: RpcCall = async (url) => {
      seen.push(url);
      if (url.includes("qn.example")) return { status: 429, json: { error: { code: 429, message: "rate limit" } } };
      return { status: 200, json: { result: "0x10" } };
    };
    const pool = new RpcPool("base", endpoints(), call, () => 1_000);
    const result = await pool.request("eth_blockNumber", []);
    expect(result).toBe("0x10");
    expect(seen[0]).toContain("qn.example");
    expect(seen[1]).toContain("alchemy.example");
    expect(pool.health.get("a")?.backoffUntil).toBeGreaterThan(1_000);
  });

  it("fails over on timeouts and does not retry an application error", async () => {
    let n = 0;
    const call: RpcCall = async (url) => {
      n += 1;
      if (url.includes("qn.example")) throw new Error("timed out");
      return { status: 200, json: { error: { code: 3, message: "execution reverted" } } };
    };
    const pool = new RpcPool("base", endpoints(), call, () => 5_000);
    await expect(pool.request("eth_call", [])).rejects.toBeInstanceOf(RpcApplicationError);
    expect(n).toBe(2);
  });

  it("prefers a fresh block over a stale higher-priority endpoint", () => {
    let now = 1_000_000;
    const pool = new RpcPool("solana", endpoints(), async () => ({ status: 200, json: { result: null } }), () => now, {
      staleAfterMs: 30_000,
    });
    pool.noteBlock(endpoints()[0]!, "100", now - 120_000);
    pool.noteBlock(endpoints()[1]!, "140", now - 1_000);
    expect(pool.rank()[0]?.id).toBe("b");
    expect(pool.health.get("a")?.stale).toBe(true);
    now += 60_000;
    expect(pool.health.get("a")?.backoffUntil ?? 0).toBeLessThanOrEqual(now);
  });

  it("backs off and then retries after the clock advances", async () => {
    let now = 10_000;
    const call: RpcCall = async () => ({ status: 500, json: null });
    const pool = new RpcPool("arbitrum", [endpoints()[0]!], call, () => now);
    await expect(pool.request("eth_blockNumber", [])).rejects.toThrow(/arbitrum/);
    await expect(pool.request("eth_blockNumber", [])).rejects.toThrow(/backoff/);
    now += 120_000;
    const call2: RpcCall = async () => ({ status: 200, json: { result: "0x2" } });
    const recovered = new RpcPool("arbitrum", [endpoints()[0]!], call2, () => now);
    await expect(recovered.request("eth_blockNumber", [])).resolves.toBe("0x2");
  });

  it("replaces endpoints on the live pool", async () => {
    const call: RpcCall = async (url) => ({ status: 200, json: { result: url } });
    const pool = new RpcPool("base", endpoints(), call, () => 1_000);
    pool.replaceEndpoints([{ id: "d", provider: "custom", url: "https://custom.example/d", priority: 1, source: "ui" }]);
    await expect(pool.request("eth_blockNumber", [])).resolves.toBe("https://custom.example/d");
    expect(pool.snapshot().map((ep) => ep.id)).toEqual(["d"]);
  });

  it("refuses to construct a pool with no endpoints", () => {
    expect(() => new RpcPool("ethereum", [], async () => ({ status: 200, json: { result: 1 } }))).toThrow(/ethereum/);
  });
});
