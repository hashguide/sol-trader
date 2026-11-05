import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../engine/log";
import { decryptSecret, encryptSecret, hashPassword, loadMasterKey, parseWalletKey, verifyPassword } from "../engine/secrets";

describe("secrets", () => {
  it("round-trips a wallet key and a password without putting the secret in the log", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "meridian-key-"));
    const key = loadMasterKey(dir);
    const evm = "0x" + "11".repeat(32);
    const parsed = parseWalletKey("base", evm);
    const sealed = encryptSecret(parsed.material, key);
    expect(decryptSecret(sealed, key)).toBe(parsed.material);
    expect(parsed.address.startsWith("0x")).toBe(true);
    const password = hashPassword("correct horse battery");
    expect(verifyPassword("correct horse battery", password)).toBe(true);
    expect(verifyPassword("nope", password)).toBe(false);
    let line = "";
    const dest = new Writable({
      write(chunk, _enc, cb) {
        line += chunk.toString();
        cb();
      },
    });
    const log = createLogger("info", dest);
    log.info({ privateKey: evm, password: "correct horse battery", address: parsed.address }, "wallet");
    expect(line).not.toContain(evm);
    expect(line).not.toContain("correct horse battery");
    expect(line).toContain("[redacted]");
    expect(line).toContain(parsed.address);
  });

  it("rejects a malformed key", () => {
    expect(() => parseWalletKey("ethereum", "nope")).toThrow(/EVM/);
  });
});
