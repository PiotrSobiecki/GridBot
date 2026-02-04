import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * GridState - stan algorytmu GRID dla konkretnego zlecenia
 */
export class GridState {
  constructor(data = {}) {
    this.id = data.id || uuidv4();
    this.walletAddress = data.walletAddress || data.wallet_address;
    this.orderId = data.orderId || data.order_id;
    this.currentFocusPrice = data.currentFocusPrice ?? data.current_focus_price ?? 0;
    this.focusLastUpdated = data.focusLastUpdated || data.focus_last_updated;
    this.buyTrendCounter = data.buyTrendCounter ?? data.buy_trend_counter ?? 0;
    this.sellTrendCounter = data.sellTrendCounter ?? data.sell_trend_counter ?? 0;
    this.nextBuyTarget = data.nextBuyTarget ?? data.next_buy_target;
    this.nextSellTarget = data.nextSellTarget ?? data.next_sell_target;
    this.openPositionIds = this._parseJson(data.openPositionIds || data.open_position_ids || '[]');
    this.openSellPositionIds = this._parseJson(data.openSellPositionIds || data.open_sell_position_ids || '[]');
    this.totalProfit = data.totalProfit ?? data.total_profit ?? 0;
    this.totalBuyTransactions = data.totalBuyTransactions ?? data.total_buy_transactions ?? 0;
    this.totalSellTransactions = data.totalSellTransactions ?? data.total_sell_transactions ?? 0;
    this.totalBoughtValue = data.totalBoughtValue ?? data.total_bought_value ?? 0;
    this.totalSoldValue = data.totalSoldValue ?? data.total_sold_value ?? 0;
    this.isActive = data.isActive ?? data.is_active ?? true;
    this.lastUpdated = data.lastUpdated || data.last_updated;
    this.createdAt = data.createdAt || data.created_at;
    this.lastKnownPrice = data.lastKnownPrice ?? data.last_known_price;
    this.lastPriceUpdate = data.lastPriceUpdate || data.last_price_update;
  }

  _parseJson(value) {
    if (Array.isArray(value)) return value;
    try {
      return JSON.parse(value || '[]');
    } catch {
      return [];
    }
  }

  save() {
    const now = new Date().toISOString();
    this.lastUpdated = now;
    if (!this.createdAt) this.createdAt = now;

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO grid_states (
        id, wallet_address, order_id, current_focus_price, focus_last_updated,
        buy_trend_counter, sell_trend_counter, next_buy_target, next_sell_target,
        open_position_ids, open_sell_position_ids, total_profit,
        total_buy_transactions, total_sell_transactions, total_bought_value,
        total_sold_value, is_active, last_updated, created_at,
        last_known_price, last_price_update
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      this.id,
      this.walletAddress,
      this.orderId,
      this.currentFocusPrice,
      this.focusLastUpdated,
      this.buyTrendCounter,
      this.sellTrendCounter,
      this.nextBuyTarget,
      this.nextSellTarget,
      JSON.stringify(this.openPositionIds),
      JSON.stringify(this.openSellPositionIds),
      this.totalProfit,
      this.totalBuyTransactions,
      this.totalSellTransactions,
      this.totalBoughtValue,
      this.totalSoldValue,
      this.isActive ? 1 : 0,
      this.lastUpdated,
      this.createdAt,
      this.lastKnownPrice,
      this.lastPriceUpdate
    );

    return this;
  }

  static findByWalletAndOrderId(walletAddress, orderId) {
    const row = db.prepare(
      'SELECT * FROM grid_states WHERE wallet_address = ? AND order_id = ?'
    ).get(walletAddress, orderId);
    
    return row ? new GridState(row) : null;
  }

  static findAllActive() {
    const rows = db.prepare('SELECT * FROM grid_states WHERE is_active = 1').all();
    return rows.map(row => new GridState(row));
  }

  static findAllByWallet(walletAddress) {
    const rows = db.prepare('SELECT * FROM grid_states WHERE wallet_address = ?').all(walletAddress);
    return rows.map(row => new GridState(row));
  }

  toJSON() {
    return {
      id: this.id,
      walletAddress: this.walletAddress,
      orderId: this.orderId,
      currentFocusPrice: this.currentFocusPrice,
      focusLastUpdated: this.focusLastUpdated,
      buyTrendCounter: this.buyTrendCounter,
      sellTrendCounter: this.sellTrendCounter,
      nextBuyTarget: this.nextBuyTarget,
      nextSellTarget: this.nextSellTarget,
      openPositionIds: this.openPositionIds,
      openSellPositionIds: this.openSellPositionIds,
      totalProfit: this.totalProfit,
      totalBuyTransactions: this.totalBuyTransactions,
      totalSellTransactions: this.totalSellTransactions,
      totalBoughtValue: this.totalBoughtValue,
      totalSoldValue: this.totalSoldValue,
      isActive: this.isActive,
      lastUpdated: this.lastUpdated,
      createdAt: this.createdAt,
      lastKnownPrice: this.lastKnownPrice,
      lastPriceUpdate: this.lastPriceUpdate
    };
  }
}

export default GridState;
