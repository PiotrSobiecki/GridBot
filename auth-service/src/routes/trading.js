import express from "express";
import Decimal from "decimal.js";
import * as GridAlgorithmService from "../trading/services/GridAlgorithmService.js";
import * as PriceFeedService from "../trading/services/PriceFeedService.js";
import * as WalletService from "../trading/services/WalletService.js";
import * as GridSchedulerService from "../trading/services/GridSchedulerService.js";
import * as AsterSpotService from "../trading/services/AsterSpotService.js";
import * as BingXService from "../trading/services/BingXService.js";
import UserSettings from "../trading/models/UserSettings.js";

/**
 * Pobiera wybraną giełdę dla użytkownika
 */
async function getExchangeForWallet(walletAddress) {
  if (!walletAddress) {
    return "asterdex";
  }
  
  try {
    const settings = await UserSettings.findOne({
      walletAddress: walletAddress.toLowerCase(),
    });
    
    const exchange = settings?.exchange || "asterdex";
    return exchange === "bingx" ? "bingx" : "asterdex";
  } catch (e) {
    console.warn(`⚠️ Failed to get exchange for wallet=${walletAddress}:`, e.message);
    return "asterdex";
  }
}

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
 * Usuwa pozycję z historii i bazy danych
 */
router.delete("/positions/:positionId", async (req, res) => {
  try {
    const walletAddress = req.headers["x-wallet-address"];
    const { positionId } = req.params;

    if (!walletAddress) {
      return res.status(400).json({ error: "Missing X-Wallet-Address header" });
    }

    const { Position } = await import("../trading/models/Position.js");
    const { GridState } = await import("../trading/models/GridState.js");

    // Znajdź pozycję
    const position = await Position.findById(positionId);
    if (!position) {
      return res.status(404).json({ error: "Position not found" });
    }

    // Sprawdź czy pozycja należy do tego portfela
    if (position.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const wasClosed = position.status === "CLOSED";
    const wasOpen = position.status === "OPEN";
    const orderId = position.orderId;
    const positionType = position.type;

    // Usuń pozycję
    await position.delete();

    // Zaktualizuj GridState
    if (orderId) {
      const state = await GridState.findByWalletAndOrderId(
        walletAddress,
        orderId
      );
      if (state) {
        // Jeśli była to otwarta pozycja, usuń ją z listy otwartych pozycji
        if (wasOpen) {
          if (positionType === "BUY" || !positionType) {
            state.openPositionIds = state.openPositionIds.filter(
              (id) => id !== positionId
            );
          } else if (positionType === "SELL") {
            state.openSellPositionIds = state.openSellPositionIds.filter(
              (id) => id !== positionId
            );
          }
          console.log(
            `🔄 Removed open position ${positionId} from GridState (type: ${positionType})`
          );
        }

        // Jeśli była to zamknięta pozycja, przelicz totalProfit
        if (wasClosed) {
          state.totalProfit = await Position.getTotalClosedProfit(
            walletAddress,
            orderId
          );
          console.log(
            `🔄 Recalculated totalProfit after position deletion: ${state.totalProfit}`
          );
        }

        await state.save();
      }
    }

    console.log(
      `🗑️ Deleted position ${positionId} (wallet=${walletAddress}, orderId=${orderId}, wasClosed=${wasClosed})`
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting position:", error);
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
 * Pobiera aktualne ceny (z wybranej giełdy użytkownika)
 */
router.get("/prices", async (req, res) => {
  try {
    const walletAddress = req.headers["x-wallet-address"];
    
    // Jeśli podano walletAddress, pobierz ceny z jego giełdy
    if (walletAddress) {
      const exchange = await getExchangeForWallet(walletAddress);
      const exchangeService = exchange === "bingx" ? BingXService : AsterSpotService;
      
      // Pobierz ceny bezpośrednio z API wybranej giełdy (dla BingX wymagany signed request z walletAddress)
      const tickers = await exchangeService.fetchAllTickerPrices(walletAddress);
      const prices = {};
      
      tickers.forEach((t) => {
        if (t.symbol && t.price) {
          prices[t.symbol] = {
            price: t.price,
            priceChangePercent: t.priceChangePercent ?? null,
          };
        }
      });
      
      console.log(`📊 Prices API: fetched from ${exchange} for wallet ${walletAddress}, ${Object.keys(prices).length} symbols`);
      return res.json(prices);
    }
    
    // Fallback: użyj globalnych cen z PriceFeedService (dla kompatybilności)
    res.json(PriceFeedService.getAllPrices());
  } catch (error) {
    console.error("Error getting prices:", error);
    // Fallback do PriceFeedService w przypadku błędu
    res.json(PriceFeedService.getAllPrices());
  }
});

/**
 * Pobiera cenę dla konkretnego symbolu (z wybranej giełdy użytkownika)
 */
router.get("/prices/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const walletAddress = req.headers["x-wallet-address"];
    
    let price;
    let stale = true;
    
    if (walletAddress) {
      // Pobierz cenę z giełdy użytkownika
      price = await PriceFeedService.getPrice(symbol, walletAddress);
      stale = PriceFeedService.isPriceStale(symbol);
    } else {
      // Fallback: użyj globalnych cen
      price = PriceFeedService.getPriceSync(symbol);
      stale = PriceFeedService.isPriceStale(symbol);
    }

    res.json({
      symbol: symbol.toUpperCase(),
      price: price.toString(),
      stale,
    });
  } catch (error) {
    console.error("Error getting price:", error);
    res.status(500).json({ error: error.message });
  }
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
 * Pobiera salda portfela z wybranej giełdy
 * Najpierw próbuje pobrać rzeczywiste salda z wybranej giełdy,
 * a jeśli się nie uda, wraca do lokalnego, symulowanego portfela.
 */
router.get("/wallet/balances", async (req, res) => {
  try {
    const walletAddress = req.headers["x-wallet-address"];

    if (!walletAddress) {
      return res.status(400).json({ error: "Missing X-Wallet-Address header" });
    }

    // Pobierz wybraną giełdę dla tego portfela
    const exchange = await getExchangeForWallet(walletAddress);
    const exchangeService = exchange === "bingx" ? BingXService : AsterSpotService;
    const exchangeName = exchange === "bingx" ? "BingX" : "AsterDex";

    let balances = {};

    try {
      // Prawdziwe salda z wybranej giełdy
      const account = await exchangeService.fetchSpotAccount(walletAddress);

      if (Array.isArray(account?.balances)) {
        const externalBalances = {};

        account.balances.forEach((b) => {
          // BingX może używać różnych nazw pól - sprawdź asset, coin, currency
          const asset = b.asset || b.coin || b.currency;
          // BingX może używać available zamiast free, locked może być freeze lub locked
          const free = parseFloat(b.free || b.available || "0");
          const locked = parseFloat(b.locked || b.freeze || b.frozen || "0");
          const total = free + locked;

          console.log(`🔍 Parsing BingX balance: asset=${asset}, free=${free}, locked=${locked}, total=${total}`);

          // Zapisuj wszystkie salda > 0 (nawet jeśli free=0 ale locked>0)
          if (asset && total > 0) {
            externalBalances[asset.toUpperCase()] = total.toString();
            console.log(`✅ Added balance: ${asset.toUpperCase()} = ${total}`);
          } else if (asset) {
            console.log(`⏭️ Skipping balance ${asset}: total=${total} (free=${free}, locked=${locked})`);
          }
        });
        
        console.log(`💰 Final externalBalances for ${exchangeName}:`, JSON.stringify(externalBalances, null, 2));

        // Zsynchronizuj z wewnętrznym portfelem (używane przez algorytm/symulację)
        await WalletService.syncBalances(walletAddress, externalBalances, exchange);
        balances = externalBalances;
        console.log(`💰 Wallet balances: fetched from ${exchangeName} for wallet ${walletAddress}`);
      } else {
        console.warn(
          `⚠️ ${exchangeName} account response bez pola balances – fallback do lokalnego portfela. Response keys: ${Object.keys(account || {}).join(", ")}`
        );
        // Loguj pełną odpowiedź dla debugowania
        if (process.env.GRID_DEBUG_CONDITIONS) {
          console.log(`🔍 Full ${exchangeName} account response:`, JSON.stringify(account, null, 2));
        }
        balances = await WalletService.getAllBalances(walletAddress, exchange);
      }
    } catch (e) {
      console.error(
        `❌ Error fetching ${exchangeName} balances, fallback to local wallet:`,
        e.message
      );
      balances = await WalletService.getAllBalances(walletAddress, exchange);
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
 * Ręcznie odświeża portfel z wybranej giełdy
 */
router.post("/wallet/refresh", async (req, res) => {
  try {
    const walletAddress = req.headers["x-wallet-address"];

    if (!walletAddress) {
      return res.status(400).json({ error: "Missing X-Wallet-Address header" });
    }

    // Pobierz wybraną giełdę dla tego portfela
    const exchange = await getExchangeForWallet(walletAddress);
    const exchangeService = exchange === "bingx" ? BingXService : AsterSpotService;
    const exchangeName = exchange === "bingx" ? "BingX" : "AsterDex";

    // Pobierz rzeczywiste salda z wybranej giełdy i zsynchronizuj
    const account = await exchangeService.fetchSpotAccount(walletAddress);

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

      // Przekaż exchange, żeby salda były zapisane per giełda
      await WalletService.syncBalances(walletAddress, externalBalances, exchange);
      console.log(`💰 Wallet refresh: synced from ${exchangeName} for wallet ${walletAddress}`);
      res.json({ success: true, balances: externalBalances });
    } else {
      res.status(500).json({ error: `Failed to fetch balances from ${exchangeName}` });
    }
  } catch (error) {
    console.error("Error refreshing wallet:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
