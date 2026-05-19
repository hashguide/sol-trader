import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '../../../data/trading.db')

let db

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initSchema()
  }
  return db
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'paper',
      status TEXT NOT NULL DEFAULT 'stopped',
      config TEXT NOT NULL DEFAULT '{}',
      tokens TEXT NOT NULL DEFAULT '[]',
      initial_capital REAL NOT NULL DEFAULT 100,
      current_capital REAL NOT NULL DEFAULT 100,
      paper_capital REAL DEFAULT NULL,
      stop_loss_pct REAL DEFAULT NULL,
      trailing_stop_pct REAL DEFAULT NULL,
      take_profit_pct REAL DEFAULT NULL,
      max_position_size REAL DEFAULT 10,
      expiry_at TEXT DEFAULT NULL,
      profit_goal REAL DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id INTEGER REFERENCES strategies(id),
      token_mint TEXT NOT NULL,
      token_symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'paper',
      amount_in REAL NOT NULL,
      amount_out REAL,
      price_in REAL NOT NULL,
      price_out REAL DEFAULT NULL,
      pnl REAL DEFAULT NULL,
      pnl_pct REAL DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      tx_hash TEXT DEFAULT NULL,
      error TEXT DEFAULT NULL,
      metadata TEXT DEFAULT '{}',
      opened_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id INTEGER REFERENCES strategies(id),
      token_mint TEXT NOT NULL,
      token_symbol TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'paper',
      side TEXT NOT NULL DEFAULT 'long',
      size REAL NOT NULL,
      entry_price REAL NOT NULL,
      current_price REAL DEFAULT NULL,
      stop_loss REAL DEFAULT NULL,
      trailing_stop REAL DEFAULT NULL,
      take_profit REAL DEFAULT NULL,
      unrealized_pnl REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      opened_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT DEFAULT NULL,
      UNIQUE(strategy_id, token_mint, status)
    );

    CREATE TABLE IF NOT EXISTS market_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_mint TEXT NOT NULL,
      token_symbol TEXT NOT NULL,
      price REAL NOT NULL,
      volume_24h REAL DEFAULT NULL,
      price_change_24h REAL DEFAULT NULL,
      market_cap REAL DEFAULT NULL,
      liquidity REAL DEFAULT NULL,
      recorded_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id INTEGER REFERENCES strategies(id),
      token_mint TEXT NOT NULL,
      token_symbol TEXT NOT NULL,
      signal TEXT NOT NULL,
      confidence REAL DEFAULT NULL,
      reasoning TEXT DEFAULT NULL,
      action_taken TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id INTEGER REFERENCES strategies(id),
      date TEXT NOT NULL,
      realized_pnl REAL DEFAULT 0,
      unrealized_pnl REAL DEFAULT 0,
      trade_count INTEGER DEFAULT 0,
      win_count INTEGER DEFAULT 0,
      loss_count INTEGER DEFAULT 0,
      capital REAL NOT NULL,
      UNIQUE(strategy_id, date)
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS watched_tokens (
      mint TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT DEFAULT NULL,
      decimals INTEGER DEFAULT 9,
      logo_uri TEXT DEFAULT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      is_active INTEGER DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy_id);
    CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
    CREATE INDEX IF NOT EXISTS idx_positions_strategy ON positions(strategy_id);
    CREATE INDEX IF NOT EXISTS idx_market_data_mint ON market_data(token_mint);
    CREATE INDEX IF NOT EXISTS idx_market_data_time ON market_data(recorded_at);
    CREATE INDEX IF NOT EXISTS idx_performance_strategy ON performance(strategy_id);

    INSERT OR IGNORE INTO watched_tokens (mint, symbol, name) VALUES
      ('So11111111111111111111111111111111111111112', 'SOL', 'Solana'),
      ('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'USDC', 'USD Coin'),
      ('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'USDT', 'Tether'),
      ('JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', 'JUP', 'Jupiter'),
      ('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'BONK', 'Bonk'),
      ('7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', 'ETH', 'Wrapped Ethereum');
  `)
}

export default getDb
