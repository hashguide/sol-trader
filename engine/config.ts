import type { ChainId, ProviderId, TradingMode } from "../src/shared/types";
import { DEFAULT_GATES, DEFAULT_RISK, DEFAULT_STRATEGY_PARAMS, PAPER_STARTING_EQUITY, type StrategyParams } from "../src/shared/params";
import type { GateConfig, RiskLimits, StrategyId } from "../src/shared/types";

export interface ChainConfig {
  id: ChainId;
  kind: "evm" | "solana";
  name: string;
  /** EVM chain id. Solana is null. */
  evmChainId: number | null;
  nativeSymbol: string;
  explorer: string;
  enabled: boolean;
  tradingEnabled: boolean;
  productionReady: boolean;
  note: string;
  publicRpcs: string[];
  uniswap: { quoter: `0x${string}`; router: `0x${string}` } | null;
  aerodrome: { router: `0x${string}`; factory: `0x${string}` } | null;
  gasUsd: number;
  staleAfterMs: number;
}

export interface PairConfig {
  id: string;
  chain: ChainId;
  base: { symbol: string; address: string; decimals: number };
  quote: { symbol: string; address: string; decimals: number };
  pool: string;
  dex: "jupiter" | "uniswap-v3" | "aerodrome";
  /** Uniswap v3 fee tier, parts per million. */
  feeTier: number | null;
  feeBps: number;
  geckoNetwork: string;
  dexscreenerChain: string;
  /** Hyperliquid coin, if listed. Null means spot shorts flatten or stay flat. */
  perpCoin: string | null;
  tokenGroup: string;
  enabled: boolean;
  allowlisted: boolean;
}

export const CHAINS: ChainConfig[] = [
  {
    id: "solana",
    kind: "solana",
    name: "Solana",
    evmChainId: null,
    nativeSymbol: "SOL",
    explorer: "https://solscan.io",
    enabled: true,
    tradingEnabled: true,
    productionReady: true,
    note: "Jupiter routes spot swaps. Shorts in SOL go to Hyperliquid perps.",
    publicRpcs: ["https://api.mainnet-beta.solana.com"],
    uniswap: null,
    aerodrome: null,
    gasUsd: 0.05,
    staleAfterMs: 45_000,
  },
  {
    id: "ethereum",
    kind: "evm",
    name: "Ethereum",
    evmChainId: 1,
    nativeSymbol: "ETH",
    explorer: "https://etherscan.io",
    enabled: true,
    tradingEnabled: false,
    productionReady: true,
    note: "Adapter and RPC are on for balances. Spot trading stays off because L1 gas swamps the edge of a small book. Sends use Flashbots Protect when trading is enabled.",
    publicRpcs: ["https://ethereum.publicnode.com"],
    uniswap: {
      quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
      router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    },
    aerodrome: null,
    gasUsd: 1.5,
    staleAfterMs: 90_000,
  },
  {
    id: "base",
    kind: "evm",
    name: "Base",
    evmChainId: 8453,
    nativeSymbol: "ETH",
    explorer: "https://basescan.org",
    enabled: true,
    tradingEnabled: true,
    productionReady: true,
    note: "Uniswap v3 for WETH/USDC. AERO/USDC is an Aerodrome pool and uses the Aerodrome router.",
    publicRpcs: ["https://base.publicnode.com"],
    uniswap: {
      quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
      router: "0x2626664c2603336E57B271c5C0b26F421741e481",
    },
    aerodrome: {
      router: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
      factory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
    },
    gasUsd: 0.03,
    staleAfterMs: 60_000,
  },
  {
    id: "arbitrum",
    kind: "evm",
    name: "Arbitrum",
    evmChainId: 42161,
    nativeSymbol: "ETH",
    explorer: "https://arbiscan.io",
    enabled: true,
    tradingEnabled: true,
    productionReady: true,
    note: "Uniswap v3 WETH/USDC. ETH shorts go to Hyperliquid and share the ETH exposure cap with Base.",
    publicRpcs: ["https://arbitrum.publicnode.com"],
    uniswap: {
      quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
      router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    },
    aerodrome: null,
    gasUsd: 0.08,
    staleAfterMs: 60_000,
  },
  {
    id: "robinhood",
    kind: "evm",
    name: "Robinhood Chain",
    evmChainId: 4663,
    nativeSymbol: "ETH",
    explorer: "https://robinhoodchain.blockscout.com",
    enabled: false,
    tradingEnabled: false,
    productionReady: false,
    note: "Mainnet is live (chain id 4663, public RPC https://rpc.mainnet.chain.robinhood.com, eth_chainId 0x1237 confirmed 2026-11-05). Robinhood documents that public endpoint as rate-limited and not for production. DEX liquidity is thin and mostly illiquid or meme markets, and no production router is configured. The chain stays disabled until a paid RPC is set and a pool passes the universe filters. Turning it on is configuration, not a code change.",
    publicRpcs: ["https://rpc.mainnet.chain.robinhood.com"],
    uniswap: null,
    aerodrome: null,
    gasUsd: 0.02,
    staleAfterMs: 60_000,
  },
];

export const PAIRS: PairConfig[] = [
  {
    id: "sol-usdc",
    chain: "solana",
    base: { symbol: "SOL", address: "So11111111111111111111111111111111111111112", decimals: 9 },
    quote: { symbol: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
    pool: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
    dex: "jupiter",
    feeTier: null,
    feeBps: 5,
    geckoNetwork: "solana",
    dexscreenerChain: "solana",
    perpCoin: "SOL",
    tokenGroup: "SOL",
    enabled: true,
    allowlisted: true,
  },
  {
    id: "ray-usdc",
    chain: "solana",
    base: { symbol: "RAY", address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", decimals: 6 },
    quote: { symbol: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
    pool: "6UmmUiYoBjSrhakAobJw8BvkmJtDVxaeBtbt7rxWo1mg",
    dex: "jupiter",
    feeTier: null,
    feeBps: 25,
    geckoNetwork: "solana",
    dexscreenerChain: "solana",
    perpCoin: null,
    tokenGroup: "RAY",
    enabled: true,
    allowlisted: true,
  },
  {
    id: "base-weth-usdc",
    chain: "base",
    base: { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    quote: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    pool: "0x6c561b446416e1a00e8e93e221854d6ea4171372",
    dex: "uniswap-v3",
    feeTier: 3000,
    feeBps: 30,
    geckoNetwork: "base",
    dexscreenerChain: "base",
    perpCoin: "ETH",
    tokenGroup: "ETH",
    enabled: true,
    allowlisted: true,
  },
  {
    id: "arb-weth-usdc",
    chain: "arbitrum",
    base: { symbol: "WETH", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
    quote: { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    pool: "0xc6962004f452be9203591991d15f6b388e09e8d0",
    dex: "uniswap-v3",
    feeTier: 500,
    feeBps: 5,
    geckoNetwork: "arbitrum",
    dexscreenerChain: "arbitrum",
    perpCoin: "ETH",
    tokenGroup: "ETH",
    enabled: true,
    allowlisted: true,
  },
  {
    id: "base-aero-usdc",
    chain: "base",
    base: { symbol: "AERO", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
    quote: { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    pool: "0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d",
    dex: "aerodrome",
    feeTier: null,
    feeBps: 20,
    geckoNetwork: "base",
    dexscreenerChain: "base",
    perpCoin: "AERO",
    tokenGroup: "AERO",
    enabled: true,
    allowlisted: true,
  },
];

export interface RpcConfig {
  id: string;
  chain: ChainId;
  provider: ProviderId;
  url: string;
  priority: number;
  source: "default" | "env" | "ui";
}

const PROVIDERS: { id: ProviderId; priority: number; env: string }[] = [
  { id: "quicknode", priority: 10, env: "QUICKNODE" },
  { id: "alchemy", priority: 20, env: "ALCHEMY" },
  { id: "infura", priority: 30, env: "INFURA" },
];

export function envRpcEndpoints(env: NodeJS.ProcessEnv = process.env): RpcConfig[] {
  const out: RpcConfig[] = [];
  for (const chain of CHAINS) {
    for (const provider of PROVIDERS) {
      const key = `RPC_${chain.id.toUpperCase()}_${provider.env}`;
      const url = env[key]?.trim();
      if (!url) continue;
      out.push({
        id: `${chain.id}:${provider.id}`,
        chain: chain.id,
        provider: provider.id,
        url,
        priority: provider.priority,
        source: "env",
      });
    }
    chain.publicRpcs.forEach((url, index) => {
      out.push({
        id: `${chain.id}:public:${index}`,
        chain: chain.id,
        provider: "public",
        url,
        priority: 100 + index,
        source: "default",
      });
    });
  }
  return out;
}

export function chainById(id: string): ChainConfig | undefined {
  return CHAINS.find((c) => c.id === id);
}

export function pairById(id: string): PairConfig | undefined {
  return PAIRS.find((p) => p.id === id);
}

export interface RuntimeSettings {
  mode: TradingMode;
  modeSource: "default" | "env" | "ui";
  loopIntervalMs: number;
  paperStartingEquity: number;
  risk: RiskLimits;
  gates: GateConfig;
  strategy: StrategyParams;
  chains: Record<ChainId, { enabled: boolean; tradingEnabled: boolean }>;
  pairs: Record<string, { enabled: boolean }>;
  overrideGates: boolean;
  alertWebhook: string | null;
  alertWebhookSource: "env" | "ui" | "none";
}

export interface UiOverrides {
  mode?: TradingMode;
  loopIntervalMs?: number;
  paperStartingEquity?: number;
  risk?: Partial<RiskLimits>;
  gates?: Partial<GateConfig>;
  strategyEnabled?: Partial<Record<StrategyId, boolean>>;
  chains?: Partial<Record<ChainId, { enabled?: boolean; tradingEnabled?: boolean }>>;
  pairs?: Record<string, { enabled: boolean }>;
  overrideGates?: boolean;
  alertWebhook?: string | null;
  rpc?: Partial<Record<ChainId, { provider: ProviderId; url: string; priority: number }[]>>;
}

function num(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function resolveSettings(overrides: UiOverrides | null, env: NodeJS.ProcessEnv = process.env): RuntimeSettings {
  const envMode = env.TRADING_MODE === "live" || env.TRADING_MODE === "paper" ? env.TRADING_MODE : null;
  const mode = overrides?.mode ?? envMode ?? "paper";
  const modeSource = overrides?.mode ? "ui" : envMode ? "env" : "default";
  const chains = {} as RuntimeSettings["chains"];
  for (const chain of CHAINS) {
    const over = overrides?.chains?.[chain.id];
    chains[chain.id] = {
      enabled: over?.enabled ?? chain.enabled,
      tradingEnabled: over?.tradingEnabled ?? chain.tradingEnabled,
    };
  }
  const pairs: RuntimeSettings["pairs"] = {};
  for (const pair of PAIRS) {
    pairs[pair.id] = { enabled: overrides?.pairs?.[pair.id]?.enabled ?? pair.enabled };
  }
  const strategy: StrategyParams = structuredClone(DEFAULT_STRATEGY_PARAMS);
  if (overrides?.strategyEnabled) {
    for (const id of ["trend", "breakout", "mean_reversion"] as const) {
      const value = overrides.strategyEnabled[id];
      if (typeof value === "boolean") strategy.enabled[id] = value;
    }
  }
  const webhook = overrides?.alertWebhook !== undefined ? overrides.alertWebhook : env.ALERT_WEBHOOK_URL?.trim() || null;
  return {
    mode,
    modeSource,
    loopIntervalMs: Math.max(15_000, Math.round(overrides?.loopIntervalMs ?? num(env.LOOP_INTERVAL_MS, 60_000))),
    paperStartingEquity: overrides?.paperStartingEquity ?? num(env.PAPER_STARTING_EQUITY_USD, PAPER_STARTING_EQUITY),
    risk: { ...DEFAULT_RISK, ...cleanRisk(overrides?.risk) },
    gates: { ...DEFAULT_GATES, ...cleanGates(overrides?.gates) },
    strategy,
    chains,
    pairs,
    overrideGates: overrides?.overrideGates ?? env.LIVE_OVERRIDE_GATES === "true",
    alertWebhook: webhook || null,
    alertWebhookSource: overrides?.alertWebhook !== undefined ? "ui" : env.ALERT_WEBHOOK_URL ? "env" : "none",
  };
}

function cleanRisk(partial: Partial<RiskLimits> | undefined): Partial<RiskLimits> {
  if (!partial) return {};
  const ranges: Record<keyof RiskLimits, [number, number]> = {
    riskPerTradePct: [0.1, 2],
    maxPositionPct: [1, 25],
    maxConcurrentPositions: [1, 12],
    maxChainExposurePct: [5, 100],
    maxTokenExposurePct: [2, 50],
    dailyDrawdownKillPct: [0.5, 20],
    totalDrawdownKillPct: [1, 40],
    maxSlippageBps: [5, 150],
    maxPriceImpactBps: [5, 300],
    maxGasEdgePct: [5, 80],
    conservativeWinRate: [0.2, 0.7],
    circuitBarMovePct: [5, 40],
    staleDataMinutes: [15, 720],
    quoteDivergencePct: [1, 20],
    emergencyExitSlippageBps: [20, 400],
  };
  const out: Partial<RiskLimits> = {};
  for (const key of Object.keys(ranges) as (keyof RiskLimits)[]) {
    const value = partial[key];
    const bounds = ranges[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= bounds[0] && value <= bounds[1]) {
      out[key] = key === "maxConcurrentPositions" ? Math.round(value) : value;
    }
  }
  return out;
}

function cleanGates(partial: Partial<GateConfig> | undefined): Partial<GateConfig> {
  if (!partial) return {};
  const out: Partial<GateConfig> = {};
  const copy = <K extends keyof GateConfig>(key: K, min: number, max: number) => {
    const value = partial[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) out[key] = value as GateConfig[K];
  };
  copy("minExpectancyUsd", -100, 100);
  copy("minProfitFactor", 1, 5);
  copy("maxDrawdownPct", 1, 50);
  copy("minTrades", 5, 500);
  copy("minWalkForwardWindows", 2, 100);
  copy("minProfitableWindowFraction", 0.3, 1);
  copy("minStableGridFraction", 0.3, 1);
  copy("paperMinTrades", 3, 200);
  copy("paperMinProfitFactor", 1, 5);
  copy("paperMaxDrawdownPct", 1, 50);
  return out;
}

export function endpointsForChain(chain: ChainId, overrides: UiOverrides | null, env: NodeJS.ProcessEnv = process.env): RpcConfig[] {
  const custom = overrides?.rpc?.[chain];
  if (custom && custom.length > 0) {
    return custom
      .filter((row) => row.url.trim())
      .map((row, index) => ({
        id: `${chain}:ui:${index}`,
        chain,
        provider: row.provider,
        url: row.url.trim(),
        priority: row.priority,
        source: "ui" as const,
      }))
      .sort((a, b) => a.priority - b.priority);
  }
  return envRpcEndpoints(env).filter((e) => e.chain === chain).sort((a, b) => a.priority - b.priority);
}

export function shortMode(pair: PairConfig): "hyperliquid-perp" | "spot-flat" {
  return pair.perpCoin ? "hyperliquid-perp" : "spot-flat";
}
