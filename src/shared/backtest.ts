import { DEFAULT_RISK } from "./params";
import type { StrategyParams } from "./params";
import { assessRisk, estimateSlippageBps, slippedPrice } from "./risk";
import { computeSeries, signalAt, type OpenState, type Signal } from "./strategy";
import type { Bar, EquityPoint, Side, SimTrade, StrategyId, Venue } from "./types";
import { computeMetrics, equityCurveFromMarks } from "./metrics";
import type { Metrics } from "./types";

export interface CostModel {
  feeBps: number;
  gasUsd: number;
  baseSlippageBps: number;
  impactCoeff: number;
  /** Constant funding drag for perp inventory, in bps per 8 hours. Not historical funding. */
  fundingBpsPer8h: number;
  allowPerpShort: boolean;
  venueForShort: Venue;
}

export interface SimPosition {
  side: Side;
  strategy: StrategyId;
  venue: Venue;
  qty: number;
  entryPx: number;
  entryRaw: number;
  stop: number;
  takeProfit: number;
  trailingAtrMult: number | null;
  maxHold: number;
  barsHeld: number;
  openedIndex: number;
  extreme: number;
  fees: number;
  gas: number;
  slippageUsd: number;
  margin: number;
  notional: number;
}

export interface SimResult {
  trades: SimTrade[];
  equity: EquityPoint[];
  metrics: Metrics;
  skipped: { reason: string; count: number }[];
}

export interface SimulateArgs {
  bars: Bar[];
  params: StrategyParams;
  costs: CostModel;
  startEquity?: number;
  /** First index allowed to open a new trade. */
  recordFrom?: number;
  recordTo?: number;
  signalFn?: (i: number, open: OpenState | null) => Signal;
}

function fee(notional: number, feeBps: number): number {
  return (notional * feeBps) / 10_000;
}

function markEquity(cash: number, pos: SimPosition | null, price: number): number {
  if (!pos) return cash;
  if (pos.venue === "spot") return cash + pos.qty * price;
  const unrealized = pos.side === "long" ? (price - pos.entryPx) * pos.qty : (pos.entryPx - price) * pos.qty;
  return cash + pos.margin + unrealized;
}

function closePosition(
  pos: SimPosition,
  exitRaw: number,
  exitIndex: number,
  bars: Bar[],
  costs: CostModel,
  reason: string,
  slippageCap: number,
): { trade: SimTrade; cashDelta: number } {
  const bar = bars[exitIndex];
  const volume = bar?.v ?? 0;
  const slipBps = Math.min(
    slippageCap,
    estimateSlippageBps(pos.notional, volume, costs.baseSlippageBps, costs.impactCoeff),
  );
  const isBuy = pos.side === "short";
  const exitPx = slippedPrice(exitRaw, pos.side, isBuy, slipBps);
  const exitNotional = pos.qty * exitPx;
  const exitFee = fee(exitNotional, costs.feeBps);
  const slipUsd = Math.abs(exitPx - exitRaw) * pos.qty;
  const entryTime = bars[pos.openedIndex]?.t ?? 0;
  const exitTime = bar?.t ?? entryTime;
  let pnl: number;
  let cashDelta: number;
  if (pos.venue === "spot") {
    cashDelta = exitNotional - exitFee - costs.gasUsd;
    pnl = (exitPx - pos.entryPx) * pos.qty - pos.fees - exitFee - pos.gas - costs.gasUsd;
  } else {
    const unrealized = pos.side === "long" ? (exitPx - pos.entryPx) * pos.qty : (pos.entryPx - exitPx) * pos.qty;
    cashDelta = pos.margin + unrealized - exitFee - costs.gasUsd;
    pnl = unrealized - pos.fees - exitFee - pos.gas - costs.gasUsd;
  }
  return {
    cashDelta,
    trade: {
      side: pos.side,
      strategy: pos.strategy,
      venue: pos.venue,
      entryTime,
      exitTime,
      entryPx: pos.entryPx,
      exitPx,
      qty: pos.qty,
      notionalUsd: pos.notional,
      pnlUsd: pnl,
      feesUsd: pos.fees + exitFee,
      gasUsd: pos.gas + costs.gasUsd,
      slippageUsd: pos.slippageUsd + slipUsd,
      barsHeld: pos.barsHeld,
      reason,
    },
  };
}

function stopHit(pos: SimPosition, bar: Bar): { raw: number; reason: string } | null {
  if (pos.side === "long") {
    const stopped = bar.o <= pos.stop || bar.l <= pos.stop;
    const targeted = bar.o >= pos.takeProfit || bar.h >= pos.takeProfit;
    if (bar.o <= pos.stop) return { raw: bar.o, reason: "stop gap" };
    if (stopped && targeted) return { raw: pos.stop, reason: "stop (both levels touched; stop fills first)" };
    if (stopped) return { raw: pos.stop, reason: "stop" };
    if (bar.o >= pos.takeProfit) return { raw: bar.o, reason: "take-profit gap" };
    if (targeted) return { raw: pos.takeProfit, reason: "take-profit" };
    return null;
  }
  const stopped = bar.o >= pos.stop || bar.h >= pos.stop;
  const targeted = bar.o <= pos.takeProfit || bar.l <= pos.takeProfit;
  if (bar.o >= pos.stop) return { raw: bar.o, reason: "stop gap" };
  if (stopped && targeted) return { raw: pos.stop, reason: "stop (both levels touched; stop fills first)" };
  if (stopped) return { raw: pos.stop, reason: "stop" };
  if (bar.o <= pos.takeProfit) return { raw: bar.o, reason: "take-profit gap" };
  if (targeted) return { raw: pos.takeProfit, reason: "take-profit" };
  return null;
}

export function simulate(args: SimulateArgs): SimResult {
  const { bars, params, costs } = args;
  const startEquity = args.startEquity ?? 10_000;
  const recordFrom = args.recordFrom ?? 0;
  const recordTo = args.recordTo ?? bars.length;
  const limits = DEFAULT_RISK;
  const series = computeSeries(bars, params);
  const signalFn = args.signalFn ?? ((i: number, open: OpenState | null) => signalAt(series, i, open, params));

  let cash = startEquity;
  let pos: SimPosition | null = null;
  let pending: { kind: "enter" | "exit"; signal: Signal; from: number } | null = null;
  const trades: SimTrade[] = [];
  const marks: { t: number; equity: number }[] = [];
  const skipCounts = new Map<string, number>();
  let barsInMarket = 0;
  const skip = (reason: string) => skipCounts.set(reason, (skipCounts.get(reason) ?? 0) + 1);

  const bumpFunding = (bar: Bar) => {
    if (!pos || pos.venue !== "perp") return;
    const drag = (pos.notional * costs.fundingBpsPer8h) / 10_000 / 8;
    cash -= drag;
    pos.fees += drag;
    void bar;
  };

  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    if (!bar) continue;

    if (pending && pending.from === i - 1) {
      if (pending.kind === "exit" && pos) {
        const closed = closePosition(pos, bar.o, i, bars, costs, pending.signal.reason, limits.emergencyExitSlippageBps);
        cash += closed.cashDelta;
        if (pos.openedIndex >= recordFrom && pos.openedIndex < recordTo) trades.push(closed.trade);
        pos = null;
      } else if (pending.kind === "enter" && !pos && pending.signal.stop != null && pending.signal.takeProfit != null && pending.signal.strategy) {
        const side: Side = pending.signal.action === "enter_short" ? "short" : "long";
        const wantPerp: boolean = side === "short";
        if (wantPerp && !costs.allowPerpShort) {
          skip("short signal on a spot-only market; stayed flat");
        } else {
          const venue: Venue = wantPerp ? "perp" : "spot";
          const probeNotional = Math.min(startEquity * (limits.maxPositionPct / 100), cash);
          const slipBps = estimateSlippageBps(probeNotional, bar.v, costs.baseSlippageBps, costs.impactCoeff);
          const entryPx = slippedPrice(bar.o, side, side === "long", Math.min(slipBps, limits.maxSlippageBps));
          const equityNow = markEquity(cash, null, entryPx);
          const decision = assessRisk({
            limits,
            killEngaged: false,
            equityUsd: equityNow,
            cashUsd: cash,
            dayStartEquity: equityNow,
            highWatermark: equityNow,
            positions: [],
            order: {
              pairId: "sim",
              chain: "sim",
              tokenGroup: "sim",
              side,
              entry: entryPx,
              stop: pending.signal.stop,
              takeProfit: pending.signal.takeProfit,
              slippageBps: slipBps,
              priceImpactBps: slipBps,
              gasUsd: costs.gasUsd,
              intent: "entry",
            },
            dataOk: true,
            eligible: true,
            overrideGates: true,
            mode: "paper",
          });
          if (!decision.ok) skip(decision.reason);
          else if (i >= recordFrom && i < recordTo) {
            const notional = decision.notionalUsd;
            const qty = notional / entryPx;
            const entryFee = fee(notional, costs.feeBps);
            const margin = notional;
            if (venue === "spot") cash -= notional + entryFee + costs.gasUsd;
            else cash -= margin + entryFee + costs.gasUsd;
            const slipUsd = Math.abs(entryPx - bar.o) * qty;
            pos = {
              side,
              strategy: pending.signal.strategy,
              venue,
              qty,
              entryPx,
              entryRaw: bar.o,
              stop: pending.signal.stop,
              takeProfit: pending.signal.takeProfit,
              trailingAtrMult: pending.signal.trailingAtrMult,
              maxHold: pending.signal.maxHoldBars ?? 48,
              barsHeld: 0,
              openedIndex: i,
              extreme: side === "long" ? bar.h : bar.l,
              fees: entryFee,
              gas: costs.gasUsd,
              slippageUsd: slipUsd,
              margin,
              notional,
            };
          } else {
            skip("signal outside the recorded window");
          }
        }
      }
      pending = null;
    }

    if (pos && pos.openedIndex <= i) {
      barsInMarket += 1;
      const hit = stopHit(pos, bar);
      if (hit && pos.openedIndex < i) {
        const closed = closePosition(pos, hit.raw, i, bars, costs, hit.reason, limits.emergencyExitSlippageBps);
        cash += closed.cashDelta;
        if (pos.openedIndex >= recordFrom && pos.openedIndex < recordTo) trades.push(closed.trade);
        pos = null;
      } else if (pos) {
        // Same-bar stop after an open fill: the position was opened at the open, so the bar's range is live.
        if (pos.openedIndex === i) {
          const same = stopHit(pos, bar);
          if (same) {
            const closed = closePosition(pos, same.raw, i, bars, costs, same.reason, limits.emergencyExitSlippageBps);
            cash += closed.cashDelta;
            if (pos.openedIndex >= recordFrom && pos.openedIndex < recordTo) trades.push(closed.trade);
            pos = null;
          }
        }
      }
    }

    if (pos) {
      pos.barsHeld += pos.openedIndex === i ? 0 : 1;
      if (pos.side === "long") pos.extreme = Math.max(pos.extreme, bar.h);
      else pos.extreme = Math.min(pos.extreme, bar.l);
      const atrNow = series.atr[i];
      if (atrNow && pos.trailingAtrMult && pos.openedIndex < i) {
        if (pos.side === "long") pos.stop = Math.max(pos.stop, pos.extreme - pos.trailingAtrMult * atrNow);
        else pos.stop = Math.min(pos.stop, pos.extreme + pos.trailingAtrMult * atrNow);
      }
      bumpFunding(bar);
      const openState: OpenState = {
        side: pos.side,
        strategy: pos.strategy,
        barsHeld: pos.barsHeld,
        entry: pos.entryPx,
      };
      const sig = signalFn(i, openState);
      const wantsExit = sig.action === "exit_long" || sig.action === "exit_short" || pos.barsHeld >= pos.maxHold;
      if (wantsExit && i + 1 < bars.length) {
        pending = {
          kind: "exit",
          from: i,
          signal: pos.barsHeld >= pos.maxHold && sig.action === "hold"
            ? { ...sig, action: pos.side === "long" ? "exit_long" : "exit_short", reason: `time exit after ${pos.maxHold} bars` }
            : sig,
        };
      }
      if (i === recordTo - 1) {
        const closed = closePosition(pos, bar.c, i, bars, costs, "window flatten", limits.emergencyExitSlippageBps);
        cash += closed.cashDelta;
        if (pos.openedIndex >= recordFrom && pos.openedIndex < recordTo) trades.push(closed.trade);
        pos = null;
        pending = null;
      }
    } else if (i >= recordFrom && i < recordTo && i + 1 < bars.length) {
      const sig = signalFn(i, null);
      if (sig.action === "enter_long" || sig.action === "enter_short") {
        pending = { kind: "enter", from: i, signal: sig };
      }
    }

    const px = bar.c;
    marks.push({ t: bar.t, equity: markEquity(cash, pos, px) });
  }

  if (pos) {
    const last = bars.length - 1;
    const bar = bars[last];
    if (bar) {
      const closed = closePosition(pos, bar.c, last, bars, costs, "end of sample flatten", limits.emergencyExitSlippageBps);
      cash += closed.cashDelta;
      if (pos.openedIndex >= recordFrom && pos.openedIndex < recordTo) trades.push(closed.trade);
      marks[marks.length - 1] = { t: bar.t, equity: cash };
    }
  }

  const equity = equityCurveFromMarks(marks);
  const observed = Math.max(0, Math.min(bars.length, recordTo) - recordFrom);
  return {
    trades,
    equity,
    metrics: computeMetrics(trades, equity, barsInMarket, observed),
    skipped: [...skipCounts.entries()].map(([reason, count]) => ({ reason, count })),
  };
}

export function sanitizeBars(bars: readonly Bar[]): { bars: Bar[]; dropped: number } {
  const cleaned: Bar[] = [];
  let dropped = 0;
  for (const bar of bars) {
    if (!(bar.o > 0 && bar.h > 0 && bar.l > 0 && bar.c > 0)) {
      dropped += 1;
      continue;
    }
    if (bar.h < Math.max(bar.o, bar.c) || bar.l > Math.min(bar.o, bar.c) || bar.l > bar.h) {
      dropped += 1;
      continue;
    }
    cleaned.push({ t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: Math.max(0, bar.v) });
  }
  cleaned.sort((a, b) => a.t - b.t);
  const dedup: Bar[] = [];
  for (const bar of cleaned) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.t === bar.t) dedup[dedup.length - 1] = bar;
    else dedup.push(bar);
  }
  return { bars: dedup, dropped };
}

export function closedBars(bars: readonly Bar[], nowMs: number, timeframeSec = 3600): Bar[] {
  const nowSec = Math.floor(nowMs / 1000);
  return bars.filter((b) => b.t + timeframeSec <= nowSec);
}
