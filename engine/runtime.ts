import { existsSync } from "node:fs";
import path from "node:path";
import { researchSleeve, type PaperStats, type SleeveReport } from "../src/shared/gates";
import { DEFAULT_GATES } from "../src/shared/params";
import { assessRisk, estimateSlippageBps, slippedPrice } from "../src/shared/risk";
import { computeSeries, signalAt, type Signal } from "../src/shared/strategy";
import type { ChainId, StrategyId, TradingMode } from "../src/shared/types";
import { deliverAlert } from "./alerts";
import { renderBanner } from "./banner";
import {
  CHAINS,
  PAIRS,
  chainById,
  endpointsForChain,
  pairById,
  resolveSettings,
  shortMode,
  type PairConfig,
  type RuntimeSettings,
  type UiOverrides,
} from "./config";
import type { Store, TradeRow } from "./db";
import type { EvmAdapter } from "./evm";
import type { Hyperliquid } from "./hyperliquid";
import type { LiveBroker } from "./live";
import { logger } from "./log";
import type { MarketData } from "./market";
import { redactUrl, RpcPool, type RpcEndpoint } from "./rpc/pool";
import type { SolanaAdapter } from "./solana";
import { ASSUMPTIONS } from "../src/shared/types";
import { resolveKey } from "./keys";

export interface ChainBalance {
  native: string | null;
  nativeSymbol: string;
  quote: string | null;
  quoteSymbol: string | null;
  error: string | null;
}

function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${frac ? `.${frac}` : ""}`;
}

export interface PairView {
  id: string;
  label: string;
  chain: ChainId;
  enabled: boolean;
  dex: string;
  feeBps: number;
  shortMode: "hyperliquid-perp" | "spot-flat";
  perpCoin: string | null;
  price: number | null;
  regime: string | null;
  indicators: { adx: number | null; rsi: number | null; emaFast: number | null; emaSlow: number | null; atr: number | null };
  lastSignal: string | null;
  eligibility: string;
}

export interface EngineSnapshot {
  now: number;
  banner: string;
  engine: {
    running: boolean;
    mode: TradingMode;
    modeSource: string;
    kill: { engaged: boolean; reason: string | null; source: string | null };
    loopIntervalMs: number;
    iteration: number;
    lastLoopAt: number | null;
    lastError: string | null;
    liveBlocked: string[];
    paperEquity: number;
    dayPnl: number;
    drawdownPct: number;
    reconciled: string[];
  };
  settings: RuntimeSettings;
  assumptions: string[];
  chains: unknown[];
  pairs: PairView[];
  positions: TradeRow[];
  trades: TradeRow[];
  decisions: unknown[];
  equity: { t: number; equity: number; drawdownPct: number }[];
  alerts: { id: number; ts: number; level: string; title: string; body: string }[];
  backtest: { id: string; createdAt: number; status: string; error: string | null } | null;
  researchRunning: boolean;
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class TradingRuntime {
  running = false;
  iteration = 0;
  lastError: string | null = null;
  lastLoopAt: number | null = null;
  startedAt: number | null = null;
  researchRunning = false;
  reconciled: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly marks = new Map<string, number>();
  private readonly regimes = new Map<string, PairView["indicators"] & { regime: string; signal: string }>();
  private readonly acted = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private readonly balances = new Map<string, ChainBalance>();
  private readonly rawBalances = new Map<string, bigint>();

  constructor(
    private readonly store: Store,
    private readonly dataDir: string,
    private readonly market: MarketData,
    private readonly pools: Map<ChainId, RpcPool>,
    private readonly evm: Map<ChainId, EvmAdapter>,
    private readonly solana: SolanaAdapter | null,
    private readonly perps: Hyperliquid,
    private readonly live: LiveBroker,
    private readonly master: Buffer,
    private readonly now: () => number = () => Date.now(),
  ) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    this.emit();
  }

  reloadRpc(chainId: ChainId): void {
    const pool = this.pools.get(chainId);
    if (!pool) throw new Error(`${chainId} has no RPC pool to update`);
    const endpoints: RpcEndpoint[] = endpointsForChain(chainId, this.store.overrides()).map((ep) => ({
      id: ep.id,
      provider: ep.provider,
      url: ep.url,
      priority: ep.priority,
      source: ep.source,
    }));
    pool.replaceEndpoints(endpoints);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  settings(): RuntimeSettings {
    return resolveSettings(this.store.overrides());
  }

  killState(): { engaged: boolean; reason: string | null; source: string | null } {
    if (process.env.KILL_SWITCH === "true") return { engaged: true, reason: "KILL_SWITCH=true", source: "env" };
    if (existsSync(path.join(this.dataDir, "KILL"))) return { engaged: true, reason: "data/KILL file is present", source: "file" };
    const raw = this.store.meta("kill");
    if (!raw) return { engaged: false, reason: null, source: null };
    return JSON.parse(raw) as { engaged: boolean; reason: string | null; source: string | null };
  }

  setKill(engaged: boolean, reason: string, source: "ui" | "drawdown"): void {
    if (!engaged && (process.env.KILL_SWITCH === "true" || existsSync(path.join(this.dataDir, "KILL")))) {
      throw new Error("The kill switch is held by the environment or data/KILL. Clear that before re-arming.");
    }
    this.store.setMeta("kill", JSON.stringify({ engaged, reason: engaged ? reason : null, source: engaged ? source : null }));
    this.alert(engaged ? "kill" : "info", engaged ? "Kill switch engaged" : "Kill switch cleared", reason);
    this.emit();
  }

  async start(): Promise<void> {
    if (this.running) return;
    const blocked = this.liveBlockers();
    if (this.settings().mode === "live" && blocked.length) {
      this.lastError = blocked.join("; ");
      this.alert("error", "Live trading refused", this.lastError);
      this.emit();
      return;
    }
    this.running = true;
    this.startedAt = this.now();
    this.store.setMeta("desiredRunning", "true");
    this.reconciled = await this.reconcile();
    logger.info(renderBanner(this.bannerInput()));
    this.emit();
    void this.loop();
  }

  stop(): void {
    this.halt();
    this.store.setMeta("desiredRunning", "false");
  }

  /** Stop the loop without forgetting that the operator wanted it running. Used on SIGTERM. */
  halt(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.emit();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const started = this.now();
      try {
        await this.runOnce();
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : "loop failed";
        logger.error({ err: this.lastError }, "loop iteration failed");
        this.alert("error", "Engine loop error", this.lastError);
      }
      const wait = Math.max(0, this.settings().loopIntervalMs - (this.now() - started));
      if (!this.running) break;
      await new Promise((resolve) => { this.timer = setTimeout(resolve, wait); });
    }
  }

  async runOnce(): Promise<void> {
    const settings = this.settings();
    const kill = this.killState();
    const ledger = this.store.ensureLedger(settings.mode, settings.paperStartingEquity, dayKey(this.now()));
    this.rollDay(settings.mode, ledger);
    await this.probe();
    if (kill.engaged) await this.flatten("kill switch", settings);
    const open = this.store.openTrades(settings.mode);
    for (const pair of PAIRS) {
      if (!settings.pairs[pair.id]?.enabled) continue;
      if (!settings.chains[pair.chain]?.enabled) continue;
      try {
        await this.onPair(pair, settings, kill.engaged, open.find((t) => t.pairId === pair.id) ?? null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "pair failed";
        this.decide(settings, pair, "error", false, message, {});
        this.alert("error", `${pair.id} scan failed`, message);
      }
    }
    this.markEquity(settings.mode);
    this.iteration += 1;
    this.lastLoopAt = this.now();
    this.emit();
  }

  private async onPair(pair: PairConfig, settings: RuntimeSettings, killed: boolean, open: TradeRow | null): Promise<void> {
    const chain = chainById(pair.chain);
    if (!chain) return;
    const loaded = await this.market.getBars(pair, this.now());
    const bars = loaded.bars;
    const markInfo = await this.market.getMark(pair);
    const last = bars[bars.length - 1];
    const mark = markInfo.price ?? last?.c ?? null;
    if (mark) this.marks.set(pair.id, mark);
    if (!last || bars.length < 80 || mark == null) {
      this.decide(settings, pair, "hold", false, loaded.warning ?? "not enough closed candles yet", { source: loaded.source, bars: bars.length });
      return;
    }
    const ageMin = (this.now() / 1000 - (last.t + 3600)) / 60;
    const dataProblems: string[] = [];
    if (ageMin > settings.risk.staleDataMinutes) dataProblems.push(`last closed bar is ${ageMin.toFixed(0)} minutes old`);
    const prev = bars[bars.length - 2];
    if (prev && Math.abs(last.c / prev.c - 1) * 100 > settings.risk.circuitBarMovePct) {
      dataProblems.push(`last bar moved ${((last.c / prev.c - 1) * 100).toFixed(1)}%`);
    }
    if (markInfo.price && Math.abs(markInfo.price / last.c - 1) * 100 > settings.risk.quoteDivergencePct) {
      dataProblems.push(`mark ${markInfo.price.toFixed(4)} diverges from the candle close ${last.c.toFixed(4)}`);
    }
    const pool = this.pools.get(pair.chain);
    if (settings.mode === "live" && pool && !pool.hasFreshEndpoint()) dataProblems.push(`${pair.chain} RPC has no fresh endpoint`);
    const series = computeSeries(bars, settings.strategy);
    const ind = signalAt(series, bars.length - 1, open ? { side: open.side, strategy: open.strategy as StrategyId, barsHeld: open.barsHeld, entry: open.entryPx } : null, settings.strategy);
    this.regimes.set(pair.id, {
      regime: ind.regime,
      signal: ind.reason,
      adx: ind.indicators.adx,
      rsi: ind.indicators.rsi,
      emaFast: ind.indicators.emaFast,
      emaSlow: ind.indicators.emaSlow,
      atr: ind.indicators.atr,
    });
    const dataOk = dataProblems.length === 0;
    if (open) {
      open.barsHeld = Math.max(open.barsHeld, Math.floor((this.now() - open.openedAt) / 3_600_000));
      const stopHit = open.side === "long" ? mark <= open.stopPx : mark >= open.stopPx;
      const targetHit = open.side === "long" ? mark >= open.takeProfitPx : mark <= open.takeProfitPx;
      const timedOut = open.barsHeld >= open.maxHoldBars;
      const signalExit = ind.action === "exit_long" || ind.action === "exit_short";
      if (stopHit || targetHit || timedOut || signalExit || killed) {
        const reason = killed ? "kill switch flatten"
          : stopHit ? "stop"
          : targetHit ? "take-profit"
          : timedOut ? "time exit"
          : ind.reason;
        if (!dataOk && !killed && !stopHit) {
          this.decide(settings, pair, "hold", false, `exit skipped because ${dataProblems.join("; ")}`, { signal: ind.reason });
          return;
        }
        await this.exit(open, pair, mark, reason, settings, last.v);
        return;
      }
      this.store.updateTrade(open);
      this.decide(settings, pair, "hold", false, ind.reason, { indicators: ind.indicators, regime: ind.regime });
      return;
    }
    if (killed) {
      this.decide(settings, pair, "hold", false, "kill switch is engaged; no new risk", {});
      return;
    }
    if (!settings.chains[pair.chain]?.tradingEnabled) {
      this.decide(settings, pair, "hold", false, `${chain.name} is in watch mode`, { regime: ind.regime });
      return;
    }
    if (this.acted.get(pair.id) === last.t) {
      this.decide(settings, pair, "hold", false, "this closed bar was already evaluated", { regime: ind.regime });
      return;
    }
    this.acted.set(pair.id, last.t);
    if (ind.action !== "enter_long" && ind.action !== "enter_short") {
      this.decide(settings, pair, ind.action, false, ind.reason, { indicators: ind.indicators, regime: ind.regime, data: dataProblems });
      return;
    }
    if (ind.action === "enter_short" && !pair.perpCoin) {
      this.decide(settings, pair, "enter_short", false, "spot DEX cannot open a short; the book stays flat. Hyperliquid does not list this coin.", { regime: ind.regime });
      return;
    }
    await this.enter(pair, ind, mark, last.v, settings, dataOk, dataProblems.join("; "));
  }

  private async enter(pair: PairConfig, signal: Signal, mark: number, volume: number, settings: RuntimeSettings, dataOk: boolean, dataProblem: string): Promise<void> {
    const side = signal.action === "enter_short" ? "short" : "long";
    const ledger = this.store.ledger(settings.mode);
    const open = this.store.openTrades(settings.mode);
    const equity = this.equityNow(settings.mode, open);
    const slip = estimateSlippageBps(equity * (settings.risk.maxPositionPct / 100), volume, 5, 0.1);
    const entry = slippedPrice(mark, side, side === "long", Math.min(slip, settings.risk.maxSlippageBps));
    const eligible = this.eligible(pair.id, signal.strategy);
    const decision = assessRisk({
      limits: settings.risk,
      killEngaged: this.killState().engaged,
      equityUsd: equity,
      cashUsd: ledger?.cashUsd ?? 0,
      dayStartEquity: ledger?.dayStartEquity ?? equity,
      highWatermark: ledger?.highWatermark ?? equity,
      positions: open.map((t) => ({ pairId: t.pairId, chain: t.chain, tokenGroup: t.tokenGroup, notionalUsd: t.notionalUsd })),
      order: {
        pairId: pair.id,
        chain: pair.chain,
        tokenGroup: pair.tokenGroup,
        side,
        entry,
        stop: signal.stop,
        takeProfit: signal.takeProfit,
        slippageBps: slip,
        priceImpactBps: slip,
        gasUsd: chainById(pair.chain)?.gasUsd ?? 0,
        intent: "entry",
      },
      dataOk,
      dataProblem,
      eligible,
      overrideGates: settings.overrideGates,
      mode: settings.mode,
    });
    if (!decision.ok) {
      if (decision.kill) this.setKill(true, decision.reason, "drawdown");
      this.decide(settings, pair, signal.action, false, decision.reason, { signal: signal.reason, regime: signal.regime, indicators: signal.indicators });
      return;
    }
    if (signal.stop == null || signal.takeProfit == null || signal.strategy == null) return;
    const venue = side === "short" ? "perp" : "spot";
    let fillPx = entry;
    let qty = decision.notionalUsd / entry;
    let fee = (decision.notionalUsd * pair.feeBps) / 10_000;
    let gas = chainById(pair.chain)?.gasUsd ?? 0;
    let slipUsd = Math.abs(entry - mark) * qty;
    let tx: string | null = null;
    if (settings.mode === "live") {
      const liveFill = venue === "perp"
        ? await this.live.perp(pair, side, qty, mark, false)
        : await this.live.spot(pair, "buy", decision.notionalUsd, qty, mark, settings.risk.maxSlippageBps, settings.risk.maxPriceImpactBps);
      if (liveFill.impactBps > settings.risk.maxPriceImpactBps) {
        this.decide(settings, pair, signal.action, false, `live quote impact ${liveFill.impactBps.toFixed(1)} bps is over the cap`, {});
        return;
      }
      fillPx = liveFill.price;
      qty = liveFill.qty;
      fee = liveFill.feeUsd;
      gas = liveFill.gasUsd;
      slipUsd = liveFill.slippageUsd;
      tx = liveFill.tx;
    }
    const row: TradeRow = {
      id: newId(pair.id),
      mode: settings.mode,
      chain: pair.chain,
      pairId: pair.id,
      strategy: signal.strategy,
      venue,
      side,
      qty,
      entryPx: fillPx,
      exitPx: null,
      stopPx: signal.stop,
      takeProfitPx: signal.takeProfit,
      trailingAtr: signal.trailingAtrMult,
      notionalUsd: fillPx * qty,
      feesUsd: fee,
      gasUsd: gas,
      slippageUsd: slipUsd,
      realizedPnlUsd: null,
      status: "open",
      openedAt: this.now(),
      closedAt: null,
      txOpen: tx,
      txClose: null,
      reasonOpen: signal.reason,
      reasonClose: null,
      barsHeld: 0,
      tokenGroup: pair.tokenGroup,
      maxHoldBars: signal.maxHoldBars ?? 48,
    };
    const book = this.store.ledger(settings.mode);
    if (!book) throw new Error("ledger missing");
    book.cashUsd -= row.notionalUsd + fee + gas;
    if (book.cashUsd < -1) {
      this.decide(settings, pair, signal.action, false, "cash would go negative; entry cancelled", {});
      return;
    }
    this.store.saveLedger(book);
    this.store.insertTrade(row);
    this.decide(settings, pair, signal.action, true, signal.reason, { fillPx, qty, venue, regime: signal.regime });
    this.alert("trade", `${settings.mode} ${side} ${pair.base.symbol}`, `${signal.reason}. Fill ${fillPx.toFixed(4)}, notional $${row.notionalUsd.toFixed(2)}.`);
  }

  private async exit(open: TradeRow, pair: PairConfig, mark: number, reason: string, settings: RuntimeSettings, volume: number): Promise<void> {
    const slip = Math.min(settings.risk.emergencyExitSlippageBps, estimateSlippageBps(open.notionalUsd, volume, 5, 0.1));
    const isBuy = open.side === "short";
    let fillPx = slippedPrice(mark, open.side, isBuy, slip);
    let fee = (open.qty * fillPx * pair.feeBps) / 10_000;
    let gas = chainById(pair.chain)?.gasUsd ?? 0;
    let tx: string | null = null;
    if (settings.mode === "live") {
      const liveFill = open.venue === "perp"
        ? await this.live.perp(pair, open.side === "long" ? "short" : "long", open.qty, mark, true)
        : await this.live.spot(pair, "sell", open.qty * mark, open.qty, mark, settings.risk.emergencyExitSlippageBps, settings.risk.emergencyExitSlippageBps);
      fillPx = liveFill.price;
      fee = liveFill.feeUsd;
      gas = liveFill.gasUsd;
      tx = liveFill.tx;
    }
    const gross = open.side === "long" ? (fillPx - open.entryPx) * open.qty : (open.entryPx - fillPx) * open.qty;
    const pnl = gross - open.feesUsd - fee - open.gasUsd - gas;
    open.exitPx = fillPx;
    open.feesUsd += fee;
    open.gasUsd += gas;
    open.slippageUsd += Math.abs(fillPx - mark) * open.qty;
    open.realizedPnlUsd = pnl;
    open.status = "closed";
    open.closedAt = this.now();
    open.txClose = tx;
    open.reasonClose = reason;
    const book = this.store.ledger(settings.mode);
    if (book) {
      if (open.venue === "spot") book.cashUsd += open.qty * fillPx - fee - gas;
      else book.cashUsd += open.notionalUsd + gross - fee - gas;
      this.store.saveLedger(book);
    }
    this.store.updateTrade(open);
    this.decide(settings, pair, open.side === "long" ? "exit_long" : "exit_short", true, reason, { pnl, fillPx });
    this.alert("trade", `${settings.mode} exit ${pair.base.symbol}`, `${reason}. PnL $${pnl.toFixed(2)}.`);
  }

  private async flatten(reason: string, settings: RuntimeSettings): Promise<void> {
    for (const trade of this.store.openTrades(settings.mode)) {
      const pair = pairById(trade.pairId);
      if (!pair) continue;
      const mark = this.marks.get(trade.pairId) ?? trade.entryPx;
      await this.exit(trade, pair, mark, reason, settings, 1_000_000);
    }
  }

  async flattenAll(reason: string): Promise<void> {
    await this.flatten(reason, this.settings());
    this.emit();
  }

  private equityNow(mode: TradingMode, open: TradeRow[]): number {
    const book = this.store.ledger(mode);
    let equity = book?.cashUsd ?? 0;
    for (const trade of open) {
      const mark = this.marks.get(trade.pairId) ?? trade.entryPx;
      if (trade.venue === "spot") equity += trade.qty * mark;
      else {
        const unrealized = trade.side === "long" ? (mark - trade.entryPx) * trade.qty : (trade.entryPx - mark) * trade.qty;
        equity += trade.notionalUsd + unrealized;
      }
    }
    return equity;
  }

  private markEquity(mode: TradingMode): void {
    const open = this.store.openTrades(mode);
    const equity = this.equityNow(mode, open);
    const book = this.store.ledger(mode);
    if (!book) return;
    if (equity > book.highWatermark) book.highWatermark = equity;
    const dd = book.highWatermark > 0 ? ((book.highWatermark - equity) / book.highWatermark) * 100 : 0;
    this.store.saveLedger(book);
    this.store.addEquity(this.now(), mode, equity, book.cashUsd, dd);
    const daily = book.dayStartEquity > 0 ? ((book.dayStartEquity - equity) / book.dayStartEquity) * 100 : 0;
    if (daily >= this.settings().risk.dailyDrawdownKillPct || dd >= this.settings().risk.totalDrawdownKillPct) {
      if (!this.killState().engaged) {
        this.setKill(true, daily >= this.settings().risk.dailyDrawdownKillPct ? `daily drawdown ${daily.toFixed(2)}%` : `total drawdown ${dd.toFixed(2)}%`, "drawdown");
      }
    }
  }

  private rollDay(mode: TradingMode, ledger: { dayKey: string; dayStartEquity: number; cashUsd: number; highWatermark: number; mode: TradingMode }): void {
    const today = dayKey(this.now());
    if (ledger.dayKey === today) return;
    const equity = this.equityNow(mode, this.store.openTrades(mode));
    const pnl = equity - ledger.dayStartEquity;
    this.alert("info", `Daily PnL ${ledger.dayKey}`, `${mode} book finished ${ledger.dayKey} at $${equity.toFixed(2)}, day PnL $${pnl.toFixed(2)}.`);
    ledger.dayKey = today;
    ledger.dayStartEquity = equity;
    this.store.saveLedger(ledger);
  }

  async probeNow(only?: ChainId): Promise<void> {
    await this.probe(only);
    this.emit();
  }

  private async probe(only?: ChainId): Promise<void> {
    if (process.env.MERIDIAN_SKIP_PROBE === "1") return;
    const jobs: Promise<void>[] = [];
    for (const chain of CHAINS) {
      if (only && chain.id !== only) continue;
      if (!this.settings().chains[chain.id]?.enabled) continue;
      const pool = this.pools.get(chain.id);
      if (!pool) continue;
      for (const ep of pool.endpoints) {
        if (chain.kind === "evm") {
          const adapter = this.evm.get(chain.id);
          if (adapter) jobs.push(adapter.probe(ep));
        } else if (this.solana) jobs.push(this.solana.probe(ep));
      }
    }
    await Promise.all(jobs);
    await this.refreshBalances();
    try { await this.perps.ensureMeta(this.now()); } catch (error) {
      logger.warn({ err: error instanceof Error ? error.message : "meta" }, "hyperliquid meta unavailable");
    }
  }

  private decide(settings: RuntimeSettings, pair: PairConfig, action: string, taken: boolean, reason: string, details: unknown): void {
    this.store.addDecision({ ts: this.now(), mode: settings.mode, chain: pair.chain, pairId: pair.id, strategy: null, action, taken, reason, details });
  }

  private alert(level: "info" | "trade" | "error" | "kill", title: string, body: string): void {
    const webhook = this.settings().alertWebhook;
    void deliverAlert({ title, body, level, webhook }).then((delivered) => {
      this.store.addAlert(level, title, body, delivered);
    }).catch(() => {
      this.store.addAlert(level, title, body, false);
    });
  }

  private eligible(pairId: string, strategy: StrategyId | null): boolean {
    const latest = this.store.latestBacktest();
    const report = latest?.report as { pairs?: { pairId: string; sleeves: SleeveReport[] }[] } | null;
    const pair = report?.pairs?.find((p) => p.pairId === pairId);
    if (!pair) return false;
    const sleeve = pair.sleeves.find((s) => s.strategy === "composite") ?? pair.sleeves.find((s) => s.strategy === strategy);
    return Boolean(sleeve?.gates.liveEligible);
  }

  liveBlockers(): string[] {
    const settings = this.settings();
    if (settings.mode !== "live") return [];
    const problems: string[] = [];
    for (const chain of CHAINS) {
      const state = settings.chains[chain.id];
      if (!state?.enabled || !state.tradingEnabled) continue;
      if (!this.walletAddress(chain.id)) problems.push(`${chain.id} is enabled for trading but has no valid wallet key`);
    }
    const needsPerp = PAIRS.some((p) => settings.pairs[p.id]?.enabled && p.perpCoin && settings.chains[p.chain]?.tradingEnabled);
    if (needsPerp && !this.hyperliquidAddress()) problems.push("a perp market is enabled but no EVM key is available to sign Hyperliquid orders");
    return problems;
  }

  walletAddress(chain: ChainId): string | null {
    try {
      return resolveKey(this.store, this.master, chain)?.address ?? null;
    } catch {
      return null;
    }
  }

  private hyperliquidAddress(): string | null {
    for (const chain of ["ethereum", "base", "arbitrum", "robinhood"] as const) {
      const address = this.walletAddress(chain);
      if (address) return address;
    }
    return null;
  }

  private bannerInput() {
    return {
      settings: this.settings(),
      chains: CHAINS,
      wallets: this.walletList(),
      kill: this.killState(),
      liveBlocked: this.liveBlockers(),
    };
  }

  private walletList(): { chain: string; address: string; source: string }[] {
    return CHAINS.flatMap((chain) => {
      try {
        const key = resolveKey(this.store, this.master, chain.id);
        return key ? [{ chain: chain.id, address: key.address, source: key.source }] : [];
      } catch {
        return [{ chain: chain.id, address: "invalid key", source: "env" }];
      }
    });
  }

  private async reconcile(): Promise<string[]> {
    const settings = this.settings();
    const notes = ["startup reconciliation"];
    if (settings.mode === "paper") {
      notes.push("paper mode uses the ledger as the book of record");
      return notes;
    }
    await this.refreshBalances();
    const address = this.hyperliquidAddress();
    let perpBook: { coin: string; size: number }[] | null = null;
    if (address) {
      try { perpBook = await this.perps.positions(address); }
      catch (error) { notes.push(`Hyperliquid positions could not be read: ${error instanceof Error ? error.message : "request failed"}`); }
    }
    for (const trade of this.store.openTrades("live")) {
      const pair = pairById(trade.pairId);
      if (!pair) continue;
      if (trade.venue === "perp") {
        const row = perpBook?.find((p) => p.coin === pair.perpCoin);
        if (!perpBook) notes.push(`${trade.pairId} perp stays open in the journal; the exchange book was not readable`);
        else if (!row) notes.push(`${trade.pairId} is open in the journal but Hyperliquid shows no ${pair.perpCoin} position. The journal was not changed.`);
        else notes.push(`${trade.pairId} journal ${trade.side} ${trade.qty} vs Hyperliquid size ${row.size}`);
        continue;
      }
      const held = this.rawBalances.get(`${trade.chain}:${pair.base.address}`);
      if (held == null) {
        notes.push(`${trade.pairId} is open in the journal but the wallet token balance could not be read`);
        continue;
      }
      const qty = Number(held) / 10 ** pair.base.decimals;
      if (qty + 1e-8 < trade.qty * 0.5) {
        const note = `${trade.pairId} journal holds ${trade.qty} but the wallet shows ${qty.toFixed(6)} ${pair.base.symbol}. The journal was left unchanged so a failed read cannot flatten a real position.`;
        notes.push(note);
        this.alert("error", "Open position does not match the wallet", note);
      } else {
        notes.push(`${trade.pairId} journal qty ${trade.qty.toFixed(6)} is covered by wallet ${qty.toFixed(6)} ${pair.base.symbol}`);
      }
    }
    if (this.store.openTrades("live").length === 0) notes.push("no live positions were open in the journal");
    return notes;
  }

  async refreshBalances(): Promise<void> {
    for (const chain of CHAINS) {
      if (!this.settings().chains[chain.id]?.enabled) continue;
      const address = this.walletAddress(chain.id);
      const quote = PAIRS.find((pair) => pair.chain === chain.id && pair.quote.symbol === "USDC")?.quote ?? null;
      if (!address) {
        this.balances.set(chain.id, { native: null, nativeSymbol: chain.nativeSymbol, quote: null, quoteSymbol: quote?.symbol ?? null, error: null });
        continue;
      }
      try {
        const bases = PAIRS.filter((pair) => pair.chain === chain.id);
        if (chain.kind === "solana" && this.solana) {
          const native = await this.solana.solBalance(address);
          let quoteBal: bigint | null = null;
          if (quote) {
            quoteBal = await this.solana.tokenBalance(address, quote.address);
            this.rawBalances.set(`${chain.id}:${quote.address}`, quoteBal);
          }
          for (const pair of bases) {
            const held = await this.solana.tokenBalance(address, pair.base.address);
            this.rawBalances.set(`${chain.id}:${pair.base.address}`, held);
          }
          this.balances.set(chain.id, {
            native: formatUnits(native, 9),
            nativeSymbol: chain.nativeSymbol,
            quote: quote && quoteBal != null ? formatUnits(quoteBal, quote.decimals) : null,
            quoteSymbol: quote?.symbol ?? null,
            error: null,
          });
        } else if (chain.kind === "evm") {
          const adapter = this.evm.get(chain.id);
          if (!adapter) continue;
          const wallet = address as `0x${string}`;
          const native = await adapter.nativeBalance(wallet);
          let quoteBal: bigint | null = null;
          if (quote) {
            quoteBal = await adapter.tokenBalance(wallet, quote.address as `0x${string}`);
            this.rawBalances.set(`${chain.id}:${quote.address}`, quoteBal);
          }
          for (const pair of bases) {
            const held = await adapter.tokenBalance(wallet, pair.base.address as `0x${string}`);
            this.rawBalances.set(`${chain.id}:${pair.base.address}`, held);
          }
          this.balances.set(chain.id, {
            native: formatUnits(native, 18),
            nativeSymbol: chain.nativeSymbol,
            quote: quote && quoteBal != null ? formatUnits(quoteBal, quote.decimals) : null,
            quoteSymbol: quote?.symbol ?? null,
            error: null,
          });
        }
      } catch (error) {
        this.balances.set(chain.id, {
          native: null,
          nativeSymbol: chain.nativeSymbol,
          quote: null,
          quoteSymbol: quote?.symbol ?? null,
          error: error instanceof Error ? error.message : "balance read failed",
        });
      }
    }
  }

  async startResearch(): Promise<string> {
    if (this.researchRunning) throw new Error("a backtest is already running");
    this.researchRunning = true;
    const id = newId("bt");
    this.store.saveBacktest(id, "running", null, null);
    this.emit();
    void this.executeResearch(id).catch((error) => {
      const message = error instanceof Error ? error.message : "backtest failed";
      this.store.saveBacktest(id, "error", null, message);
      this.alert("error", "Backtest failed", message);
    }).finally(() => {
      this.researchRunning = false;
      this.emit();
    });
    return id;
  }

  private async executeResearch(id: string): Promise<void> {
    const settings = this.settings();
    const sleeves = ["trend", "breakout", "mean_reversion", "composite"] as const;
    const pairs = [];
    for (const pair of PAIRS) {
      const loaded = await this.market.getBars(pair, this.now());
      const closed = this.store.recentTrades("paper", 500).filter((t) => t.pairId === pair.id && t.status === "closed");
      const chain = chainById(pair.chain);
      const costs = {
        feeBps: pair.feeBps,
        gasUsd: chain?.gasUsd ?? 0,
        baseSlippageBps: 5,
        impactCoeff: 0.1,
        fundingBpsPer8h: pair.perpCoin ? 1 : 0,
        allowPerpShort: Boolean(pair.perpCoin),
        venueForShort: pair.perpCoin ? "perp" as const : "spot" as const,
      };
      const reports: SleeveReport[] = [];
      for (const sleeve of sleeves) {
        const subset = sleeve === "composite" ? closed : closed.filter((t) => t.strategy === sleeve);
        const paper: PaperStats | null = subset.length ? {
          trades: subset.length,
          expectancyUsd: subset.reduce((s, t) => s + (t.realizedPnlUsd ?? 0), 0) / subset.length,
          profitFactor: pf(subset.map((t) => t.realizedPnlUsd ?? 0)),
          maxDrawdownPct: 0,
        } : null;
        reports.push(researchSleeve(loaded.bars, settings.strategy, costs, sleeve, settings.gates ?? DEFAULT_GATES, paper, settings.paperStartingEquity));
      }
      const composite = reports.find((r) => r.strategy === "composite");
      pairs.push({
        pairId: pair.id,
        label: `${pair.base.symbol}/${pair.quote.symbol}`,
        chain: pair.chain,
        shortMode: shortMode(pair),
        bars: loaded.bars.length,
        from: loaded.bars[0]?.t ?? null,
        to: loaded.bars[loaded.bars.length - 1]?.t ?? null,
        feeBps: pair.feeBps,
        sleeves: reports,
        recommendation: recommend(pair.id, composite),
      });
    }
    this.store.saveBacktest(id, "done", {
      generatedAt: this.now(),
      assumptions: ASSUMPTIONS,
      pairs,
    }, null);
    this.alert("info", "Walk-forward finished", pairs.map((p) => `${p.label}: ${p.recommendation}`).join(" "));
  }

  snapshot(): EngineSnapshot {
    const settings = this.settings();
    const open = this.store.openTrades(settings.mode);
    const equity = this.equityNow(settings.mode, open);
    const book = this.store.ledger(settings.mode);
    const dd = book && book.highWatermark > 0 ? ((book.highWatermark - equity) / book.highWatermark) * 100 : 0;
    const latest = this.store.latestBacktest();
    const report = latest?.report as { pairs?: { pairId: string; sleeves: SleeveReport[] }[] } | null;
    return {
      now: this.now(),
      banner: renderBanner(this.bannerInput()),
      engine: {
        running: this.running,
        mode: settings.mode,
        modeSource: settings.modeSource,
        kill: this.killState(),
        loopIntervalMs: settings.loopIntervalMs,
        iteration: this.iteration,
        lastLoopAt: this.lastLoopAt,
        lastError: this.lastError,
        liveBlocked: this.liveBlockers(),
        paperEquity: equity,
        dayPnl: book ? equity - book.dayStartEquity : 0,
        drawdownPct: dd,
        reconciled: this.reconciled,
      },
      settings,
      assumptions: ASSUMPTIONS,
      chains: CHAINS.map((chain) => {
        const pool = this.pools.get(chain.id);
        return {
          ...chain,
          enabled: settings.chains[chain.id]?.enabled ?? false,
          tradingEnabled: settings.chains[chain.id]?.tradingEnabled ?? false,
          wallet: this.walletList().find((w) => w.chain === chain.id) ?? null,
          balances: this.balances.get(chain.id) ?? null,
          rpc: (pool?.snapshot() ?? []).map((ep) => ({ ...ep, url: redactUrl(ep.url) })),
        };
      }),
      pairs: PAIRS.map((pair) => {
        const view = this.regimes.get(pair.id);
        const sleeve = report?.pairs?.find((p) => p.pairId === pair.id)?.sleeves.find((s) => s.strategy === "composite");
        return {
          id: pair.id,
          label: `${pair.base.symbol}/${pair.quote.symbol}`,
          chain: pair.chain,
          enabled: settings.pairs[pair.id]?.enabled ?? false,
          dex: pair.dex,
          feeBps: pair.feeBps,
          shortMode: shortMode(pair),
          perpCoin: pair.perpCoin,
          price: this.marks.get(pair.id) ?? null,
          regime: view?.regime ?? null,
          indicators: {
            adx: view?.adx ?? null,
            rsi: view?.rsi ?? null,
            emaFast: view?.emaFast ?? null,
            emaSlow: view?.emaSlow ?? null,
            atr: view?.atr ?? null,
          },
          lastSignal: view?.signal ?? null,
          eligibility: sleeve?.gates.status ?? "not tested",
        };
      }),
      positions: open,
      trades: this.store.recentTrades(settings.mode, 100),
      decisions: this.store.recentDecisions(150),
      equity: this.store.equity(settings.mode, 800),
      alerts: this.store.recentAlerts(80),
      backtest: latest ? { id: latest.id, createdAt: latest.createdAt, status: latest.status, error: latest.error } : null,
      researchRunning: this.researchRunning,
    };
  }

  chart(pairId: string): Promise<unknown> {
    const pair = pairById(pairId);
    if (!pair) throw new Error("unknown pair");
    return this.market.getBars(pair, this.now()).then((loaded) => {
      const settings = this.settings();
      const series = computeSeries(loaded.bars, settings.strategy);
      const tail = loaded.bars.slice(-400);
      const offset = loaded.bars.length - tail.length;
      const point = (arr: (number | null)[], index: number) => {
        const value = arr[index];
        const bar = loaded.bars[index];
        return value == null || !bar ? null : { time: bar.t, value };
      };
      const trades = this.store.recentTrades(settings.mode, 300).filter((t) => t.pairId === pairId);
      const markers = trades.flatMap((trade) => {
        const entry = { time: Math.floor(trade.openedAt / 1000), position: trade.side === "long" ? "belowBar" : "aboveBar", color: trade.side === "long" ? "#3dd68c" : "#ff5d5d", shape: trade.side === "long" ? "arrowUp" : "arrowDown", text: `${trade.strategy} ${trade.side}` };
        const exit = trade.closedAt ? [{ time: Math.floor(trade.closedAt / 1000), position: "aboveBar" as const, color: "#f0b429", shape: "circle" as const, text: trade.reasonClose ?? "exit" }] : [];
        return [entry, ...exit];
      });
      return {
        pairId,
        source: loaded.source,
        warning: loaded.warning ?? null,
        candles: tail.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })),
        emaFast: tail.map((_, i) => point(series.emaFast, i + offset)).filter((p) => p != null),
        emaSlow: tail.map((_, i) => point(series.emaSlow, i + offset)).filter((p) => p != null),
        bbUpper: tail.map((_, i) => point(series.bbUpper, i + offset)).filter((p) => p != null),
        bbLower: tail.map((_, i) => point(series.bbLower, i + offset)).filter((p) => p != null),
        markers,
        stops: this.store.openTrades(settings.mode).filter((t) => t.pairId === pairId).map((t) => ({ stop: t.stopPx, takeProfit: t.takeProfitPx, entry: t.entryPx })),
      };
    });
  }
}

function pf(pnls: number[]): number | null {
  const wins = pnls.filter((n) => n > 0).reduce((s, n) => s + n, 0);
  const losses = Math.abs(pnls.filter((n) => n <= 0).reduce((s, n) => s + n, 0));
  if (losses > 0) return wins / losses;
  return pnls.length ? null : 0;
}

function recommend(pairId: string, composite: SleeveReport | undefined): string {
  if (!composite) return "no result";
  if (composite.gates.status === "eligible") return `${pairId} passed the gates including paper confirmation`;
  if (composite.gates.status === "backtest_pass_pending_paper") return `${pairId} passed the out-of-sample gates and can be paper traded; it is not live-eligible yet`;
  const failed = composite.gates.checks.filter((c) => !c.pass && c.id !== "paper").map((c) => c.label);
  return `${pairId} is not a candidate (${failed.join(", ") || "see checks"})`;
}

export function buildPools(overrides: UiOverrides | null): Map<ChainId, RpcPool> {
  const pools = new Map<ChainId, RpcPool>();
  for (const chain of CHAINS) {
    const endpoints: RpcEndpoint[] = endpointsForChain(chain.id, overrides).map((ep) => ({
      id: ep.id,
      provider: ep.provider,
      url: ep.url,
      priority: ep.priority,
      source: ep.source,
    }));
    if (endpoints.length === 0) continue;
    pools.set(chain.id, new RpcPool(chain.id, endpoints, async (url, body, timeoutMs) => {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      const json = await res.json().catch(() => null) as { result?: unknown; error?: { code?: number; message?: string } } | null;
      return { status: res.status, json };
    }, () => Date.now(), { staleAfterMs: chain.staleAfterMs }));
  }
  return pools;
}
