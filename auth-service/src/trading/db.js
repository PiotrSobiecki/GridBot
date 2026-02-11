import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Sprawdź czy używamy Postgresa (produkcja na Railway) czy SQLite (lokalnie)
const DATABASE_URL = process.env.DATABASE_URL;
const usePostgres = !!DATABASE_URL;

let db;
let dbInitialized = false;

// Helper do konwersji SQLite SQL na Postgres
function convertSqliteToPostgres(sql) {
  let pgSql = sql;
  
  // Zamień INSERT OR REPLACE na INSERT ... ON CONFLICT
  if (pgSql.match(/INSERT OR REPLACE INTO/i)) {
    const tableMatch = pgSql.match(/INSERT OR REPLACE INTO\s+(\w+)/i);
    if (tableMatch) {
      const table = tableMatch[1];
      const columnsMatch = pgSql.match(/\(([^)]+)\)/);
      if (columnsMatch) {
        const columns = columnsMatch[1].split(',').map(c => c.trim());
        const primaryKey = columns[0]; // Zakładamy że pierwsza kolumna to PK
        
        // Znajdź VALUES
        const valuesIdx = pgSql.indexOf('VALUES');
        if (valuesIdx > 0) {
          const beforeValues = pgSql.substring(0, valuesIdx);
          const afterValues = pgSql.substring(valuesIdx);
          
          // Stwórz UPDATE SET dla wszystkich kolumn oprócz PK
          const updateCols = columns.slice(1).map((col, idx) => 
            `${col} = EXCLUDED.${col}`
          ).join(', ');
          
          pgSql = `INSERT INTO ${table} ${columnsMatch[0]} ${afterValues} ON CONFLICT (${primaryKey}) DO UPDATE SET ${updateCols}`;
        }
      }
    }
  }
  
  return pgSql;
}

// Helper do konwersji parametrów ? na $1, $2, ...
function convertParams(sql) {
  let paramIndex = 1;
  return sql.replace(/\?/g, () => `$${paramIndex++}`);
}

if (usePostgres) {
  // Postgres na produkcji (Railway) - użyjemy sync wrappera przez deasync lub zmienimy modele na async
  console.log('📦 Using PostgreSQL database (production)');
  
  // Dla Postgres musimy użyć async, więc stworzymy wrapper
  const pgModule = await import('pg');
  const { Pool } = pgModule.default || pgModule;
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  // Inicjalizuj tabele w Postgresie
  await initPostgresTables(pool);
  console.log('✅ PostgreSQL database initialized');
  dbInitialized = true;

  // Adapter Postgres -> podobny interfejs jak better-sqlite3
  // Uwaga: dla Postgres wywołania są async, więc modele będą musiały używać await
  db = {
    pool,
    _isAsync: true, // Flaga że to async DB
    prepare: (sql) => {
      const pgSql = convertParams(convertSqliteToPostgres(sql));
      
      return {
        get: async (...params) => {
          try {
            const result = await pool.query(pgSql, params);
            return result.rows[0] || null;
          } catch (error) {
            console.error('Postgres query error:', error.message, 'SQL:', pgSql);
            throw error;
          }
        },
        all: async (...params) => {
          try {
            const result = await pool.query(pgSql, params);
            return result.rows;
          } catch (error) {
            console.error('Postgres query error:', error.message, 'SQL:', pgSql);
            throw error;
          }
        },
        run: async (...params) => {
          try {
            const result = await pool.query(pgSql, params);
            return {
              changes: result.rowCount || 0,
              lastInsertRowid: result.rows[0]?.id || null,
            };
          } catch (error) {
            console.error('Postgres query error:', error.message, 'SQL:', pgSql);
            throw error;
          }
        },
      };
    },
    exec: async (sql) => {
      const statements = sql.split(';').filter(s => s.trim());
      for (const stmt of statements) {
        if (stmt.trim()) {
          try {
            await pool.query(stmt.trim());
          } catch (error) {
            // Ignoruj błędy typu "table already exists"
            if (!error.message.includes('already exists')) {
              console.error('Postgres exec error:', error.message);
            }
          }
        }
      }
    },
  };
} else {
  // SQLite lokalnie (dev)
  console.log('📦 Using SQLite database (local development)');
  
  const Database = (await import('better-sqlite3')).default;
  const dbPath = path.join(__dirname, '../../data/gridbot.db');
  
  // Ensure data directory exists
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const sqliteDb = new Database(dbPath);
  sqliteDb._isAsync = false; // Flaga że to sync DB

  // Wrapper dla exec żeby był async (dla spójności z Postgres)
  const originalExec = sqliteDb.exec.bind(sqliteDb);
  sqliteDb.exec = async (sql) => {
    return originalExec(sql);
  };

  // Initialize tables
  await sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      wallet_address TEXT UNIQUE NOT NULL,
      nonce TEXT,
      last_login TEXT,
      created_at TEXT
    );

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

    CREATE TABLE IF NOT EXISTS user_settings (
      id TEXT PRIMARY KEY,
      wallet_address TEXT UNIQUE NOT NULL,
      wallet_currencies TEXT DEFAULT '[]',
      orders TEXT DEFAULT '[]',
      api_config TEXT DEFAULT '{}',
      created_at TEXT,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_grid_states_wallet ON grid_states(wallet_address, order_id);
    CREATE INDEX IF NOT EXISTS idx_positions_wallet ON positions(wallet_address, order_id);
    CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
    CREATE INDEX IF NOT EXISTS idx_user_settings_wallet ON user_settings(wallet_address);
  `);

  db = sqliteDb;
  console.log('✅ SQLite database initialized');
  dbInitialized = true;
}

// Funkcja do inicjalizacji tabel w Postgresie
async function initPostgresTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      wallet_address VARCHAR(255) UNIQUE NOT NULL,
      nonce TEXT,
      last_login TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS grid_states (
      id VARCHAR(255) PRIMARY KEY,
      wallet_address VARCHAR(255) NOT NULL,
      order_id VARCHAR(255) NOT NULL,
      current_focus_price DOUBLE PRECISION,
      focus_last_updated TEXT,
      buy_trend_counter INTEGER DEFAULT 0,
      sell_trend_counter INTEGER DEFAULT 0,
      next_buy_target DOUBLE PRECISION,
      next_sell_target DOUBLE PRECISION,
      open_position_ids TEXT DEFAULT '[]',
      open_sell_position_ids TEXT DEFAULT '[]',
      total_profit DOUBLE PRECISION DEFAULT 0,
      total_buy_transactions INTEGER DEFAULT 0,
      total_sell_transactions INTEGER DEFAULT 0,
      total_bought_value DOUBLE PRECISION DEFAULT 0,
      total_sold_value DOUBLE PRECISION DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      last_updated TEXT,
      created_at TEXT,
      last_known_price DOUBLE PRECISION,
      last_price_update TEXT,
      UNIQUE(wallet_address, order_id)
    );

    CREATE TABLE IF NOT EXISTS positions (
      id VARCHAR(255) PRIMARY KEY,
      wallet_address VARCHAR(255) NOT NULL,
      order_id VARCHAR(255) NOT NULL,
      type VARCHAR(50) NOT NULL,
      buy_price DOUBLE PRECISION,
      buy_value DOUBLE PRECISION,
      sell_price DOUBLE PRECISION,
      sell_value DOUBLE PRECISION,
      amount DOUBLE PRECISION,
      trend_at_buy INTEGER,
      target_sell_price DOUBLE PRECISION,
      target_buyback_price DOUBLE PRECISION,
      status VARCHAR(50) DEFAULT 'OPEN',
      profit DOUBLE PRECISION,
      created_at TEXT,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      id VARCHAR(255) PRIMARY KEY,
      wallet_address VARCHAR(255) UNIQUE NOT NULL,
      wallet_currencies TEXT DEFAULT '[]',
      orders TEXT DEFAULT '[]',
      api_config TEXT DEFAULT '{}',
      created_at TEXT,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_grid_states_wallet ON grid_states(wallet_address, order_id);
    CREATE INDEX IF NOT EXISTS idx_positions_wallet ON positions(wallet_address, order_id);
    CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
    CREATE INDEX IF NOT EXISTS idx_user_settings_wallet ON user_settings(wallet_address);
  `);
}

// Helper do synchronicznego/asynchronicznego wywołania
export function dbCall(method, ...args) {
  if (db._isAsync) {
    // Postgres - zwróć Promise
    return method(...args);
  } else {
    // SQLite - zwróć synchronicznie
    return method(...args);
  }
}

export default db;
