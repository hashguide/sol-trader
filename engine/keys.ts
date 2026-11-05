import type { ChainId } from "../src/shared/types";
import type { Store } from "./db";
import { decryptSecret, parseWalletKey } from "./secrets";

export interface ResolvedKey {
  address: string;
  material: string;
  source: "ui" | "env";
}

export function resolveKey(store: Store, master: Buffer, chain: ChainId, env: NodeJS.ProcessEnv = process.env): ResolvedKey | null {
  const row = store.walletCipher(chain);
  if (row) {
    const parsed = parseWalletKey(chain, decryptSecret(row, master));
    return { address: parsed.address, material: parsed.material, source: "ui" };
  }
  const specific = chain === "solana" ? env.SOLANA_PRIVATE_KEY : env[`${chain.toUpperCase()}_PRIVATE_KEY`];
  const raw = specific?.trim() || (chain !== "solana" ? env.EVM_PRIVATE_KEY?.trim() : undefined);
  if (!raw) return null;
  const parsed = parseWalletKey(chain, raw);
  return { address: parsed.address, material: parsed.material, source: "env" };
}
