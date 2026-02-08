import cron from "node-cron";
import Decimal from "decimal.js";
import { GridState } from "../models/GridState.js";
import * as GridAlgorithmService from "./GridAlgorithmService.js";
import * as PriceFeedService from "./PriceFeedService.js";
import * as AsterSpotService from "./AsterSpotService.js";
import * as WalletService from "./WalletService.js";
// Use SQLite model instead of MongoDB
import UserSettings from "../models/UserSettings.js";

/**
 * Serwis schedulera do automatycznego przetwarzania zleceń GRID
 */

let schedulerTask = null;
let isProcessing = false;
let lastPriceRefreshAt = 0;

// Interwał cyku schedulera w sekundach (1 = minimum, żeby „Odświeżanie” 1 s działało; env: GRID_SCHEDULER_INTERVAL_SEC)
const SCHEDULER_INTERVAL_SEC = Number(
  process.env.GRID_SCHEDULER_INTERVAL_SEC || "1"
);
const CRON_EXPRESSION =
  SCHEDULER_INTERVAL_SEC >= 1 && SCHEDULER_INTERVAL_SEC <= 59
    ? `*/${SCHEDULER_INTERVAL_SEC} * * * * *`
    : "*/1 * * * * *"; // fallback co 1 s

/**
 * Uruchamia scheduler
 */
export function start() {
  if (schedulerTask) {
    console.log("⚠️ Scheduler already running");
    return;
  }

  schedulerTask = cron.schedule(CRON_EXPRESSION, () => {
    if (isProcessing) return;

    try {
      isProcessing = true;
      processActiveOrders();
    } catch (error) {
      console.error("❌ Scheduler error:", error.message);
    } finally {
      isProcessing = false;
    }
  });

  console.log(
    `✅ Grid Scheduler started (every ${SCHEDULER_INTERVAL_SEC} seconds)`
  );
}

/**
 * Zatrzymuje scheduler
 */
export function stop() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    console.log("⏹️ Grid Scheduler stopped");
  }
}

/**
 * Zwraca minimalny refreshInterval (w sekundach) spośród aktywnych zleceń – do odświeżania cen.
 */
function getMinRefreshIntervalSec(activeStates) {
  if (!activeStates || activeStates.length === 0) return 60;
  let minSec = 999999;
  for (const state of activeStates) {
    const settings = getOrderSettings(state.walletAddress, state.orderId);
    const sec = Number(settings?.refreshInterval || 5);
    if (sec > 0 && sec < minSec) minSec = sec;
  }
  return minSec === 999999 ? 60 : minSec;
}

/**
 * Przetwarza wszystkie aktywne zlecenia.
 * Odświeża ceny z Aster tylko co min(refreshInterval) aktywnych zleceń – żeby „Odświeżanie” w UI (np. 60 s) miało sens.
 */
async function processActiveOrders() {
  const activeStates = GridState.findAllActive();

  const minRefreshSec = getMinRefreshIntervalSec(activeStates);
  const now = Date.now();
  if (minRefreshSec > 0 && now - lastPriceRefreshAt < minRefreshSec * 1000) {
    // Za wcześnie na odświeżenie cen – przetwarzaj z ostatnio pobranymi cenami
  } else {
    await PriceFeedService.refreshFromAster();
    lastPriceRefreshAt = now;
  }

  for (const state of activeStates) {
    try {
      await processOrder(state);
    } catch (error) {
      console.error(
        `❌ Error processing order ${state.orderId}:`,
        error.message
      );
    }
  }
}

/**
 * Przetwarza pojedyncze zlecenie
 */
async function processOrder(state) {
  // Pobierz ustawienia zlecenia
  const settings = getOrderSettings(state.walletAddress, state.orderId);

  if (!settings) {
    console.warn(`⚠️ Settings not found for order ${state.orderId}`);
    return;
  }

  // 1) Uszanuj refreshInterval z frontu (w sekundach).
  //    Scheduler tyka co 5s, ale każde zlecenie ma własną częstotliwość.
  const refreshIntervalSec = Number(settings.refreshInterval || 5);
  if (state.lastUpdated && refreshIntervalSec > 0) {
    const elapsedSec =
      (Date.now() - new Date(state.lastUpdated).getTime()) / 1000;
    if (elapsedSec < refreshIntervalSec) {
      // Za wcześnie na kolejne przetwarzanie tego zlecenia
      return;
    }
  }

  // 2) Odśwież stan portfela z giełdy (SPOT) przy każdym „ticku” tego zlecenia.
  //    Dzięki temu algorytm zawsze widzi aktualne salda USDT/BTC itd.
  try {
    const account = await AsterSpotService.fetchSpotAccount(
      state.walletAddress
    );
    if (account && Array.isArray(account.balances)) {
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
      await WalletService.syncBalances(state.walletAddress, externalBalances);
    }
  } catch (e) {
    // Logi wyłączone - brak kluczy API jest normalny w trybie demo/bez realnego handlu
    // Używamy ostatniego znanego stanu portfela
  }

  // Utwórz symbol pary (baseAsset + quoteAsset lub fallback)
  const baseAsset = settings.baseAsset || settings.sell?.currency || "BTC";
  // Na spocie jako stable używamy USDT
  const quoteAsset = settings.quoteAsset || settings.buy?.currency || "USDT";
  const symbol = `${baseAsset}${quoteAsset}`;

  const currentPrice = PriceFeedService.getPrice(symbol);

  if (currentPrice.eq(0)) {
    // Logi wyłączone - brak ceny jest normalny gdy nie ma kluczy API
    return;
  }

  // Przetwórz cenę (teraz async)
  await GridAlgorithmService.processPrice(
    state.walletAddress,
    state.orderId,
    currentPrice,
    settings
  );
}

/**
 * Pobiera ustawienia zlecenia z SQLite
 */
function getOrderSettings(walletAddress, orderId) {
  try {
    const userSettings = UserSettings.findOne({
      walletAddress: walletAddress.toLowerCase(),
    });

    if (!userSettings || !userSettings.orders) {
      return null;
    }

    const order = userSettings.orders.find((o) => o.id === orderId);
    return order || null;
  } catch (error) {
    console.error("Error fetching settings:", error.message);
    return null;
  }
}

/**
 * Ręcznie przetwarza cenę dla zlecenia (do testów)
 */
export function manualProcess(walletAddress, orderId, price) {
  const settings = getOrderSettings(walletAddress, orderId);

  if (!settings) {
    throw new Error(`Settings not found for order ${orderId}`);
  }

  return GridAlgorithmService.processPrice(
    walletAddress,
    orderId,
    new Decimal(price),
    settings
  );
}

export default {
  start,
  stop,
  manualProcess,
};
