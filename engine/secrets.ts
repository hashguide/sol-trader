import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { privateKeyToAccount } from "viem/accounts";
import type { ChainId } from "../src/shared/types";
import { chainById } from "./config";

export function loadMasterKey(dataDir: string, env: NodeJS.ProcessEnv = process.env): Buffer {
  const fromEnv = env.SECRETS_KEY?.trim();
  if (fromEnv) {
    const buf = Buffer.from(fromEnv, "hex");
    if (buf.length !== 32) throw new Error("SECRETS_KEY must be 32 bytes of hex (64 characters)");
    return buf;
  }
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "secrets.key");
  if (!existsSync(file)) {
    const key = randomBytes(32);
    writeFileSync(file, key.toString("hex"), { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* windows */ }
    return key;
  }
  const buf = Buffer.from(readFileSync(file, "utf8").trim(), "hex");
  if (buf.length !== 32) throw new Error("data/secrets.key is not a 32-byte hex key");
  return buf;
}

export function encryptSecret(plain: string, key: Buffer): { iv: string; tag: string; ciphertext: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: data.toString("base64") };
}

export function decryptSecret(payload: { iv: string; tag: string; ciphertext: string }, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]);
  return plain.toString("utf8");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, saltB64, hashB64] = stored.split("$");
  if (kind !== "scrypt" || !saltB64 || !hashB64) return false;
  const hash = scryptSync(password, Buffer.from(saltB64, "base64"), 32);
  const expected = Buffer.from(hashB64, "base64");
  if (hash.length !== expected.length) return false;
  return timingSafeEqual(hash, expected);
}

export interface ParsedKey {
  address: string;
  /** Material used to sign. Never log this. */
  material: string;
}

export function parseWalletKey(chain: ChainId, raw: string): ParsedKey {
  const cfg = chainById(chain);
  if (!cfg) throw new Error(`Unknown chain ${chain}`);
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Empty key");
  if (cfg.kind === "solana") {
    let bytes: Uint8Array;
    if (trimmed.startsWith("[")) {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed) || !parsed.every((n) => Number.isInteger(n))) throw new Error("Solana key JSON must be an array of bytes");
      bytes = Uint8Array.from(parsed as number[]);
    } else {
      bytes = bs58.decode(trimmed);
    }
    const kp = bytes.length === 32 ? Keypair.fromSeed(bytes) : bytes.length === 64 ? Keypair.fromSecretKey(bytes) : null;
    if (!kp) throw new Error("Solana key must be 32 or 64 bytes");
    return { address: kp.publicKey.toBase58(), material: bs58.encode(kp.secretKey) };
  }
  const hex = (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error("EVM key must be 32 bytes of hex");
  const account = privateKeyToAccount(hex);
  return { address: account.address, material: hex };
}
