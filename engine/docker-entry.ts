import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const candles = path.join(dataDir, "candles");
const bundled = path.join(process.cwd(), "research-candles");
if (!existsSync(candles) && existsSync(bundled)) {
  mkdirSync(dataDir, { recursive: true });
  cpSync(bundled, candles, { recursive: true });
}

function start(name: string, command: string, args: string[], restart: boolean): ChildProcess {
  const child = spawn(command, args, { stdio: "inherit", env: process.env });
  child.on("exit", (code) => {
    if (name === "engine") {
      console.error(`engine exited (${code ?? "signal"}); stopping the container`);
      process.exit(code ?? 1);
    }
    if (restart) {
      console.error("dashboard exited; restarting in 2s. The engine keeps trading.");
      setTimeout(() => start(name, command, args, restart), 2000);
    }
  });
  return child;
}

const bind = process.env.WEB_BIND ?? "127.0.0.1";
const webPort = process.env.WEB_PORT ?? "4472";
start("engine", "node", ["dist/engine.js"], false);
start("dashboard", "node", ["node_modules/next/dist/bin/next", "start", "--hostname", bind, "--port", webPort], true);
