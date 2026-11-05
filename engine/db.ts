import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import type { UiOverrides } from "./config";
import type { TradingMode } from "../src/shared/types";

export interface TradeRow {
  id: string;
  mode: TradingMode;
  chain: string;
  pairId: string;
  strategy: string;
  venue: "spot" | "perp";
  side: "long" | "short";
  qty: number;
  entryPx: number;
  exitPx: number | null;
  stopPx: number;
  takeProfitPx: number;
  trailingAtr: number | null;
  notionalUsd: number;
  feesUsd: number;
  gasUsd: number;
  slippageUsd: number;
  realizedPnlUsd: number | null;
  status: "open" | "closed";
  openedAt: number;
  closedAt: number | null;
  txOpen: string | null;
  txClose: string | null;
  reasonOpen: string;
  reasonClose: string | null;
  barsHeld: number;
  tokenGroup: string;
  maxHoldBars: number;
}

export interface DecisionRow {
  id: number;
  ts: number;
  mode: string;
  chain: string;
  pairId: string;
  strategy: string | null;
  action: string;
  taken: boolean;
  reason: string;
  details: unknown;
}

export interface LedgerRow {
  mode: TradingMode;
  cashUsd: number;
  highWatermark: number;
  dayKey: string;
  dayStartEquity: number;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(readonly file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS wallets (
        chain TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        iv TEXT NOT NULL,
        tag TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        chain TEXT NOT NULL,
        pair_id TEXT NOT NULL,
        strategy TEXT NOT NULL,
        venue TEXT NOT NULL,
        side TEXT NOT NULL,
        qty REAL NOT NULL,
        entry_px REAL NOT NULL,
        exit_px REAL,
        stop_px REAL NOT NULL,
        take_profit_px REAL NOT NULL,
        trailing_atr REAL,
        notional_usd REAL NOT NULL,
        fees_usd REAL NOT NULL,
        gas_usd REAL NOT NULL,
        slippage_usd REAL NOT NULL,
        realized_pnl_usd REAL,
        status TEXT NOT NULL,
        opened_at INTEGER NOT NULL,
        closed_at INTEGER,
        tx_open TEXT,
        tx_close TEXT,
        reason_open TEXT NOT NULL,
        reason_close TEXT,
        bars_held INTEGER NOT NULL DEFAULT 0,
        token_group TEXT NOT NULL,
        max_hold_bars INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        mode TEXT NOT NULL,
        chain TEXT NOT NULL,
        pair_id TEXT NOT NULL,
        strategy TEXT,
        action TEXT NOT NULL,
        taken INTEGER NOT NULL,
        reason TEXT NOT NULL,
        details_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS equity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        mode TEXT NOT NULL,
        equity_usd REAL NOT NULL,
        cash_usd REAL NOT NULL,
        drawdown_pct REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        level TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        delivered INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS ledger (
        mode TEXT PRIMARY KEY,
        cash_usd REAL NOT NULL,
        high_watermark REAL NOT NULL,
        day_key TEXT NOT NULL,
        day_start_equity REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS backtests (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        report_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_decisions_ts ON decisions(ts);
      CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(mode, status);
      CREATE INDEX IF NOT EXISTS idx_equity_ts ON equity(mode, ts);
    `);
  }

  meta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  overrides(): UiOverrides | null {
    const row = this.db.prepare("SELECT json FROM settings WHERE id = 1").get() as { json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.json) as UiOverrides;
  }

  saveOverrides(overrides: UiOverrides): void {
    const json = JSON.stringify(overrides);
    this.db.prepare("INSERT INTO settings(id, json, updated_at) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
      .run(json, Date.now());
  }

  saveSession(token: string, ttlMs: number): void {
    const now = Date.now();
    this.db.prepare("INSERT INTO sessions(token, created_at, expires_at) VALUES(?, ?, ?)").run(token, now, now + ttlMs);
  }

  validSession(token: string): boolean {
    const row = this.db.prepare("SELECT expires_at FROM sessions WHERE token = ?").get(token) as { expires_at: number } | undefined;
    return Boolean(row && row.expires_at > Date.now());
  }

  dropSession(token: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  }

  saveWallet(chain: string, address: string, iv: string, tag: string, ciphertext: string): void {
    this.db.prepare(`INSERT INTO wallets(chain, address, iv, tag, ciphertext, updated_at)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(chain) DO UPDATE SET address = excluded.address, iv = excluded.iv, tag = excluded.tag, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`)
      .run(chain, address, iv, tag, ciphertext, Date.now());
  }

  walletCipher(chain: string): { address: string; iv: string; tag: string; ciphertext: string } | null {
    const row = this.db.prepare("SELECT address, iv, tag, ciphertext FROM wallets WHERE chain = ?").get(chain) as
      | { address: string; iv: string; tag: string; ciphertext: string }
      | undefined;
    return row ?? null;
  }

  walletAddresses(): { chain: string; address: string }[] {
    return this.db.prepare("SELECT chain, address FROM wallets").all() as { chain: string; address: string }[];
  }

  deleteWallet(chain: string): void {
    this.db.prepare("DELETE FROM wallets WHERE chain = ?").run(chain);
  }

  ensureLedger(mode: TradingMode, equity: number, dayKey: string): LedgerRow {
    const existing = this.ledger(mode);
    if (existing) return existing;
    this.db.prepare("INSERT INTO ledger(mode, cash_usd, high_watermark, day_key, day_start_equity) VALUES(?, ?, ?, ?, ?)")
      .run(mode, equity, equity, dayKey, equity);
    return this.ledger(mode) as LedgerRow;
  }

  ledger(mode: TradingMode): LedgerRow | null {
    const row = this.db.prepare("SELECT mode, cash_usd AS cashUsd, high_watermark AS highWatermark, day_key AS dayKey, day_start_equity AS dayStartEquity FROM ledger WHERE mode = ?").get(mode) as LedgerRow | undefined;
    return row ?? null;
  }

  saveLedger(row: LedgerRow): void {
    this.db.prepare("UPDATE ledger SET cash_usd = ?, high_watermark = ?, day_key = ?, day_start_equity = ? WHERE mode = ?")
      .run(row.cashUsd, row.highWatermark, row.dayKey, row.dayStartEquity, row.mode);
  }

  insertTrade(row: TradeRow): void {
    this.db.prepare(`INSERT INTO trades(
      id, mode, chain, pair_id, strategy, venue, side, qty, entry_px, exit_px, stop_px, take_profit_px, trailing_atr,
      notional_usd, fees_usd, gas_usd, slippage_usd, realized_pnl_usd, status, opened_at, closed_at, tx_open, tx_close,
      reason_open, reason_close, bars_held, token_group, max_hold_bars
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      row.id, row.mode, row.chain, row.pairId, row.strategy, row.venue, row.side, row.qty, row.entryPx, row.exitPx,
      row.stopPx, row.takeProfitPx, row.trailingAtr, row.notionalUsd, row.feesUsd, row.gasUsd, row.slippageUsd,
      row.realizedPnlUsd, row.status, row.openedAt, row.closedAt, row.txOpen, row.txClose, row.reasonOpen,
      row.reasonClose, row.barsHeld, row.tokenGroup, row.maxHoldBars,
    );
  }

  updateTrade(row: TradeRow): void {
    this.db.prepare(`UPDATE trades SET qty=?, exit_px=?, stop_px=?, fees_usd=?, gas_usd=?, slippage_usd=?, realized_pnl_usd=?,
      status=?, closed_at=?, tx_close=?, reason_close=?, bars_held=? WHERE id=?`).run(
      row.qty, row.exitPx, row.stopPx, row.feesUsd, row.gasUsd, row.slippageUsd, row.realizedPnlUsd, row.status,
      row.closedAt, row.txClose, row.reasonClose, row.barsHeld, row.id,
    );
  }

  openTrades(mode: TradingMode): TradeRow[] {
    return this.db.prepare(`${TRADE_SELECT} WHERE mode = ? AND status = 'open' ORDER BY opened_at`).all(mode) as unknown as TradeRow[];
  }

  recentTrades(mode: TradingMode, limit = 200): TradeRow[] {
    return this.db.prepare(`${TRADE_SELECT} WHERE mode = ? ORDER BY opened_at DESC LIMIT ?`).all(mode, limit) as unknown as TradeRow[];
  }

  addDecision(row: Omit<DecisionRow, "id">): void {
    this.db.prepare("INSERT INTO decisions(ts, mode, chain, pair_id, strategy, action, taken, reason, details_json) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(row.ts, row.mode, row.chain, row.pairId, row.strategy, row.action, row.taken ? 1 : 0, row.reason, JSON.stringify(row.details));
  }

  recentDecisions(limit = 200): DecisionRow[] {
    const rows = this.db.prepare("SELECT id, ts, mode, chain, pair_id AS pairId, strategy, action, taken, reason, details_json AS details FROM decisions ORDER BY id DESC LIMIT ?").all(limit) as Array<Omit<DecisionRow, "details" | "taken"> & { details: string; taken: number }>;
    return rows.map((row) => ({ ...row, taken: row.taken === 1, details: JSON.parse(row.details) })).reverse();
  }

  addEquity(ts: number, mode: TradingMode, equity: number, cash: number, drawdownPct: number): void {
    this.db.prepare("INSERT INTO equity(ts, mode, equity_usd, cash_usd, drawdown_pct) VALUES(?, ?, ?, ?, ?)").run(ts, mode, equity, cash, drawdownPct);
  }

  equity(mode: TradingMode, limit = 1500): { t: number; equity: number; drawdownPct: number }[] {
    const rows = this.db.prepare("SELECT ts AS t, equity_usd AS equity, drawdown_pct AS drawdownPct FROM equity WHERE mode = ? ORDER BY ts DESC LIMIT ?").all(mode, limit) as { t: number; equity: number; drawdownPct: number }[];
    return rows.reverse();
  }

  addAlert(level: string, title: string, body: string, delivered: boolean): number {
    const result = this.db.prepare("INSERT INTO alerts(ts, level, title, body, delivered) VALUES(?, ?, ?, ?, ?)").run(Date.now(), level, title, body, delivered ? 1 : 0);
    return Number(result.lastInsertRowid);
  }

  recentAlerts(limit = 100): { id: number; ts: number; level: string; title: string; body: string }[] {
    const rows = this.db.prepare("SELECT id, ts, level, title, body FROM alerts ORDER BY id DESC LIMIT ?").all(limit) as { id: number; ts: number; level: string; title: string; body: string }[];
    return rows.reverse();
  }

  saveBacktest(id: string, status: string, report: unknown, error: string | null): void {
    this.db.prepare(`INSERT INTO backtests(id, created_at, status, error, report_json) VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, error = excluded.error, report_json = excluded.report_json`)
      .run(id, Date.now(), status, error, report == null ? null : JSON.stringify(report));
  }

  latestBacktest(): { id: string; createdAt: number; status: string; error: string | null; report: unknown } | null {
    const row = this.db.prepare("SELECT id, created_at AS createdAt, status, error, report_json AS report FROM backtests ORDER BY created_at DESC LIMIT 1").get() as
      | { id: string; createdAt: number; status: string; error: string | null; report: string | null }
      | undefined;
    if (!row) return null;
    return { ...row, report: row.report ? JSON.parse(row.report) : null };
  }

  close(): void {
    this.db.close();
  }
}

const TRADE_SELECT = `SELECT id, mode, chain, pair_id AS pairId, strategy, venue, side, qty, entry_px AS entryPx, exit_px AS exitPx,
  stop_px AS stopPx, take_profit_px AS takeProfitPx, trailing_atr AS trailingAtr, notional_usd AS notionalUsd, fees_usd AS feesUsd,
  gas_usd AS gasUsd, slippage_usd AS slippageUsd, realized_pnl_usd AS realizedPnlUsd, status, opened_at AS openedAt, closed_at AS closedAt,
  tx_open AS txOpen, tx_close AS txClose, reason_open AS reasonOpen, reason_close AS reasonClose, bars_held AS barsHeld,
  token_group AS tokenGroup, max_hold_bars AS maxHoldBars FROM trades`;
