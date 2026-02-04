import mongoose from "mongoose";

// Schema dla progów cenowych
const priceThresholdSchema = new mongoose.Schema(
  {
    condition: {
      type: String,
      enum: ["less", "lessEqual", "greater", "greaterEqual"],
      required: true,
    },
    price: { type: Number, required: true },
    value: { type: Number, required: true },
  },
  { _id: false }
);

// Schema dla procentów transakcji według trendu
const trendPercentSchema = new mongoose.Schema(
  {
    trend: { type: Number, required: true },
    buyPercent: { type: Number, required: true },
    sellPercent: { type: Number, required: true },
  },
  { _id: false }
);

// Schema dla pojedynczego zlecenia/algorytmu
const orderSchema = new mongoose.Schema(
  {
    name: { type: String, default: "Zlecenie 1" },
    isActive: { type: Boolean, default: false },

    // 1# Ogólne ustawienia
    refreshInterval: { type: Number, default: 60 }, // sekundy
    minProfitPercent: { type: Number, default: 0.5 },
    focusPrice: { type: Number, default: 0 },
    timeToNewFocus: { type: Number, default: 0 }, // sekundy, 0 = wyłączone
    buyTrendCounter: { type: Number, default: 0 },
    sellTrendCounter: { type: Number, default: 0 },

    // 2# Wymagania KUPNO
    buy: {
      currency: { type: String, default: "USDC" },
      walletProtection: { type: Number, default: 0 },
      mode: {
        type: String,
        enum: ["onlySold", "maxDefined", "walletLimit"],
        default: "walletLimit",
      },
      maxValue: { type: Number, default: 0 },
      addProfit: { type: Boolean, default: false },
    },

    // 2# Wymagania SPRZEDAŻ
    sell: {
      currency: { type: String, default: "BTC" },
      walletProtection: { type: Number, default: 0 },
      mode: {
        type: String,
        enum: ["onlyBought", "maxDefined", "walletLimit"],
        default: "walletLimit",
      },
      maxValue: { type: Number, default: 0 },
      addProfit: { type: Boolean, default: false },
    },

    // 3# Wymagania Platformy
    platform: {
      minTransactionValue: { type: Number, default: 10 },
      checkFeeProfit: { type: Boolean, default: true },
    },

    // 4# Warunek kolejnych transakcji
    buyConditions: {
      minValuePer1Percent: { type: Number, default: 200 },
      priceThreshold: { type: Number, default: 100000 },
      checkThresholdIfProfitable: { type: Boolean, default: true },
    },

    sellConditions: {
      minValuePer1Percent: { type: Number, default: 200 },
      priceThreshold: { type: Number, default: 89000 },
      checkThresholdIfProfitable: { type: Boolean, default: true },
    },

    // 5# Procent do nowej transakcji (według trendu)
    trendPercents: {
      type: [trendPercentSchema],
      default: [
        { trend: 0, buyPercent: 0.5, sellPercent: 0.5 },
        { trend: 1, buyPercent: 1, sellPercent: 1 },
        { trend: 2, buyPercent: 0.6, sellPercent: 0.3 },
        { trend: 5, buyPercent: 0.5, sellPercent: 0.5 },
        { trend: 10, buyPercent: 0.1, sellPercent: 1 },
      ],
    },

    // 6# Dodatkowa wartość kupna/sprzedaży
    additionalBuyValues: {
      type: [priceThresholdSchema],
      default: [
        // zakresy: minPrice <= cena < maxPrice
        { minPrice: 0, maxPrice: 89000, value: 250 },
        { minPrice: 89000, maxPrice: 100000, value: 70 },
        { minPrice: 100000, maxPrice: null, value: 50 },
      ],
    },

    additionalSellValues: {
      type: [priceThresholdSchema],
      default: [
        { minPrice: 0, maxPrice: 89000, value: 50 },
        { minPrice: 89000, maxPrice: 100000, value: 100 },
        { minPrice: 100000, maxPrice: null, value: 150 },
      ],
    },

    // 7# MAX SPRZEDAŻ/KUPNO poj. transakcji
    maxBuyPerTransaction: {
      type: [priceThresholdSchema],
      default: [
        { condition: "less", price: 104000, value: 500 },
        { condition: "greaterEqual", price: 100000, value: 700 },
        { condition: "greater", price: 89000, value: 2000 },
      ],
    },

    maxSellPerTransaction: {
      type: [priceThresholdSchema],
      default: [
        { condition: "less", price: 104000, value: 1500 },
        { condition: "greaterEqual", price: 100000, value: 1000 },
        { condition: "greater", price: 89000, value: 500 },
      ],
    },

    // 8# Procent wahania
    buySwingPercent: {
      type: [{ minPrice: Number, maxPrice: Number, value: Number }],
      default: [
        // zakresy cen: minPrice <= cena < maxPrice => min wahanie %
        { minPrice: 0, maxPrice: 90000, value: 0.1 },
        { minPrice: 90000, maxPrice: 95000, value: 0.2 },
        { minPrice: 95000, maxPrice: 100000, value: 0.5 },
        { minPrice: 100000, maxPrice: null, value: 1 },
      ],
    },

    sellSwingPercent: {
      type: [{ minPrice: Number, maxPrice: Number, value: Number }],
      default: [
        { minPrice: 0, maxPrice: 90000, value: 0.1 },
        { minPrice: 90000, maxPrice: 95000, value: 0.2 },
        { minPrice: 95000, maxPrice: 100000, value: 0.5 },
        { minPrice: 100000, maxPrice: null, value: 1 },
      ],
    },
  },
  { _id: true }
);

// Główna schema ustawień użytkownika
const userSettingsSchema = new mongoose.Schema({
  walletAddress: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
  },

  // Portfel
  wallet: {
    type: [
      {
        currency: String,
        balance: Number,
        reserved: Number,
      },
    ],
    default: [
      { currency: "USDC", balance: 10000, reserved: 0 },
      { currency: "BTC", balance: 1, reserved: 0 },
      { currency: "DOGE", balance: 1000, reserved: 0 },
      { currency: "ETH", balance: 0, reserved: 0 },
      { currency: "SOL", balance: 0, reserved: 0 },
    ],
  },

  // Lista zleceń/algorytmów
  orders: {
    type: [orderSchema],
    default: [],
  },

  // Historia transakcji
  transactionHistory: [
    {
      orderId: mongoose.Schema.Types.ObjectId,
      type: { type: String, enum: ["buy", "sell"] },
      currency: String,
      amount: Number,
      price: Number,
      value: Number,
      profit: Number,
      trend: Number,
      timestamp: { type: Date, default: Date.now },
    },
  ],

  createdAt: {
    type: Date,
    default: Date.now,
  },

  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

userSettingsSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model("UserSettings", userSettingsSchema);
