export interface WalletBalance {
  currency: string;
  balance: number;
  reserved: number;
}

export interface PriceThreshold {
  /**
   * Stare podejście – pojedynczy warunek względem jednej ceny.
   * Używane dalej dla: additionalBuyValues / additionalSellValues.
   */
  condition?: "less" | "lessEqual" | "greater" | "greaterEqual";
  price?: number;

  /**
   * Nowe podejście – zakres cen w jednej linii:
   * minPrice <= cena < maxPrice (jeśli wartości ustawione).
   * Używane dla: maxBuyPerTransaction / maxSellPerTransaction.
   */
  minPrice?: number | null;
  maxPrice?: number | null;

  value: number;
}

export interface TrendPercent {
  trend: number;
  buyPercent: number;
  sellPercent: number;
}

export interface SwingPercent {
  // Zakres cen: minPrice <= cena < maxPrice
  minPrice?: number | null;
  maxPrice?: number | null;
  value: number;
}

export interface BuySellSettings {
  currency: string;
  walletProtection: number;
  mode: "onlySold" | "onlyBought" | "maxDefined" | "walletLimit";
  maxValue: number;
  addProfit: boolean;
}

export interface PlatformSettings {
  minTransactionValue: number;
  checkFeeProfit: boolean;
}

export interface TransactionConditions {
  minValuePer1Percent: number;
  priceThreshold: number;
  checkThresholdIfProfitable: boolean;
}

export interface OrderSettings {
  _id?: string;
  name: string;
  isActive: boolean;

  // 1# Ogólne ustawienia
  refreshInterval: number;
  minProfitPercent: number;
  focusPrice: number;
  timeToNewFocus: number;
  buyTrendCounter: number;
  sellTrendCounter: number;

  // Para handlowa
  baseAsset?: string; // np. BTC
  quoteAsset?: string; // np. USDT (stable na spocie)
  
  // Giełda dla tego zlecenia
  exchange?: "asterdex" | "bingx";

  // 2# Wymagania KUPNO/SPRZEDAŻ
  buy: BuySellSettings;
  sell: BuySellSettings;

  // 3# Wymagania Platformy
  platform: PlatformSettings;

  // 4# Warunek kolejnych transakcji
  buyConditions: TransactionConditions;
  sellConditions: TransactionConditions;

  // 5# Procent do nowej transakcji
  trendPercents: TrendPercent[];

  // 6# Dodatkowa wartość kupna/sprzedaży
  additionalBuyValues: PriceThreshold[];
  additionalSellValues: PriceThreshold[];

  // 7# MAX SPRZEDAŻ/KUPNO poj. transakcji
  maxBuyPerTransaction: PriceThreshold[];
  maxSellPerTransaction: PriceThreshold[];

  // 8# Procent wahania
  buySwingPercent: SwingPercent[];
  sellSwingPercent: SwingPercent[];
}

export interface Position {
  id: string;
  walletAddress: string;
  orderId: string;
  type: "BUY" | "SELL";
  buyPrice: number;
  buyValue: number;
  sellPrice: number;
  sellValue: number;
  amount: number;
  trendAtBuy: number;
  targetSellPrice: number;
  targetBuybackPrice: number;
  status: "OPEN" | "CLOSED" | "CANCELLED";
  profit?: number;
  createdAt: string;
  closedAt?: string;
}

export interface GridState {
  id: string;
  walletAddress: string;
  orderId: string;
  currentFocusPrice: number;
  focusLastUpdated: string;
  buyTrendCounter: number;
  sellTrendCounter: number;
  nextBuyTarget: number;
  nextSellTarget: number;
  openPositionIds: string[];
  openSellPositionIds: string[];
  totalProfit: number;
  totalBuyTransactions: number;
  totalSellTransactions: number;
  totalBoughtValue: number;
  totalSoldValue: number;
  isActive: boolean;
  lastKnownPrice: number;
  lastPriceUpdate: string;
  lastUpdated: string;
  createdAt: string;
}

export interface Transaction {
  orderId: string;
  type: "buy" | "sell";
  currency: string;
  amount: number;
  price: number;
  value: number;
  profit?: number;
  trend: number;
  timestamp: string;
}

export interface UserSettings {
  walletAddress: string;
  wallet: WalletBalance[];
  orders: OrderSettings[];
  transactionHistory: Transaction[];
  exchange?: "asterdex" | "bingx";
  createdAt: string;
  updatedAt: string;
}

export interface PriceData {
  symbol: string;
  price: number;
  timestamp: number;
  priceChangePercent?: number | null; // Zmiana ceny z 24h (z AsterDex)
}
