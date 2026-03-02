import Decimal from "decimal.js";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GridState } from "../models/GridState.js";
import { Position, PositionStatus, PositionType } from "../models/Position.js";
import * as WalletService from "./WalletService.js";
import * as ExchangeService from "./ExchangeService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Pomocniczy log – pokaż surową wartość zmiennej z .env
const DEBUG_CONDITIONS_ENV = String(
  process.env.GRID_DEBUG_CONDITIONS || "",
).trim();

// W DEV włączamy logowanie domyślnie (jeśli zmienna nie jest ustawiona na '0').
// Dzięki temu nie blokujemy się na problemach z .env.
const DEBUG_CONDITIONS =
  DEBUG_CONDITIONS_ENV === "1" ||
  (DEBUG_CONDITIONS_ENV === "" && process.env.NODE_ENV !== "production");

// "Ciche" logi produkcyjne – przy tym ustawieniu zostawiamy
// tylko błędy z API / ważne ostrzeżenia oraz udane transakcje.
const QUIET_PRODUCTION_LOGS =
  process.env.NODE_ENV === "production" && DEBUG_CONDITIONS_ENV !== "1";

// Te logi są przydatne głównie w DEV – w produkcji je wyłączamy,
// żeby nie zaśmiecać logów przy QUIET_PRODUCTION_LOGS.
if (!QUIET_PRODUCTION_LOGS) {
  console.log(
    "GRID_DEBUG_CONDITIONS raw from env:",
    JSON.stringify(DEBUG_CONDITIONS_ENV || null),
  );

  if (DEBUG_CONDITIONS) {
    console.log("✅ Logowanie warunków BUY/SELL jest WŁĄCZONE");
  } else {
    console.log("ℹ️ Logowanie warunków BUY/SELL jest WYŁĄCZONE");
  }
}

/**
 * Główny serwis implementujący algorytm GRID
 */

const PRICE_SCALE = 2;
const AMOUNT_SCALE = 8;
const DEFAULT_FEE_PERCENT = new Decimal("0.1");

// Ścieżki do plików z logami transakcji
const TRANSACTIONS_BUY_FILE = path.join(
  __dirname,
  "../../../logs/transactions-buy.json",
);
const TRANSACTIONS_SELL_FILE = path.join(
  __dirname,
  "../../../logs/transactions-sell.json",
);

// Sprawdź czy logowanie do JSON jest włączone (domyślnie tylko w dev, nie w produkcji)
const ENABLE_JSON_LOGGING =
  process.env.NODE_ENV !== "production" ||
  process.env.ENABLE_TRANSACTION_LOGS === "1";

/**
 * Zapisuje transakcję zakupu (long) do pliku JSON
 */
async function logBuyTransaction(transactionData) {
  // W produkcji nie zapisujemy do plików JSON (chyba że włączone przez zmienną środowiskową)
  if (!ENABLE_JSON_LOGGING) {
    return;
  }

  try {
    // Utwórz katalog logs jeśli nie istnieje
    const logsDir = path.dirname(TRANSACTIONS_BUY_FILE);
    await fs.mkdir(logsDir, { recursive: true });

    // Wczytaj istniejące transakcje lub utwórz pustą tablicę
    let transactions = [];
    try {
      const content = await fs.readFile(TRANSACTIONS_BUY_FILE, "utf-8");
      transactions = JSON.parse(content);
    } catch (error) {
      // Plik nie istnieje lub jest pusty - utworzymy nowy
      if (error.code !== "ENOENT") {
        console.error("Error reading buy transactions file:", error);
      }
    }

    // Dodaj nową transakcję na początku tablicy
    transactions.unshift({
      ...transactionData,
      timestamp: new Date().toISOString(),
    });

    // Zapisz z powrotem do pliku
    await fs.writeFile(
      TRANSACTIONS_BUY_FILE,
      JSON.stringify(transactions, null, 2),
      "utf-8",
    );
  } catch (error) {
    console.error("Error logging buy transaction:", error);
  }
}

/**
 * Zapisuje transakcję sprzedaży (short) do pliku JSON
 */
async function logSellTransaction(transactionData) {
  // W produkcji nie zapisujemy do plików JSON (chyba że włączone przez zmienną środowiskową)
  if (!ENABLE_JSON_LOGGING) {
    return;
  }

  try {
    // Utwórz katalog logs jeśli nie istnieje
    const logsDir = path.dirname(TRANSACTIONS_SELL_FILE);
    await fs.mkdir(logsDir, { recursive: true });

    // Wczytaj istniejące transakcje lub utwórz pustą tablicę
    let transactions = [];
    try {
      const content = await fs.readFile(TRANSACTIONS_SELL_FILE, "utf-8");
      transactions = JSON.parse(content);
    } catch (error) {
      // Plik nie istnieje lub jest pusty - utworzymy nowy
      if (error.code !== "ENOENT") {
        console.error("Error reading sell transactions file:", error);
      }
    }

    // Dodaj nową transakcję na początku tablicy
    transactions.unshift({
      ...transactionData,
      timestamp: new Date().toISOString(),
    });

    // Zapisz z powrotem do pliku
    await fs.writeFile(
      TRANSACTIONS_SELL_FILE,
      JSON.stringify(transactions, null, 2),
      "utf-8",
    );
  } catch (error) {
    console.error("Error logging sell transaction:", error);
  }
}

/** Konwersja Decimal lub number na number (bezpieczna przy zapisie pozycji) */
function toNum(v) {
  if (v == null) return 0;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v.toNumber === "function") return v.toNumber();
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Inicjalizuje stan GRID dla nowego zlecenia
 */
export async function initializeGridState(walletAddress, settings) {
  const focusPrice = new Decimal(settings.focusPrice || 0);

  const state = new GridState({
    walletAddress,
    orderId: settings.id,
    currentFocusPrice: focusPrice.toNumber(),
    buyTrendCounter: 0,
    sellTrendCounter: 0,
    nextBuyTarget: calculateNextBuyTarget(focusPrice, 0, settings).toNumber(),
    nextSellTarget: calculateNextSellTarget(focusPrice, 0, settings).toNumber(),
    openPositionIds: [],
    openSellPositionIds: [],
    totalProfit: 0,
    totalBuyTransactions: 0,
    totalSellTransactions: 0,
    totalBoughtValue: 0,
    totalSoldValue: 0,
    isActive: settings.isActive !== false,
    focusLastUpdated: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });

  return await state.save();
}

/**
 * Przetwarza aktualizację ceny
 */
export async function processPrice(
  walletAddress,
  orderId,
  currentPrice,
  settings,
) {
  const state = await GridState.findByWalletAndOrderId(walletAddress, orderId);

  if (!state) {
    console.warn(
      `Grid state not found for wallet ${walletAddress} and order ${orderId}`,
    );
    return null;
  }

  if (!state.isActive) {
    return state;
  }

  const price = new Decimal(currentPrice);
  // Tryb kierunku zleceń:
  // - "both" (domyślnie) – otwieraj pozycje BUY i SELL,
  // - "buyOnly" – otwieraj tylko nowe pozycje BUY (long),
  // - "sellOnly" – otwieraj tylko nowe pozycje SELL (short).
  // Zamknięcia istniejących pozycji (take profit / buyback) zawsze są dozwolone.
  const tradeMode = settings.tradeMode || "both";
  const allowLongEntries = tradeMode === "both" || tradeMode === "buyOnly";
  const allowShortEntries = tradeMode === "both" || tradeMode === "sellOnly";

  state.lastKnownPrice = price.toNumber();
  state.lastPriceUpdate = new Date().toISOString();

  // #1.4 Sprawdź czas do nowego focus
  await checkAndUpdateFocusTime(state, price, settings);

  // Sprawdź warunki kupna
  if (allowLongEntries && shouldBuy(price, state, settings)) {
    await executeBuy(price, state, settings);
    // Po wykonaniu zakupu przeładuj stan z bazy, aby kolejne sprawdzenia używały zaktualizowanego focusPrice
    const updatedState = await GridState.findByWalletAndOrderId(
      walletAddress,
      orderId,
    );
    if (updatedState) {
      Object.assign(state, updatedState.toJSON());
      // Przerwij przetwarzanie - poczekaj na następny cykl schedulera
      state.lastUpdated = new Date().toISOString();
      await state.save();
      return state;
    }
  }

  // Sprawdź zamknięcie pozycji kupna (sprzedaż z zyskiem)
  const buySellExecuted = await checkAndExecuteBuySells(price, state, settings);
  if (buySellExecuted) {
    // Po zamknięciu pozycji long przeładuj stan z bazy
    const updatedState = await GridState.findByWalletAndOrderId(
      walletAddress,
      orderId,
    );
    if (updatedState) {
      Object.assign(state, updatedState.toJSON());
      // Przerwij przetwarzanie - poczekaj na następny cykl schedulera
      state.lastUpdated = new Date().toISOString();
      await state.save();
      return state;
    }
  }

  // Sprawdź warunki sprzedaży short
  if (allowShortEntries && shouldSellShort(price, state, settings)) {
    await executeSellShort(price, state, settings);
    // Po wykonaniu sprzedaży przeładuj stan z bazy
    const updatedState = await GridState.findByWalletAndOrderId(
      walletAddress,
      orderId,
    );
    if (updatedState) {
      Object.assign(state, updatedState.toJSON());
      // Przerwij przetwarzanie - poczekaj na następny cykl schedulera
      state.lastUpdated = new Date().toISOString();
      await state.save();
      return state;
    }
  }

  // Sprawdź zamknięcie pozycji short (odkup z zyskiem)
  // Funkcja sprawdza wszystkie pozycje short i zamyka te które spełniają warunki
  await checkAndExecuteSellBuybacks(price, state, settings);
  // Po sprawdzeniu wszystkich pozycji short przeładuj stan z bazy
  const updatedStateAfterSell = await GridState.findByWalletAndOrderId(
    walletAddress,
    orderId,
  );
  if (updatedStateAfterSell) {
    Object.assign(state, updatedStateAfterSell.toJSON());
  }

  state.lastUpdated = new Date().toISOString();
  await state.save();

  return state;
}

/**
 * #1.4 Sprawdza i aktualizuje focus na podstawie czasu
 */
async function checkAndUpdateFocusTime(state, currentPrice, settings) {
  const timeToNewFocus = settings.timeToNewFocus || 0;

  if (timeToNewFocus <= 0) return;

  if (state.focusLastUpdated) {
    const elapsed =
      (Date.now() - new Date(state.focusLastUpdated).getTime()) / 1000;

    if (elapsed >= timeToNewFocus) {
      // Aktualizuj focus tylko jeśli trend = 0 (brak otwartych pozycji)
      if (state.buyTrendCounter === 0 && state.sellTrendCounter === 0) {
        state.currentFocusPrice = currentPrice.toNumber();
        state.focusLastUpdated = new Date().toISOString();
        state.nextBuyTarget = calculateNextBuyTarget(
          currentPrice,
          0,
          settings,
        ).toNumber();
        state.nextSellTarget = calculateNextSellTarget(
          currentPrice,
          0,
          settings,
        ).toNumber();
        await state.save();
      }
    }
  }
}

/**
 * #2 Sprawdza czy można wykonać zakup (walidacja portfela)
 */
async function canExecuteBuy(transactionValue, currentPrice, state, settings) {
  const buySettings = settings.buy;
  if (!buySettings) return true;

  // Na spocie jako stable używamy USDT
  const currency = buySettings.currency || "USDT";
  const exchange = settings.exchange || "asterdex";
  const walletBalance = await WalletService.getBalance(
    state.walletAddress,
    currency,
    exchange,
  );
  const walletProtection = new Decimal(buySettings.walletProtection || 0);
  const availableBalance = walletBalance.minus(walletProtection);

  // Pomocnicze dane o parze/krypto do logów
  const baseAsset = settings.baseAsset || settings.sell?.currency || "BTC";
  const quoteAsset = settings.quoteAsset || currency;
  const symbol = `${baseAsset}${quoteAsset}`;

  if (availableBalance.lt(transactionValue)) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 BUY skipped (wallet.balance) wallet=${state.walletAddress} order=${state.orderId} ` +
          `symbol=${symbol} base=${baseAsset} quote=${quoteAsset} price=${currentPrice?.toString?.() ?? currentPrice ?? "-"} ` +
          `currency=${currency} balance=${walletBalance.toString()} protection=${walletProtection.toString()} ` +
          `available=${availableBalance.toString()} txValue=${transactionValue.toString()}`,
      );
    }
    return false;
  }

  const mode = buySettings.mode;
  if (!mode) return true;

  const maxValue = new Decimal(buySettings.maxValue || 0);
  const addProfit = buySettings.addProfit === true;

  switch (mode) {
    case "onlySold": {
      // Może kupić tylko za tyle ile wcześniej sprzedał
      const soldValue = new Decimal(state.totalSoldValue || 0);
      const boughtValue = new Decimal(state.totalBoughtValue || 0);
      let allowedToBuy = soldValue.minus(boughtValue);
      if (addProfit) allowedToBuy = allowedToBuy.plus(state.totalProfit || 0);
      if (transactionValue.gt(allowedToBuy)) {
        if (DEBUG_CONDITIONS) {
          console.log(
            `🔍 BUY skipped (wallet.onlySold) wallet=${state.walletAddress} order=${state.orderId} ` +
              `symbol=${symbol} base=${baseAsset} quote=${quoteAsset} price=${currentPrice?.toString?.() ?? currentPrice ?? "-"} ` +
              `soldValue=${soldValue.toString()} boughtValue=${boughtValue.toString()} ` +
              `totalProfit=${(state.totalProfit || 0).toString()} addProfit=${addProfit} ` +
              `allowedToBuy=${allowedToBuy.toString()} txValue=${transactionValue.toString()}`,
          );
        }
        return false;
      }
      break;
    }
    case "maxDefined": {
      // Kupuje do określonego maksimum
      // Używamy TYLKO łącznej wartości OTWARTYCH pozycji long (BUY),
      // żeby zamknięte pozycje "zwalniały" limit.
      const openBoughtValue = await getOpenLongBuyValue(state);
      let effectiveMax = maxValue;
      if (addProfit) effectiveMax = effectiveMax.plus(state.totalProfit || 0);
      if (openBoughtValue.plus(transactionValue).gt(effectiveMax)) {
        if (DEBUG_CONDITIONS) {
          console.log(
            `🔍 BUY skipped (wallet.maxDefined) wallet=${state.walletAddress} order=${state.orderId} ` +
              `symbol=${symbol} base=${baseAsset} quote=${quoteAsset} price=${currentPrice?.toString?.() ?? currentPrice ?? "-"} ` +
              `totalBoughtOpen=${openBoughtValue.toString()} maxValue=${maxValue.toString()} ` +
              `effectiveMax=${effectiveMax.toString()} addProfit=${addProfit} ` +
              `txValue=${transactionValue.toString()}`,
          );
        }
        return false;
      }
      break;
    }
    // 'walletLimit' - limit portfela, już sprawdzony przez availableBalance
  }

  return true;
}

/**
 * #2 Sprawdza czy można wykonać sprzedaż (walidacja portfela)
 */
async function canExecuteSell(amount, currentPrice, state, settings) {
  const sellSettings = settings.sell;
  if (!sellSettings) return true;

  const currency = sellSettings.currency || "BTC";
  const exchange = settings.exchange || "asterdex";
  const walletBalance = await WalletService.getBalance(
    state.walletAddress,
    currency,
    exchange,
  );
  const walletProtection = new Decimal(sellSettings.walletProtection || 0);
  const availableBalance = walletBalance.minus(walletProtection);

  if (availableBalance.lt(amount)) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 SELL skipped (wallet.balance) wallet=${state.walletAddress} order=${state.orderId} ` +
          `currency=${currency} balance=${walletBalance.toString()} protection=${walletProtection.toString()} ` +
          `available=${availableBalance.toString()} amount=${amount.toString()}`,
      );
    }
    return false;
  }

  const mode = sellSettings.mode;
  if (!mode) return true;

  const maxValue = new Decimal(sellSettings.maxValue || 0);
  const addProfit = sellSettings.addProfit === true;

  // Pomocnicze dane o parze do logów
  const baseAsset = settings.baseAsset || sellSettings.currency || "BTC";
  const quoteAsset = settings.quoteAsset || settings.buy?.currency || "USDT";
  const symbol = `${baseAsset}${quoteAsset}`;
  const txValue = currentPrice
    ? amount
        .mul(new Decimal(currentPrice))
        .toDecimalPlaces(PRICE_SCALE, Decimal.ROUND_DOWN)
    : new Decimal(0);

  switch (mode) {
    case "onlySold": {
      // Może sprzedać tylko tyle ile wcześniej kupiło
      const soldValue = new Decimal(state.totalSoldValue || 0);
      const boughtValue = new Decimal(state.totalBoughtValue || 0);
      let allowedToSell = boughtValue.minus(soldValue);
      if (addProfit) allowedToSell = allowedToSell.plus(state.totalProfit || 0);
      if (txValue.gt(allowedToSell)) {
        if (DEBUG_CONDITIONS) {
          console.log(
            `🔍 SELL skipped (wallet.onlySold) wallet=${state.walletAddress} order=${state.orderId} ` +
              `symbol=${symbol} base=${baseAsset} quote=${quoteAsset} price=${currentPrice?.toString?.() ?? "-"} ` +
              `boughtValue=${boughtValue.toString()} soldValue=${soldValue.toString()} ` +
              `totalProfit=${(state.totalProfit || 0).toString()} addProfit=${addProfit} ` +
              `allowedToSell=${allowedToSell.toString()} txValue=${txValue.toString()}`,
          );
        }
        return false;
      }
      break;
    }
    case "maxDefined": {
      // Sprzedaje do określonego maksimum
      // Używamy TYLKO wartości otwartych pozycji short (SELL),
      // żeby zamknięte shorty zwalniały limit.
      const totalSoldOpen = await getOpenShortSellValue(state);
      let effectiveMax = maxValue;
      if (addProfit) effectiveMax = effectiveMax.plus(state.totalProfit || 0);
      if (maxValue.gt(0) && totalSoldOpen.plus(txValue).gt(effectiveMax)) {
        if (DEBUG_CONDITIONS) {
          console.log(
            `🔍 SELL skipped (wallet.maxDefined) wallet=${state.walletAddress} order=${state.orderId} ` +
              `symbol=${symbol} base=${baseAsset} quote=${quoteAsset} price=${currentPrice?.toString?.() ?? "-"} ` +
              `totalSoldOpen=${totalSoldOpen.toString()} maxValue=${maxValue.toString()} ` +
              `effectiveMax=${effectiveMax.toString()} addProfit=${addProfit} ` +
              `txValue=${txValue.toString()}`,
          );
        }
        return false;
      }
      break;
    }
    // 'walletLimit' - limit portfela, już sprawdzony przez availableBalance
  }

  return true;
}

/**
 * #3 Sprawdza minimalną wartość transakcji
 *
 * AsterDex ma własne minimum: ~5 USDT na zlecenie.
 * Tutaj pilnujemy, żeby transakcja BUY/SELL nie schodziła poniżej tego progu
 * (ewentualnie wyższego, jeśli ustawiono platform.minTransactionValue).
 */
function meetsMinTransactionValue(transactionValue, settings) {
  try {
    const tx = new Decimal(transactionValue || 0);
    // Minimalna wartość z ustawień (jeśli użytkownik chce wyższy próg)

    // Minimalna wartość narzucona przez giełdę
    const exchangeMin = new Decimal(2); // 2 USDT

    const effectiveMin = exchangeMin;

    if (effectiveMin.lte(0)) {
      return true;
    }

    const ok = tx.gte(effectiveMin);

    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 minTransactionValue check: tx=${tx.toString()} minExchange=${exchangeMin.toString()} → effective=${effectiveMin.toString()} ok=${ok}`,
      );
    }

    return ok;
  } catch (e) {
    console.warn(
      "⚠️ meetsMinTransactionValue: failed to evaluate, allowing transaction:",
      e?.message,
    );
    return true;
  }
}

/**
 * Zwraca łączną wartość OTWARTYCH pozycji long (BUY) dla danego stanu GRID.
 * Używane w logice wallet.maxDefined, żeby limit opierał się na faktycznie
 * zajętym kapitale, a nie na historycznej sumie wszystkich zakupów.
 */
async function getOpenLongBuyValue(state) {
  try {
    const positions = await Position.findOpenByWalletAndOrderId(
      state.walletAddress,
      state.orderId,
    );

    let sum = new Decimal(0);
    for (const p of positions) {
      // Traktuj brak typu jako BUY (stare rekordy)
      if (p.type && p.type !== PositionType.BUY) continue;
      if (p.buyValue == null) continue;
      sum = sum.plus(new Decimal(p.buyValue));
    }

    return sum;
  } catch (e) {
    console.warn(
      "⚠️ getOpenLongBuyValue: failed to sum open BUY positions, falling back to 0:",
      e?.message,
    );
    return new Decimal(0);
  }
}

/**
 * Zwraca łączną wartość OTWARTYCH pozycji short (SELL) dla danego stanu GRID.
 * Używane w logice wallet.maxDefined po stronie sprzedaży, żeby limit
 * opierał się na faktycznie otwartych shortach, a nie na historii.
 */
async function getOpenShortSellValue(state) {
  try {
    const positions = await Position.findOpenByWalletAndOrderId(
      state.walletAddress,
      state.orderId,
    );

    let sum = new Decimal(0);
    for (const p of positions) {
      if (p.type && p.type !== PositionType.SELL) continue;
      if (p.sellValue == null) continue;
      sum = sum.plus(new Decimal(p.sellValue));
    }

    return sum;
  } catch (e) {
    console.warn(
      "⚠️ getOpenShortSellValue: failed to sum open SELL positions, falling back to 0:",
      e?.message,
    );
    return new Decimal(0);
  }
}

/**
 * #3 Sprawdza czy fee nie zje profitu
 */
function checkFeeDoesNotEatProfit(buyValue, expectedProfit, settings) {
  if (!settings.platform?.checkFeeProfit) return true;

  // Fee za kupno + sprzedaż (2x)
  const totalFee = buyValue.mul(DEFAULT_FEE_PERCENT).mul(2).div(100);

  return totalFee.lt(expectedProfit);
}

/**
 * #8 Pobiera procent wahania dla zakresu cen
 */
function getSwingPercent(currentPrice, settings, isBuy) {
  const swingPercents = isBuy
    ? settings.buySwingPercent
    : settings.sellSwingPercent;

  if (!swingPercents || swingPercents.length === 0) {
    return new Decimal(0);
  }

  const price = new Decimal(currentPrice);

  for (const sp of swingPercents) {
    // Sprawdź zakres cen: minPrice <= cena < maxPrice
    if (sp.minPrice != null && price.lt(new Decimal(sp.minPrice))) {
      continue;
    }
    if (sp.maxPrice != null && price.gte(new Decimal(sp.maxPrice))) {
      continue;
    }
    return new Decimal(sp.value || 0);
  }

  return new Decimal(0);
}

/**
 * #8 Sprawdza minimalny procent wahania
 */
function meetsMinSwing(previousPrice, currentPrice, trend, settings, isBuy) {
  const minSwingPercent = getSwingPercent(currentPrice, settings, isBuy);

  if (minSwingPercent.eq(0)) return true;

  const priceDiff = previousPrice.minus(currentPrice).abs();
  const percentChange = priceDiff.div(previousPrice).mul(100);

  return percentChange.gte(minSwingPercent);
}

/**
 * Sprawdza czy spełnione są warunki zakupu
 */
function shouldBuy(currentPrice, state, settings) {
  if (!settings.buyConditions) return false;

  const wallet = state.walletAddress;
  const orderId = state.orderId;

  // Sprawdź próg cenowy
  const priceThreshold = settings.buyConditions.priceThreshold;
  if (priceThreshold && currentPrice.gt(priceThreshold)) {
    if (settings.buyConditions.checkThresholdIfProfitable) {
      return false; // Zawsze sprawdzaj próg
    }
    if ((state.totalProfit || 0) <= 0) {
      return false; // Sprawdź tylko jeśli nie na plusie
    }
  }

  // Sprawdź cel zakupu
  let buyTarget = state.nextBuyTarget
    ? new Decimal(state.nextBuyTarget)
    : calculateNextBuyTarget(
        new Decimal(state.currentFocusPrice),
        state.buyTrendCounter,
        settings,
      );

  if (currentPrice.gt(buyTarget)) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 BUY skipped (target) wallet=${wallet} order=${orderId} ` +
          `price=${currentPrice.toNumber()} > target=${buyTarget.toNumber()}`,
      );
    }
    return false;
  }

  // #8 Sprawdź min wahanie
  const swingOk = meetsMinSwing(
    new Decimal(state.currentFocusPrice),
    currentPrice,
    state.buyTrendCounter,
    settings,
    true,
  );

  if (DEBUG_CONDITIONS) {
    console.log(
      `🔍 BUY check wallet=${wallet} order=${orderId} ` +
        `price=${currentPrice.toNumber()} focus=${state.currentFocusPrice} ` +
        `target=${buyTarget.toNumber()} swingOk=${swingOk}`,
    );
  }

  return swingOk;
}

/**
 * Wykonuje zakup
 */
async function executeBuy(currentPrice, state, settings) {
  const currentTrend = state.buyTrendCounter;

  // Oblicz realny spadek ceny od focus (w %) – ile faktycznie "poszło w dół".
  let effectiveTrendPercent = getTrendPercent(currentTrend, settings, true);
  try {
    const focus = new Decimal(state.currentFocusPrice || 0);
    if (!focus.isZero()) {
      const dropPercent = focus
        .minus(currentPrice)
        .div(focus)
        .mul(100)
        .toDecimalPlaces(1, Decimal.ROUND_DOWN); // dokładność 0.1%
      // Użyj większej z wartości: skonfigurowany trend lub faktyczny spadek.
      if (dropPercent.gt(effectiveTrendPercent)) {
        effectiveTrendPercent = dropPercent;
      }
    }
  } catch {
    // w razie problemów zostań przy trendPercent
  }

  // Oblicz wartość transakcji na podstawie "efektywnego" procenta
  let transactionValue = calculateTransactionValue(
    currentPrice,
    currentTrend,
    settings,
    true,
    effectiveTrendPercent,
  );

  // Jeśli tryb kupna to "maxDefined", to zamiast całkowicie blokować transakcję,
  // przytnij jej wartość do "wolnego miejsca" w limicie.
  const buySettings = settings.buy || {};
  if (buySettings.mode === "maxDefined") {
    const maxValue = new Decimal(buySettings.maxValue || 0);
    if (maxValue.gt(0)) {
      const addProfit = buySettings.addProfit === true;
      let effectiveMax = maxValue;
      if (addProfit) effectiveMax = effectiveMax.plus(state.totalProfit || 0);

      const openBoughtValue = await getOpenLongBuyValue(state);
      const remaining = effectiveMax.minus(openBoughtValue);

      // Limit całkowicie wypełniony – nic nie kupuj.
      if (remaining.lte(0)) {
        if (DEBUG_CONDITIONS) {
          console.log(
            `🔍 BUY skipped (wallet.maxDefined.filled) wallet=${state.walletAddress} order=${state.orderId} ` +
              `totalBoughtOpen=${openBoughtValue.toString()} maxValue=${maxValue.toString()} ` +
              `effectiveMax=${effectiveMax.toString()} addProfit=${addProfit}`,
          );
        }
        return;
      }

      // Jeśli wyliczone txValue przekracza wolne miejsce, kup tylko do limitu.
      if (transactionValue.gt(remaining)) {
        const originalTx = transactionValue;
        transactionValue = remaining.toDecimalPlaces(
          PRICE_SCALE,
          Decimal.ROUND_DOWN,
        );

        if (DEBUG_CONDITIONS) {
          console.log(
            `🔍 BUY maxDefined capped txValue wallet=${state.walletAddress} order=${state.orderId} ` +
              `totalBoughtOpen=${openBoughtValue.toString()} maxValue=${maxValue.toString()} ` +
              `effectiveMax=${effectiveMax.toString()} addProfit=${addProfit} ` +
              `txOriginal=${originalTx.toString()} txCapped=${transactionValue.toString()}`,
          );
        }
      }
    }
  }

  // #3 Sprawdź min wartość
  if (!meetsMinTransactionValue(transactionValue, settings)) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 BUY skipped (minTransactionValue) wallet=${state.walletAddress} order=${state.orderId} ` +
          `txValue=${transactionValue.toNumber()} min=${settings.platform?.minTransactionValue}`,
      );
    }
    return;
  }

  // #2 Sprawdź portfel
  // Szczegółowe logi powodów (saldo / onlySold / maxDefined) są w canExecuteBuy
  if (!(await canExecuteBuy(transactionValue, currentPrice, state, settings))) {
    return;
  }

  // Oblicz ilość kupowanej waluty
  const amount = transactionValue
    .div(currentPrice)
    .toDecimalPlaces(AMOUNT_SCALE, Decimal.ROUND_DOWN);

  // Oblicz cel sprzedaży (profit na pojedynczej transakcji)
  // Trendy służą tylko do wyznaczania poziomów wejścia.
  // Minimalny zarobek określa, o ile % cena musi wzrosnąć od zakupu,
  // żeby sprzedać pozycję.
  const profitPercent = new Decimal(settings.minProfitPercent || 0.5);

  const targetSellPrice = currentPrice
    .mul(Decimal.add(1, profitPercent.div(100)))
    .toDecimalPlaces(PRICE_SCALE, Decimal.ROUND_UP);

  // Oblicz oczekiwany profit
  const expectedProfit = targetSellPrice.minus(currentPrice).mul(amount);

  // #3 Sprawdź fee
  if (!checkFeeDoesNotEatProfit(transactionValue, expectedProfit, settings)) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 BUY skipped (fee>=profit) wallet=${state.walletAddress} order=${state.orderId} ` +
          `txValue=${transactionValue.toNumber()} expectedProfit=${expectedProfit.toNumber()}`,
      );
    }
    return;
  }

  // Utwórz symbol pary (baseAsset + quoteAsset lub fallback na currency)
  const baseAsset = settings.baseAsset || settings.sell?.currency || "BTC";
  // Na spocie jako stable używamy USDT
  const quoteAsset = settings.quoteAsset || settings.buy?.currency || "USDT";
  const symbol = `${baseAsset}${quoteAsset}`;
  const exchange = settings.exchange || "asterdex";

  // Wykonaj zlecenie przez ExchangeService (realne lub paper-trading)
  // Przekaż exchange z ustawień zlecenia (może być inny niż globalna giełda użytkownika)
  const exchangeResult = await ExchangeService.placeSpotBuy(
    state.walletAddress,
    symbol,
    transactionValue,
    currentPrice,
    exchange, // Przekaż giełdę z zlecenia
  );

  if (!exchangeResult.success) {
    console.error(`Failed to execute buy on exchange: ${exchangeResult.error}`);
    return;
  }

  // Użyj RZECZYWISTEJ wykonanej ilości i średniej ceny z giełdy
  // (GridBot działa na realnych wartościach z giełdy, a nie na „planowanych” 5 USDT)
  let executedAmount = exchangeResult.executedQty || amount;
  let executedPrice = exchangeResult.avgPrice || currentPrice;

  if (!(executedAmount instanceof Decimal)) {
    executedAmount = new Decimal(executedAmount);
  }
  if (!(executedPrice instanceof Decimal)) {
    executedPrice = new Decimal(executedPrice);
  }

  let buyPriceNum = toNum(executedPrice);
  let amountNum = toNum(executedAmount);
  let buyValueNum = executedPrice.mul(executedAmount).toNumber();

  if (buyPriceNum <= 0 || amountNum <= 0) {
    console.warn(
      `⚠️ BUY: executed data invalid (buyPrice=${buyPriceNum}, amount=${amountNum}), using currentPrice/amount`,
    );
    buyPriceNum = toNum(currentPrice);
    amountNum = toNum(amount);
  }
  // Zawsze ustaw wartość zakupu (cena × ilość), żeby w UI kolumna „Wartość” miała dane
  if (buyValueNum <= 0 || !Number.isFinite(buyValueNum)) {
    buyValueNum = buyPriceNum * amountNum;
  }

  // Zapisz pozycję
  const position = new Position({
    walletAddress: state.walletAddress,
    orderId: state.orderId,
    type: PositionType.BUY,
    buyPrice: buyPriceNum,
    amount: amountNum,
    buyValue: buyValueNum,
    trendAtBuy: currentTrend,
    targetSellPrice: toNum(targetSellPrice),
    status: PositionStatus.OPEN,
  });
  await position.save();

  // Aktualizuj stan: focus = cena ostatniego zakupu, trend 0→1→2→… do max z trendPercents
  state.openPositionIds.push(position.id);
  const maxTrend = getMaxTrend(settings);
  state.buyTrendCounter = Math.min(currentTrend + 1, maxTrend);
  state.totalBuyTransactions += 1;
  state.totalBoughtValue = new Decimal(state.totalBoughtValue || 0)
    .plus(transactionValue)
    .toNumber();

  // Focus zmienia się na cenę zakupu - to jest nowa baza dla kolejnych zakupów
  // Po każdym zakupie focus = cena zakupu, a następny cel zakupu jest niższy o procent odpowiadający następnemu trendowi
  state.currentFocusPrice = buyPriceNum;
  state.focusLastUpdated = new Date().toISOString();

  // Następny cel zakupu obliczamy dla następnego trendu (zwiększonego)
  // Jeśli trend osiągnął max, następny cel jest dla trendu 0 (cykl się powtarza)
  // nextBuyTarget = focus - (focus * trendPercent / 100) - zawsze niższy niż focus
  const nextTrend =
    state.buyTrendCounter >= maxTrend ? 0 : state.buyTrendCounter;
  state.nextBuyTarget = calculateNextBuyTarget(
    new Decimal(buyPriceNum), // Focus = cena zakupu (nowa baza)
    nextTrend, // Następny trend (zwiększony lub 0 jeśli osiągnięto max)
    settings,
  ).toNumber();

  if (DEBUG_CONDITIONS && !QUIET_PRODUCTION_LOGS) {
    const trendPercent = getTrendPercent(nextTrend, settings, true);
    console.log(
      `🔍 BUY focus updated: price=${buyPriceNum}, trend=${currentTrend}→${state.buyTrendCounter}, ` +
        `nextTrend=${nextTrend} (${trendPercent}%), nextBuyTarget=${state.nextBuyTarget} ` +
        `(spadek: ${(((buyPriceNum - state.nextBuyTarget) / buyPriceNum) * 100).toFixed(2)}%)`,
    );
  }

  if (!QUIET_PRODUCTION_LOGS) {
    console.log(
      `🟢 BUY executed: position=${position.id} order=${state.orderId} price=${buyPriceNum}, amount=${amountNum}, value=${transactionValue}, trend=${currentTrend}→${state.buyTrendCounter} focus=${buyPriceNum}`,
    );
  }

  // Oblicz szczegółowe źródło kwoty zakupu - krok po kroku
  const trendPercent = getTrendPercent(currentTrend, settings, true);
  const minValuePer1Percent =
    settings.buyConditions?.minValuePer1Percent || 200;

  // Krok 1: Oblicz podstawową wartość
  const baseValueStep1 = minValuePer1Percent * trendPercent.toNumber();
  let calculationSteps = [
    {
      step: 1,
      description: "Podstawowa wartość na 1%",
      formula: `minValuePer1Percent × trendPercent`,
      values: {
        minValuePer1Percent: minValuePer1Percent,
        trendPercent: trendPercent.toNumber().toFixed(4),
        result: baseValueStep1.toFixed(2),
      },
      result: baseValueStep1,
    },
  ];

  // Krok 2: Sprawdź faktyczny spadek ceny
  let actualDropPercent = null;
  try {
    const focus = new Decimal(state.currentFocusPrice || 0);
    if (!focus.isZero()) {
      actualDropPercent = focus
        .minus(currentPrice)
        .div(focus)
        .mul(100)
        .toDecimalPlaces(1, Decimal.ROUND_DOWN)
        .toNumber();
    }
  } catch {}

  calculationSteps.push({
    step: 2,
    description: "Faktyczny spadek ceny od focus",
    formula: `(focusPrice - currentPrice) / focusPrice × 100`,
    values: {
      focusPrice: (state.currentFocusPrice || 0).toFixed(2),
      currentPrice: currentPrice.toNumber().toFixed(2),
      actualDropPercent:
        actualDropPercent != null
          ? actualDropPercent.toFixed(2) + "%"
          : "brak focus",
      trendPercentFromSettings: trendPercent.toNumber().toFixed(4) + "%",
      effectiveTrendPercent: effectiveTrendPercent.toNumber().toFixed(4) + "%",
      note:
        actualDropPercent != null && actualDropPercent > trendPercent.toNumber()
          ? "Użyto faktycznego spadku (większy niż trend z ustawień)"
          : "Użyto trendPercent z ustawień",
    },
    result: effectiveTrendPercent.toNumber(),
  });

  // Krok 3: Dodatkowe wartości z progów cenowych
  let additionalValueStep3 = 0;
  let additionalThreshold = null;
  const additionalBuyValues = settings.additionalBuyValues;
  if (additionalBuyValues && additionalBuyValues.length > 0) {
    for (const threshold of additionalBuyValues) {
      if (matchesThreshold(currentPrice, threshold)) {
        const addVal = new Decimal(threshold.value || 0);
        const addComponent = addVal.mul(trendPercent);
        additionalValueStep3 = addComponent.toNumber();
        additionalThreshold = threshold;
        break;
      }
    }
  }

  if (additionalValueStep3 > 0) {
    calculationSteps.push({
      step: 3,
      description: "Dodatkowa wartość z progu cenowego",
      formula: `additionalValue × trendPercent`,
      values: {
        priceRange: `[${additionalThreshold?.minPrice ?? "-"}, ${additionalThreshold?.maxPrice ?? "-"}]`,
        additionalValue: additionalThreshold?.value || 0,
        trendPercent: trendPercent.toNumber().toFixed(4),
        result: additionalValueStep3.toFixed(2),
      },
      result: additionalValueStep3,
    });
  }

  // Krok 4: Wartość przed ograniczeniem max
  const valueBeforeMax = baseValueStep1 + additionalValueStep3;
  calculationSteps.push({
    step: calculationSteps.length + 1,
    description: "Wartość przed ograniczeniem maksymalnym",
    formula: `baseValue + additionalValue`,
    values: {
      baseValue: baseValueStep1.toFixed(2),
      additionalValue: additionalValueStep3.toFixed(2),
      result: valueBeforeMax.toFixed(2),
    },
    result: valueBeforeMax,
  });

  // Krok 5: Ograniczenie maksymalnej wartości
  let maxValueStep5 = null;
  let maxThreshold = null;
  const maxBuyValues = settings.maxBuyPerTransaction;
  if (maxBuyValues && maxBuyValues.length > 0) {
    for (const threshold of maxBuyValues) {
      if (matchesThreshold(currentPrice, threshold)) {
        const maxVal = new Decimal(threshold.value || 10000);
        if (valueBeforeMax > maxVal.toNumber()) {
          maxValueStep5 = maxVal.toNumber();
          maxThreshold = threshold;
        }
        break;
      }
    }
  }

  if (maxValueStep5 != null) {
    calculationSteps.push({
      step: calculationSteps.length + 1,
      description: "Ograniczenie maksymalnej wartości",
      formula: `min(wartośćPrzedMax, maxValue)`,
      values: {
        valueBeforeMax: valueBeforeMax.toFixed(2),
        maxValue: maxValueStep5.toFixed(2),
        priceRange: `[${maxThreshold?.minPrice ?? "-"}, ${maxThreshold?.maxPrice ?? "-"}]`,
        result: maxValueStep5.toFixed(2),
        note: "Wartość została ograniczona do maksimum",
      },
      result: maxValueStep5,
    });
  }

  // Krok 6: Finalna obliczona wartość transakcji
  const finalCalculatedValue =
    maxValueStep5 != null ? maxValueStep5 : valueBeforeMax;
  calculationSteps.push({
    step: calculationSteps.length + 1,
    description: "Finalna obliczona wartość transakcji",
    formula:
      maxValueStep5 != null
        ? "wartośćPrzedMax ograniczona do maxValue"
        : "baseValue + additionalValue",
    values: {
      result: finalCalculatedValue.toFixed(2),
    },
    result: finalCalculatedValue,
  });

  // Krok 7: Obliczona ilość
  const calculatedAmount = finalCalculatedValue / currentPrice.toNumber();
  calculationSteps.push({
    step: calculationSteps.length + 1,
    description: "Obliczona ilość",
    formula: `transactionValue / currentPrice`,
    values: {
      transactionValue: finalCalculatedValue.toFixed(2),
      currentPrice: currentPrice.toNumber().toFixed(2),
      result: calculatedAmount.toFixed(8),
    },
    result: calculatedAmount,
  });

  // Krok 8: Rzeczywiste wartości z giełdy
  calculationSteps.push({
    step: calculationSteps.length + 1,
    description: "Rzeczywiste wartości z giełdy",
    formula: "Wartości zwrócone przez ExchangeService",
    values: {
      executedPrice: buyPriceNum.toFixed(2),
      executedAmount: amountNum.toFixed(8),
      executedValue: buyValueNum.toFixed(2),
      priceSource: exchangeResult.avgPrice
        ? "exchange (avgPrice)"
        : "currentPrice (fallback)",
      amountSource: exchangeResult.executedQty
        ? "exchange (executedQty)"
        : "calculated (fallback)",
    },
    result: buyValueNum,
  });

  const calculationDetails = {
    summary: {
      trend: currentTrend,
      trendPercent: trendPercent.toNumber().toFixed(4) + "%",
      effectiveTrendPercent: effectiveTrendPercent.toNumber().toFixed(4) + "%",
      calculatedTransactionValue: finalCalculatedValue.toFixed(2),
      executedValue: buyValueNum.toFixed(2),
      currentPrice: currentPrice.toNumber().toFixed(2),
      executedPrice: buyPriceNum.toFixed(2),
    },
    steps: calculationSteps,
  };

  // Loguj transakcję zakupu do pliku JSON
  await logBuyTransaction({
    type: "BUY",
    walletAddress: state.walletAddress,
    orderId: state.orderId,
    positionId: position.id,
    price: buyPriceNum,
    amount: amountNum,
    value: buyValueNum,
    trend: currentTrend,
    targetSellPrice: toNum(targetSellPrice),
    status: "OPEN",
    focusPrice: buyPriceNum,
    nextBuyTarget: state.nextBuyTarget,
    calculationDetails: calculationDetails,
  });

  // Zapisz zaktualizowany stan (włącznie z nextBuyTarget) do bazy danych
  await state.save();
}

/**
 * Sprawdza i wykonuje sprzedaż pozycji kupna (z zyskiem)
 * Uwzględnia próg cenowy sprzedaży (sellConditions.priceThreshold).
 */
async function checkAndExecuteBuySells(currentPrice, state, settings) {
  // Najpierw zsynchronizuj openPositionIds z rzeczywistymi otwartymi pozycjami w bazie
  // To zapewni, że wszystkie otwarte pozycje są sprawdzane, nawet jeśli openPositionIds jest nieaktualne
  const allOpenPositions = await Position.findByWalletAndOrderId(
    state.walletAddress,
    state.orderId,
  );
  const actualOpenPositions = allOpenPositions.filter(
    (p) => (p.type === "BUY" || !p.type) && p.status === PositionStatus.OPEN,
  );

  // Zaktualizuj openPositionIds jeśli różni się od rzeczywistych otwartych pozycji
  const actualOpenIds = actualOpenPositions.map((p) => p.id);
  if (
    JSON.stringify(state.openPositionIds.sort()) !==
    JSON.stringify(actualOpenIds.sort())
  ) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 BUY_SELL syncing openPositionIds: was ${state.openPositionIds.length}, now ${actualOpenIds.length} ` +
          `wallet=${state.walletAddress} order=${state.orderId}`,
      );
    }
    state.openPositionIds = actualOpenIds;
    await state.save();
  }

  if (!state.openPositionIds || state.openPositionIds.length === 0) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 BUY_SELL skipped (no open positions) wallet=${state.walletAddress} order=${state.orderId}`,
      );
    }
    return false;
  }

  const positions = await Position.findByIds(state.openPositionIds);

  if (DEBUG_CONDITIONS && positions.length > 0) {
    console.log(
      `🔍 BUY_SELL checking ${positions.length} positions wallet=${state.walletAddress} order=${state.orderId} ` +
        `currentPrice=${currentPrice.toNumber()} ` +
        `openPositionIds=${JSON.stringify(state.openPositionIds)}`,
    );
  }

  // Sortuj po cenie docelowej (najniższa pierwsza - najpierw zamknij te z najniższym targetSellPrice)
  positions.sort((a, b) => (a.targetSellPrice || 0) - (b.targetSellPrice || 0));

  // Próg sprzedaży: poniżej tej ceny nie sprzedajemy (z wyjątkiem gdy checkThresholdIfProfitable=false i jest zysk)
  const priceThreshold = settings.sellConditions?.priceThreshold;
  const belowThreshold =
    priceThreshold && currentPrice.lt(new Decimal(priceThreshold));
  if (belowThreshold) {
    if (settings.sellConditions?.checkThresholdIfProfitable) {
      if (DEBUG_CONDITIONS) {
        console.log(
          `🔍 BUY_SELL skipped (price threshold) wallet=${state.walletAddress} order=${state.orderId} ` +
            `currentPrice=${currentPrice.toNumber()} < threshold=${priceThreshold}`,
        );
      }
      return false; // Zawsze respektuj próg – nie zamykaj pozycji poniżej progu
    }
    if ((state.totalProfit || 0) <= 0) {
      if (DEBUG_CONDITIONS) {
        console.log(
          `🔍 BUY_SELL skipped (threshold+no profit) wallet=${state.walletAddress} order=${state.orderId} ` +
            `currentPrice=${currentPrice.toNumber()} < threshold=${priceThreshold}, totalProfit=${state.totalProfit}`,
        );
      }
      return false; // Poniżej progu i bez zysku – nie sprzedawaj
    }
  }

  let executed = false;
  let executedCount = 0;
  const maxExecutionsPerCycle = 10; // Maksymalna liczba pozycji do zamknięcia w jednym cyklu (zabezpieczenie)

  for (const position of positions) {
    if (position.status !== PositionStatus.OPEN) {
      if (DEBUG_CONDITIONS) {
        console.log(
          `🔍 BUY_SELL skipped (not OPEN) wallet=${state.walletAddress} order=${state.orderId} ` +
            `position=${position.id} status=${position.status}`,
        );
      }
      continue;
    }

    if (!position.targetSellPrice) {
      if (DEBUG_CONDITIONS) {
        console.log(
          `🔍 BUY_SELL skipped (no target) wallet=${state.walletAddress} order=${state.orderId} ` +
            `position=${position.id} - brak targetSellPrice`,
        );
      }
      continue;
    }

    const targetPrice = new Decimal(position.targetSellPrice);
    const priceReached = currentPrice.gte(targetPrice);

    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 BUY_SELL check position=${position.id} wallet=${state.walletAddress} order=${state.orderId} ` +
          `currentPrice=${currentPrice.toNumber()} targetSellPrice=${targetPrice.toNumber()} ` +
          `reached=${priceReached}`,
      );
    }

    if (priceReached) {
      if (DEBUG_CONDITIONS) {
        console.log(
          `✅ BUY_SELL executing position=${position.id} wallet=${state.walletAddress} order=${state.orderId} ` +
            `currentPrice=${currentPrice.toNumber()} targetSellPrice=${targetPrice.toNumber()}`,
        );
      }

      // Przeładuj stan przed każdym zamknięciem, aby mieć aktualne dane
      const currentState = await GridState.findByWalletAndOrderId(
        state.walletAddress,
        state.orderId,
      );
      if (currentState) {
        Object.assign(state, currentState.toJSON());
      }

      try {
        await executeBuySell(currentPrice, position, state, settings);
      } catch (e) {
        console.error(
          `❌ BUY_SELL error for position=${position.id} wallet=${state.walletAddress} order=${state.orderId}:`,
          e?.message || e,
        );
        continue;
      }
      executed = true;
      executedCount++;

      // Przerwij jeśli osiągnięto limit (zabezpieczenie przed zbyt wieloma transakcjami w jednym cyklu)
      if (executedCount >= maxExecutionsPerCycle) {
        if (DEBUG_CONDITIONS) {
          console.log(
            `⚠️ BUY_SELL limit reached: ${executedCount} positions closed in this cycle`,
          );
        }
        break;
      }

      // Po zamknięciu pozycji przeładuj stan z bazy przed sprawdzeniem następnej
      const updatedState = await GridState.findByWalletAndOrderId(
        state.walletAddress,
        state.orderId,
      );
      if (updatedState) {
        Object.assign(state, updatedState.toJSON());
      }
    }
  }

  if (executed && DEBUG_CONDITIONS) {
    console.log(
      `✅ BUY_SELL completed: ${executedCount} position(s) closed wallet=${state.walletAddress} order=${state.orderId}`,
    );
  }

  return executed;
}

/**
 * Wykonuje sprzedaż pozycji kupna
 */
async function executeBuySell(currentPrice, position, state, settings) {
  if (DEBUG_CONDITIONS) {
    console.log(
      `🔍 executeBuySell start position=${position.id} wallet=${state.walletAddress} order=${state.orderId} ` +
        `currentPrice=${currentPrice.toNumber()} buyPrice=${position.buyPrice} buyValue=${position.buyValue}`,
    );
  }

  const amount = new Decimal(position.amount);
  const sellValue = amount.mul(currentPrice);
  const profit = sellValue.minus(position.buyValue);

  // Nigdy nie sprzedawaj ze stratą
  if (profit.lt(0)) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 SELL skipped (profit<0) position=${position.id} wallet=${state.walletAddress} order=${state.orderId} ` +
          `sellValue=${sellValue.toNumber()} buyValue=${position.buyValue} profit=${profit.toNumber()}`,
      );
    }
    return;
  }

  const baseAsset = settings.baseAsset || settings.sell?.currency || "BTC";
  const quoteAsset = settings.quoteAsset || settings.buy?.currency || "USDT";
  const symbol = `${baseAsset}${quoteAsset}`;
  const exchange = settings.exchange || "asterdex";

  // Wykonaj zlecenie przez ExchangeService
  // Przekaż exchange z ustawień zlecenia (może być inny niż globalna giełda użytkownika)
  const exchangeResult = await ExchangeService.placeSpotSell(
    state.walletAddress,
    symbol,
    amount,
    currentPrice,
    exchange, // Przekaż giełdę z zlecenia
  );

  if (!exchangeResult.success) {
    console.error(
      `Failed to execute sell on exchange for position=${position.id}: ${exchangeResult.error}`,
    );
    return;
  }

  // Użyj rzeczywistej wykonanej ilości i średniej ceny z giełdy
  let executedAmount = exchangeResult.executedQty;
  let executedPrice = exchangeResult.avgPrice;

  // Konwersja do Decimal jeśli potrzeba
  if (executedAmount != null && !(executedAmount instanceof Decimal)) {
    executedAmount = new Decimal(executedAmount);
  } else if (executedAmount == null || executedAmount.isZero()) {
    executedAmount = amount;
  }

  if (executedPrice != null && !(executedPrice instanceof Decimal)) {
    executedPrice = new Decimal(executedPrice);
  } else if (
    executedPrice == null ||
    executedPrice.isZero() ||
    executedPrice.lte(0)
  ) {
    executedPrice = new Decimal(currentPrice);
  }

  const executedSellValue = executedPrice.mul(executedAmount);
  // Profit brutto = różnica między wartością sprzedaży a wartością zakupu (w USDT)
  // Kupiliśmy za position.buyValue USDT, sprzedaliśmy za executedSellValue USDT
  const executedProfitGross = executedSellValue.minus(position.buyValue);
  // Przybliżona prowizja: fee od zakupu + fee od sprzedaży (0.1% na każdą stronę)
  const totalFeeLong = new Decimal(position.buyValue || 0)
    .plus(executedSellValue)
    .mul(DEFAULT_FEE_PERCENT)
    .div(100);
  const executedProfit = executedProfitGross.minus(totalFeeLong);
  const sellPriceNum = toNum(executedPrice);
  const executedAmountNum = toNum(executedAmount);
  const executedSellValueNum = executedSellValue.toNumber();
  const executedProfitNum = executedProfit.toNumber();

  // Walidacja: jeśli sellPriceNum jest 0, użyj currentPrice
  const finalSellPrice = sellPriceNum > 0 ? sellPriceNum : toNum(currentPrice);

  // Następny cel zakupu po tej sprzedaży (do pokazania w UI jako "Cel odkupu")
  const newBuyTrendCounter = Math.max(0, state.buyTrendCounter - 1);
  const nextBuyTargetForDisplay = calculateNextBuyTarget(
    new Decimal(finalSellPrice),
    newBuyTrendCounter,
    settings,
  ).toNumber();

  // Aktualizuj pozycję BUY (zamknij ją)
  position.sellPrice = finalSellPrice;
  position.sellValue = executedSellValueNum;
  position.profit = executedProfitNum;
  position.status = PositionStatus.CLOSED;
  position.closedAt = new Date().toISOString();
  await position.save();

  // Aktualizuj stan: focus = cena sprzedaży; trend w dół (5→4→…→0)
  state.openPositionIds = state.openPositionIds.filter(
    (id) => id !== position.id,
  );
  state.buyTrendCounter = Math.max(0, state.buyTrendCounter - 1);
  state.totalSellTransactions += 1;
  state.totalSoldValue = new Decimal(state.totalSoldValue || 0)
    .plus(executedSellValueNum)
    .toNumber();
  // Przelicz łączny profit na podstawie wszystkich ZAMKNIĘTYCH pozycji
  // (long + short) dla danego zlecenia – dzięki temu Total Profit w UI
  // zawsze odpowiada sumie z tabeli zamkniętych pozycji.
  state.totalProfit = await Position.getTotalClosedProfit(
    state.walletAddress,
    state.orderId,
  );

  // Ustaw focus na cenę sprzedaży (zawsze > 0)
  // Po zamknięciu long:
  // - aktualizujemy BUY focus i jego kolejne poziomy (nextBuyTarget),
  // - SELL focus (nextSellTarget) zostawiamy – zmienia się tylko przy transakcjach SELL.
  state.currentFocusPrice = finalSellPrice;
  state.focusLastUpdated = new Date().toISOString();
  state.nextBuyTarget = nextBuyTargetForDisplay;

  if (!QUIET_PRODUCTION_LOGS) {
    console.log(
      `🔴 SELL executed: position=${position.id} price=${finalSellPrice}, amount=${executedAmountNum}, ` +
        `buyValue=${position.buyValue}, sellValue=${executedSellValueNum}, ` +
        `profit=${executedProfitNum}, trend→${state.buyTrendCounter} focus=${finalSellPrice}`,
    );
  }

  // Oblicz szczegółowe źródło kwoty sprzedaży - krok po kroku
  const sellCalculationSteps = [
    {
      step: 1,
      description: "Dane z pozycji zakupu",
      formula: "Zapamiętane wartości z momentu zakupu",
      values: {
        buyPrice: position.buyPrice.toFixed(2),
        buyAmount: position.amount.toFixed(8),
        buyValue: position.buyValue.toFixed(2),
      },
      result: position.buyValue,
    },
    {
      step: 2,
      description: "Aktualna cena rynkowa",
      formula: "Cena pobrana z PriceFeedService",
      values: {
        currentPrice: currentPrice.toNumber().toFixed(2),
        source: "PriceFeedService.getPrice()",
      },
      result: currentPrice.toNumber(),
    },
    {
      step: 3,
      description: "Obliczona wartość sprzedaży",
      formula: "buyAmount × currentPrice",
      values: {
        buyAmount: position.amount.toFixed(8),
        currentPrice: currentPrice.toNumber().toFixed(2),
        calculatedSellValue: (
          position.amount * currentPrice.toNumber()
        ).toFixed(2),
      },
      result: position.amount * currentPrice.toNumber(),
    },
    {
      step: 4,
      description: "Rzeczywiste wartości z giełdy",
      formula: "Wartości zwrócone przez ExchangeService",
      values: {
        executedPrice: finalSellPrice.toFixed(2),
        executedAmount: executedAmountNum.toFixed(8),
        executedSellValue: executedSellValueNum.toFixed(2),
        priceSource: exchangeResult.avgPrice
          ? "exchange (avgPrice)"
          : "currentPrice (fallback)",
        amountSource: exchangeResult.executedQty
          ? "exchange (executedQty)"
          : "position.amount (fallback)",
      },
      result: executedSellValueNum,
    },
    {
      step: 5,
      description: "Obliczenie zysku",
      formula: "executedSellValue - buyValue",
      values: {
        executedSellValue: executedSellValueNum.toFixed(2),
        buyValue: position.buyValue.toFixed(2),
        profit: executedProfitNum.toFixed(2),
        profitPercent:
          ((executedProfitNum / position.buyValue) * 100).toFixed(2) + "%",
      },
      result: executedProfitNum,
    },
  ];

  const sellCalculationDetails = {
    summary: {
      buyPrice: position.buyPrice.toFixed(2),
      buyValue: position.buyValue.toFixed(2),
      executedPrice: finalSellPrice.toFixed(2),
      executedSellValue: executedSellValueNum.toFixed(2),
      profit: executedProfitNum.toFixed(2),
      profitPercent:
        ((executedProfitNum / position.buyValue) * 100).toFixed(2) + "%",
    },
    steps: sellCalculationSteps,
  };

  // Loguj zamknięcie pozycji long (sprzedaż) do pliku JSON
  await logBuyTransaction({
    type: "BUY_CLOSE",
    walletAddress: state.walletAddress,
    orderId: state.orderId,
    positionId: position.id,
    buyPrice: position.buyPrice,
    sellPrice: finalSellPrice,
    amount: executedAmountNum,
    buyValue: position.buyValue,
    sellValue: executedSellValueNum,
    profit: executedProfitNum, // Profit = sellValue - buyValue (różnica w USDT)
    trend: position.trendAtBuy,
    status: "CLOSED",
    focusPrice: finalSellPrice,
    nextBuyTarget: state.nextBuyTarget,
    calculationDetails: sellCalculationDetails,
  });

  // Zapisz zaktualizowany stan (włącznie z nextBuyTarget) do bazy danych
  await state.save();
}

/**
 * Sprawdza czy spełnione są warunki sprzedaży short
 */
function shouldSellShort(currentPrice, state, settings) {
  if (!settings.sellConditions) return false;

  const wallet = state.walletAddress;
  const orderId = state.orderId;

  // Sprawdź próg cenowy
  const priceThreshold = settings.sellConditions.priceThreshold;
  const belowThreshold =
    priceThreshold && currentPrice.lt(new Decimal(priceThreshold));

  if (belowThreshold) {
    if (settings.sellConditions.checkThresholdIfProfitable) {
      if (DEBUG_CONDITIONS) {
        console.log(
          `🔍 SELL skipped (threshold) wallet=${wallet} order=${orderId} ` +
            `price=${currentPrice.toNumber()} < threshold=${priceThreshold}`,
        );
      }
      return false;
    }
    if ((state.totalProfit || 0) <= 0) {
      if (DEBUG_CONDITIONS) {
        console.log(
          `🔍 SELL skipped (threshold+no profit) wallet=${wallet} order=${orderId} ` +
            `price=${currentPrice.toNumber()} < threshold=${priceThreshold}, totalProfit=${state.totalProfit}`,
        );
      }
      return false;
    }
  }

  // Sprawdź cel sprzedaży
  let sellTarget = state.nextSellTarget
    ? new Decimal(state.nextSellTarget)
    : calculateNextSellTarget(
        new Decimal(state.currentFocusPrice),
        state.sellTrendCounter,
        settings,
      );

  const reachesTarget = currentPrice.gte(sellTarget);

  if (!reachesTarget) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 SELL skipped (target) wallet=${wallet} order=${orderId} ` +
          `price=${currentPrice.toNumber()} < target=${sellTarget.toNumber()}`,
      );
    }
    return false;
  }

  // #8 Sprawdź min wahanie
  const swingOk = meetsMinSwing(
    new Decimal(state.currentFocusPrice),
    currentPrice,
    state.sellTrendCounter,
    settings,
    false,
  );

  if (DEBUG_CONDITIONS) {
    console.log(
      `🔍 SELL check wallet=${wallet} order=${orderId} ` +
        `price=${currentPrice.toNumber()} focus=${state.currentFocusPrice} ` +
        `target=${sellTarget.toNumber()} threshold=${priceThreshold || "-"} ` +
        `swingOk=${swingOk}`,
    );
  }

  return swingOk;
}

/**
 * Wykonuje sprzedaż short
 */
async function executeSellShort(currentPrice, state, settings) {
  const currentTrend = state.sellTrendCounter;

  // Oblicz realny wzrost ceny od focus (w %) – ile faktycznie "poszło w górę".
  let effectiveTrendPercent = getTrendPercent(currentTrend, settings, false);
  try {
    const focus = new Decimal(state.currentFocusPrice || 0);
    if (!focus.isZero()) {
      const upPercent = currentPrice
        .minus(focus)
        .div(focus)
        .mul(100)
        .toDecimalPlaces(1, Decimal.ROUND_DOWN); // dokładność 0.1%
      if (upPercent.gt(effectiveTrendPercent)) {
        effectiveTrendPercent = upPercent;
      }
    }
  } catch {
    // w razie problemów zostań przy trendPercent
  }

  // Początkowa wartość transakcji na podstawie "efektywnego" procenta.
  // Rzeczywistą wartość przeliczymy po przycięciu ilości do dostępnego salda portfela.
  let transactionValue = calculateTransactionValue(
    currentPrice,
    currentTrend,
    settings,
    false,
    effectiveTrendPercent,
  );

  // Jeśli tryb sprzedaży to "maxDefined", to zamiast całkowicie blokować transakcję,
  // przytnij jej wartość do "wolnego miejsca" w limicie.
  const sellSettings = settings.sell || {};
  if (sellSettings.mode === "maxDefined") {
    const maxValue = new Decimal(sellSettings.maxValue || 0);
    if (maxValue.gt(0)) {
      const addProfit = sellSettings.addProfit === true;
      let effectiveMax = maxValue;
      if (addProfit) effectiveMax = effectiveMax.plus(state.totalProfit || 0);

      const openShortValue = await getOpenShortSellValue(state);
      const remaining = effectiveMax.minus(openShortValue);

      // Limit całkowicie wypełniony – nic nie sprzedawaj.
      if (remaining.lte(0)) {
        if (DEBUG_CONDITIONS) {
          console.log(
            `🔍 SELL skipped (wallet.maxDefined.filled) wallet=${state.walletAddress} order=${state.orderId} ` +
              `totalSoldOpen=${openShortValue.toString()} maxValue=${maxValue.toString()} ` +
              `effectiveMax=${effectiveMax.toString()} addProfit=${addProfit}`,
          );
        }
        return;
      }

      // Jeśli wyliczone txValue przekracza wolne miejsce, sprzedaj tylko do limitu.
      if (transactionValue.gt(remaining)) {
        const originalTx = transactionValue;
        transactionValue = remaining.toDecimalPlaces(
          PRICE_SCALE,
          Decimal.ROUND_DOWN,
        );

        if (DEBUG_CONDITIONS) {
          console.log(
            `🔍 SELL maxDefined capped txValue wallet=${state.walletAddress} order=${state.orderId} ` +
              `totalSoldOpen=${openShortValue.toString()} maxValue=${maxValue.toString()} ` +
              `effectiveMax=${effectiveMax.toString()} addProfit=${addProfit} ` +
              `txOriginal=${originalTx.toString()} txCapped=${transactionValue.toString()}`,
          );
        }
      }
    }
  }

  // Ilość wynikająca z (ewentualnie przyciętej) wartości transakcji
  let amount = transactionValue
    .div(currentPrice)
    .toDecimalPlaces(AMOUNT_SCALE, Decimal.ROUND_DOWN);

  // Sprawdź realne saldo BTC i w razie potrzeby przytnij ilość do dostępnego balansu.
  // Dzięki temu przy małym saldzie (i ustawionym 0 w polu "Max wartość")
  // bot sprzeda "ile ma", zamiast w ogóle nie wykonywać transakcji.
  const sellCurrency = sellSettings.currency || "BTC";
  const exchange = settings.exchange || "asterdex";
  const walletBalance = await WalletService.getBalance(
    state.walletAddress,
    sellCurrency,
    exchange,
  );
  const walletProtection = new Decimal(sellSettings.walletProtection || 0);
  let availableBalance = walletBalance.minus(walletProtection);

  if (availableBalance.lte(0)) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 SELL skipped (no balance) wallet=${state.walletAddress} ` +
          `currency=${sellCurrency} balance=${walletBalance.toString()} protection=${walletProtection.toString()}`,
      );
    }
    return;
  }

  if (amount.gt(availableBalance)) {
    // Sprzedaj maksymalnie tyle, ile faktycznie mamy w portfelu
    amount = availableBalance.toDecimalPlaces(AMOUNT_SCALE, Decimal.ROUND_DOWN);
  }

  if (!(await canExecuteSell(amount, currentPrice, state, settings))) {
    return;
  }

  // Po ewentualnym przycięciu ilości zaktualizuj realną wartość transakcji (w USDT)
  transactionValue = amount
    .mul(currentPrice)
    .toDecimalPlaces(PRICE_SCALE, Decimal.ROUND_DOWN);

  // Jeszcze raz sprawdź minimalną wartość – dla mocno przyciętej ilości
  if (!meetsMinTransactionValue(transactionValue, settings)) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 SELL skipped (minTransactionValue) wallet=${state.walletAddress} ` +
          `txValue=${transactionValue.toNumber()} min=${settings.platform?.minTransactionValue}`,
      );
    }
    return;
  }

  // Cel odkupu (profit na pojedynczej transakcji short)
  // Trendy służą tylko do wyznaczania poziomów wejścia.
  // Minimalny zarobek określa, o ile % cena musi spaść od sprzedaży,
  // żeby opłacało się odkupić (zamknąć short).
  const profitPercent = new Decimal(settings.minProfitPercent || 0.5);

  const targetBuybackPrice = currentPrice
    .mul(Decimal.sub(1, profitPercent.div(100)))
    .toDecimalPlaces(PRICE_SCALE, Decimal.ROUND_DOWN);

  const expectedProfit = currentPrice.minus(targetBuybackPrice).mul(amount);

  if (!checkFeeDoesNotEatProfit(transactionValue, expectedProfit, settings)) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 SELL skipped (fee>=profit) wallet=${state.walletAddress} ` +
          `txValue=${transactionValue.toNumber()} expectedProfit=${expectedProfit.toNumber()}`,
      );
    }
    return;
  }

  const baseAsset = settings.baseAsset || settings.sell?.currency || "BTC";
  const quoteAsset = settings.quoteAsset || settings.buy?.currency || "USDT";
  const symbol = `${baseAsset}${quoteAsset}`;
  // exchange jest już zadeklarowane wcześniej w tej funkcji (linia 1375)

  // Wykonaj zlecenie przez ExchangeService
  // Przekaż exchange z ustawień zlecenia (może być inny niż globalna giełda użytkownika)
  const exchangeResult = await ExchangeService.placeSpotSell(
    state.walletAddress,
    symbol,
    amount,
    currentPrice,
    exchange, // Przekaż giełdę z zlecenia (już zadeklarowane wcześniej)
  );

  if (!exchangeResult.success) {
    console.error(
      `Failed to execute SELL on exchange: ${exchangeResult.error}`,
    );
    return;
  }

  // Użyj rzeczywistej wykonanej ilości i średniej ceny z giełdy
  // Zabezpieczenie: jeśli giełda zwróci 0/undefined, użyj naszych wartości.
  let executedAmount = exchangeResult.executedQty;
  let executedPrice = exchangeResult.avgPrice;

  // Konwersja do Decimal jeśli potrzeba
  if (executedAmount != null && !(executedAmount instanceof Decimal)) {
    executedAmount = new Decimal(executedAmount);
  } else if (executedAmount == null || executedAmount.isZero()) {
    executedAmount = amount;
  }

  if (executedPrice != null && !(executedPrice instanceof Decimal)) {
    executedPrice = new Decimal(executedPrice);
  } else if (
    executedPrice == null ||
    executedPrice.isZero() ||
    executedPrice.lte(0)
  ) {
    executedPrice = new Decimal(currentPrice);
  }

  const executedValue = executedPrice.mul(executedAmount);
  const executedAmountNum = toNum(executedAmount);
  const executedPriceNum = toNum(executedPrice);
  const executedValueNum = executedValue.toNumber();

  const position = new Position({
    walletAddress: state.walletAddress,
    orderId: state.orderId,
    type: PositionType.SELL,
    sellPrice: executedPriceNum,
    amount: executedAmountNum,
    sellValue: executedValueNum,
    trendAtBuy: currentTrend,
    targetBuybackPrice: targetBuybackPrice.toNumber(),
    status: PositionStatus.OPEN,
  });
  await position.save();

  state.openSellPositionIds.push(position.id);
  const maxTrend = getMaxTrend(settings);
  state.sellTrendCounter = Math.min(currentTrend + 1, maxTrend);
  state.totalSellTransactions += 1;
  state.totalSoldValue = new Decimal(state.totalSoldValue || 0)
    .plus(executedValueNum)
    .toNumber();
  const sellPriceNum = executedPriceNum;
  // Po otwarciu short:
  // - aktualizujemy tylko SELL focus (nextSellTarget) na bazie ceny sprzedaży,
  // - BUY focus (nextBuyTarget) pozostaje bez zmian, dopóki nie wykonamy BUY.
  state.currentFocusPrice = sellPriceNum;
  state.focusLastUpdated = new Date().toISOString();
  // Następny cel sprzedaży obliczamy dla następnego trendu (zwiększonego)
  // Jeśli trend osiągnął max, następny cel jest dla trendu 0 (cykl się powtarza)
  const nextSellTrend =
    state.sellTrendCounter >= maxTrend ? 0 : state.sellTrendCounter;
  state.nextSellTarget = calculateNextSellTarget(
    new Decimal(sellPriceNum),
    nextSellTrend,
    settings,
  ).toNumber();

  if (!QUIET_PRODUCTION_LOGS) {
    console.log(
      `🟡 SELL executed: position=${position.id} price=${sellPriceNum}, amount=${executedAmountNum}, ` +
        `value=${executedValueNum}, trend=${currentTrend}→${state.sellTrendCounter} focus=${sellPriceNum}`,
    );
  }

  // Oblicz szczegółowe źródło kwoty sprzedaży short - krok po kroku
  const sellTrendPercent = getTrendPercent(currentTrend, settings, false);
  const sellMinValuePer1Percent =
    settings.sellConditions?.minValuePer1Percent || 200;

  // Krok 1: Oblicz podstawową wartość
  const sellBaseValueStep1 =
    sellMinValuePer1Percent * sellTrendPercent.toNumber();
  let sellCalculationSteps = [
    {
      step: 1,
      description: "Podstawowa wartość na 1%",
      formula: `minValuePer1Percent × trendPercent`,
      values: {
        minValuePer1Percent: sellMinValuePer1Percent,
        trendPercent: sellTrendPercent.toNumber().toFixed(4),
        result: sellBaseValueStep1.toFixed(2),
      },
      result: sellBaseValueStep1,
    },
  ];

  // Krok 2: Sprawdź faktyczny wzrost ceny
  let actualUpPercent = null;
  try {
    const focus = new Decimal(state.currentFocusPrice || 0);
    if (!focus.isZero()) {
      actualUpPercent = currentPrice
        .minus(focus)
        .div(focus)
        .mul(100)
        .toDecimalPlaces(1, Decimal.ROUND_DOWN)
        .toNumber();
    }
  } catch {}

  sellCalculationSteps.push({
    step: 2,
    description: "Faktyczny wzrost ceny od focus",
    formula: `(currentPrice - focusPrice) / focusPrice × 100`,
    values: {
      focusPrice: (state.currentFocusPrice || 0).toFixed(2),
      currentPrice: currentPrice.toNumber().toFixed(2),
      actualUpPercent:
        actualUpPercent != null
          ? actualUpPercent.toFixed(2) + "%"
          : "brak focus",
      trendPercentFromSettings: sellTrendPercent.toNumber().toFixed(4) + "%",
      effectiveTrendPercent: effectiveTrendPercent.toNumber().toFixed(4) + "%",
      note:
        actualUpPercent != null && actualUpPercent > sellTrendPercent.toNumber()
          ? "Użyto faktycznego wzrostu (większy niż trend z ustawień)"
          : "Użyto trendPercent z ustawień",
    },
    result: effectiveTrendPercent.toNumber(),
  });

  // Krok 3: Dodatkowe wartości z progów cenowych
  let sellAdditionalValueStep3 = 0;
  let sellAdditionalThreshold = null;
  const additionalSellValues = settings.additionalSellValues;
  if (additionalSellValues && additionalSellValues.length > 0) {
    for (const threshold of additionalSellValues) {
      if (matchesThreshold(currentPrice, threshold)) {
        const addVal = new Decimal(threshold.value || 0);
        const addComponent = addVal.mul(sellTrendPercent);
        sellAdditionalValueStep3 = addComponent.toNumber();
        sellAdditionalThreshold = threshold;
        break;
      }
    }
  }

  if (sellAdditionalValueStep3 > 0) {
    sellCalculationSteps.push({
      step: 3,
      description: "Dodatkowa wartość z progu cenowego",
      formula: `additionalValue × trendPercent`,
      values: {
        priceRange: `[${sellAdditionalThreshold?.minPrice ?? "-"}, ${sellAdditionalThreshold?.maxPrice ?? "-"}]`,
        additionalValue: sellAdditionalThreshold?.value || 0,
        trendPercent: sellTrendPercent.toNumber().toFixed(4),
        result: sellAdditionalValueStep3.toFixed(2),
      },
      result: sellAdditionalValueStep3,
    });
  }

  // Krok 4: Wartość przed ograniczeniem max
  const sellValueBeforeMax = sellBaseValueStep1 + sellAdditionalValueStep3;
  sellCalculationSteps.push({
    step: sellCalculationSteps.length + 1,
    description: "Wartość przed ograniczeniem maksymalnym",
    formula: `baseValue + additionalValue`,
    values: {
      baseValue: sellBaseValueStep1.toFixed(2),
      additionalValue: sellAdditionalValueStep3.toFixed(2),
      result: sellValueBeforeMax.toFixed(2),
    },
    result: sellValueBeforeMax,
  });

  // Krok 5: Ograniczenie maksymalnej wartości
  let sellMaxValueStep5 = null;
  let sellMaxThreshold = null;
  const maxSellValues = settings.maxSellPerTransaction;
  if (maxSellValues && maxSellValues.length > 0) {
    for (const threshold of maxSellValues) {
      if (matchesThreshold(currentPrice, threshold)) {
        const maxVal = new Decimal(threshold.value || 10000);
        if (sellValueBeforeMax > maxVal.toNumber()) {
          sellMaxValueStep5 = maxVal.toNumber();
          sellMaxThreshold = threshold;
        }
        break;
      }
    }
  }

  if (sellMaxValueStep5 != null) {
    sellCalculationSteps.push({
      step: sellCalculationSteps.length + 1,
      description: "Ograniczenie maksymalnej wartości",
      formula: `min(wartośćPrzedMax, maxValue)`,
      values: {
        valueBeforeMax: sellValueBeforeMax.toFixed(2),
        maxValue: sellMaxValueStep5.toFixed(2),
        priceRange: `[${sellMaxThreshold?.minPrice ?? "-"}, ${sellMaxThreshold?.maxPrice ?? "-"}]`,
        result: sellMaxValueStep5.toFixed(2),
        note: "Wartość została ograniczona do maksimum",
      },
      result: sellMaxValueStep5,
    });
  }

  // Krok 6: Finalna obliczona wartość transakcji
  const sellFinalCalculatedValue =
    sellMaxValueStep5 != null ? sellMaxValueStep5 : sellValueBeforeMax;
  sellCalculationSteps.push({
    step: sellCalculationSteps.length + 1,
    description: "Finalna obliczona wartość transakcji",
    formula:
      sellMaxValueStep5 != null
        ? "wartośćPrzedMax ograniczona do maxValue"
        : "baseValue + additionalValue",
    values: {
      result: sellFinalCalculatedValue.toFixed(2),
    },
    result: sellFinalCalculatedValue,
  });

  // Krok 7: Obliczona ilość (przed sprawdzeniem salda)
  const sellCalculatedAmountBeforeBalance =
    sellFinalCalculatedValue / currentPrice.toNumber();
  sellCalculationSteps.push({
    step: sellCalculationSteps.length + 1,
    description: "Obliczona ilość (przed sprawdzeniem salda)",
    formula: `transactionValue / currentPrice`,
    values: {
      transactionValue: sellFinalCalculatedValue.toFixed(2),
      currentPrice: currentPrice.toNumber().toFixed(2),
      result: sellCalculatedAmountBeforeBalance.toFixed(8),
    },
    result: sellCalculatedAmountBeforeBalance,
  });

  // Krok 8: Sprawdzenie salda portfela
  const amountWasAdjusted = amount.lt(
    new Decimal(sellCalculatedAmountBeforeBalance),
  );
  sellCalculationSteps.push({
    step: sellCalculationSteps.length + 1,
    description: "Sprawdzenie salda portfela",
    formula: "walletBalance - walletProtection",
    values: {
      walletBalance: walletBalance.toNumber().toFixed(8),
      walletProtection: walletProtection.toNumber().toFixed(8),
      availableBalance: availableBalance.toNumber().toFixed(8),
      calculatedAmount: sellCalculatedAmountBeforeBalance.toFixed(8),
      finalAmount: amount.toNumber().toFixed(8),
      adjusted: amountWasAdjusted
        ? "TAK - ilość przycięta do dostępnego salda"
        : "NIE - wystarczające saldo",
    },
    result: amount.toNumber(),
  });

  // Krok 9: Zaktualizowana wartość po przycięciu ilości
  const sellFinalTransactionValue = amount.mul(currentPrice).toNumber();
  sellCalculationSteps.push({
    step: sellCalculationSteps.length + 1,
    description: "Zaktualizowana wartość po przycięciu ilości",
    formula: `finalAmount × currentPrice`,
    values: {
      finalAmount: amount.toNumber().toFixed(8),
      currentPrice: currentPrice.toNumber().toFixed(2),
      result: sellFinalTransactionValue.toFixed(2),
    },
    result: sellFinalTransactionValue,
  });

  // Krok 10: Rzeczywiste wartości z giełdy
  sellCalculationSteps.push({
    step: sellCalculationSteps.length + 1,
    description: "Rzeczywiste wartości z giełdy",
    formula: "Wartości zwrócone przez ExchangeService",
    values: {
      executedPrice: sellPriceNum.toFixed(2),
      executedAmount: executedAmountNum.toFixed(8),
      executedValue: executedValueNum.toFixed(2),
      priceSource: exchangeResult.avgPrice
        ? "exchange (avgPrice)"
        : "currentPrice (fallback)",
      amountSource: exchangeResult.executedQty
        ? "exchange (executedQty)"
        : amountWasAdjusted
          ? "availableBalance"
          : "calculated",
    },
    result: executedValueNum,
  });

  const sellCalculationDetails = {
    summary: {
      trend: currentTrend,
      trendPercent: sellTrendPercent.toNumber().toFixed(4) + "%",
      effectiveTrendPercent: effectiveTrendPercent.toNumber().toFixed(4) + "%",
      calculatedTransactionValue: sellFinalTransactionValue.toFixed(2),
      executedValue: executedValueNum.toFixed(2),
      currentPrice: currentPrice.toNumber().toFixed(2),
      executedPrice: sellPriceNum.toFixed(2),
      amountAdjusted: amountWasAdjusted,
    },
    steps: sellCalculationSteps,
  };

  // Loguj transakcję sprzedaży short do pliku JSON
  await logSellTransaction({
    type: "SELL_SHORT",
    walletAddress: state.walletAddress,
    orderId: state.orderId,
    positionId: position.id,
    sellPrice: sellPriceNum,
    amount: executedAmountNum,
    sellValue: executedValueNum,
    trend: currentTrend,
    targetBuybackPrice: targetBuybackPrice.toNumber(),
    status: "OPEN",
    focusPrice: sellPriceNum,
    nextSellTarget: state.nextSellTarget,
    calculationDetails: sellCalculationDetails,
  });

  // Zapisz zaktualizowany stan (włącznie z nextSellTarget) do bazy danych
  await state.save();
}

/**
 * Sprawdza i wykonuje odkup pozycji short
 */
async function checkAndExecuteSellBuybacks(currentPrice, state, settings) {
  // Najpierw zsynchronizuj openSellPositionIds z rzeczywistymi otwartymi pozycjami short w bazie
  // To zapewni, że wszystkie otwarte pozycje short są sprawdzane, nawet jeśli openSellPositionIds jest nieaktualne
  const allOpenPositions = await Position.findByWalletAndOrderId(
    state.walletAddress,
    state.orderId,
  );
  const actualOpenSellPositions = allOpenPositions.filter(
    (p) => p.type === PositionType.SELL && p.status === PositionStatus.OPEN,
  );

  // Zaktualizuj openSellPositionIds jeśli różni się od rzeczywistych otwartych pozycji short
  const actualOpenSellIds = actualOpenSellPositions.map((p) => p.id);
  if (
    JSON.stringify(state.openSellPositionIds.sort()) !==
    JSON.stringify(actualOpenSellIds.sort())
  ) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 BUYBACK syncing openSellPositionIds: was ${state.openSellPositionIds.length}, now ${actualOpenSellIds.length} ` +
          `wallet=${state.walletAddress} order=${state.orderId}`,
      );
    }
    state.openSellPositionIds = actualOpenSellIds;
    await state.save();
  }

  if (!state.openSellPositionIds || state.openSellPositionIds.length === 0) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 BUYBACK skipped (no open positions) wallet=${state.walletAddress} order=${state.orderId} ` +
          `openSellPositionIds=${JSON.stringify(state.openSellPositionIds)}`,
      );
    }
    return false;
  }

  const positions = await Position.findByIds(state.openSellPositionIds);

  if (DEBUG_CONDITIONS && positions.length > 0) {
    console.log(
      `🔍 BUYBACK checking ${positions.length} positions wallet=${state.walletAddress} order=${state.orderId} ` +
        `currentPrice=${currentPrice.toNumber()} ` +
        `openSellPositionIds=${JSON.stringify(state.openSellPositionIds)}`,
    );
  }

  // Sortuj po cenie docelowej odkupu (najniższa pierwsza - najpierw odkup te z największym zyskiem)
  positions.sort(
    (a, b) =>
      (a.targetBuybackPrice || Infinity) - (b.targetBuybackPrice || Infinity),
  );

  for (const position of positions) {
    if (position.status !== PositionStatus.OPEN) continue;

    if (!position.targetBuybackPrice) {
      if (DEBUG_CONDITIONS) {
        console.log(
          `🔍 BUYBACK skipped (no target) wallet=${state.walletAddress} order=${state.orderId} ` +
            `position=${position.id} - brak targetBuybackPrice`,
        );
      }
      continue;
    }

    const targetPrice = new Decimal(position.targetBuybackPrice);
    const priceReached = currentPrice.lte(targetPrice);

    if (!priceReached) {
      if (DEBUG_CONDITIONS) {
        console.log(
          `🔍 BUYBACK skipped (target not reached) wallet=${state.walletAddress} order=${state.orderId} ` +
            `position=${position.id} price=${currentPrice.toNumber()} ` +
            `target=${targetPrice.toNumber()}`,
        );
      }
      continue;
    }

    // Sprawdź minimalne wahanie (swing) - dla odkupu short sprawdzamy spadek od focus (currentFocusPrice)
    // lub od ceny sprzedaży jeśli focus nie jest dostępny
    const swingReferencePrice =
      state.currentFocusPrice > 0
        ? new Decimal(state.currentFocusPrice)
        : position.sellPrice
          ? new Decimal(position.sellPrice)
          : null;

    if (swingReferencePrice) {
      const swingOk = meetsMinSwing(
        swingReferencePrice,
        currentPrice,
        position.trendAtBuy || 0,
        settings,
        true, // isBuy = true bo odkupujemy (to jest zakup)
      );

      if (!swingOk) {
        if (DEBUG_CONDITIONS) {
          console.log(
            `🔍 BUYBACK skipped (min swing) wallet=${state.walletAddress} order=${state.orderId} ` +
              `position=${position.id} referencePrice=${swingReferencePrice.toNumber()} ` +
              `currentPrice=${currentPrice.toNumber()} target=${targetPrice.toNumber()}`,
          );
        }
        continue;
      }
    }

    if (DEBUG_CONDITIONS) {
      console.log(
        `✅ BUYBACK executing wallet=${state.walletAddress} order=${state.orderId} ` +
          `position=${position.id} price=${currentPrice.toNumber()} ` +
          `target=${targetPrice.toNumber()}`,
      );
    }

    // Przeładuj stan przed każdym odkupem, aby mieć aktualne dane
    const currentState = await GridState.findByWalletAndOrderId(
      state.walletAddress,
      state.orderId,
    );
    if (currentState) {
      Object.assign(state, currentState.toJSON());
    }

    await executeSellBuyback(currentPrice, position, state, settings);

    // Po odkupie przeładuj stan z bazy przed sprawdzeniem następnej pozycji
    const updatedState = await GridState.findByWalletAndOrderId(
      state.walletAddress,
      state.orderId,
    );
    if (updatedState) {
      Object.assign(state, updatedState.toJSON());
    }

    // Kontynuuj sprawdzanie innych pozycji (nie przerywaj po pierwszym odkupie)
    // Wszystkie pozycje short które spełniają warunki będą odkupione w jednym cyklu
  }

  return false; // Funkcja nie zwraca już boolean - wszystkie pozycje są sprawdzane
}

/**
 * Wykonuje odkup pozycji short
 */
async function executeSellBuyback(currentPrice, position, state, settings) {
  const amount = new Decimal(position.amount);
  const buybackValue = amount.mul(currentPrice);
  const profit = new Decimal(position.sellValue).minus(buybackValue);

  if (profit.lt(0)) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 BUYBACK skipped (negative profit) wallet=${state.walletAddress} order=${state.orderId} ` +
          `position=${position.id} sellValue=${position.sellValue} buybackValue=${buybackValue.toNumber()} profit=${profit.toNumber()}`,
      );
    }
    return;
  }

  // Sprawdź minimalną wartość transakcji
  if (!meetsMinTransactionValue(buybackValue, settings)) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 BUYBACK skipped (minTransactionValue) wallet=${state.walletAddress} order=${state.orderId} ` +
          `position=${position.id} buybackValue=${buybackValue.toNumber()} min=${settings.platform?.minTransactionValue}`,
      );
    }
    return;
  }

  // Sprawdź czy fee nie zje profitu
  const expectedProfit = profit;
  if (!checkFeeDoesNotEatProfit(buybackValue, expectedProfit, settings)) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 BUYBACK skipped (fee>=profit) wallet=${state.walletAddress} order=${state.orderId} ` +
          `position=${position.id} buybackValue=${buybackValue.toNumber()} expectedProfit=${expectedProfit.toNumber()}`,
      );
    }
    return;
  }

  const baseAsset = settings.baseAsset || settings.sell?.currency || "BTC";
  const quoteAsset = settings.quoteAsset || settings.buy?.currency || "USDT";
  const symbol = `${baseAsset}${quoteAsset}`;
  const exchange = settings.exchange || "asterdex";

  // Wykonaj zlecenie BUY przez ExchangeService (odkup short)
  // Przekaż exchange z ustawień zlecenia (może być inny niż globalna giełda użytkownika)
  const exchangeResult = await ExchangeService.placeSpotBuy(
    state.walletAddress,
    symbol,
    buybackValue,
    currentPrice,
    exchange, // Przekaż giełdę z zlecenia
  );

  if (!exchangeResult.success) {
    console.error(
      `Failed to execute buyback on exchange: ${exchangeResult.error}`,
    );
    return;
  }

  // Użyj rzeczywistej wykonanej ilości i średniej ceny z giełdy
  let executedAmount = exchangeResult.executedQty;
  let executedPrice = exchangeResult.avgPrice;

  // Konwersja do Decimal jeśli potrzeba
  if (executedAmount != null && !(executedAmount instanceof Decimal)) {
    executedAmount = new Decimal(executedAmount);
  } else if (executedAmount == null || executedAmount.isZero()) {
    executedAmount = amount;
  }

  if (executedPrice != null && !(executedPrice instanceof Decimal)) {
    executedPrice = new Decimal(executedPrice);
  } else if (
    executedPrice == null ||
    executedPrice.isZero() ||
    executedPrice.lte(0)
  ) {
    executedPrice = new Decimal(currentPrice);
  }

  const executedBuybackValue = executedPrice.mul(executedAmount);
  // Profit brutto = różnica między wartością sprzedaży a wartością odkupu (w USDT)
  // Sprzedaliśmy za position.sellValue USDT, odkupiliśmy za executedBuybackValue USDT
  const executedProfitGross = new Decimal(position.sellValue).minus(
    executedBuybackValue,
  );
  // Przybliżona prowizja: fee od sprzedaży + fee od odkupu (0.1% na każdą stronę)
  const totalFeeShort = new Decimal(position.sellValue || 0)
    .plus(executedBuybackValue)
    .mul(DEFAULT_FEE_PERCENT)
    .div(100);
  const executedProfit = executedProfitGross.minus(totalFeeShort);

  const buybackPriceNum = toNum(executedPrice);
  const executedAmountNum = toNum(executedAmount);
  const executedBuybackValueNum = executedBuybackValue.toNumber();
  const executedProfitNum = executedProfit.toNumber();

  position.buyPrice = buybackPriceNum;
  position.buyValue = executedBuybackValueNum;
  position.profit = executedProfitNum;
  position.status = PositionStatus.CLOSED;
  position.closedAt = new Date().toISOString();
  await position.save();

  state.openSellPositionIds = state.openSellPositionIds.filter(
    (id) => id !== position.id,
  );
  state.sellTrendCounter = Math.max(0, state.sellTrendCounter - 1);
  state.totalBuyTransactions += 1;
  state.totalBoughtValue = new Decimal(state.totalBoughtValue || 0)
    .plus(executedBuybackValueNum)
    .toNumber();
  // Spójne przeliczenie totalProfit na podstawie zamkniętych pozycji
  state.totalProfit = await Position.getTotalClosedProfit(
    state.walletAddress,
    state.orderId,
  );
  // Po zamknięciu short:
  // - aktualizujemy tylko SELL-ową stronę progów (nextSellTarget),
  //   BUY focus zostaje bez zmian (odpowiada za kolejne wejścia long).
  state.currentFocusPrice = buybackPriceNum;
  state.focusLastUpdated = new Date().toISOString();
  state.nextSellTarget = calculateNextSellTarget(
    new Decimal(buybackPriceNum),
    state.sellTrendCounter,
    settings,
  ).toNumber();

  if (!QUIET_PRODUCTION_LOGS) {
    console.log(
      `🔵 BUYBACK executed: price=${buybackPriceNum}, amount=${executedAmountNum}, ` +
        `sellValue=${position.sellValue}, buybackValue=${executedBuybackValueNum}, ` +
        `profit=${executedProfitNum}, trend→${state.sellTrendCounter} focus=${buybackPriceNum}`,
    );
  }

  // Oblicz szczegółowe źródło kwoty odkupu short - krok po kroku
  const buybackCalculationSteps = [
    {
      step: 1,
      description: "Dane z pozycji sprzedaży short",
      formula: "Zapamiętane wartości z momentu sprzedaży",
      values: {
        sellPrice: position.sellPrice.toFixed(2),
        sellAmount: position.amount.toFixed(8),
        sellValue: position.sellValue.toFixed(2),
      },
      result: position.sellValue,
    },
    {
      step: 2,
      description: "Aktualna cena rynkowa",
      formula: "Cena pobrana z PriceFeedService",
      values: {
        currentPrice: currentPrice.toNumber().toFixed(2),
        source: "PriceFeedService.getPrice()",
      },
      result: currentPrice.toNumber(),
    },
    {
      step: 3,
      description: "Obliczona wartość odkupu",
      formula: "sellAmount × currentPrice",
      values: {
        sellAmount: position.amount.toFixed(8),
        currentPrice: currentPrice.toNumber().toFixed(2),
        calculatedBuybackValue: buybackValue.toNumber().toFixed(2),
      },
      result: buybackValue.toNumber(),
    },
    {
      step: 4,
      description: "Rzeczywiste wartości z giełdy",
      formula: "Wartości zwrócone przez ExchangeService",
      values: {
        executedPrice: buybackPriceNum.toFixed(2),
        executedAmount: executedAmountNum.toFixed(8),
        executedBuybackValue: executedBuybackValueNum.toFixed(2),
        priceSource: exchangeResult.avgPrice
          ? "exchange (avgPrice)"
          : "currentPrice (fallback)",
        amountSource: exchangeResult.executedQty
          ? "exchange (executedQty)"
          : "position.amount (fallback)",
      },
      result: executedBuybackValueNum,
    },
    {
      step: 5,
      description: "Obliczenie zysku",
      formula: "sellValue - executedBuybackValue",
      values: {
        sellValue: position.sellValue.toFixed(2),
        executedBuybackValue: executedBuybackValueNum.toFixed(2),
        profit: executedProfitNum.toFixed(2),
        profitPercent:
          ((executedProfitNum / position.sellValue) * 100).toFixed(2) + "%",
        note: "Zysk = różnica między wartością sprzedaży a wartością odkupu",
      },
      result: executedProfitNum,
    },
  ];

  const buybackCalculationDetails = {
    summary: {
      sellPrice: position.sellPrice.toFixed(2),
      sellValue: position.sellValue.toFixed(2),
      executedPrice: buybackPriceNum.toFixed(2),
      executedBuybackValue: executedBuybackValueNum.toFixed(2),
      profit: executedProfitNum.toFixed(2),
      profitPercent:
        ((executedProfitNum / position.sellValue) * 100).toFixed(2) + "%",
    },
    steps: buybackCalculationSteps,
  };

  // Loguj zamknięcie pozycji short (odkup) do pliku JSON
  await logSellTransaction({
    type: "SELL_CLOSE",
    walletAddress: state.walletAddress,
    orderId: state.orderId,
    positionId: position.id,
    sellPrice: position.sellPrice,
    buybackPrice: buybackPriceNum,
    amount: executedAmountNum,
    sellValue: position.sellValue,
    buybackValue: executedBuybackValueNum,
    profit: executedProfitNum, // Profit = sellValue - buybackValue (różnica w USDT)
    trend: position.trendAtBuy,
    status: "CLOSED",
    focusPrice: buybackPriceNum,
    nextSellTarget: state.nextSellTarget,
    calculationDetails: buybackCalculationDetails,
  });

  // Zapisz zaktualizowany stan (włącznie z nextSellTarget) do bazy danych
  await state.save();
}

/**
 * #5 Oblicza następny cel zakupu
 */
export function calculateNextBuyTarget(focusPrice, trend, settings) {
  const fp = new Decimal(focusPrice);
  const trendPercent = getTrendPercent(trend, settings, true);

  const decrease = fp.mul(trendPercent).div(100);
  return fp.minus(decrease).toDecimalPlaces(PRICE_SCALE, Decimal.ROUND_DOWN);
}

/**
 * Oblicza następny cel sprzedaży
 */
export function calculateNextSellTarget(focusPrice, trend, settings) {
  const fp = new Decimal(focusPrice);
  const trendPercent = getTrendPercent(trend, settings, false);

  const increase = fp.mul(trendPercent).div(100);
  return fp.plus(increase).toDecimalPlaces(PRICE_SCALE, Decimal.ROUND_UP);
}

/**
 * Maksymalny trend z ustawień (np. 0, 1, 2, 5 → max 5)
 */
function getMaxTrend(settings) {
  const trendPercents = settings.trendPercents;
  if (!trendPercents || trendPercents.length === 0) return 0;
  return Math.max(...trendPercents.map((tp) => Number(tp.trend) || 0));
}

/**
 * #5 Pobiera procent dla trendu
 */
function getTrendPercent(trend, settings, isBuy) {
  const trendPercents = settings.trendPercents;

  if (!trendPercents || trendPercents.length === 0) {
    // Brak zdefiniowanych trendów:
    // użyj globalnego minProfitPercent jako domyślnego kroku (BUY/SELL),
    // a jeśli go nie ma – wróć do 0.5% jak wcześniej.
    const fallback =
      typeof settings.minProfitPercent === "number" &&
      !Number.isNaN(settings.minProfitPercent)
        ? settings.minProfitPercent
        : 0.5;
    return new Decimal(fallback);
  }

  // Znajdź najwyższy trend <= aktualny trend (np. trend 3 przy 0,1,2,5 → używamy 2)
  let result = trendPercents[0];
  for (const tp of trendPercents) {
    if (tp.trend <= trend) {
      result = tp;
    }
  }

  const percent = isBuy ? result.buyPercent : result.sellPercent;
  // Jeśli w trendzie nie ustawiono konkretnego procentu,
  // też użyj minProfitPercent jako sensownego defaultu.
  if (percent != null && !Number.isNaN(percent)) {
    return new Decimal(percent);
  }
  const fallback =
    typeof settings.minProfitPercent === "number" &&
    !Number.isNaN(settings.minProfitPercent)
      ? settings.minProfitPercent
      : 0.5;
  return new Decimal(fallback);
}

/**
 * #4, #6, #7 Oblicza wartość transakcji
 *
 * trendPercentOverride – jeśli podany, używany zamiast procentu z trendu.
 */
function calculateTransactionValue(
  currentPrice,
  trend,
  settings,
  isBuy,
  trendPercentOverride,
) {
  const trendPercent =
    trendPercentOverride || getTrendPercent(trend, settings, isBuy);

  // #4 Podstawowa wartość na 1%
  let minValuePer1Percent;
  if (isBuy && settings.buyConditions?.minValuePer1Percent) {
    minValuePer1Percent = new Decimal(
      settings.buyConditions.minValuePer1Percent,
    );
  } else if (!isBuy && settings.sellConditions?.minValuePer1Percent) {
    minValuePer1Percent = new Decimal(
      settings.sellConditions.minValuePer1Percent,
    );
  } else {
    minValuePer1Percent = new Decimal(200);
  }

  let baseValue = minValuePer1Percent.mul(trendPercent);

  // #6 Dodatkowa wartość według ceny
  const additionalValues = isBuy
    ? settings.additionalBuyValues
    : settings.additionalSellValues;

  if (additionalValues && additionalValues.length > 0) {
    for (const threshold of additionalValues) {
      if (matchesThreshold(currentPrice, threshold)) {
        const addVal = new Decimal(threshold.value || 0);
        const addComponent = addVal.mul(trendPercent);
        baseValue = baseValue.plus(addComponent);

        if (DEBUG_CONDITIONS) {
          console.log(
            `🔍 ${isBuy ? "BUY" : "SELL"} additional value applied: ` +
              `price=${currentPrice.toString()} in [${threshold.minPrice ?? "-"}, ${
                threshold.maxPrice ?? "-"
              }] ` +
              `basePer1%=${minValuePer1Percent.toString()} trend%=${trendPercent.toString()} ` +
              `extra=${addVal.toString()} → +${addComponent.toString()} USDT`,
          );
        }
        break;
      }
    }
  }

  // #7 MAX wartość transakcji
  const maxValues = isBuy
    ? settings.maxBuyPerTransaction
    : settings.maxSellPerTransaction;

  if (maxValues && maxValues.length > 0) {
    for (const threshold of maxValues) {
      if (matchesThreshold(currentPrice, threshold)) {
        const maxVal = new Decimal(threshold.value || 10000);
        if (baseValue.gt(maxVal)) {
          if (DEBUG_CONDITIONS) {
            console.log(
              `🔍 ${isBuy ? "BUY" : "SELL"} max value applied: ` +
                `price=${currentPrice.toString()} in [${threshold.minPrice ?? "-"}, ${
                  threshold.maxPrice ?? "-"
                }] ` +
                `txBefore=${baseValue.toString()} maxValue=${maxVal.toString()} → txAfter=${maxVal.toString()}`,
            );
          }
          baseValue = maxVal;
        }
        break;
      }
    }
  }

  return baseValue.toDecimalPlaces(PRICE_SCALE, Decimal.ROUND_DOWN);
}

/**
 * Sprawdza czy cena pasuje do progu
 */
function matchesThreshold(price, threshold) {
  if (!threshold) return false;

  const p = new Decimal(price);

  // Nowy tryb: zakres cen w jednej linii (minPrice <= price < maxPrice)
  if (threshold.minPrice != null || threshold.maxPrice != null) {
    if (threshold.minPrice != null && p.lt(new Decimal(threshold.minPrice))) {
      return false;
    }
    if (threshold.maxPrice != null && p.gte(new Decimal(threshold.maxPrice))) {
      return false;
    }
    return true;
  }

  // Stary tryb: pojedynczy warunek względem price/condition
  if (!threshold.price || !threshold.condition) return false;

  const thresholdPrice = new Decimal(threshold.price);
  const condition = threshold.condition;

  switch (condition) {
    case "less":
      return p.lt(thresholdPrice);
    case "lessEqual":
      return p.lte(thresholdPrice);
    case "greater":
      return p.gt(thresholdPrice);
    case "greaterEqual":
      return p.gte(thresholdPrice);
    default:
      return false;
  }
}

/**
 * Pobiera stan GRID
 */
export async function getGridState(walletAddress, orderId) {
  return await GridState.findByWalletAndOrderId(walletAddress, orderId);
}

/**
 * Pobiera otwarte pozycje
 */
export async function getOpenPositions(walletAddress, orderId) {
  return await Position.findByWalletAndOrderId(
    walletAddress,
    orderId,
    PositionStatus.OPEN,
  );
}

/**
 * Pobiera wszystkie pozycje (OPEN i CLOSED) dla historii
 */
export async function getAllPositions(walletAddress, orderId) {
  return await Position.findByWalletAndOrderId(walletAddress, orderId);
}

/**
 * Zatrzymuje GRID
 */
export async function stopGrid(walletAddress, orderId) {
  const state = await GridState.findByWalletAndOrderId(walletAddress, orderId);
  if (state) {
    state.isActive = false;
    state.lastUpdated = new Date().toISOString();
    await state.save();
  }
}

/**
 * Uruchamia GRID
 */
export async function startGrid(walletAddress, orderId) {
  const state = await GridState.findByWalletAndOrderId(walletAddress, orderId);
  if (state) {
    state.isActive = true;
    state.lastUpdated = new Date().toISOString();
    await state.save();
  }
}

export default {
  initializeGridState,
  processPrice,
  calculateNextBuyTarget,
  calculateNextSellTarget,
  getGridState,
  getOpenPositions,
  getAllPositions,
  stopGrid,
  startGrid,
};
