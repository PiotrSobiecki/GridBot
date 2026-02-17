import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Position - pojedyncza pozycja (zakup lub sprzedaż short)
 */
export const PositionStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED'
};

export const PositionType = {
  BUY: 'BUY',
  SELL: 'SELL'
};

export class Position {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    this.walletAddress = data.walletAddress || data.wallet_address;
    this.orderId = data.orderId || data.order_id;
    this.type = data.type || PositionType.BUY;
    this.buyPrice = data.buyPrice ?? data.buy_price;
    this.buyValue = data.buyValue ?? data.buy_value;
    this.sellPrice = data.sellPrice ?? data.sell_price;
    this.sellValue = data.sellValue ?? data.sell_value;
    this.amount = data.amount ?? 0;
    this.trendAtBuy = data.trendAtBuy ?? data.trend_at_buy ?? 0;
    this.targetSellPrice = data.targetSellPrice ?? data.target_sell_price;
    this.targetBuybackPrice = data.targetBuybackPrice ?? data.target_buyback_price;
    this.status = data.status || PositionStatus.OPEN;
    this.profit = data.profit ?? 0;
    this.createdAt = data.createdAt || data.created_at;
    this.closedAt = data.closedAt || data.closed_at;
  }

  async save() {
    const now = new Date().toISOString();
    if (!this.createdAt) this.createdAt = now;

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO positions (
        id, wallet_address, order_id, type, buy_price, buy_value,
        sell_price, sell_value, amount, trend_at_buy, target_sell_price,
        target_buyback_price, status, profit, created_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    await stmt.run(
      this.id,
      this.walletAddress,
      this.orderId,
      this.type,
      this.buyPrice,
      this.buyValue,
      this.sellPrice,
      this.sellValue,
      this.amount,
      this.trendAtBuy,
      this.targetSellPrice,
      this.targetBuybackPrice,
      this.status,
      this.profit,
      this.createdAt,
      this.closedAt
    );

    return this;
  }

  static async findById(id) {
    const stmt = db.prepare('SELECT * FROM positions WHERE id = ?');
    const row = await stmt.get(id);
    return row ? new Position(row) : null;
  }

  static async findByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const stmt = db.prepare(`SELECT * FROM positions WHERE id IN (${placeholders})`);
    const rows = await stmt.all(...ids);
    return rows.map(row => new Position(row));
  }

  static async findByWalletAndOrderId(walletAddress, orderId, status = null) {
    let query = 'SELECT * FROM positions WHERE wallet_address = ? AND order_id = ?';
    const params = [walletAddress, orderId];
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    const stmt = db.prepare(query);
    const rows = await stmt.all(...params);
    return rows.map(row => new Position(row));
  }

  static findOpenByWalletAndOrderId(walletAddress, orderId) {
    return Position.findByWalletAndOrderId(walletAddress, orderId, PositionStatus.OPEN);
  }

  /**
   * Usuwa pozycję z bazy danych
   */
  async delete() {
    const stmt = db.prepare('DELETE FROM positions WHERE id = ?');
    await stmt.run(this.id);
    return true;
  }

  /**
   * Zwraca łączny profit ze wszystkich ZAMKNIĘTYCH pozycji
   * dla danego portfela i zlecenia (long + short).
   * Używane do spójnego wyliczania totalProfit w GridState.
   */
  static async getTotalClosedProfit(walletAddress, orderId) {
    const stmt = db.prepare(
      'SELECT COALESCE(SUM(profit), 0) AS total FROM positions WHERE wallet_address = ? AND order_id = ? AND status = ?'
    );
    const row = await stmt.get(walletAddress, orderId, PositionStatus.CLOSED);
    return row?.total ?? 0;
  }

  toJSON() {
    return {
      id: this.id,
      walletAddress: this.walletAddress,
      orderId: this.orderId,
      type: this.type,
      buyPrice: this.buyPrice,
      buyValue: this.buyValue,
      sellPrice: this.sellPrice,
      sellValue: this.sellValue,
      amount: this.amount,
      trendAtBuy: this.trendAtBuy,
      targetSellPrice: this.targetSellPrice,
      targetBuybackPrice: this.targetBuybackPrice,
      status: this.status,
      profit: this.profit,
      createdAt: this.createdAt,
      closedAt: this.closedAt
    };
  }
}

export default Position;
