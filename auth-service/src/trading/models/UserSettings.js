import db from "../db.js";
import { v4 as uuidv4 } from "uuid";

// Initialize user_settings table (SQLite) lub Postgres (db.exec jest async/sync-aware)
(async () => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      id TEXT PRIMARY KEY,
      wallet_address TEXT UNIQUE NOT NULL,
      wallet_currencies TEXT DEFAULT '[]',
      orders TEXT DEFAULT '[]',
      api_config TEXT DEFAULT '{}',
      created_at TEXT,
      updated_at TEXT
    );
    
    CREATE INDEX IF NOT EXISTS idx_user_settings_wallet ON user_settings(wallet_address);
  `);

  // Best-effort migration: dodaj kolumnę api_config jeśli jej brakuje (dla starych baz)
  try {
    await db.exec("ALTER TABLE user_settings ADD COLUMN api_config TEXT DEFAULT '{}';");
  } catch (e) {
    // Ignoruj jeśli kolumna już istnieje
  }
  
  // Best-effort migration: dodaj kolumnę exchange jeśli jej brakuje
  try {
    await db.exec("ALTER TABLE user_settings ADD COLUMN exchange TEXT DEFAULT 'asterdex';");
  } catch (e) {
    // Ignoruj jeśli kolumna już istnieje
  }
})();

/**
 * UserSettings model - SQLite version
 */
export class UserSettings {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    this.walletAddress = data.walletAddress || data.wallet_address;
    this.wallet = this._parseJson(
      data.wallet || data.wallet_currencies || "[]",
    );
    // Konfiguracja API per użytkownik (zaszyfrowane klucze, nazwa konta, avatar)
    this.apiConfig = this._parseJson(data.apiConfig || data.api_config || "{}");
    // Wybrana giełda: "asterdex" lub "bingx"
    this.exchange = data.exchange || "asterdex";
    this.createdAt = data.createdAt || data.created_at;
    this.updatedAt = data.updatedAt || data.updated_at;
  }

  _parseJson(value) {
    if (Array.isArray(value)) return value;
    try {
      return JSON.parse(value || "[]");
    } catch {
      return [];
    }
  }

  async save() {
    const now = new Date().toISOString();
    this.updatedAt = now;
    if (!this.createdAt) this.createdAt = now;

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO user_settings (id, wallet_address, wallet_currencies, api_config, exchange, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    await stmt.run(
      this.id,
      this.walletAddress,
      JSON.stringify(this.wallet),
      JSON.stringify(this.apiConfig || {}),
      this.exchange || "asterdex",
      this.createdAt,
      this.updatedAt,
    );

    return this;
  }

  static async findOne({ walletAddress }) {
    const stmt = db.prepare(
      "SELECT * FROM user_settings WHERE wallet_address = ?"
    );
    const row = await stmt.get(walletAddress?.toLowerCase());
    return row ? new UserSettings(row) : null;
  }

  static async findById(id) {
    const stmt = db.prepare("SELECT * FROM user_settings WHERE id = ?");
    const row = await stmt.get(id);
    return row ? new UserSettings(row) : null;
  }
}

export default UserSettings;
