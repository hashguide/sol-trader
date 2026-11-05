export interface ChainBalance {
  native: string | null;
  nativeSymbol: string;
  quote: string | null;
  quoteSymbol: string | null;
  error: string | null;
}

export interface RpcRow {
  id: string;
  provider: string;
  url: string;
  priority: number;
  source: string;
  latencyMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
  backoffUntil: number;
  lastSuccessAt: number | null;
  blockNumber: string | null;
  stale: boolean;
}

export interface ChainView {
  id: string;
  name: string;
  kind: string;
  nativeSymbol: string;
  enabled: boolean;
  tradingEnabled: boolean;
  productionReady: boolean;
  note: string;
  wallet: { address: string; source: string } | null;
  balances: ChainBalance | null;
  rpc: RpcRow[];
}

export interface PairView {
  id: string;
  label: string;
  chain: string;
  enabled: boolean;
  dex: string;
  feeBps: number;
  shortMode: string;
  perpCoin: string | null;
  price: number | null;
  regime: string | null;
  indicators: { adx: number | null; rsi: number | null; emaFast: number | null; emaSlow: number | null; atr: number | null };
  lastSignal: string | null;
  eligibility: string;
}

export interface TradeRow {
  id: string;
  mode: string;
  chain: string;
  pairId: string;
  strategy: string;
  venue: string;
  side: string;
  qty: number;
  entryPx: number;
  exitPx: number | null;
  stopPx: number;
  takeProfitPx: number;
  notionalUsd: number;
  feesUsd: number;
  gasUsd: number;
  realizedPnlUsd: number | null;
  status: string;
  openedAt: number;
  closedAt: number | null;
  reasonOpen: string;
  reasonClose: string | null;
  barsHeld: number;
}

export interface DecisionRow {
  id: number;
  ts: number;
  mode: string;
  pairId: string;
  chain: string;
  strategy: string | null;
  action: string;
  taken: boolean;
  reason: string;
}

export interface RiskLimits {
  riskPerTradePct: number;
  maxPositionPct: number;
  maxConcurrentPositions: number;
  maxChainExposurePct: number;
  maxTokenExposurePct: number;
  dailyDrawdownKillPct: number;
  totalDrawdownKillPct: number;
  maxSlippageBps: number;
  maxPriceImpactBps: number;
  maxGasEdgePct: number;
  conservativeWinRate: number;
  circuitBarMovePct: number;
  staleDataMinutes: number;
  quoteDivergencePct: number;
  emergencyExitSlippageBps: number;
}

export interface GateConfig {
  minExpectancyUsd: number;
  minProfitFactor: number;
  maxDrawdownPct: number;
  minTrades: number;
  minWalkForwardWindows: number;
  minProfitableWindowFraction: number;
  minStableGridFraction: number;
  paperMinTrades: number;
  paperMinProfitFactor: number;
  paperMaxDrawdownPct: number;
}

export interface Snapshot {
  now: number;
  banner: string;
  engine: {
    running: boolean;
    mode: "paper" | "live";
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
  settings: {
    mode: "paper" | "live";
    modeSource: string;
    loopIntervalMs: number;
    paperStartingEquity: number;
    risk: RiskLimits;
    gates: GateConfig;
    strategy: { enabled: { trend: boolean; breakout: boolean; mean_reversion: boolean } };
    chains: Record<string, { enabled: boolean; tradingEnabled: boolean }>;
    pairs: Record<string, { enabled: boolean }>;
    overrideGates: boolean;
    alertWebhookSource: string;
  };
  assumptions: string[];
  chains: ChainView[];
  pairs: PairView[];
  positions: TradeRow[];
  trades: TradeRow[];
  decisions: DecisionRow[];
  equity: { t: number; equity: number; drawdownPct: number }[];
  alerts: { id: number; ts: number; level: string; title: string; body: string }[];
  backtest: { id: string; createdAt: number; status: string; error: string | null } | null;
  researchRunning: boolean;
}

export interface SleeveReport {
  strategy: string;
  outOfSample: {
    trades: number;
    winRate: number | null;
    pnlUsd: number;
    expectancyUsd: number | null;
    profitFactor: number | null;
    maxDrawdownPct: number;
    sharpe: number | null;
    avgBarsHeld: number | null;
    feesUsd: number;
    gasUsd: number;
    slippageUsd: number;
  };
  gates: { status: string; liveEligible: boolean; checks: { id: string; label: string; pass: boolean; actual: string; required: string }[] };
}

export interface ResearchReport {
  generatedAt?: number;
  assumptions?: string[];
  pairs?: { pairId: string; label: string; chain: string; recommendation: string; sleeves: SleeveReport[] }[];
}
