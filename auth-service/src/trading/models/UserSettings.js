import db from "../db.js";
import { v4 as uuidv4 } from "uuid";

// Initialize user_settings table
db.exec(`
  CREATE TABLE IF NOT EXISTS user_settings (
    id TEXT PRIMARY KEY,
    wallet_address TEXT UNIQUE NOT NULL,
    wallet_currencies TEXT DEFAULT '[]',
    orders TEXT DEFAULT '[]',
    created_at TEXT,
    updated_at TEXT
  );
  
  CREATE INDEX IF NOT EXISTS idx_user_settings_wallet ON user_settings(wallet_address);
`);

/**
 * UserSettings model - SQLite version
 */
export class UserSettings {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    this.walletAddress = data.walletAddress || data.wallet_address;
    this.wallet = this._parseJson(
      data.wallet || data.wallet_currencies || "[]"
    );
    this.orders = this._parseJson(data.orders || "[]");
    this.createdAt = data.createdAt || data.created_at;
    this.updatedAt = data.updatedAt || data.updated_at;

    // Initialize default orders if empty
    if (this.orders.length === 0) {
      this.orders = [
        {
          id: uuidv4(),
          name: "Zlecenie 1",
          isActive: false,
          refreshInterval: 60,
          minProfitPercent: 0.5,
          focusPrice: 94000,
          timeToNewFocus: 0,
          buy: {
            currency: "USDC",
            walletProtection: 100,
            mode: "walletLimit",
            maxValue: 0,
            addProfit: false,
          },
          sell: {
            currency: "BTC",
            walletProtection: 0.01,
            mode: "onlyBought",
            maxValue: 0,
            addProfit: false,
          },
          platform: {
            minTransactionValue: 10,
            checkFeeProfit: true,
          },
          buyConditions: {
            minValuePer1Percent: 200,
            priceThreshold: 100000,
            checkThresholdIfProfitable: true,
          },
          sellConditions: {
            minValuePer1Percent: 200,
            priceThreshold: 89000,
            checkThresholdIfProfitable: true,
          },
          trendPercents: [
            { trend: 0, buyPercent: 0.5, sellPercent: 0.5 },
            { trend: 1, buyPercent: 1, sellPercent: 1 },
            { trend: 2, buyPercent: 0.6, sellPercent: 0.6 },
            { trend: 5, buyPercent: 0.1, sellPercent: 0.1 },
          ],
          additionalBuyValues: [
            { condition: "less", price: 104000, value: 50 },
            { condition: "greaterEqual", price: 100000, value: 70 },
            { condition: "greater", price: 89000, value: 250 },
          ],
          additionalSellValues: [
            { condition: "less", price: 104000, value: 150 },
            { condition: "greaterEqual", price: 100000, value: 100 },
            { condition: "greater", price: 89000, value: 50 },
          ],
          maxBuyPerTransaction: [
            // zakresy: minPrice <= cena < maxPrice
            { minPrice: 0, maxPrice: 89000, value: 2000 },
            { minPrice: 89000, maxPrice: 100000, value: 700 },
            { minPrice: 100000, maxPrice: null, value: 500 },
          ],
          maxSellPerTransaction: [
            { minPrice: 0, maxPrice: 89000, value: 1500 },
            { minPrice: 89000, maxPrice: 100000, value: 1000 },
            { minPrice: 100000, maxPrice: null, value: 500 },
          ],
          buySwingPercent: [
            // zakresy cen: minPrice <= cena < maxPrice => min wahanie %
            { minPrice: 0, maxPrice: 90000, value: 0.1 },
            { minPrice: 90000, maxPrice: 95000, value: 0.2 },
            { minPrice: 95000, maxPrice: 100000, value: 0.5 },
            { minPrice: 100000, maxPrice: null, value: 1 },
          ],
          sellSwingPercent: [
            { minPrice: 0, maxPrice: 90000, value: 0.1 },
            { minPrice: 90000, maxPrice: 95000, value: 0.2 },
            { minPrice: 95000, maxPrice: 100000, value: 0.5 },
            { minPrice: 100000, maxPrice: null, value: 1 },
          ],
        },
      ];
    }
  }

  _parseJson(value) {
    if (Array.isArray(value)) return value;
    try {
      return JSON.parse(value || "[]");
    } catch {
      return [];
    }
  }

  save() {
    const now = new Date().toISOString();
    this.updatedAt = now;
    if (!this.createdAt) this.createdAt = now;

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO user_settings (id, wallet_address, wallet_currencies, orders, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      this.id,
      this.walletAddress,
      JSON.stringify(this.wallet),
      JSON.stringify(this.orders),
      this.createdAt,
      this.updatedAt
    );

    return this;
  }

  static findOne({ walletAddress }) {
    const row = db
      .prepare("SELECT * FROM user_settings WHERE wallet_address = ?")
      .get(walletAddress?.toLowerCase());
    return row ? new UserSettings(row) : null;
  }

  static findById(id) {
    const row = db.prepare("SELECT * FROM user_settings WHERE id = ?").get(id);
    return row ? new UserSettings(row) : null;
  }
}

export default UserSettings;
