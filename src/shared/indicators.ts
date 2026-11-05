import type { Bar } from "./types";

export function ema(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: values.length }, () => null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += values[i] ?? 0;
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i += 1) {
    const v = values[i] ?? prev;
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function sma(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: values.length }, () => null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i] ?? 0;
    if (i >= period) sum -= values[i - period] ?? 0;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function rsiFrom(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Wilder RSI. Index `period` is the first value. */
export function rsi(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: values.length }, () => null);
  if (period <= 0 || values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = (values[i] ?? 0) - (values[i - 1] ?? 0);
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = rsiFrom(avgGain, avgLoss);
  for (let i = period + 1; i < values.length; i += 1) {
    const diff = (values[i] ?? 0) - (values[i - 1] ?? 0);
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = rsiFrom(avgGain, avgLoss);
  }
  return out;
}

export function trueRange(bars: readonly Bar[]): number[] {
  const tr: number[] = [];
  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i];
    if (!b) {
      tr.push(0);
      continue;
    }
    if (i === 0) {
      tr.push(b.h - b.l);
      continue;
    }
    const p = bars[i - 1];
    const prevClose = p?.c ?? b.c;
    tr.push(Math.max(b.h - b.l, Math.abs(b.h - prevClose), Math.abs(b.l - prevClose)));
  }
  return tr;
}

/** Wilder ATR. First value at index `period`. */
export function atr(bars: readonly Bar[], period: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: bars.length }, () => null);
  if (period <= 0 || bars.length <= period) return out;
  const tr = trueRange(bars);
  let sum = 0;
  for (let i = 1; i <= period; i += 1) sum += tr[i] ?? 0;
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i += 1) {
    prev = (prev * (period - 1) + (tr[i] ?? 0)) / period;
    out[i] = prev;
  }
  return out;
}

/**
 * Wilder ADX. First value lands near index `2 * period`.
 * Returns null until the seed window is complete.
 */
export function adx(bars: readonly Bar[], period: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: bars.length }, () => null);
  if (period <= 0 || bars.length <= period * 2) return out;
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const b = bars[i];
    const p = bars[i - 1];
    if (!b || !p) continue;
    const up = b.h - p.h;
    const down = p.l - b.l;
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)));
  }
  let trS = 0;
  let pS = 0;
  let mS = 0;
  for (let i = 0; i < period; i += 1) {
    trS += tr[i] ?? 0;
    pS += plusDm[i] ?? 0;
    mS += minusDm[i] ?? 0;
  }
  const dx: number[] = [];
  const dxBar: number[] = [];
  const push = (barIndex: number, trSmooth: number, plusSmooth: number, minusSmooth: number) => {
    if (trSmooth <= 0) dx.push(0);
    else {
      const plus = (100 * plusSmooth) / trSmooth;
      const minus = (100 * minusSmooth) / trSmooth;
      const denom = plus + minus;
      dx.push(denom === 0 ? 0 : (100 * Math.abs(plus - minus)) / denom);
    }
    dxBar.push(barIndex);
  };
  push(period, trS, pS, mS);
  for (let i = period; i < tr.length; i += 1) {
    trS = trS - trS / period + (tr[i] ?? 0);
    pS = pS - pS / period + (plusDm[i] ?? 0);
    mS = mS - mS / period + (minusDm[i] ?? 0);
    push(i + 1, trS, pS, mS);
  }
  if (dx.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += dx[i] ?? 0;
  let value = seed / period;
  const first = dxBar[period - 1];
  if (first !== undefined) out[first] = value;
  for (let i = period; i < dx.length; i += 1) {
    value = (value * (period - 1) + (dx[i] ?? 0)) / period;
    const idx = dxBar[i];
    if (idx !== undefined) out[idx] = value;
  }
  return out;
}

export function bollinger(
  values: readonly number[],
  period: number,
  mult: number,
): { mid: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
  const mid: (number | null)[] = Array.from({ length: values.length }, () => null);
  const upper: (number | null)[] = Array.from({ length: values.length }, () => null);
  const lower: (number | null)[] = Array.from({ length: values.length }, () => null);
  if (period <= 1) return { mid, upper, lower };
  for (let i = period - 1; i < values.length; i += 1) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j += 1) sum += values[j] ?? 0;
    const mean = sum / period;
    let ss = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const d = (values[j] ?? 0) - mean;
      ss += d * d;
    }
    const sd = Math.sqrt(ss / period);
    mid[i] = mean;
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { mid, upper, lower };
}

/** Highest high / lowest low of the prior `lookback` bars, excluding the current bar. */
export function donchianPrior(
  bars: readonly Bar[],
  lookback: number,
): { high: (number | null)[]; low: (number | null)[] } {
  const high: (number | null)[] = Array.from({ length: bars.length }, () => null);
  const low: (number | null)[] = Array.from({ length: bars.length }, () => null);
  if (lookback <= 0) return { high, low };
  for (let i = lookback; i < bars.length; i += 1) {
    let hh = Number.NEGATIVE_INFINITY;
    let ll = Number.POSITIVE_INFINITY;
    for (let j = i - lookback; j < i; j += 1) {
      const b = bars[j];
      if (!b) continue;
      if (b.h > hh) hh = b.h;
      if (b.l < ll) ll = b.l;
    }
    high[i] = hh;
    low[i] = ll;
  }
  return { high, low };
}

/** Average of the prior `period` values, excluding the current index. */
export function priorSma(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array.from({ length: values.length }, () => null);
  if (period <= 0) return out;
  for (let i = period; i < values.length; i += 1) {
    let sum = 0;
    for (let j = i - period; j < i; j += 1) sum += values[j] ?? 0;
    out[i] = sum / period;
  }
  return out;
}
