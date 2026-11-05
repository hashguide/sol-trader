import {
  createPublicClient,
  createWalletClient,
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, base, mainnet } from "viem/chains";
import { defineChain } from "viem";
import type { ChainConfig } from "./config";
import { RpcPool, type RpcEndpoint } from "./rpc/pool";

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

const quoterAbi = [{
  type: "function",
  name: "quoteExactInputSingle",
  stateMutability: "nonpayable",
  inputs: [{
    name: "params",
    type: "tuple",
    components: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "fee", type: "uint24" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
  }],
  outputs: [
    { name: "amountOut", type: "uint256" },
    { name: "sqrtPriceX96After", type: "uint160" },
    { name: "initializedTicksCrossed", type: "uint32" },
    { name: "gasEstimate", type: "uint256" },
  ],
}] as const;

const swapAbi = [{
  type: "function",
  name: "exactInputSingle",
  stateMutability: "payable",
  inputs: [{
    name: "params",
    type: "tuple",
    components: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "recipient", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMinimum", type: "uint256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
    ],
  }],
  outputs: [{ name: "amountOut", type: "uint256" }],
}] as const;

const aeroPoolAbi = [
  { type: "function", name: "getAmountOut", stateMutability: "view", inputs: [{ name: "amountIn", type: "uint256" }, { name: "tokenIn", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "stable", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
] as const;

const aeroRouterAbi = [{
  type: "function",
  name: "swapExactTokensForTokens",
  stateMutability: "nonpayable",
  inputs: [
    { name: "amountIn", type: "uint256" },
    { name: "amountOutMin", type: "uint256" },
    {
      name: "routes",
      type: "tuple[]",
      components: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "stable", type: "bool" },
        { name: "factory", type: "address" },
      ],
    },
    { name: "to", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
  outputs: [{ name: "amounts", type: "uint256[]" }],
}] as const;

export interface SwapQuote {
  amountIn: bigint;
  amountOut: bigint;
  priceImpactBps: number;
  gasUsd: number;
  router: "uniswap-v3" | "aerodrome" | "0x";
  feeTier?: number;
  stable?: boolean;
}

export interface BuiltSwap {
  to: Address;
  data: Hex;
  value: bigint;
  router: Address;
  tokenIn: Address;
  amountIn: bigint;
  minOut: bigint;
}

function viemChain(cfg: ChainConfig) {
  if (cfg.evmChainId === 1) return mainnet;
  if (cfg.evmChainId === 8453) return base;
  if (cfg.evmChainId === 42161) return arbitrum;
  if (cfg.evmChainId === 4663) return robinhood;
  return defineChain({
    id: cfg.evmChainId ?? 0,
    name: cfg.name,
    nativeCurrency: { name: cfg.nativeSymbol, symbol: cfg.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: cfg.publicRpcs as [string, ...string[]] } },
  });
}

export class EvmAdapter {
  private nonces = new Map<string, number>();

  constructor(readonly config: ChainConfig, readonly pool: RpcPool) {
    if (config.kind !== "evm" || config.evmChainId == null) throw new Error(`${config.id} is not an EVM chain`);
  }

  private client(url: string) {
    return createPublicClient({ chain: viemChain(this.config), transport: http(url, { timeout: this.pool.timeoutMs }) });
  }

  private async withUrl<T>(fn: (url: string) => Promise<T>): Promise<T> {
    const errors: string[] = [];
    for (const ep of this.pool.rank()) {
      try {
        return await fn(ep.url);
      } catch (error) {
        const message = error instanceof Error ? error.message : "rpc error";
        errors.push(`${ep.provider}: ${message}`);
      }
    }
    // Fall back to the pool's own failover for a raw call if every direct attempt threw before we could classify it.
    if (errors.length === 0) throw new Error(`No RPC endpoints configured for ${this.config.id}`);
    throw new Error(`All RPC endpoints failed for ${this.config.id}: ${errors.join("; ")}`);
  }

  async probe(ep: RpcEndpoint): Promise<void> {
    const started = Date.now();
    try {
      const client = this.client(ep.url);
      const block = await client.getBlock({ blockTag: "latest" });
      const health = this.pool.health.get(ep.id);
      if (health) {
        health.latencyMs = Date.now() - started;
        health.consecutiveFailures = 0;
        health.backoffUntil = 0;
        health.lastError = null;
        health.lastSuccessAt = Date.now();
      }
      this.pool.noteBlock(ep, block.number.toString(), Number(block.timestamp) * 1000);
    } catch (error) {
      const health = this.pool.health.get(ep.id);
      if (health) {
        health.consecutiveFailures += 1;
        health.lastError = error instanceof Error ? error.message : "probe failed";
        health.backoffUntil = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(health.consecutiveFailures, 5));
      }
    }
  }

  async nativeBalance(address: Address): Promise<bigint> {
    return this.withUrl((url) => this.client(url).getBalance({ address }));
  }

  async tokenBalance(wallet: Address, token: Address): Promise<bigint> {
    return this.withUrl((url) => this.client(url).readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }));
  }

  async tokenMetadata(token: Address): Promise<{ symbol: string; decimals: number }> {
    return this.withUrl(async (url) => {
      const client = this.client(url);
      const [symbol, decimals] = await Promise.all([
        client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
        client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      ]);
      return { symbol, decimals };
    });
  }

  async quoteUniswap(tokenIn: Address, tokenOut: Address, amountIn: bigint, fee: number, midPrice: number): Promise<SwapQuote> {
    if (!this.config.uniswap) throw new Error(`${this.config.name} has no Uniswap router configured`);
    const data = encodeFunctionData({
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
    });
    const raw = await this.ethCall(this.config.uniswap.quoter, data);
    const decoded = decodeFunctionResult({ abi: quoterAbi, functionName: "quoteExactInputSingle", data: raw });
    const amountOut = decoded[0];
    return {
      amountIn,
      amountOut,
      priceImpactBps: impactBps(amountIn, amountOut, midPrice),
      gasUsd: this.config.gasUsd,
      router: "uniswap-v3",
      feeTier: fee,
    };
  }

  async quoteAerodrome(pool: Address, tokenIn: Address, tokenOut: Address, amountIn: bigint, midPrice: number): Promise<SwapQuote> {
    if (!this.config.aerodrome) throw new Error(`${this.config.name} has no Aerodrome router configured`);
    const data = encodeFunctionData({ abi: aeroPoolAbi, functionName: "getAmountOut", args: [amountIn, tokenIn] });
    const raw = await this.ethCall(pool, data);
    const amountOut = decodeFunctionResult({ abi: aeroPoolAbi, functionName: "getAmountOut", data: raw });
    const stableRaw = await this.ethCall(pool, encodeFunctionData({ abi: aeroPoolAbi, functionName: "stable" }));
    const stable = decodeFunctionResult({ abi: aeroPoolAbi, functionName: "stable", data: stableRaw });
    return {
      amountIn,
      amountOut,
      priceImpactBps: impactBps(amountIn, amountOut, midPrice),
      gasUsd: this.config.gasUsd,
      router: "aerodrome",
      stable,
    };
  }

  buildUniswap(quote: SwapQuote, tokenIn: Address, tokenOut: Address, recipient: Address, slippageBps: number): BuiltSwap {
    if (!this.config.uniswap || quote.feeTier == null) throw new Error("uniswap quote is incomplete");
    const minOut = quote.amountOut * BigInt(10_000 - slippageBps) / 10_000n;
    const data = encodeFunctionData({
      abi: swapAbi,
      functionName: "exactInputSingle",
      args: [{
        tokenIn,
        tokenOut,
        fee: quote.feeTier,
        recipient,
        amountIn: quote.amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      }],
    });
    return { to: this.config.uniswap.router, data, value: 0n, router: this.config.uniswap.router, tokenIn, amountIn: quote.amountIn, minOut };
  }

  buildAerodrome(quote: SwapQuote, tokenIn: Address, tokenOut: Address, recipient: Address, slippageBps: number): BuiltSwap {
    if (!this.config.aerodrome || quote.stable == null) throw new Error("aerodrome quote is incomplete");
    const minOut = quote.amountOut * BigInt(10_000 - slippageBps) / 10_000n;
    const data = encodeFunctionData({
      abi: aeroRouterAbi,
      functionName: "swapExactTokensForTokens",
      args: [quote.amountIn, minOut, [{ from: tokenIn, to: tokenOut, stable: quote.stable, factory: this.config.aerodrome.factory }], recipient, BigInt(Math.floor(Date.now() / 1000) + 120)],
    });
    return { to: this.config.aerodrome.router, data, value: 0n, router: this.config.aerodrome.router, tokenIn, amountIn: quote.amountIn, minOut };
  }

  async simulate(tx: BuiltSwap, from: Address): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.withUrl((url) => this.client(url).call({ to: tx.to, data: tx.data, account: from }));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "simulation failed" };
    }
  }

  async send(tx: BuiltSwap, privateKey: Hex, from: Address): Promise<Hex> {
    const account = privateKeyToAccount(privateKey);
    if (account.address.toLowerCase() !== from.toLowerCase()) throw new Error("signing key does not match the wallet address");
    const url = this.sendUrl();
    const publicClient = this.client(url);
    const allowance = await publicClient.readContract({ address: tx.tokenIn, abi: erc20Abi, functionName: "allowance", args: [from, tx.router] });
    const wallet = createWalletClient({ account, chain: viemChain(this.config), transport: http(url, { timeout: 20_000 }) });
    if (allowance < tx.amountIn) {
      const approveHash = await wallet.writeContract({ address: tx.tokenIn, abi: erc20Abi, functionName: "approve", args: [tx.router, tx.amountIn] });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
    }
    const pending = await publicClient.getTransactionCount({ address: from, blockTag: "pending" });
    const local = this.nonces.get(from.toLowerCase());
    const nonce = local == null ? pending : Math.max(local, pending);
    this.nonces.set(from.toLowerCase(), nonce + 1);
    const fees = await publicClient.estimateFeesPerGas();
    try {
      return await wallet.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value,
        nonce,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    } catch (error) {
      this.nonces.delete(from.toLowerCase());
      throw error;
    }
  }

  async confirm(hash: Hex): Promise<{ ok: boolean; status: string }> {
    const url = this.pool.rank()[0]?.url ?? this.config.publicRpcs[0];
    if (!url) throw new Error(`no RPC to confirm on ${this.config.id}`);
    const receipt = await this.client(url).waitForTransactionReceipt({ hash, timeout: 60_000 });
    return { ok: receipt.status === "success", status: receipt.status };
  }

  private sendUrl(): string {
    if (this.config.id === "ethereum" && process.env.FLASHBOTS_PROTECT !== "false") return "https://rpc.flashbots.net";
    const fresh = this.pool.rank()[0];
    if (!fresh) throw new Error(`no healthy RPC for ${this.config.id}`);
    return fresh.url;
  }

  private async ethCall(to: Address, data: Hex): Promise<Hex> {
    const result = await this.withUrl((url) => this.client(url).call({ to, data }));
    if (!result.data) throw new Error("empty eth_call");
    return result.data;
  }
}

function impactBps(amountIn: bigint, amountOut: bigint, midPrice: number): number {
  if (!(midPrice > 0) || amountIn === 0n || amountOut === 0n) return 0;
  // midPrice is quote tokens per 1 whole base token. This quote path does not know decimals,
  // so callers that need a precise impact pass 0 and use the router's own figure. We return 0
  // here and let the runtime compare the executable price with the mark.
  void amountIn;
  void amountOut;
  void midPrice;
  return 0;
}

/** Executable price impact in bps given human amounts. Positive means worse than the mark. */
export function humanImpactBps(side: "buy" | "sell", amountIn: number, amountOut: number, mark: number): number {
  if (!(mark > 0) || !(amountIn > 0) || !(amountOut > 0)) return 0;
  const exec = side === "buy" ? amountIn / amountOut : amountOut / amountIn;
  const impact = side === "buy" ? (exec - mark) / mark : (mark - exec) / mark;
  return Math.max(0, impact * 10_000);
}
