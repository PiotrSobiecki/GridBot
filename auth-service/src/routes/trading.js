import express from "express";
import Decimal from "decimal.js";
import * as GridAlgorithmService from "../trading/services/GridAlgorithmService.js";
import * as PriceFeedService from "../trading/services/PriceFeedService.js";
import * as WalletService from "../trading/services/WalletService.js";
import * as GridSchedulerService from "../trading/services/GridSchedulerService.js";
import * as AsterSpotService from "../trading/services/AsterSpotService.js";
import UserSettings from "../models/UserSettings.js";

const router = express.Router();

// Prosty cache na symbole Aster (żeby nie pytać API przy każdym żądaniu)
let cachedAsterSymbols = null;
let cachedAsterSymbolsAt = 0;
const ASTER_SYMBOLS_TTL_MS = 10 * 60 * 1000; // 10 minut

/**
 * Inicjalizuje algorytm GRID dla zlecenia
 */
router.post("/grid/init", async (req, res) => {
  try {
    const walletAddress = req.headers["x-wallet-address"];
    const settings = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: "Missing X-Wallet-Address header" });
    }

    console.log(
      `🚀 Initializing GRID for wallet ${walletAddress} with order ${settings.id}`
    );

    const state = await GridAlgorithmService.initializeGridState(
      walletAddress,
      settings
    );
    res.json(state.toJSON());
  } catch (error) {
    console.error("Error initializing grid:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Pobiera stan algorytmu GRID
 */
router.get("/grid/state/:orderId", async (req, res) => {
  try {
    const walletAddress = req.headers["x-wallet-address"];
    const { orderId } = req.params;

    if (!walletAddress) {
      return res.status(400).json({ error: "Missing X-Wallet-Address header" });
    }

    const state = await GridAlgorithmService.getGridState(walletAddress, orderId);

    if (!state) {
      return res.status(404).json({ error: "Grid state not found" });
    }

    res.json(state.toJSON());
  } catch (error) {
    console.error("Error getting grid state:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Pobiera wszystkie stany GRID dla portfela
 */
router.get("/grid/states", async (req, res) => {
  try {
    const walletAddress = req.headers["x-wallet-address"];

    if (!walletAddress) {
      return res.status(400).json({ error: "Missing X-Wallet-Address header" });
    }

    const { GridState } = await import("../trading/models/GridState.js");
    const states = await GridState.findAllByWallet(walletAddress);

    res.json(states.map((s) => s.toJSON()));
  } catch (error) {
    console.error("Error getting grid states:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Uruchamia algorytm GRID
 */
router.post("/grid/start/:orderId", async (req, res) => {
  try {
    const walletAddress = req.headers["x-wallet-address"];
    const { orderId } = req.params;

    if (!walletAddress) {
      return res.status(400).json({ error: "Missing X-Wallet-Address header" });
    }

    console.log(
      `▶️ Starting GRID for wallet ${walletAddress} order ${orderId}`
    );
    await GridAlgorithmService.startGrid(walletAddress, orderId);
    res.json({ success: true });
  } catch (error) {
    console.error("Error starting grid:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Zatrzymuje algorytm GRID
 */
router.post("/grid/stop/:orderId", async (req, res) => {
  try {
    const walletAddress = req.headers["x-wallet-address"];
    const { orderId } = req.params;

    if (!walletAddress) {
      return res.status(400).json({ error: "Missing X-Wallet-Address header" });
    }

    console.log(
      `⏹️ Stopping GRID for wallet ${walletAddress} order ${orderId}`
    );
    await GridAlgorithmService.stopGrid(walletAddress, orderId);
    res.json({ success: true });
  } catch (error) {
    console.error("Error stopping grid:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Pobiera wszystkie pozycje (OPEN i CLOSED) dla zlecenia - do wyświetlania historii
 */
router.get("/positions/:orderId", async (req, res) => {
  try {
    const walletAddress = req.headers["x-wallet-address"];
    const { orderId } = req.params;

    if (!walletAddress) {
      return res.status(400).json({ error: "Missing X-Wallet-Address header" });
    }

    // Zwróć wszystkie pozycje (OPEN i CLOSED) dla historii
    const positions = await GridAlgorithmService.getAllPositions(
      walletAddress,
      orderId
    );

    // Logowanie dla debugowania
    const buyCount = positions.filter(
      (p) => p.type === "BUY" || !p.type
    ).length;
    const sellCount = positions.filter((p) => p.type === "SELL").length;
    console.log(
      `📊 Positions API: wallet=${walletAddress}, orderId=${orderId}, total=${positions.length}, BUY=${buyCount}, SELL=${sellCount}`
    );

    res.json(positions.map((p) => p.toJSON()));
  } catch (error) {
    console.error("Error getting positions:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Oblicza następny cel zakupu (preview)
 */
router.post("/grid/calculate-buy-target", (req, res) => {
  try {
    const { focusPrice, trend } = req.query;
    const settings = req.body;

    const fp = new Decimal(focusPrice);
    const t = parseInt(trend);

    const target = GridAlgorithmService.calculateNextBuyTarget(fp, t, settings);

    res.json({
      focusPrice: fp.toString(),
      trend: t,
      targetPrice: target.toString(),
    });
  } catch (error) {
    console.error("Error calculating buy target:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Oblicza następny cel sprzedaży (preview)
 */
router.post("/grid/calculate-sell-target", (req, res) => {
  try {
    const { focusPrice, trend } = req.query;
    const settings = req.body;

    const fp = new Decimal(focusPrice);
    const t = parseInt(trend);

    const target = GridAlgorithmService.calculateNextSellTarget(
      fp,
      t,
      settings
    );

    res.json({
      focusPrice: fp.toString(),
      trend: t,
      targetPrice: target.toString(),
    });
  } catch (error) {
    console.error("Error calculating sell target:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Pobiera aktualne ceny
 */
router.get("/prices", (req, res) => {
  res.json(PriceFeedService.getAllPrices());
});

/**
 * Pobiera cenę dla konkretnego symbolu
 */
router.get("/prices/:symbol", (req, res) => {
  const { symbol } = req.params;
  const price = PriceFeedService.getPrice(symbol);
  const stale = PriceFeedService.isPriceStale(symbol);

  res.json({
    symbol: symbol.toUpperCase(),
    price: price.toString(),
    stale,
  });
});

/**
 * Lista symboli i par spot z AsterDex (exchangeInfo)
 */
router.get("/aster/symbols", async (req, res) => {
  try {
    const now = Date.now();
    if (
      cachedAsterSymbols &&
      now - cachedAsterSymbolsAt < ASTER_SYMBOLS_TTL_MS
    ) {
      return res.json(cachedAsterSymbols);
    }

    const info = await AsterSpotService.fetchExchangeInfo();
    const symbols = Array.isArray(info.symbols) ? info.symbols : [];

    const baseAssetsSet = new Set();
    const quoteAssetsSet = new Set();

    symbols.forEach((s) => {
      if (s.baseAsset) baseAssetsSet.add(s.baseAsset);
      if (s.quoteAsset) quoteAssetsSet.add(s.quoteAsset);
    });

    // Aster spot: jako stable obsługujemy tylko USDT
    const allQuoteAssets = Array.from(quoteAssetsSet).sort();
    const quoteAssets = allQuoteAssets.includes("USDT") ? ["USDT"] : [];

    const payload = {
      symbols,
      baseAssets: Array.from(baseAssetsSet).sort(),
      quoteAssets,
    };

    cachedAsterSymbols = payload;
    cachedAsterSymbolsAt = now;

    res.json(payload);
  } catch (error) {
    console.error("Error fetching Aster symbols:", error.message);
    res.status(500).json({ error: "Failed to fetch Aster symbols" });
  }
});

/**
 * Ręcznie ustawia cenę (dla testów/symulacji)
 */
router.post("/prices/:symbol", (req, res) => {
  const { symbol } = req.params;
  const { price } = req.body;

  PriceFeedService.setPrice(symbol, price);
  res.json({ success: true });
});

/**
 * Ręcznie wywołuje przetworzenie ceny (dla testów)
 */
router.post("/grid/process-price/:orderId", async (req, res) => {
  try {
    const walletAddress = req.headers["x-wallet-address"];
    const { orderId } = req.params;
    const { price } = req.query;
    const settings = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: "Missing X-Wallet-Address header" });
    }

    await GridAlgorithmService.processPrice(
      walletAddress,
      orderId,
      new Decimal(price),
      settings
    );

    const state = await GridAlgorithmService.getGridState(walletAddress, orderId);
    res.json(state ? state.toJSON() : null);
  } catch (error) {
    console.error("Error processing price:", error);
    res.status(500).json({ error: error.message });
  }
});

// ============ WALLET API ============

/**
 * Pobiera salda portfela
 * Najpierw próbuje pobrać rzeczywiste salda z AsterDex SPOT (`GET /api/v1/account`),
 * a jeśli się nie uda, wraca do lokalnego, symulowanego portfela.
 */
router.get("/wallet/balances", async (req, res) => {
  try {
    const walletAddress = req.headers["x-wallet-address"];

    if (!walletAddress) {
      return res.status(400).json({ error: "Missing X-Wallet-Address header" });
    }

    let balances = {};

    try {
      // Prawdziwe salda z AsterDex SPOT
      const account = await AsterSpotService.fetchSpotAccount(walletAddress);

      if (Array.isArray(account?.balances)) {
        const externalBalances = {};

        account.balances.forEach((b) => {
          const asset = b.asset;
          const free = parseFloat(b.free || "0");
          const locked = parseFloat(b.locked || "0");
          const total = free + locked;

          if (asset && total > 0) {
            externalBalances[asset.toUpperCase()] = total.toString();
          }
        });

        // Zsynchronizuj z wewnętrznym portfelem (używane przez algorytm/symulację)
        await WalletService.syncBalances(walletAddress, externalBalances);
        balances = externalBalances;
      } else {
        console.warn(
          "⚠️ Aster SPOT account response bez pola balances – fallback do lokalnego portfela"
        );
        balances = WalletService.getAllBalances(walletAddress);
      }
    } catch (e) {
      console.error(
        "❌ Error fetching Aster SPOT balances, fallback to local wallet:",
        e.message
      );
      balances = WalletService.getAllBalances(walletAddress);
    }

    res.json(balances);
  } catch (error) {
    console.error("Error getting balances:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Ustawia saldo (dla testów)
 */
router.post("/wallet/balance", (req, res) => {
  try {
    const walletAddress = req.headers["x-wallet-address"];
    const { currency, balance } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: "Missing X-Wallet-Address header" });
    }

    WalletService.setBalance(walletAddress, currency, new Decimal(balance));
    res.json({ success: true });
  } catch (error) {
    console.error("Error setting balance:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Synchronizuje salda z zewnętrznego źródła
 */
router.post("/wallet/sync", async (req, res) => {
  try {
    const walletAddress = req.headers["x-wallet-address"];
    const balances = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: "Missing X-Wallet-Address header" });
    }

    await WalletService.syncBalances(walletAddress, balances);
    res.json({ success: true });
  } catch (error) {
    console.error("Error syncing balances:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Ręcznie odświeża portfel z giełdy AsterDex SPOT
 */
router.post("/wallet/refresh", async (req, res) => {
  try {
    const walletAddress = req.headers["x-wallet-address"];

    if (!walletAddress) {
      return res.status(400).json({ error: "Missing X-Wallet-Address header" });
    }

    // Pobierz rzeczywiste salda z AsterDex SPOT i zsynchronizuj
    const account = await AsterSpotService.fetchSpotAccount(walletAddress);

    if (Array.isArray(account?.balances)) {
      const externalBalances = {};
      account.balances.forEach((b) => {
        const asset = b.asset;
        const free = parseFloat(b.free || "0");
        const locked = parseFloat(b.locked || "0");
        const total = free + locked;
        if (asset && total > 0) {
          externalBalances[asset.toUpperCase()] = total.toString();
        }
      });

      await WalletService.syncBalances(walletAddress, externalBalances);
      res.json({ success: true, balances: externalBalances });
    } else {
      res.status(500).json({ error: "Failed to fetch balances from exchange" });
    }
  } catch (error) {
    console.error("Error refreshing wallet:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
