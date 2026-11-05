import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { PairConfig } from "./config";
import { closedBars, sanitizeBars } from "../src/shared/backtest";
import type { Bar } from "../src/shared/types";

export interface MarketData {
  getBars(pair: PairConfig, nowMs: number): Promise<{ bars: Bar[]; source: string; warning?: string }>;
  getMark(pair: PairConfig): Promise<{ price: number | null; source: string; liquidityUsd: number | null; volume24hUsd: number | null }>;
}

interface CacheFile {
  bars: Bar[];
}

export class PublicMarketData implements MarketData {
  private memory = new Map<string, { at: number; bars: Bar[]; source: string }>();

  constructor(private readonly dataDir: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async getBars(pair: PairConfig, nowMs: number): Promise<{ bars: Bar[]; source: string; warning?: string }> {
    const cached = this.memory.get(pair.id);
    if (cached && nowMs - cached.at < 45_000) {
      return { bars: closedBars(cached.bars, nowMs), source: cached.source };
    }
    const disk = this.readDisk(pair.id);
    try {
      const fresh = await this.gecko(pair, 300);
      const merged = mergeBars(disk, fresh);
      this.memory.set(pair.id, { at: nowMs, bars: merged, source: disk.length ? "geckoterminal+cache" : "geckoterminal" });
      return { bars: closedBars(merged, nowMs), source: disk.length ? "geckoterminal+cache" : "geckoterminal" };
    } catch (error) {
      if (disk.length) {
        this.memory.set(pair.id, { at: nowMs, bars: disk, source: "cache" });
        return {
          bars: closedBars(disk, nowMs),
          source: "cache",
          warning: error instanceof Error ? error.message : "live candle fetch failed",
        };
      }
      throw error;
    }
  }

  async getMark(pair: PairConfig): Promise<{ price: number | null; source: string; liquidityUsd: number | null; volume24hUsd: number | null }> {
    try {
      const url = `https://api.dexscreener.com/latest/dex/pairs/${pair.dexscreenerChain}/${pair.pool}`;
      const res = await this.fetchImpl(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`dexscreener ${res.status}`);
      const body = await res.json() as { pairs?: { priceUsd?: string; liquidity?: { usd?: number }; volume?: { h24?: number } }[] | null };
      const row = body.pairs?.[0];
      const price = row?.priceUsd ? Number(row.priceUsd) : null;
      return {
        price: price && price > 0 ? price : null,
        source: "dexscreener",
        liquidityUsd: row?.liquidity?.usd ?? null,
        volume24hUsd: row?.volume?.h24 ?? null,
      };
    } catch {
      return { price: null, source: "dexscreener", liquidityUsd: null, volume24hUsd: null };
    }
  }

  private readDisk(id: string): Bar[] {
    const file = path.join(this.dataDir, "candles", `${id}.json`);
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, "utf8")) as CacheFile;
    return sanitizeBars(parsed.bars ?? []).bars;
  }

  private async gecko(pair: PairConfig, limit: number): Promise<Bar[]> {
    const url = `https://api.geckoterminal.com/api/v2/networks/${pair.geckoNetwork}/pools/${pair.pool}/ohlcv/hour?aggregate=1&limit=${limit}&currency=usd`;
    const res = await this.fetchImpl(url, { headers: { accept: "application/json;version=20230302", "user-agent": "meridian/0.1" } });
    if (!res.ok) throw new Error(`geckoterminal ${res.status}`);
    const body = await res.json() as { data?: { attributes?: { ohlcv_list?: number[][] } } };
    const rows = body.data?.attributes?.ohlcv_list ?? [];
    const bars: Bar[] = rows.map((row) => ({
      t: Number(row[0]),
      o: Number(row[1]),
      h: Number(row[2]),
      l: Number(row[3]),
      c: Number(row[4]),
      v: Number(row[5]),
    }));
    return sanitizeBars(bars).bars;
  }
}

export function mergeBars(older: Bar[], newer: Bar[]): Bar[] {
  const map = new Map<number, Bar>();
  for (const bar of older) map.set(bar.t, bar);
  for (const bar of newer) map.set(bar.t, bar);
  return [...map.values()].sort((a, b) => a.t - b.t);
}

export interface UniverseCandidate {
  chain: string;
  pool: string;
  name: string;
  liquidityUsd: number;
  volume24hUsd: number;
  createdAt: string | null;
  pass: boolean;
  reasons: string[];
}

export function screenPool(input: {
  liquidityUsd: number;
  volume24hUsd: number;
  createdAtMs: number | null;
  nowMs: number;
  honeypot?: boolean | null;
  sellTaxPct?: number | null;
  minLiquidityUsd?: number;
  minVolumeUsd?: number;
  minAgeDays?: number;
  maxTaxPct?: number;
}): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const minLiq = input.minLiquidityUsd ?? 100_000;
  const minVol = input.minVolumeUsd ?? 50_000;
  const minAge = input.minAgeDays ?? 14;
  const maxTax = input.maxTaxPct ?? 10;
  if (!(input.liquidityUsd >= minLiq)) reasons.push(`liquidity $${Math.round(input.liquidityUsd)} is below $${minLiq}`);
  if (!(input.volume24hUsd >= minVol)) reasons.push(`24h volume $${Math.round(input.volume24hUsd)} is below $${minVol}`);
  if (input.createdAtMs == null) reasons.push("pool age is unknown");
  else if (input.nowMs - input.createdAtMs < minAge * 86_400_000) reasons.push(`pool is younger than ${minAge} days`);
  if (input.honeypot === true) reasons.push("honeypot flag");
  if (input.sellTaxPct != null && input.sellTaxPct > maxTax) reasons.push(`sell tax ${input.sellTaxPct}% exceeds ${maxTax}%`);
  return { pass: reasons.length === 0, reasons };
}
