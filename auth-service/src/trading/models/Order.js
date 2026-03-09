import db from '../db.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Order – pojedyncze zlecenie GRID użytkownika.
 *
 * Kolumny główne trzymają pola najczęściej filtrowane/wyświetlane.
 * Złożone ustawienia (trendPercents, buyConditions, sellConditions, buy/sell wallet,
 * platform, additionalValues, maxPerTransaction, swingPercents) są w kolumnie `config` (JSON).
 */
export class Order {
  constructor(data = {}) {
    this.id             = data.id || uuidv4();
    this.walletAddress  = data.walletAddress || data.wallet_address;
    this.name           = data.name || 'Zlecenie 1';
    this.isActive       = data.isActive ?? (data.is_active == 1);
    this.exchange       = data.exchange || 'asterdex';
    this.baseAsset      = data.baseAsset  || data.base_asset  || 'BTC';
    this.quoteAsset     = data.quoteAsset || data.quote_asset || 'USDT';
    this.tradeMode      = data.tradeMode  || data.trade_mode  || 'both';
    this.refreshInterval   = Number(data.refreshInterval   ?? data.refresh_interval   ?? 30);
    this.minProfitPercent  = Number(data.minProfitPercent  ?? data.min_profit_percent  ?? 0.5);
    this.focusPrice        = Number(data.focusPrice        ?? data.focus_price        ?? 0);
    this.focusLocked       = data.focusLocked ?? (data.focus_locked != 0);
    this.timeToNewFocus    = Number(data.timeToNewFocus    ?? data.time_to_new_focus   ?? 0);

    // Złożone ustawienia z kolumny config (JSON)
    const cfg = this._parseJson(data.config || data._config || '{}');
    this.buy                  = data.buy                  ?? cfg.buy                  ?? { currency: 'USDT', walletProtection: 100, mode: 'walletLimit', maxValue: 0, addProfit: false };
    this.sell                 = data.sell                 ?? cfg.sell                 ?? { currency: 'BTC',  walletProtection: 0.01, mode: 'walletLimit', maxValue: 0, addProfit: false };
    this.platform             = data.platform             ?? cfg.platform             ?? { minTransactionValue: 0, checkFeeProfit: true };
    this.buyConditions        = data.buyConditions        ?? cfg.buyConditions        ?? { minValuePer1Percent: 20, priceThreshold: 0, checkThresholdIfProfitable: true };
    this.sellConditions       = data.sellConditions       ?? cfg.sellConditions       ?? { minValuePer1Percent: 20, priceThreshold: 0, checkThresholdIfProfitable: true };
    this.trendPercents        = data.trendPercents        ?? cfg.trendPercents        ?? [];
    this.additionalBuyValues  = data.additionalBuyValues  ?? cfg.additionalBuyValues  ?? [];
    this.additionalSellValues = data.additionalSellValues ?? cfg.additionalSellValues ?? [];
    this.maxBuyPerTransaction  = data.maxBuyPerTransaction  ?? cfg.maxBuyPerTransaction  ?? [];
    this.maxSellPerTransaction = data.maxSellPerTransaction ?? cfg.maxSellPerTransaction ?? [];
    this.buySwingPercent  = data.buySwingPercent  ?? cfg.buySwingPercent  ?? [];
    this.sellSwingPercent = data.sellSwingPercent ?? cfg.sellSwingPercent ?? [];

    this.createdAt = data.createdAt || data.created_at;
    this.updatedAt = data.updatedAt || data.updated_at;
  }

  _parseJson(value) {
    if (value && typeof value === 'object') return value;
    try { return JSON.parse(value || '{}'); } catch { return {}; }
  }

  /** Buduje obiekt `config` do zapisu w bazie */
  _buildConfig() {
    return JSON.stringify({
      buy:                  this.buy,
      sell:                 this.sell,
      platform:             this.platform,
      buyConditions:        this.buyConditions,
      sellConditions:       this.sellConditions,
      trendPercents:        this.trendPercents,
      additionalBuyValues:  this.additionalBuyValues,
      additionalSellValues: this.additionalSellValues,
      maxBuyPerTransaction:  this.maxBuyPerTransaction,
      maxSellPerTransaction: this.maxSellPerTransaction,
      buySwingPercent:  this.buySwingPercent,
      sellSwingPercent: this.sellSwingPercent,
    });
  }

  /**
   * Zwraca pełny obiekt ustawień – taki, jakiego oczekuje GridAlgorithmService
   * (płaski obiekt z wszystkimi polami).
   */
  toSettings() {
    return {
      id:                   this.id,
      _id:                  this.id,
      name:                 this.name,
      isActive:             this.isActive,
      exchange:             this.exchange,
      baseAsset:            this.baseAsset,
      quoteAsset:           this.quoteAsset,
      tradeMode:            this.tradeMode,
      refreshInterval:      this.refreshInterval,
      minProfitPercent:     this.minProfitPercent,
      focusPrice:           this.focusPrice,
      focusLocked:          this.focusLocked,
      timeToNewFocus:       this.timeToNewFocus,
      buy:                  this.buy,
      sell:                 this.sell,
      platform:             this.platform,
      buyConditions:        this.buyConditions,
      sellConditions:       this.sellConditions,
      trendPercents:        this.trendPercents,
      additionalBuyValues:  this.additionalBuyValues,
      additionalSellValues: this.additionalSellValues,
      maxBuyPerTransaction:  this.maxBuyPerTransaction,
      maxSellPerTransaction: this.maxSellPerTransaction,
      buySwingPercent:  this.buySwingPercent,
      sellSwingPercent: this.sellSwingPercent,
    };
  }

  /** Zwraca pełny obiekt do wysłania na frontend */
  toJSON() {
    return {
      ...this.toSettings(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  async save() {
    const now = new Date().toISOString();
    this.updatedAt = now;
    if (!this.createdAt) this.createdAt = now;

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO orders (
        id, wallet_address, name, is_active, exchange, base_asset, quote_asset,
        trade_mode, refresh_interval, min_profit_percent, focus_price, focus_locked,
        time_to_new_focus, config, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    await stmt.run(
      this.id,
      this.walletAddress?.toLowerCase(),
      this.name,
      this.isActive ? 1 : 0,
      this.exchange,
      this.baseAsset,
      this.quoteAsset,
      this.tradeMode,
      this.refreshInterval,
      this.minProfitPercent,
      this.focusPrice,
      this.focusLocked ? 1 : 0,
      this.timeToNewFocus,
      this._buildConfig(),
      this.createdAt,
      this.updatedAt,
    );

    return this;
  }

  async delete() {
    const stmt = db.prepare('DELETE FROM orders WHERE id = ?');
    await stmt.run(this.id);
    return true;
  }

  // ── Statyczne metody wyszukiwania ──────────────────────────────────────────

  static async findById(id) {
    const stmt = db.prepare('SELECT * FROM orders WHERE id = ?');
    const row = await stmt.get(id);
    return row ? new Order(row) : null;
  }

  static async findByWallet(walletAddress) {
    const stmt = db.prepare('SELECT * FROM orders WHERE wallet_address = ? ORDER BY created_at ASC');
    const rows = await stmt.all(walletAddress?.toLowerCase());
    return rows.map(r => new Order(r));
  }

  static async findByWalletAndExchange(walletAddress, exchange) {
    const stmt = db.prepare('SELECT * FROM orders WHERE wallet_address = ? AND exchange = ? ORDER BY created_at ASC');
    const rows = await stmt.all(walletAddress?.toLowerCase(), exchange);
    return rows.map(r => new Order(r));
  }

  static async findAllActive() {
    const stmt = db.prepare('SELECT * FROM orders WHERE is_active = 1');
    const rows = await stmt.all();
    return rows.map(r => new Order(r));
  }

  static async findByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const stmt = db.prepare(`SELECT * FROM orders WHERE id IN (${placeholders})`);
    const rows = await stmt.all(...ids);
    return rows.map((r) => new Order(r));
  }
}

export default Order;
