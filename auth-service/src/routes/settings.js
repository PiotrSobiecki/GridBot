import express from "express";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import UserSettings from "../trading/models/UserSettings.js";
import Order from "../trading/models/Order.js";
import GridState from "../trading/models/GridState.js";
import * as GridAlgorithmService from "../trading/services/GridAlgorithmService.js";
import { encrypt, decrypt } from "../trading/services/CryptoService.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "gridbot-secret-key";

// Helper – normalizuje strukturę zleceń tak, żeby frontend miał zawsze _id
const normalizeOrders = (orders = []) =>
  orders.map((o) => ({
    ...o,
    _id: o._id || o.id,
    id:  o.id  || o._id,
  }));

// Middleware autoryzacji
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.walletAddress = decoded.walletAddress;
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
  }
};

// Pobierz wszystkie ustawienia użytkownika
router.get("/", authMiddleware, async (req, res) => {
  try {
    let settings = await UserSettings.findOne({ walletAddress: req.walletAddress });

    if (!settings) {
      settings = new UserSettings({ walletAddress: req.walletAddress });
      await settings.save();
    }

    const currentExchange = settings.exchange || "asterdex";
    const orders = await Order.findByWalletAndExchange(req.walletAddress, currentExchange);

    res.json({
      walletAddress: settings.walletAddress,
      wallet: settings.wallet,
      orders: normalizeOrders(orders.map(o => o.toJSON())),
      exchange: currentExchange,
    });
  } catch (error) {
    console.error("Get settings error:", error);
    res.status(500).json({ error: "Failed to get settings" });
  }
});

// ================== Ustawienia API / konta giełdowego ==================

/**
 * GET /settings/api
 * Zwraca metadane API (bez kluczy) dla zalogowanego portfela.
 */
router.get("/api", authMiddleware, async (req, res) => {
  try {
    const settings = await UserSettings.findOne({ walletAddress: req.walletAddress });
    const apiConfig = settings?.apiConfig || {};
    const aster = apiConfig.aster || {};
    const bingx = apiConfig.bingx || {};

    res.json({
      aster: {
        name: aster.name || "",
        avatar: aster.avatar || "",
        hasKeys: !!(aster.apiKeyEncrypted && aster.apiSecretEncrypted),
      },
      bingx: {
        name: bingx.name || "",
        avatar: bingx.avatar || "",
        hasKeys: !!(bingx.apiKeyEncrypted && bingx.apiSecretEncrypted),
      },
    });
  } catch (error) {
    console.error("Get API settings error:", error);
    res.status(500).json({ error: "Failed to load API settings" });
  }
});

/**
 * POST /settings/api/aster
 * Zapisuje zaszyfrowane klucze API + metadane konta Aster dla zalogowanego portfela.
 */
router.post("/api/aster", authMiddleware, async (req, res) => {
  try {
    const { name, avatar, apiKey, apiSecret } = req.body || {};

    let settings = await UserSettings.findOne({ walletAddress: req.walletAddress });

    if (!settings) {
      settings = new UserSettings({ walletAddress: req.walletAddress });
    }

    const cfg = settings.apiConfig || {};
    const aster = cfg.aster || {};

    if (typeof name === "string") aster.name = name;
    if (typeof avatar === "string") aster.avatar = avatar;

    if (typeof apiKey === "string" && apiKey.trim()) {
      aster.apiKeyEncrypted = encrypt(apiKey.trim());
    }
    if (typeof apiSecret === "string" && apiSecret.trim()) {
      aster.apiSecretEncrypted = encrypt(apiSecret.trim());
    }

    cfg.aster = aster;
    settings.apiConfig = cfg;
    await settings.save();

    res.json({
      aster: {
        name: aster.name || "",
        avatar: aster.avatar || "",
        hasKeys: !!(aster.apiKeyEncrypted && aster.apiSecretEncrypted),
      },
    });
  } catch (error) {
    console.error("Save API settings error:", error);
    res.status(500).json({ error: "Failed to save API settings" });
  }
});

/**
 * POST /settings/api/bingx
 * Zapisuje zaszyfrowane klucze API + metadane konta BingX dla zalogowanego portfela.
 */
router.post("/api/bingx", authMiddleware, async (req, res) => {
  try {
    const { name, avatar, apiKey, apiSecret } = req.body || {};

    let settings = await UserSettings.findOne({ walletAddress: req.walletAddress });

    if (!settings) {
      settings = new UserSettings({ walletAddress: req.walletAddress });
    }

    const cfg = settings.apiConfig || {};
    const bingx = cfg.bingx || {};

    if (typeof name === "string") bingx.name = name;
    if (typeof avatar === "string") bingx.avatar = avatar;

    if (typeof apiKey === "string" && apiKey.trim()) {
      bingx.apiKeyEncrypted = encrypt(apiKey.trim());
    }
    if (typeof apiSecret === "string" && apiSecret.trim()) {
      bingx.apiSecretEncrypted = encrypt(apiSecret.trim());
    }

    cfg.bingx = bingx;
    settings.apiConfig = cfg;
    await settings.save();

    res.json({
      bingx: {
        name: bingx.name || "",
        avatar: bingx.avatar || "",
        hasKeys: !!(bingx.apiKeyEncrypted && bingx.apiSecretEncrypted),
      },
    });
  } catch (error) {
    console.error("Save BingX API settings error:", error);
    res.status(500).json({ error: "Failed to save BingX API settings" });
  }
});

/**
 * PUT /settings/exchange
 * Ustawia wybraną giełdę (asterdex lub bingx)
 */
router.put("/exchange", authMiddleware, async (req, res) => {
  try {
    const { exchange } = req.body;
    
    if (exchange !== "asterdex" && exchange !== "bingx") {
      return res.status(400).json({ error: "Invalid exchange. Must be 'asterdex' or 'bingx'" });
    }

    let settings = await UserSettings.findOne({ walletAddress: req.walletAddress });

    if (!settings) {
      settings = new UserSettings({ walletAddress: req.walletAddress });
    }

    settings.exchange = exchange;
    await settings.save();

    // Wyczyść cache exchangeInfo, żeby przy następnym użyciu pobrać dane z nowej giełdy
    try {
      const { clearExchangeInfoCache } = await import("../trading/services/ExchangeService.js");
      clearExchangeInfoCache();
      console.log(`🔄 Exchange changed to ${exchange} for wallet ${req.walletAddress} - cache cleared`);
    } catch (e) {
      console.warn('⚠️ Failed to clear exchange cache:', e.message);
    }

    res.json({ exchange: settings.exchange });
  } catch (error) {
    console.error("Update exchange error:", error);
    res.status(500).json({ error: "Failed to update exchange" });
  }
});

// Aktualizuj portfel
router.put("/wallet", authMiddleware, async (req, res) => {
  try {
    const { wallet } = req.body;

    let settings = await UserSettings.findOne({ walletAddress: req.walletAddress });

    if (!settings) {
      settings = new UserSettings({ walletAddress: req.walletAddress });
    }

    settings.wallet = wallet;
    await settings.save();

    res.json(settings.wallet);
  } catch (error) {
    console.error("Update wallet error:", error);
    res.status(500).json({ error: "Failed to update wallet" });
  }
});

// Pobierz wszystkie zlecenia (tylko dla aktualnie wybranej giełdy)
router.get("/orders", authMiddleware, async (req, res) => {
  try {
    const settings = await UserSettings.findOne({ walletAddress: req.walletAddress });
    const currentExchange = settings?.exchange || "asterdex";
    const orders = await Order.findByWalletAndExchange(req.walletAddress, currentExchange);
    res.json(normalizeOrders(orders.map(o => o.toJSON())));
  } catch (error) {
    console.error("Get orders error:", error);
    res.status(500).json({ error: "Failed to get orders" });
  }
});

// Dodaj nowe zlecenie
router.post("/orders", authMiddleware, async (req, res) => {
  try {
    const settings = await UserSettings.findOne({ walletAddress: req.walletAddress });
    const currentExchange = settings?.exchange || "asterdex";

    const order = new Order({
      ...req.body,
      id: req.body.id || req.body._id || uuidv4(),
      walletAddress: req.walletAddress,
      exchange: req.body.exchange || currentExchange,
    });

    await order.save();
    res.json(order.toJSON());
  } catch (error) {
    console.error("Create order error:", error);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// Aktualizuj zlecenie
router.put("/orders/:orderId", authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const updateData = req.body;

    const existingOrder = await Order.findById(orderId);
    if (!existingOrder) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Logika Focus:
    // - focusLocked=false z frontu = jednorazowe odblokowanie zmiany focusPrice,
    // - po zapisaniu zawsze wracamy do focusLocked=true.
    const isFirstFocus = !existingOrder.focusPrice || existingOrder.focusPrice === 0;
    const unblockRequested = updateData.focusLocked === false;
    let focusChangedThisUpdate = false;

    if ((isFirstFocus || unblockRequested) && typeof updateData.focusPrice === "number") {
      focusChangedThisUpdate = existingOrder.focusPrice !== updateData.focusPrice;
      existingOrder.focusPrice = updateData.focusPrice;
    }
    existingOrder.focusLocked = true; // po zapisie zawsze zablokowany

    // Nadpisz pozostałe pola (oprócz id i walletAddress)
    const { id: _id, _id: __id, walletAddress: _w, focusPrice: _fp, focusLocked: _fl, ...rest } = updateData;
    Object.assign(existingOrder, rest);
    existingOrder.id = orderId;

    await existingOrder.save();

    // Jeśli zmienił się focusPrice – zaktualizuj GridState od razu
    if (focusChangedThisUpdate) {
      try {
        const lowerWallet = req.walletAddress.toLowerCase();
        const state = await GridState.findByWalletAndOrderId(lowerWallet, orderId);
        if (state) {
          const fp = existingOrder.focusPrice;
          state.currentFocusPrice = fp;
          state.focusLastUpdated = new Date().toISOString();
          state.nextBuyTarget = GridAlgorithmService.calculateNextBuyTarget(fp, state.buyTrendCounter || 0, existingOrder.toSettings()).toNumber();
          state.nextSellTarget = GridAlgorithmService.calculateNextSellTarget(fp, state.buyTrendCounter || 0, existingOrder.toSettings()).toNumber();
          await state.save();
          console.log(`🔄 Synced GridState focusPrice=${fp} for order=${orderId}`);
        }
      } catch (syncError) {
        console.error("⚠️ Failed to sync GridState after order update:", syncError.message);
      }
    }

    res.json(existingOrder.toJSON());
  } catch (error) {
    console.error("Update order error:", error);
    res.status(500).json({ error: "Failed to update order" });
  }
});

// Usuń zlecenie
router.delete("/orders/:orderId", authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    await order.delete();

    // Wyczyść powiązany GRID state + pozycje
    try {
      const lowerWallet = req.walletAddress.toLowerCase();
      const dbModule = await import("../trading/db.js");
      const db = dbModule.default;
      await db.prepare("DELETE FROM grid_states WHERE wallet_address = ? AND order_id = ?").run(lowerWallet, orderId);
      await db.prepare("DELETE FROM positions  WHERE wallet_address = ? AND order_id = ?").run(lowerWallet, orderId);
      console.log(`🧹 Deleted GRID state and positions for order=${orderId}`);
    } catch (cleanupError) {
      console.error("⚠️ Failed to cleanup GRID state/positions:", cleanupError.message);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Delete order error:", error);
    res.status(500).json({ error: "Failed to delete order" });
  }
});

// Pobierz historię transakcji (z pozycji w SQLite/Postgres)
router.get("/transactions", authMiddleware, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const {
      Position,
      PositionStatus,
    } = await import("../trading/models/Position.js");

    const positions = await Position.findByWalletAndOrderId(
      req.walletAddress,
      null,
      PositionStatus.CLOSED
    );

    res.json({
      total: positions.length,
      transactions: positions
        .slice(offset, offset + parseInt(limit))
        .map((p) => p.toJSON()),
    });
  } catch (error) {
    console.error("Get transactions error:", error);
    res.status(500).json({ error: "Failed to get transactions" });
  }
});

export default router;
