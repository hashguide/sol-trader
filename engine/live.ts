import type { Address, Hex } from "viem";
import type { ChainId } from "../src/shared/types";
import type { PairConfig } from "./config";
import { humanImpactBps, type EvmAdapter } from "./evm";
import type { Hyperliquid } from "./hyperliquid";
import type { SolanaAdapter } from "./solana";

export interface LiveFill {
  price: number;
  qty: number;
  feeUsd: number;
  gasUsd: number;
  slippageUsd: number;
  tx: string;
  impactBps: number;
}

export interface KeyMaterial {
  address: string;
  material: string;
}

export class LiveBroker {
  constructor(
    private readonly evm: Map<ChainId, EvmAdapter>,
    private readonly solana: SolanaAdapter | null,
    private readonly perps: Hyperliquid,
    private readonly keyFor: (chain: ChainId) => KeyMaterial | null,
    private readonly hyperliquidKey: () => KeyMaterial | null = () => keyFor("ethereum"),
  ) {}

  async spot(pair: PairConfig, side: "buy" | "sell", notionalUsd: number, qtyBase: number, mark: number, slippageBps: number, maxImpactBps: number): Promise<LiveFill> {
    if (pair.chain === "solana") return this.solanaSpot(pair, side, notionalUsd, qtyBase, mark, slippageBps, maxImpactBps);
    return this.evmSpot(pair, side, notionalUsd, qtyBase, mark, slippageBps, maxImpactBps);
  }

  async perp(pair: PairConfig, side: "long" | "short", qty: number, mark: number, reduceOnly: boolean): Promise<LiveFill> {
    if (!pair.perpCoin) throw new Error(`${pair.id} has no perp market`);
    const key = this.hyperliquidKey();
    if (!key) throw new Error("Hyperliquid signing needs an EVM private key. Spot Solana keys cannot sign perp orders.");
    const aggressive = side === "long" ? mark * 1.003 : mark * 0.997;
    const placed = await this.perps.placeIoc({
      privateKey: key.material as Hex,
      coin: pair.perpCoin,
      isBuy: side === "long",
      size: qty,
      price: aggressive,
      reduceOnly,
    });
    if (!placed.ok) throw new Error(`Hyperliquid rejected the order: ${JSON.stringify(placed.response)}`);
    return {
      price: mark,
      qty,
      feeUsd: notionalFee(qty * mark, 4.5),
      gasUsd: 0,
      slippageUsd: Math.abs(aggressive - mark) * qty,
      tx: `hyperliquid:${pair.perpCoin}:${Date.now()}`,
      impactBps: 0,
    };
  }

  private async solanaSpot(pair: PairConfig, side: "buy" | "sell", notionalUsd: number, qtyBase: number, mark: number, slippageBps: number, maxImpactBps: number): Promise<LiveFill> {
    if (!this.solana) throw new Error("Solana adapter is not configured");
    const key = this.keyFor("solana");
    if (!key) throw new Error("solana wallet key is missing");
    const inputMint = side === "buy" ? pair.quote.address : pair.base.address;
    const outputMint = side === "buy" ? pair.base.address : pair.quote.address;
    const amount = side === "buy"
      ? BigInt(Math.round(notionalUsd * 10 ** pair.quote.decimals))
      : BigInt(Math.round(qtyBase * 10 ** pair.base.decimals));
    const quote = await this.solana.quote(inputMint, outputMint, amount, slippageBps);
    const inHuman = Number(quote.inAmount) / 10 ** (side === "buy" ? pair.quote.decimals : pair.base.decimals);
    const outHuman = Number(quote.outAmount) / 10 ** (side === "buy" ? pair.base.decimals : pair.quote.decimals);
    const impact = humanImpactBps(side, inHuman, outHuman, mark);
    if (impact > maxImpactBps) throw new Error(`Jupiter impact ${impact.toFixed(1)} bps exceeds the ${maxImpactBps} bps cap`);
    const sig = await this.solana.buildAndSend(quote, key.material);
    const qty = side === "buy" ? outHuman : inHuman;
    const price = side === "buy" ? inHuman / outHuman : outHuman / inHuman;
    return { price, qty, feeUsd: notionalFee(notionalUsd, pair.feeBps), gasUsd: 0.05, slippageUsd: Math.abs(price - mark) * qty, tx: sig, impactBps: impact };
  }

  private async evmSpot(pair: PairConfig, side: "buy" | "sell", notionalUsd: number, qtyBase: number, mark: number, slippageBps: number, maxImpactBps: number): Promise<LiveFill> {
    const adapter = this.evm.get(pair.chain);
    const key = this.keyFor(pair.chain);
    if (!adapter || !key) throw new Error(`${pair.chain} wallet or adapter is missing`);
    const tokenIn = (side === "buy" ? pair.quote.address : pair.base.address) as Address;
    const tokenOut = (side === "buy" ? pair.base.address : pair.quote.address) as Address;
    const amountIn = side === "buy"
      ? BigInt(Math.round(notionalUsd * 10 ** pair.quote.decimals))
      : BigInt(Math.round(qtyBase * 10 ** pair.base.decimals));
    const quote = pair.dex === "aerodrome"
      ? await adapter.quoteAerodrome(pair.pool as Address, tokenIn, tokenOut, amountIn, mark)
      : await adapter.quoteUniswap(tokenIn, tokenOut, amountIn, pair.feeTier ?? 3000, mark);
    const inDecimals = side === "buy" ? pair.quote.decimals : pair.base.decimals;
    const outDecimals = side === "buy" ? pair.base.decimals : pair.quote.decimals;
    const inHuman = Number(amountIn) / 10 ** inDecimals;
    const outHuman = Number(quote.amountOut) / 10 ** outDecimals;
    const impact = humanImpactBps(side, inHuman, outHuman, mark);
    if (impact > maxImpactBps) throw new Error(`route impact ${impact.toFixed(1)} bps exceeds the ${maxImpactBps} bps cap`);
    const built = pair.dex === "aerodrome"
      ? adapter.buildAerodrome(quote, tokenIn, tokenOut, key.address as Address, slippageBps)
      : adapter.buildUniswap(quote, tokenIn, tokenOut, key.address as Address, slippageBps);
    const sim = await adapter.simulate(built, key.address as Address);
    if (!sim.ok) throw new Error(sim.error ?? "simulation failed");
    const hash = await adapter.send(built, key.material as Hex, key.address as Address);
    const receipt = await adapter.confirm(hash);
    if (!receipt.ok) throw new Error(`transaction ${hash} reverted`);
    const qty = side === "buy" ? outHuman : inHuman;
    const price = side === "buy" ? inHuman / Math.max(outHuman, 1e-12) : outHuman / Math.max(inHuman, 1e-12);
    return {
      price,
      qty,
      feeUsd: notionalFee(notionalUsd, pair.feeBps),
      gasUsd: adapter.config.gasUsd,
      slippageUsd: Math.abs(price - mark) * qty,
      tx: hash,
      impactBps: impact,
    };
  }
}

function notionalFee(notional: number, feeBps: number): number {
  return (notional * feeBps) / 10_000;
}
