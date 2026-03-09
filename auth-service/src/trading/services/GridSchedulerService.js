import cron from "node-cron";
import Decimal from "decimal.js";
import { GridState } from "../models/GridState.js";
import * as GridAlgorithmService from "./GridAlgorithmService.js";
import * as PriceFeedService from "./PriceFeedService.js";
import * as AsterSpotService from "./AsterSpotService.js";
import * as BingXService from "./BingXService.js";
import * as WalletService from "./WalletService.js";
import UserSettings from "../models/UserSettings.js";
import Order from "../models/Order.js";

/**
 * Pobiera wybraną giełdę dla użytkownika (domyślnie "asterdex")
 * @param {string} walletAddress - adres portfela
 * @returns {Promise<"asterdex"|"bingx">}
 */
async function getExchange(walletAddress) {
  if (!walletAddress) {
    return "asterdex"; // Domyślnie AsterDex
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

  // Używamy async callbacka i czekamy na zakończenie processActiveOrders,
  // żeby nie uruchomić kilku cykli jednocześnie (co mogło powodować
  // podwójne zakupy / sprzedaże przy jednym ticku ceny).
  schedulerTask = cron.schedule(CRON_EXPRESSION, async () => {
    if (isProcessing) return;

    isProcessing = true;
    try {
      await processActiveOrders();
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
  const activeStates = await GridState.findAllActive();

  const minRefreshSec = getMinRefreshIntervalSec(activeStates);
  const now = Date.now();
  if (minRefreshSec > 0 && now - lastPriceRefreshAt < minRefreshSec * 1000) {
    // Za wcześnie na odświeżenie cen – przetwarzaj z ostatnio pobranymi cenami
  } else {
    // Pobierz ceny dla każdego unikalnego portfela z jego wybranej giełdy
    // Używamy aktualnego portfela użytkownika z UserSettings, nie starego walletAddress z GridState
    const walletsToRefresh = new Map(); // walletAddress -> exchange
    
    if (activeStates.length > 0) {
      // Zbierz wszystkie unikalne portfele z ich giełdami z ustawień zleceń
      for (const state of activeStates) {
        try {
          const order = await Order.findById(state.orderId);
          if (order) {
            const wallet = (order.walletAddress || state.walletAddress).toLowerCase();
            walletsToRefresh.set(wallet, order.exchange || "asterdex");
          }
        } catch (e) {
          console.warn(`⚠️ Failed to get order ${state.orderId}:`, e.message);
        }
      }
      
      // Pobierz ceny dla każdego portfela z jego wybranej giełdy
      const refreshPromises = Array.from(walletsToRefresh.entries()).map(async ([walletAddress, exchange]) => {
        try {
          // Przekaż exchange z zlecenia, żeby PriceFeedService użył właściwej giełdy
          // (nie tej z UserSettings.exchange, która może być stara)
          await PriceFeedService.refreshFromAster(walletAddress, exchange);
        } catch (e) {
          console.error(`❌ Failed to refresh prices for wallet ${walletAddress} (${exchange}):`, e.message);
        }
      });
      
      await Promise.all(refreshPromises);
      
      const exchangeCounts = {};
      walletsToRefresh.forEach((exchange) => {
        exchangeCounts[exchange] = (exchangeCounts[exchange] || 0) + 1;
      });
      
      console.log(
        `📊 Price refresh: activeOrders=${activeStates.length}, ` +
        `refreshed prices for ${walletsToRefresh.size} unique wallets ` +
        `(asterdex: ${exchangeCounts.asterdex || 0}, bingx: ${exchangeCounts.bingx || 0})`
      );
    } else {
      // Brak aktywnych zleceń - nie pobieramy cen (będą pobrane gdy pojawią się aktywne zlecenia)
      console.log(`📊 Price refresh: no active orders, skipping price fetch`);
    }
    
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
  const settings = await getOrderSettings(state.walletAddress, state.orderId);

  if (!settings) {
    // Zlecenie usunięte lub brak w ustawieniach – dezaktywuj stan, żeby scheduler przestał go brać pod uwagę
    console.warn(
      `⚠️ Settings not found for order ${state.orderId} (was looking in wallet ${state.walletAddress}) – deactivating grid state`
    );
    state.isActive = false;
    await state.save();
    return;
  }

  // Znajdź aktualny portfel z tabeli orders
  let currentWallet = state.walletAddress;
  try {
    const order = await Order.findById(state.orderId);
    if (order?.walletAddress) {
      currentWallet = order.walletAddress;
    }
  } catch (e) {
    console.warn(`⚠️ Failed to find wallet for order ${state.orderId}:`, e.message);
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
    // Pobierz wybraną giełdę dla aktualnego portfela
    const exchange = await getExchange(currentWallet);
    const exchangeService = exchange === "bingx" ? BingXService : AsterSpotService;
    
    const account = await exchangeService.fetchSpotAccount(
      currentWallet
    );
    if (account && Array.isArray(account.balances)) {
      const externalBalances = {};
      account.balances.forEach((b) => {
        // BingX może używać różnych nazw pól - sprawdź asset, coin, currency
        const asset = b.asset || b.coin || b.currency;
        // BingX może używać available zamiast free, locked może być freeze lub locked
        const free = parseFloat(b.free || b.available || "0");
        const locked = parseFloat(b.locked || b.freeze || b.frozen || "0");
        const total = free + locked;
        if (asset && total > 0) {
          externalBalances[asset.toUpperCase()] = total.toString();
        }
      });
  // Pobierz exchange z ustawień zlecenia
  const orderExchange = settings.exchange || "asterdex";
  await WalletService.syncBalances(currentWallet, externalBalances, orderExchange);
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

  const currentPrice = await PriceFeedService.getPrice(symbol, currentWallet);

  if (currentPrice.eq(0)) {
    // Logi wyłączone - brak ceny jest normalny gdy nie ma kluczy API
    return;
  }

  // Przetwórz cenę (teraz async) - użyj aktualnego portfela
  await GridAlgorithmService.processPrice(
    currentWallet,
    state.orderId,
    currentPrice,
    settings
  );
}

/**
 * Pobiera ustawienia zlecenia z tabeli orders
 */
async function getOrderSettings(walletAddress, orderId) {
  try {
    const order = await Order.findById(orderId);
    if (order) return order.toSettings();
    console.warn(`⚠️ Order ${orderId} not found in orders table`);
    return null;
  } catch (error) {
    console.error("Error fetching order settings:", error.message);
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
