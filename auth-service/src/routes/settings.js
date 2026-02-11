import express from "express";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
// Use SQLite model instead of MongoDB
import UserSettings from "../trading/models/UserSettings.js";
import GridState from "../trading/models/GridState.js";
import * as GridAlgorithmService from "../trading/services/GridAlgorithmService.js";
import { encrypt, decrypt } from "../trading/services/CryptoService.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "gridbot-secret-key";

// Helper – normalizuje strukturę zleceń tak, żeby frontend miał zawsze _id
const normalizeOrders = (orders = []) =>
  orders.map((o) => ({
    _id: o._id || o.id,
    id: o.id || o._id,
    ...o,
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

    res.json({
      walletAddress: settings.walletAddress,
      wallet: settings.wallet,
      orders: normalizeOrders(settings.orders),
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

    res.json({
      aster: {
        name: aster.name || "",
        avatar: aster.avatar || "",
        hasKeys: !!(aster.apiKeyEncrypted && aster.apiSecretEncrypted),
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

// Pobierz wszystkie zlecenia
router.get("/orders", authMiddleware, async (req, res) => {
  try {
    const settings = await UserSettings.findOne({ walletAddress: req.walletAddress });
    res.json(normalizeOrders(settings?.orders || []));
  } catch (error) {
    console.error("Get orders error:", error);
    res.status(500).json({ error: "Failed to get orders" });
  }
});

// Dodaj nowe zlecenie
router.post("/orders", authMiddleware, async (req, res) => {
  try {
    const orderData = { ...req.body };

    let settings = await UserSettings.findOne({ walletAddress: req.walletAddress });

    if (!settings) {
      settings = new UserSettings({ walletAddress: req.walletAddress });
    }

    // Ensure order has an ID (id oraz _id dla frontu)
    if (!orderData.id && !orderData._id) {
      orderData.id = uuidv4();
    }
    orderData._id = orderData._id || orderData.id;
    orderData.id = orderData.id || orderData._id;

    settings.orders.push(orderData);
    await settings.save();

    res.json(orderData);
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

    let settings = await UserSettings.findOne({ walletAddress: req.walletAddress });

    if (!settings) {
      return res.status(404).json({ error: "Settings not found" });
    }

    const orderIndex = settings.orders.findIndex(
      (o) => o.id === orderId || o._id === orderId
    );

    if (orderIndex === -1) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Merge update data with existing order
    const updatedOrder = {
      ...settings.orders[orderIndex],
      ...updateData,
      id: orderId,
      _id: orderId,
    };

    settings.orders[orderIndex] = updatedOrder;

    await settings.save();

    // Jeśli zmieniły się kluczowe parametry (np. focusPrice),
    // zaktualizuj także istniejący GridState, żeby wartości u góry
    // (focus, następny zakup/sprzedaż) od razu się zgadzały.
    try {
      const lowerWallet = req.walletAddress.toLowerCase();
      const state = await GridState.findByWalletAndOrderId(lowerWallet, orderId);
      if (state && typeof updatedOrder.focusPrice === "number") {
        const focusPrice = updatedOrder.focusPrice || 0;
        state.currentFocusPrice = focusPrice;
        state.focusLastUpdated = new Date().toISOString();
        state.nextBuyTarget = GridAlgorithmService.calculateNextBuyTarget(
          focusPrice,
          state.buyTrendCounter || 0,
          updatedOrder
        ).toNumber();
        state.nextSellTarget = GridAlgorithmService.calculateNextSellTarget(
          focusPrice,
          state.buyTrendCounter || 0,
          updatedOrder
        ).toNumber();
        await state.save();
        console.log(
          `🔄 Synced GridState with new focusPrice for wallet=${lowerWallet}, orderId=${orderId}`
        );
      }
    } catch (syncError) {
      console.error(
        "⚠️ Failed to sync GridState after order update:",
        syncError.message
      );
    }

    res.json(updatedOrder);
  } catch (error) {
    console.error("Update order error:", error);
    res.status(500).json({ error: "Failed to update order" });
  }
});

// Usuń zlecenie
router.delete("/orders/:orderId", authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;

    let settings = await UserSettings.findOne({ walletAddress: req.walletAddress });

    if (!settings) {
      return res.status(404).json({ error: "Settings not found" });
    }

    settings.orders = settings.orders.filter(
      (o) => (o.id || o._id) !== orderId
    );
    await settings.save();

    // Dodatkowo wyczyść stan GRID + pozycje w SQLite/Postgres,
    // żeby scheduler nie próbował dalej przetwarzać tego zlecenia.
    try {
      const lowerWallet = req.walletAddress.toLowerCase();
      const state = await GridState.findByWalletAndOrderId(lowerWallet, orderId);

      if (state) {
        const dbModule = await import("../trading/db.js");
        const db = dbModule.default;

        const deleteStateStmt = db.prepare(
          "DELETE FROM grid_states WHERE wallet_address = ? AND order_id = ?"
        );
        await deleteStateStmt.run(lowerWallet, orderId);

        const deletePositionsStmt = db.prepare(
          "DELETE FROM positions WHERE wallet_address = ? AND order_id = ?"
        );
        await deletePositionsStmt.run(lowerWallet, orderId);

        console.log(
          `🧹 Deleted GRID state and positions for wallet=${lowerWallet}, orderId=${orderId}`
        );
      }
    } catch (cleanupError) {
      console.error(
        "⚠️ Failed to cleanup GRID state/positions after order delete:",
        cleanupError.message
      );
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
