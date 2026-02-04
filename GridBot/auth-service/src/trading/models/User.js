import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

// Initialize users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    wallet_address TEXT UNIQUE NOT NULL,
    nonce TEXT,
    last_login TEXT,
    created_at TEXT
  );
  
  CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
`);

/**
 * User model - SQLite version
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

  save() {
    const now = new Date().toISOString();
    if (!this.createdAt) this.createdAt = now;

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO users (id, wallet_address, nonce, last_login, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(this.id, this.walletAddress, this.nonce, this.lastLogin, this.createdAt);
    return this;
  }

  static findOne({ walletAddress }) {
    const row = db.prepare('SELECT * FROM users WHERE wallet_address = ?').get(walletAddress?.toLowerCase());
    return row ? new User(row) : null;
  }

  static findById(id) {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    return row ? new User(row) : null;
  }
}

export default User;
