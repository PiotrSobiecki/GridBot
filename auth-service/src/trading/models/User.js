import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

// Initialize users table (SQLite) lub Postgres (db.exec jest async/sync-aware)
(async () => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      wallet_address TEXT UNIQUE NOT NULL,
      nonce TEXT,
      last_login TEXT,
      created_at TEXT
    );
    
    CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
  `);
})();

/**
 * User model - SQLite/Postgres version
 */
export class User {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    this._id = this.id; // MongoDB compatibility
    this.walletAddress = data.walletAddress || data.wallet_address;
    this.nonce = data.nonce;
    this.lastLogin = data.lastLogin || data.last_login;
    this.createdAt = data.createdAt || data.created_at;
  }

  async save() {
    const now = new Date().toISOString();
    if (!this.createdAt) this.createdAt = now;

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO users (id, wallet_address, nonce, last_login, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    await stmt.run(this.id, this.walletAddress, this.nonce, this.lastLogin, this.createdAt);
    return this;
  }

  static async findOne({ walletAddress }) {
    const stmt = db.prepare('SELECT * FROM users WHERE wallet_address = ?');
    const row = await stmt.get(walletAddress?.toLowerCase());
    return row ? new User(row) : null;
  }

  static async findById(id) {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    const row = await stmt.get(id);
    return row ? new User(row) : null;
  }
}

export default User;
