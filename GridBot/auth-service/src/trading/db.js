import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../../data/gridbot.db');

// Ensure data directory exists
import fs from 'fs';
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS grid_states (
    id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    order_id TEXT NOT NULL,
    current_focus_price REAL,
    focus_last_updated TEXT,
    buy_trend_counter INTEGER DEFAULT 0,
    sell_trend_counter INTEGER DEFAULT 0,
    next_buy_target REAL,
    next_sell_target REAL,
    open_position_ids TEXT DEFAULT '[]',
    open_sell_position_ids TEXT DEFAULT '[]',
    total_profit REAL DEFAULT 0,
    total_buy_transactions INTEGER DEFAULT 0,
    total_sell_transactions INTEGER DEFAULT 0,
    total_bought_value REAL DEFAULT 0,
    total_sold_value REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    last_updated TEXT,
    created_at TEXT,
    last_known_price REAL,
    last_price_update TEXT,
    UNIQUE(wallet_address, order_id)
  );

  CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    order_id TEXT NOT NULL,
    type TEXT NOT NULL,
    buy_price REAL,
    buy_value REAL,
    sell_price REAL,
    sell_value REAL,
    amount REAL,
    trend_at_buy INTEGER,
    target_sell_price REAL,
    target_buyback_price REAL,
    status TEXT DEFAULT 'OPEN',
    profit REAL,
    created_at TEXT,
    closed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_grid_states_wallet ON grid_states(wallet_address, order_id);
  CREATE INDEX IF NOT EXISTS idx_positions_wallet ON positions(wallet_address, order_id);
  CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
`);

console.log('✅ SQLite database initialized');

export default db;
