import type { RiskLimits, Side } from "./types";

export interface SizeInput {
  equityUsd: number;
  cashUsd: number;
  entry: number;
  stop: number;
  side: Side;
  riskPerTradePct: number;
  maxPositionPct: number;
}

export type SizeResult =
  | { ok: true; notionalUsd: number; qty: number; riskUsd: number; stopDistancePct: number }
  | { ok: false; reason: string };

/** Fixed-fractional size: risk budget divided by stop distance, then capped. */
export function sizePosition(input: SizeInput): SizeResult {
  const { equityUsd, cashUsd, entry, stop, riskPerTradePct, maxPositionPct } = input;
  if (!(equityUsd > 0)) return { ok: false, reason: "equity is not positive" };
  if (!(entry > 0) || !(stop > 0)) return { ok: false, reason: "entry and stop must be positive" };
  if (input.side === "long" && stop >= entry) return { ok: false, reason: "long stop must sit below entry" };
  if (input.side === "short" && stop <= entry) return { ok: false, reason: "short stop must sit above entry" };
  const stopDistancePct = Math.abs(entry - stop) / entry;
  if (stopDistancePct <= 0 || stopDistancePct > 0.5) {
    return { ok: false, reason: `stop distance ${(stopDistancePct * 100).toFixed(2)}% is outside 0-50%` };
  }
  const riskUsd = equityUsd * (riskPerTradePct / 100);
  let notionalUsd = riskUsd / stopDistancePct;
  const positionCap = equityUsd * (maxPositionPct / 100);
  notionalUsd = Math.min(notionalUsd, positionCap, Math.max(cashUsd, 0));
  if (!(notionalUsd > 1)) return { ok: false, reason: "sized notional is below $1 after caps" };
  return { ok: true, notionalUsd, qty: notionalUsd / entry, riskUsd, stopDistancePct };
}

export interface ExposurePosition {
  pairId: string;
  chain: string;
  tokenGroup: string;
  notionalUsd: number;
}

export interface RiskOrder {
  pairId: string;
  chain: string;
  tokenGroup: string;
  side: Side;
  entry: number;
  stop: number | null;
  takeProfit: number | null;
  slippageBps: number;
  priceImpactBps: number;
  gasUsd: number;
  intent: "entry" | "exit";
}

export interface RiskContext {
  limits: RiskLimits;
  killEngaged: boolean;
  equityUsd: number;
  cashUsd: number;
  dayStartEquity: number;
  highWatermark: number;
  positions: ExposurePosition[];
  order: RiskOrder;
  dataOk: boolean;
  dataProblem?: string;
  eligible: boolean;
  overrideGates: boolean;
  mode: "paper" | "live";
}

export type RiskDecision =
  | { ok: true; notionalUsd: number; qty: number; riskUsd: number; stopDistancePct: number }
  | { ok: false; reason: string; kill: boolean };

function pctDrop(from: number, to: number): number {
  if (!(from > 0)) return 0;
  return ((from - to) / from) * 100;
}

export function assessRisk(ctx: RiskContext): RiskDecision {
  const { limits, order } = ctx;
  if (ctx.killEngaged && order.intent === "entry") {
    return { ok: false, reason: "global kill switch is engaged", kill: false };
  }
  const dailyDd = pctDrop(ctx.dayStartEquity, ctx.equityUsd);
  if (dailyDd >= limits.dailyDrawdownKillPct && order.intent === "entry") {
    return {
      ok: false,
      kill: true,
      reason: `KILL: daily drawdown ${dailyDd.toFixed(2)}% has hit the ${limits.dailyDrawdownKillPct}% limit`,
    };
  }
  const totalDd = pctDrop(ctx.highWatermark, ctx.equityUsd);
  if (totalDd >= limits.totalDrawdownKillPct && order.intent === "entry") {
    return {
      ok: false,
      kill: true,
      reason: `KILL: drawdown from the high watermark ${totalDd.toFixed(2)}% has hit the ${limits.totalDrawdownKillPct}% limit`,
    };
  }
  if (!ctx.dataOk && order.intent === "entry") {
    return { ok: false, kill: false, reason: ctx.dataProblem ?? "market data failed the circuit breaker" };
  }
  if (order.intent === "exit") {
    return { ok: true, notionalUsd: 0, qty: 0, riskUsd: 0, stopDistancePct: 0 };
  }
  if (ctx.mode === "live" && !ctx.eligible && !ctx.overrideGates) {
    return { ok: false, kill: false, reason: "strategy/pair is not eligible for live trading" };
  }
  if (order.stop == null || order.takeProfit == null) {
    return { ok: false, kill: false, reason: "a stop and a take-profit are required before entry" };
  }
  if (order.slippageBps > limits.maxSlippageBps) {
    return {
      ok: false,
      kill: false,
      reason: `estimated slippage ${order.slippageBps.toFixed(1)} bps exceeds the ${limits.maxSlippageBps} bps cap`,
    };
  }
  if (order.priceImpactBps > limits.maxPriceImpactBps) {
    return {
      ok: false,
      kill: false,
      reason: `price impact ${order.priceImpactBps.toFixed(1)} bps exceeds the ${limits.maxPriceImpactBps} bps cap`,
    };
  }
  const sized = sizePosition({
    equityUsd: ctx.equityUsd,
    cashUsd: ctx.cashUsd,
    entry: order.entry,
    stop: order.stop,
    side: order.side,
    riskPerTradePct: limits.riskPerTradePct,
    maxPositionPct: limits.maxPositionPct,
  });
  if (!sized.ok) return { ok: false, kill: false, reason: sized.reason };

  if (ctx.positions.length >= limits.maxConcurrentPositions) {
    return { ok: false, kill: false, reason: `already at the maximum of ${limits.maxConcurrentPositions} open positions` };
  }
  const chainExposure = ctx.positions.filter((p) => p.chain === order.chain).reduce((s, p) => s + p.notionalUsd, 0);
  if ((chainExposure + sized.notionalUsd) / ctx.equityUsd * 100 > limits.maxChainExposurePct) {
    return { ok: false, kill: false, reason: `${order.chain} exposure would exceed ${limits.maxChainExposurePct}% of equity` };
  }
  const tokenExposure = ctx.positions.filter((p) => p.tokenGroup === order.tokenGroup).reduce((s, p) => s + p.notionalUsd, 0);
  if ((tokenExposure + sized.notionalUsd) / ctx.equityUsd * 100 > limits.maxTokenExposurePct) {
    return { ok: false, kill: false, reason: `${order.tokenGroup} exposure would exceed ${limits.maxTokenExposurePct}% of equity` };
  }

  const tpDist = Math.abs(order.takeProfit - order.entry) / order.entry;
  const win = limits.conservativeWinRate;
  const grossEdgeUsd = sized.notionalUsd * (win * tpDist - (1 - win) * sized.stopDistancePct);
  if (!(grossEdgeUsd > 0)) {
    return {
      ok: false,
      kill: false,
      reason: `conservative expected edge is $${grossEdgeUsd.toFixed(2)} at a ${win} win-rate prior`,
    };
  }
  const gasShare = (order.gasUsd / grossEdgeUsd) * 100;
  if (gasShare > limits.maxGasEdgePct) {
    return {
      ok: false,
      kill: false,
      reason: `gas $${order.gasUsd.toFixed(2)} is ${gasShare.toFixed(0)}% of expected edge, above the ${limits.maxGasEdgePct}% limit`,
    };
  }
  return { ...sized, ok: true };
}

export function estimateSlippageBps(
  notionalUsd: number,
  barVolumeUsd: number,
  baseSlippageBps: number,
  impactCoeff: number,
): number {
  const vol = Math.max(barVolumeUsd, 1);
  const impact = impactCoeff * Math.sqrt(Math.max(notionalUsd, 0) / vol) * 10_000;
  return baseSlippageBps + impact;
}

export function slippedPrice(raw: number, side: Side, isBuy: boolean, slippageBps: number): number {
  const slip = Math.max(0, slippageBps) / 10_000;
  const adverseUp = (side === "long" && isBuy) || (side === "short" && !isBuy);
  return adverseUp ? raw * (1 + slip) : raw * (1 - slip);
}
