import { encode } from "@msgpack/msgpack";
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const INFO = "https://api.hyperliquid.xyz/info";
const EXCHANGE = "https://api.hyperliquid.xyz/exchange";

export interface PerpAsset {
  index: number;
  szDecimals: number;
}

export interface PerpPosition {
  coin: string;
  size: number;
  entryPx: number;
}

/** Constant-time-ish wire format matching the Hyperliquid SDK's 8-decimal normalization. */
export function floatToWire(x: number): string {
  const negative = x < 0;
  const fixed = Math.abs(x).toFixed(8);
  let body = fixed.replace(/0+$/, "").replace(/\.$/, "");
  if (body === "") body = "0";
  return negative && body !== "0" ? `-${body}` : body;
}

export function roundPerpPrice(px: number, szDecimals: number): number {
  if (!(px > 0)) throw new Error("price must be positive");
  const sig = Number(px.toPrecision(5));
  const decimals = Math.max(0, 6 - szDecimals);
  const factor = 10 ** decimals;
  return Math.round(sig * factor) / factor;
}

export function roundPerpSize(size: number, szDecimals: number): number {
  const factor = 10 ** szDecimals;
  return Math.floor(size * factor) / factor;
}

export function actionHash(action: unknown, nonce: number): Hex {
  const packed = Buffer.from(encode(action));
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64BE(BigInt(nonce));
  return keccak256(Buffer.concat([packed, nonceBuf, Buffer.from([0])]));
}

export async function signL1Action(privateKey: Hex, action: unknown, nonce: number): Promise<{ r: Hex; s: Hex; v: number }> {
  const connectionId = actionHash(action, nonce);
  const account = privateKeyToAccount(privateKey);
  const signature = await account.signTypedData({
    domain: {
      name: "Exchange",
      version: "1",
      chainId: 1337,
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    types: {
      Agent: [
        { name: "source", type: "string" },
        { name: "connectionId", type: "bytes32" },
      ],
    },
    primaryType: "Agent",
    message: { source: "a", connectionId },
  });
  return {
    r: `0x${signature.slice(2, 66)}` as Hex,
    s: `0x${signature.slice(66, 130)}` as Hex,
    v: Number.parseInt(signature.slice(130, 132), 16),
  };
}

export class Hyperliquid {
  private assets = new Map<string, PerpAsset>();
  private loadedAt = 0;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async ensureMeta(now = Date.now()): Promise<void> {
    if (this.assets.size && now - this.loadedAt < 30 * 60_000) return;
    const body = await this.postInfo({ type: "meta" }) as { universe: { name: string; szDecimals: number }[] };
    this.assets.clear();
    body.universe.forEach((asset, index) => {
      this.assets.set(asset.name, { index, szDecimals: asset.szDecimals });
    });
    this.loadedAt = now;
  }

  has(coin: string): boolean {
    return this.assets.has(coin);
  }

  asset(coin: string): PerpAsset | undefined {
    return this.assets.get(coin);
  }

  async mid(coin: string): Promise<number | null> {
    const mids = await this.postInfo({ type: "allMids" }) as Record<string, string>;
    const px = Number(mids[coin]);
    return px > 0 ? px : null;
  }

  async positions(user: string): Promise<PerpPosition[]> {
    const state = await this.postInfo({ type: "clearinghouseState", user }) as {
      assetPositions?: { position: { coin: string; szi: string; entryPx: string } }[];
    };
    return (state.assetPositions ?? []).map((row) => ({
      coin: row.position.coin,
      size: Number(row.position.szi),
      entryPx: Number(row.position.entryPx),
    })).filter((row) => row.size !== 0);
  }

  /** IOC order. Returns the raw exchange response. Caller must treat non-ok statuses as a failed send. */
  async placeIoc(input: {
    privateKey: Hex;
    coin: string;
    isBuy: boolean;
    size: number;
    price: number;
    reduceOnly: boolean;
  }): Promise<{ ok: boolean; response: unknown }> {
    await this.ensureMeta();
    const asset = this.assets.get(input.coin);
    if (!asset) throw new Error(`Hyperliquid has no market for ${input.coin}`);
    const px = roundPerpPrice(input.price, asset.szDecimals);
    const sz = roundPerpSize(input.size, asset.szDecimals);
    if (!(sz > 0)) throw new Error("rounded size is zero");
    const action = {
      type: "order",
      orders: [{
        a: asset.index,
        b: input.isBuy,
        p: floatToWire(px),
        s: floatToWire(sz),
        r: input.reduceOnly,
        t: { limit: { tif: "Ioc" } },
      }],
      grouping: "na",
    };
    const nonce = Date.now();
    const signature = await signL1Action(input.privateKey, action, nonce);
    const res = await this.fetchImpl(EXCHANGE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, nonce, signature, vaultAddress: null }),
    });
    const response = await res.json() as { status?: string; response?: unknown };
    const ok = res.ok && response.status === "ok";
    return { ok, response };
  }

  private async postInfo(body: unknown): Promise<unknown> {
    const res = await this.fetchImpl(INFO, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`hyperliquid info ${res.status}`);
    return res.json();
  }
}
