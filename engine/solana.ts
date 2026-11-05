import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { ChainConfig } from "./config";
import { RpcPool, type RpcEndpoint } from "./rpc/pool";

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct?: string;
  [key: string]: unknown;
}

function jupiterBase(): string {
  return (process.env.JUPITER_API_BASE ?? "https://lite-api.jup.ag/swap/v1").replace(/\/$/, "");
}

function jupiterHeaders(): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (process.env.JUPITER_API_KEY) headers["x-api-key"] = process.env.JUPITER_API_KEY;
  return headers;
}

export class SolanaAdapter {
  constructor(readonly config: ChainConfig, readonly pool: RpcPool, private readonly fetchImpl: typeof fetch = fetch) {}

  connection(url: string): Connection {
    return new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  }

  private url(): string {
    const fresh = this.pool.rank()[0];
    if (!fresh) throw new Error("No RPC endpoints configured for solana");
    return fresh.url;
  }

  async probe(ep: RpcEndpoint): Promise<void> {
    const started = Date.now();
    try {
      const connection = this.connection(ep.url);
      const slot = await connection.getSlot();
      const blockTime = await connection.getBlockTime(slot);
      const health = this.pool.health.get(ep.id);
      if (health) {
        health.latencyMs = Date.now() - started;
        health.consecutiveFailures = 0;
        health.backoffUntil = 0;
        health.lastError = null;
        health.lastSuccessAt = Date.now();
      }
      this.pool.noteBlock(ep, String(slot), blockTime ? blockTime * 1000 : null);
    } catch (error) {
      const health = this.pool.health.get(ep.id);
      if (health) {
        health.consecutiveFailures += 1;
        health.lastError = error instanceof Error ? error.message : "probe failed";
        health.backoffUntil = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(health.consecutiveFailures, 5));
      }
    }
  }

  async solBalance(owner: string): Promise<bigint> {
    const { PublicKey } = await import("@solana/web3.js");
    const lamports = await this.connection(this.url()).getBalance(new PublicKey(owner));
    return BigInt(lamports);
  }

  async tokenBalance(owner: string, mint: string): Promise<bigint> {
    const { PublicKey } = await import("@solana/web3.js");
    const connection = this.connection(this.url());
    const accounts = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) });
    let total = 0n;
    for (const account of accounts.value) {
      const amount = account.account.data.parsed?.info?.tokenAmount?.amount;
      if (typeof amount === "string") total += BigInt(amount);
    }
    return total;
  }

  async quote(inputMint: string, outputMint: string, amount: bigint, slippageBps: number): Promise<JupiterQuote> {
    const url = new URL(`${jupiterBase()}/quote`);
    url.searchParams.set("inputMint", inputMint);
    url.searchParams.set("outputMint", outputMint);
    url.searchParams.set("amount", amount.toString());
    url.searchParams.set("slippageBps", String(slippageBps));
    const res = await this.fetchImpl(url, { headers: jupiterHeaders() });
    if (!res.ok) throw new Error(`Jupiter quote failed (${res.status})`);
    return await res.json() as JupiterQuote;
  }

  async buildAndSend(quote: JupiterQuote, secret: string): Promise<string> {
    const kp = Keypair.fromSecretKey(bs58.decode(secret));
    const res = await this.fetchImpl(`${jupiterBase()}/swap`, {
      method: "POST",
      headers: { ...jupiterHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: kp.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
    });
    if (!res.ok) throw new Error(`Jupiter swap build failed (${res.status})`);
    const body = await res.json() as { swapTransaction?: string };
    if (!body.swapTransaction) throw new Error("Jupiter did not return a transaction");
    const tx = VersionedTransaction.deserialize(Buffer.from(body.swapTransaction, "base64"));
    tx.sign([kp]);
    const connection = this.connection(this.url());
    const sim = await connection.simulateTransaction(tx, { replaceRecentBlockhash: true, sigVerify: false });
    if (sim.value.err) throw new Error(`Solana simulation failed: ${JSON.stringify(sim.value.err)}`);
    const raw = Buffer.from(tx.serialize());
    const jito = process.env.JITO_BLOCK_ENGINE_URL?.trim();
    if (jito) {
      const sent = await this.fetchImpl(jito, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [raw.toString("base64"), { encoding: "base64" }] }),
      });
      const payload = await sent.json() as { result?: string; error?: { message?: string } };
      if (!payload.result) throw new Error(payload.error?.message ?? "Jito send failed");
      return payload.result;
    }
    return connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
  }
}
