import { adx, atr, bollinger, donchianPrior, ema, priorSma, rsi } from "./indicators";
import type { StrategyParams } from "./params";
import type { Bar, Regime, Side, StrategyId } from "./types";

export interface IndicatorSnapshot {
  emaFast: number | null;
  emaSlow: number | null;
  adx: number | null;
  rsi: number | null;
  atr: number | null;
  atrPct: number | null;
  bbMid: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  donchianHigh: number | null;
  donchianLow: number | null;
  volSma: number | null;
  close: number;
}

export interface Series {
  bars: Bar[];
  emaFast: (number | null)[];
  emaSlow: (number | null)[];
  rsi: (number | null)[];
  atr: (number | null)[];
  adx: (number | null)[];
  bbMid: (number | null)[];
  bbUpper: (number | null)[];
  bbLower: (number | null)[];
  donchianHigh: (number | null)[];
  donchianLow: (number | null)[];
  volSma: (number | null)[];
}

export interface OpenState {
  side: Side;
  strategy: StrategyId;
  barsHeld: number;
  entry: number;
}

export interface Signal {
  action: "enter_long" | "exit_long" | "enter_short" | "exit_short" | "hold";
  strategy: StrategyId | null;
  regime: Regime;
  stop: number | null;
  takeProfit: number | null;
  trailingAtrMult: number | null;
  maxHoldBars: number | null;
  reason: string;
  indicators: IndicatorSnapshot;
}

export function computeSeries(bars: Bar[], params: StrategyParams): Series {
  const closes = bars.map((b) => b.c);
  const volumes = bars.map((b) => b.v);
  const bb = bollinger(closes, params.meanReversion.bbPeriod, params.meanReversion.bbStd);
  const don = donchianPrior(bars, params.breakout.lookback);
  return {
    bars,
    emaFast: ema(closes, params.trend.fast),
    emaSlow: ema(closes, params.trend.slow),
    rsi: rsi(closes, params.meanReversion.rsiPeriod),
    atr: atr(bars, params.trend.atrPeriod),
    adx: adx(bars, params.trend.adxPeriod),
    bbMid: bb.mid,
    bbUpper: bb.upper,
    bbLower: bb.lower,
    donchianHigh: don.high,
    donchianLow: don.low,
    volSma: priorSma(volumes, params.breakout.volLookback),
  };
}

function snapshot(series: Series, i: number): IndicatorSnapshot {
  const bar = series.bars[i];
  const close = bar?.c ?? 0;
  const atrVal = series.atr[i] ?? null;
  return {
    emaFast: series.emaFast[i] ?? null,
    emaSlow: series.emaSlow[i] ?? null,
    adx: series.adx[i] ?? null,
    rsi: series.rsi[i] ?? null,
    atr: atrVal,
    atrPct: atrVal != null && close > 0 ? (atrVal / close) * 100 : null,
    bbMid: series.bbMid[i] ?? null,
    bbUpper: series.bbUpper[i] ?? null,
    bbLower: series.bbLower[i] ?? null,
    donchianHigh: series.donchianHigh[i] ?? null,
    donchianLow: series.donchianLow[i] ?? null,
    volSma: series.volSma[i] ?? null,
    close,
  };
}

function regimeOf(adxValue: number | null, params: StrategyParams): Regime {
  if (adxValue == null || Number.isNaN(adxValue)) return "transition";
  if (adxValue >= params.regime.trendAdx) return "trend";
  if (adxValue <= params.regime.rangeAdx) return "range";
  return "transition";
}

function hold(series: Series, i: number, regime: Regime, reason: string, strategy: StrategyId | null = null): Signal {
  return {
    action: "hold",
    strategy,
    regime,
    stop: null,
    takeProfit: null,
    trailingAtrMult: null,
    maxHoldBars: null,
    reason,
    indicators: snapshot(series, i),
  };
}

function atrOk(ind: IndicatorSnapshot, minPct: number, maxPct: number): string | null {
  if (ind.atr == null || ind.atr <= 0 || ind.close <= 0) return "ATR not ready";
  if (ind.atrPct != null && ind.atrPct > maxPct) return `volatility ${ind.atrPct.toFixed(2)}% is above the ${maxPct}% circuit`;
  if (ind.atrPct != null && ind.atrPct < minPct) return `volatility ${ind.atrPct.toFixed(2)}% is below the ${minPct}% activity filter`;
  return null;
}

function protective(close: number, atrValue: number, side: Side, stopMult: number, tpMult: number): { stop: number; takeProfit: number } | null {
  if (!(atrValue > 0) || !(close > 0)) return null;
  if (side === "long") {
    const stop = close - stopMult * atrValue;
    const takeProfit = close + tpMult * atrValue;
    if (stop <= 0 || stop >= close || takeProfit <= close) return null;
    return { stop, takeProfit };
  }
  const stop = close + stopMult * atrValue;
  const takeProfit = close - tpMult * atrValue;
  if (takeProfit <= 0 || stop <= close) return null;
  return { stop, takeProfit };
}

function trendSignal(series: Series, i: number, params: StrategyParams, side: Side): Signal | null {
  const ind = snapshot(series, i);
  const regime = regimeOf(ind.adx, params);
  const blocked = atrOk(ind, params.trend.minAtrPct, params.trend.maxAtrPct);
  if (blocked) return null;
  if (ind.adx == null || ind.adx < params.trend.adxMin) return null;
  if (ind.emaFast == null || ind.emaSlow == null) return null;
  const prevClose = series.bars[i - 1]?.c;
  const prevFast = series.emaFast[i - 1];
  if (prevClose == null || prevFast == null) return null;
  const levels = protective(ind.close, ind.atr ?? 0, side, params.trend.stopAtr, params.trend.tpAtr);
  if (!levels) return null;
  if (side === "long") {
    const trendUp = ind.emaFast > ind.emaSlow;
    const reclaimed = prevClose <= prevFast && ind.close > ind.emaFast;
    if (!trendUp || !reclaimed) return null;
    return {
      action: "enter_long",
      strategy: "trend",
      regime,
      stop: levels.stop,
      takeProfit: levels.takeProfit,
      trailingAtrMult: params.trend.trailAtr,
      maxHoldBars: params.trend.maxHold,
      reason: `trend long: fast EMA reclaimed while slow EMA is below and ADX ${ind.adx.toFixed(1)} >= ${params.trend.adxMin}`,
      indicators: ind,
    };
  }
  const trendDown = ind.emaFast < ind.emaSlow;
  const lost = prevClose >= prevFast && ind.close < ind.emaFast;
  if (!trendDown || !lost) return null;
  return {
    action: "enter_short",
    strategy: "trend",
    regime,
    stop: levels.stop,
    takeProfit: levels.takeProfit,
    trailingAtrMult: params.trend.trailAtr,
    maxHoldBars: params.trend.maxHold,
    reason: `trend short: fast EMA lost while slow EMA is above and ADX ${ind.adx.toFixed(1)} >= ${params.trend.adxMin}`,
    indicators: ind,
  };
}

function breakoutSignal(series: Series, i: number, params: StrategyParams, side: Side): Signal | null {
  const ind = snapshot(series, i);
  const regime = regimeOf(ind.adx, params);
  const blocked = atrOk(ind, params.breakout.minAtrPct, params.breakout.maxAtrPct);
  if (blocked) return null;
  const bar = series.bars[i];
  if (!bar || ind.volSma == null || ind.volSma <= 0) return null;
  if (bar.v < params.breakout.volMult * ind.volSma) return null;
  const levels = protective(ind.close, ind.atr ?? 0, side, params.breakout.stopAtr, params.breakout.tpAtr);
  if (!levels) return null;
  if (side === "long") {
    if (ind.donchianHigh == null || ind.close <= ind.donchianHigh) return null;
    return {
      action: "enter_long",
      strategy: "breakout",
      regime,
      stop: levels.stop,
      takeProfit: levels.takeProfit,
      trailingAtrMult: params.breakout.trailAtr,
      maxHoldBars: params.breakout.maxHold,
      reason: `breakout long: close ${ind.close.toFixed(4)} through prior ${params.breakout.lookback}-bar high with volume ${ (bar.v / ind.volSma).toFixed(2) }x`,
      indicators: ind,
    };
  }
  if (ind.donchianLow == null || ind.close >= ind.donchianLow) return null;
  return {
    action: "enter_short",
    strategy: "breakout",
    regime,
    stop: levels.stop,
    takeProfit: levels.takeProfit,
    trailingAtrMult: params.breakout.trailAtr,
    maxHoldBars: params.breakout.maxHold,
    reason: `breakout short: close through prior ${params.breakout.lookback}-bar low with volume confirmation`,
    indicators: ind,
  };
}

function meanSignal(series: Series, i: number, params: StrategyParams, side: Side): Signal | null {
  const ind = snapshot(series, i);
  const regime = regimeOf(ind.adx, params);
  if (ind.atr == null || ind.rsi == null || ind.bbLower == null || ind.bbUpper == null || ind.bbMid == null) return null;
  if (ind.atrPct != null && ind.atrPct > params.meanReversion.maxAtrPct) return null;
  const levels = protective(ind.close, ind.atr, side, params.meanReversion.stopAtr, params.meanReversion.stopAtr);
  if (!levels) return null;
  if (side === "long") {
    if (!(ind.close < ind.bbLower && ind.rsi <= params.meanReversion.oversold)) return null;
    const takeProfit = ind.bbMid > ind.close ? ind.bbMid : levels.takeProfit;
    return {
      action: "enter_long",
      strategy: "mean_reversion",
      regime,
      stop: levels.stop,
      takeProfit,
      trailingAtrMult: null,
      maxHoldBars: params.meanReversion.maxHold,
      reason: `mean reversion long: RSI ${ind.rsi.toFixed(1)} and close below the lower Bollinger band, target the midline`,
      indicators: ind,
    };
  }
  if (!(ind.close > ind.bbUpper && ind.rsi >= params.meanReversion.overbought)) return null;
  const takeProfit = ind.bbMid < ind.close ? ind.bbMid : levels.takeProfit;
  return {
    action: "enter_short",
    strategy: "mean_reversion",
    regime,
    stop: levels.stop,
    takeProfit,
    trailingAtrMult: null,
    maxHoldBars: params.meanReversion.maxHold,
    reason: `mean reversion short: RSI ${ind.rsi.toFixed(1)} and close above the upper Bollinger band`,
    indicators: ind,
  };
}

function exitFor(series: Series, i: number, open: OpenState, params: StrategyParams, regime: Regime): Signal | null {
  const ind = snapshot(series, i);
  const action = open.side === "long" ? "exit_long" : "exit_short";
  const base = {
    strategy: open.strategy,
    regime,
    stop: null,
    takeProfit: null,
    trailingAtrMult: null,
    maxHoldBars: null,
    indicators: ind,
  } as const;
  if (open.strategy === "trend") {
    if (ind.emaFast == null || ind.emaSlow == null) return null;
    if (open.side === "long" && (ind.close < ind.emaFast || ind.emaFast < ind.emaSlow)) {
      return { ...base, action, reason: "trend exit: close lost the fast EMA or the fast/slow stack flipped" };
    }
    if (open.side === "short" && (ind.close > ind.emaFast || ind.emaFast > ind.emaSlow)) {
      return { ...base, action, reason: "trend exit: close reclaimed the fast EMA or the stack flipped" };
    }
  }
  if (open.strategy === "breakout") {
    if (ind.emaFast == null) return null;
    if (open.side === "long" && ind.close < ind.emaFast) {
      return { ...base, action, reason: "breakout exit: close fell back through the fast EMA" };
    }
    if (open.side === "short" && ind.close > ind.emaFast) {
      return { ...base, action, reason: "breakout exit: close reclaimed the fast EMA" };
    }
  }
  if (open.strategy === "mean_reversion") {
    if (ind.bbMid == null || ind.rsi == null) return null;
    if (open.side === "long" && (ind.close >= ind.bbMid || ind.rsi >= params.meanReversion.exitRsi)) {
      return { ...base, action, reason: "mean reversion exit: price returned to the midline or RSI normalized" };
    }
    if (open.side === "short" && (ind.close <= ind.bbMid || ind.rsi <= 100 - params.meanReversion.exitRsi)) {
      return { ...base, action, reason: "mean reversion exit: price returned to the midline or RSI normalized" };
    }
  }
  return null;
}

/** Causal signal at bar i. Uses only data at indexes <= i. */
export function signalAt(series: Series, i: number, open: OpenState | null, params: StrategyParams): Signal {
  const ind = snapshot(series, i);
  const regime = regimeOf(ind.adx, params);
  if (!series.bars[i]) return hold(series, i, regime, "missing bar");
  if (open) {
    const exit = exitFor(series, i, open, params, regime);
    if (exit) return exit;
    return hold(series, i, regime, `${open.strategy} ${open.side} still open (${open.barsHeld} bars)`, open.strategy);
  }

  const want = (id: StrategyId): boolean => params.enabled[id] && (params.force == null || params.force === id);
  const allow = (id: StrategyId, needed: Regime): boolean => {
    if (!want(id)) return false;
    if (params.force === id) return true;
    return regime === needed;
  };

  if (allow("trend", "trend")) {
    const long = trendSignal(series, i, params, "long");
    if (long) return long;
    const short = trendSignal(series, i, params, "short");
    if (short) return short;
  }
  if (allow("breakout", "trend")) {
    const long = breakoutSignal(series, i, params, "long");
    if (long) return long;
    const short = breakoutSignal(series, i, params, "short");
    if (short) return short;
  }
  if (allow("mean_reversion", "range")) {
    const long = meanSignal(series, i, params, "long");
    if (long) return long;
    const short = meanSignal(series, i, params, "short");
    if (short) return short;
  }

  if (regime === "transition" && params.force == null) {
    return hold(series, i, regime, `no new entries: ADX ${ind.adx == null ? "not ready" : ind.adx.toFixed(1)} is between the range and trend thresholds`);
  }
  if (regime === "trend" && params.force == null) {
    return hold(series, i, regime, "trend regime, no EMA pullback or volume-confirmed breakout");
  }
  if (regime === "range" && params.force == null) {
    return hold(series, i, regime, "range regime, price is not stretched to a Bollinger extreme");
  }
  return hold(series, i, regime, "no setup");
}
