import Decimal from "decimal.js";
import { GridState } from "../models/GridState.js";
import { Position, PositionStatus, PositionType } from "../models/Position.js";
import * as WalletService from "./WalletService.js";
import * as ExchangeService from "./ExchangeService.js";

// Pomocniczy log – pokaż surową wartość zmiennej z .env
const DEBUG_CONDITIONS_ENV = String(
  process.env.GRID_DEBUG_CONDITIONS || "",
).trim();
console.log(
  "GRID_DEBUG_CONDITIONS raw from env:",
  JSON.stringify(DEBUG_CONDITIONS_ENV || null),
);

// W DEV włączamy logowanie domyślnie (jeśli zmienna nie jest ustawiona na '0').
// Dzięki temu nie blokujemy się na problemach z .env.
const DEBUG_CONDITIONS =
  DEBUG_CONDITIONS_ENV === "1" ||
  (DEBUG_CONDITIONS_ENV === "" && process.env.NODE_ENV !== "production");

if (DEBUG_CONDITIONS) {
  console.log("✅ Logowanie warunków BUY/SELL jest WŁĄCZONE");
} else {
  console.log("ℹ️ Logowanie warunków BUY/SELL jest WYŁĄCZONE");
}

/**
 * Główny serwis implementujący algorytm GRID
 */

const PRICE_SCALE = 2;
const AMOUNT_SCALE = 8;
const DEFAULT_FEE_PERCENT = new Decimal("0.1");

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
export function initializeGridState(walletAddress, settings) {
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

  return state.save();
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
  const state = GridState.findByWalletAndOrderId(walletAddress, orderId);

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
  state.lastKnownPrice = price.toNumber();
  state.lastPriceUpdate = new Date().toISOString();

  // #1.4 Sprawdź czas do nowego focus
  checkAndUpdateFocusTime(state, price, settings);

  // Sprawdź warunki kupna
  if (shouldBuy(price, state, settings)) {
    await executeBuy(price, state, settings);
  }

  // Sprawdź zamknięcie pozycji kupna (sprzedaż z zyskiem)
  await checkAndExecuteBuySells(price, state, settings);

  // Sprawdź warunki sprzedaży short
  if (shouldSellShort(price, state, settings)) {
    await executeSellShort(price, state, settings);
  }

  // Sprawdź zamknięcie pozycji short (odkup z zyskiem)
  await checkAndExecuteSellBuybacks(price, state, settings);

  state.lastUpdated = new Date().toISOString();
  state.save();

  return state;
}

/**
 * #1.4 Sprawdza i aktualizuje focus na podstawie czasu
 */
function checkAndUpdateFocusTime(state, currentPrice, settings) {
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
      }
    }
  }
}

/**
 * #2 Sprawdza czy można wykonać zakup (walidacja portfela)
 */
function canExecuteBuy(transactionValue, state, settings) {
  const buySettings = settings.buy;
  if (!buySettings) return true;

  // Na spocie jako stable używamy USDT
  const currency = buySettings.currency || "USDT";
  const walletBalance = WalletService.getBalance(state.walletAddress, currency);
  const walletProtection = new Decimal(buySettings.walletProtection || 0);
  const availableBalance = walletBalance.minus(walletProtection);

  if (availableBalance.lt(transactionValue)) {
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
      if (transactionValue.gt(allowedToBuy)) return false;
      break;
    }
    case "maxDefined": {
      // Kupuje do określonego maksimum
      const totalBought = new Decimal(state.totalBoughtValue || 0);
      let effectiveMax = maxValue;
      if (addProfit) effectiveMax = effectiveMax.plus(state.totalProfit || 0);
      if (totalBought.plus(transactionValue).gt(effectiveMax)) return false;
      break;
    }
    // 'walletLimit' - limit portfela, już sprawdzony przez availableBalance
  }

  return true;
}

/**
 * #2 Sprawdza czy można wykonać sprzedaż (walidacja portfela)
 */
function canExecuteSell(amount, state, settings) {
  const sellSettings = settings.sell;
  if (!sellSettings) return true;

  const currency = sellSettings.currency || "BTC";
  const walletBalance = WalletService.getBalance(state.walletAddress, currency);
  const walletProtection = new Decimal(sellSettings.walletProtection || 0);
  const availableBalance = walletBalance.minus(walletProtection);

  return availableBalance.gte(amount);
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
    const exchangeMin = new Decimal(5); // 5 USDT

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
  const transactionValue = calculateTransactionValue(
    currentPrice,
    currentTrend,
    settings,
    true,
    effectiveTrendPercent,
  );

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
  if (!canExecuteBuy(transactionValue, state, settings)) {
    if (DEBUG_CONDITIONS) {
      const buySettings = settings.buy || {};
      const currency = buySettings.currency || "USDT";
      const walletBalance = WalletService.getBalance(
        state.walletAddress,
        currency,
      );
      const walletProtection = new Decimal(buySettings.walletProtection || 0);
      const availableBalance = walletBalance.minus(walletProtection);
      console.log(
        `🔍 BUY skipped (wallet) wallet=${state.walletAddress} order=${state.orderId} ` +
          `currency=${currency} balance=${walletBalance.toString()} protection=${walletProtection.toString()} ` +
          `available=${availableBalance.toString()} txValue=${transactionValue.toNumber()}`,
      );
    }
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

  // Wykonaj zlecenie przez ExchangeService (realne lub paper-trading)
  const exchangeResult = await ExchangeService.placeSpotBuy(
    state.walletAddress,
    symbol,
    transactionValue,
    currentPrice,
  );

  if (!exchangeResult.success) {
    console.error(`Failed to execute buy on exchange: ${exchangeResult.error}`);
    return;
  }

  // Użyj rzeczywistej wykonanej ilości i średniej ceny z giełdy (jeśli dostępne)
  const executedAmount = exchangeResult.executedQty || amount;
  const executedPrice = exchangeResult.avgPrice || currentPrice;

  let buyPriceNum = toNum(executedPrice);
  let amountNum = toNum(executedAmount);
  const buyValueNum = toNum(transactionValue);

  if (buyPriceNum <= 0 || amountNum <= 0) {
    console.warn(
      `⚠️ BUY: executed data invalid (buyPrice=${buyPriceNum}, amount=${amountNum}), using currentPrice/amount`,
    );
    buyPriceNum = toNum(currentPrice);
    amountNum = toNum(amount);
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
  position.save();

  // Aktualizuj stan: focus = cena ostatniego zakupu, trend 0→1→2→… do max z trendPercents
  state.openPositionIds.push(position.id);
  const maxTrend = getMaxTrend(settings);
  state.buyTrendCounter = Math.min(currentTrend + 1, maxTrend);
  state.totalBuyTransactions += 1;
  state.totalBoughtValue = new Decimal(state.totalBoughtValue || 0)
    .plus(transactionValue)
    .toNumber();
  // Focus wyświetlany w UI ustawiamy na cenę ostatniego zakupu,
  // ale dla logiki progów:
  // - aktualizujemy tylko BUY focus (nextBuyTarget),
  // - SELL focus (nextSellTarget) zostawiamy bez zmian,
  //   dopóki nie wykonamy osobnej transakcji sprzedaży.
  state.currentFocusPrice = buyPriceNum;
  state.focusLastUpdated = new Date().toISOString();
  state.nextBuyTarget = calculateNextBuyTarget(
    new Decimal(buyPriceNum),
    state.buyTrendCounter,
    settings,
  ).toNumber();

  console.log(
    `🟢 BUY executed: price=${buyPriceNum}, amount=${amountNum}, value=${transactionValue}, trend=${currentTrend}→${state.buyTrendCounter} focus=${buyPriceNum}`,
  );
}

/**
 * Sprawdza i wykonuje sprzedaż pozycji kupna (z zyskiem)
 * Uwzględnia próg cenowy sprzedaży (sellConditions.priceThreshold).
 */
async function checkAndExecuteBuySells(currentPrice, state, settings) {
  if (!state.openPositionIds || state.openPositionIds.length === 0) return;

  const positions = Position.findByIds(state.openPositionIds);

  // Sortuj po cenie docelowej
  positions.sort((a, b) => (a.targetSellPrice || 0) - (b.targetSellPrice || 0));

  // Próg sprzedaży: poniżej tej ceny nie sprzedajemy (z wyjątkiem gdy checkThresholdIfProfitable=false i jest zysk)
  const priceThreshold = settings.sellConditions?.priceThreshold;
  const belowThreshold =
    priceThreshold && currentPrice.lt(new Decimal(priceThreshold));
  if (belowThreshold) {
    if (settings.sellConditions?.checkThresholdIfProfitable) {
      return; // Zawsze respektuj próg – nie zamykaj pozycji poniżej progu
    }
    if ((state.totalProfit || 0) <= 0) {
      return; // Poniżej progu i bez zysku – nie sprzedawaj
    }
  }

  for (const position of positions) {
    if (position.status !== PositionStatus.OPEN) continue;
    if (
      position.targetSellPrice &&
      currentPrice.gte(position.targetSellPrice)
    ) {
      await executeBuySell(currentPrice, position, state, settings);
    }
  }
}

/**
 * Wykonuje sprzedaż pozycji kupna
 */
async function executeBuySell(currentPrice, position, state, settings) {
  const amount = new Decimal(position.amount);
  const sellValue = amount.mul(currentPrice);
  const profit = sellValue.minus(position.buyValue);

  // Nigdy nie sprzedawaj ze stratą
  if (profit.lt(0)) return;

  const baseAsset = settings.baseAsset || settings.sell?.currency || "BTC";
  const quoteAsset = settings.quoteAsset || settings.buy?.currency || "USDT";
  const symbol = `${baseAsset}${quoteAsset}`;

  // Wykonaj zlecenie przez ExchangeService
  const exchangeResult = await ExchangeService.placeSpotSell(
    state.walletAddress,
    symbol,
    amount,
    currentPrice,
  );

  if (!exchangeResult.success) {
    console.error(
      `Failed to execute sell on exchange: ${exchangeResult.error}`,
    );
    return;
  }

  // Użyj rzeczywistej wykonanej ilości i średniej ceny z giełdy
  const executedAmount = exchangeResult.executedQty || amount;
  let executedPrice = exchangeResult.avgPrice || currentPrice;

  // Upewnij się, że executedPrice jest Decimal
  if (!(executedPrice instanceof Decimal)) {
    executedPrice = new Decimal(executedPrice || currentPrice);
  }

  // Fallback: jeśli cena jest 0 lub nieprawidłowa, użyj currentPrice
  if (executedPrice.isZero() || executedPrice.lte(0)) {
    executedPrice = new Decimal(currentPrice);
  }

  const executedSellValue = executedPrice.mul(executedAmount);
  const executedProfit = executedSellValue.minus(position.buyValue);
  const sellPriceNum = toNum(executedPrice);

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
  position.sellValue = executedSellValue.toNumber();
  position.profit = executedProfit.toNumber();
  position.status = PositionStatus.CLOSED;
  position.closedAt = new Date().toISOString();
  position.save();

  // Utwórz nową pozycję typu SELL w historii sprzedaży (z celem następnego zakupu w UI)
  const now = new Date().toISOString();
  // Użyj orderId z pozycji BUY, żeby mieć pewność że jest zgodne
  const sellOrderId = position.orderId || state.orderId;
  const sellPosition = new Position({
    walletAddress: state.walletAddress,
    orderId: sellOrderId,
    type: PositionType.SELL,
    sellPrice: finalSellPrice,
    sellValue: executedSellValue.toNumber(),
    amount: toNum(executedAmount),
    buyPrice: position.buyPrice, // Cena zakupu dla referencji
    buyValue: position.buyValue,
    profit: executedProfit.toNumber(),
    status: PositionStatus.CLOSED, // Sprzedaż jest od razu zamknięta (nie short)
    createdAt: now, // Data utworzenia = data sprzedaży
    closedAt: now, // Data zamknięcia = data sprzedaży
    trendAtBuy: position.trendAtBuy || 0, // Trend z pozycji zakupu dla referencji
    targetBuybackPrice: nextBuyTargetForDisplay, // Następny cel zakupu (do kolumny "Cel odkupu")
  });
  sellPosition.save();

  console.log(
    `📝 Created SELL position in history: id=${
      sellPosition.id
    }, orderId=${sellOrderId}, wallet=${
      state.walletAddress
    }, price=${finalSellPrice}, profit=${executedProfit.toNumber()}`,
  );

  // Weryfikacja: sprawdź czy pozycja została zapisana
  const verifyPosition = Position.findById(sellPosition.id);
  if (!verifyPosition) {
    console.error(
      `❌ ERROR: SELL position ${sellPosition.id} was not saved to database!`,
    );
  } else {
    console.log(
      `✅ Verified: SELL position ${sellPosition.id} saved successfully`,
    );
  }

  // Aktualizuj stan: focus = cena sprzedaży; trend w dół (5→4→…→0)
  state.openPositionIds = state.openPositionIds.filter(
    (id) => id !== position.id,
  );
  state.buyTrendCounter = Math.max(0, state.buyTrendCounter - 1);
  state.totalSellTransactions += 1;
  state.totalSoldValue = new Decimal(state.totalSoldValue || 0)
    .plus(executedSellValue)
    .toNumber();
  // Przelicz łączny profit na podstawie wszystkich ZAMKNIĘTYCH pozycji
  // (long + short) dla danego zlecenia – dzięki temu Total Profit w UI
  // zawsze odpowiada sumie z tabeli zamkniętych pozycji.
  state.totalProfit = Position.getTotalClosedProfit(
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

  console.log(
    `🔴 SELL executed: price=${finalSellPrice}, profit=${executedProfit} trend→${state.buyTrendCounter} focus=${finalSellPrice}`,
  );
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

  // Ilość wynikająca z logiki wartości transakcji
  let amount = transactionValue
    .div(currentPrice)
    .toDecimalPlaces(AMOUNT_SCALE, Decimal.ROUND_DOWN);

  // Sprawdź realne saldo BTC i w razie potrzeby przytnij ilość do dostępnego balansu.
  // Dzięki temu przy małym saldzie (i ustawionym 0 w polu "Max wartość")
  // bot sprzeda "ile ma", zamiast w ogóle nie wykonywać transakcji.
  const sellSettings = settings.sell || {};
  const sellCurrency = sellSettings.currency || "BTC";
  const walletBalance = WalletService.getBalance(
    state.walletAddress,
    sellCurrency,
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

  if (!canExecuteSell(amount, state, settings)) {
    if (DEBUG_CONDITIONS) {
      console.log(
        `🔍 SELL skipped (canExecuteSell=false) wallet=${state.walletAddress} ` +
          `amount=${amount.toString()} available=${availableBalance.toString()}`,
      );
    }
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

  // Wykonaj zlecenie przez ExchangeService
  const exchangeResult = await ExchangeService.placeSpotSell(
    state.walletAddress,
    symbol,
    amount,
    currentPrice,
  );

  if (!exchangeResult.success) {
    console.error(
      `Failed to execute SELL on exchange: ${exchangeResult.error}`,
    );
    return;
  }

  // Użyj rzeczywistej wykonanej ilości i średniej ceny z giełdy
  // Zabezpieczenie: jeśli giełda zwróci 0/undefined, użyj naszych wartości.
  let executedAmount = exchangeResult.executedQty || amount;
  let executedPrice = exchangeResult.avgPrice || currentPrice;
  if (!(executedPrice instanceof Decimal)) {
    executedPrice = new Decimal(executedPrice || currentPrice);
  }
  if (executedPrice.lte(0)) {
    executedPrice = new Decimal(currentPrice);
  }
  const executedValue = executedPrice.mul(executedAmount);

  const position = new Position({
    walletAddress: state.walletAddress,
    orderId: state.orderId,
    type: PositionType.SELL,
    sellPrice: executedPrice.toNumber(),
    amount: executedAmount.toNumber(),
    sellValue: executedValue.toNumber(),
    trendAtBuy: currentTrend,
    targetBuybackPrice: targetBuybackPrice.toNumber(),
    status: PositionStatus.OPEN,
  });
  position.save();

  state.openSellPositionIds.push(position.id);
  const maxTrend = getMaxTrend(settings);
  state.sellTrendCounter = Math.min(currentTrend + 1, maxTrend);
  state.totalSellTransactions += 1;
  state.totalSoldValue = new Decimal(state.totalSoldValue || 0)
    .plus(executedValue)
    .toNumber();
  const sellPriceNum = toNum(executedPrice);
  // Po otwarciu short:
  // - aktualizujemy tylko SELL focus (nextSellTarget) na bazie ceny sprzedaży,
  // - BUY focus (nextBuyTarget) pozostaje bez zmian, dopóki nie wykonamy BUY.
  state.currentFocusPrice = sellPriceNum;
  state.focusLastUpdated = new Date().toISOString();
  state.nextSellTarget = calculateNextSellTarget(
    new Decimal(sellPriceNum),
    state.sellTrendCounter,
    settings,
  ).toNumber();

  console.log(
    `🟡 SELL executed: price=${sellPriceNum}, trend=${currentTrend}→${state.sellTrendCounter} focus=${sellPriceNum}`,
  );
}

/**
 * Sprawdza i wykonuje odkup pozycji short
 */
async function checkAndExecuteSellBuybacks(currentPrice, state, settings) {
  if (!state.openSellPositionIds || state.openSellPositionIds.length === 0)
    return;

  const positions = Position.findByIds(state.openSellPositionIds);

  for (const position of positions) {
    if (position.status !== PositionStatus.OPEN) continue;
    if (
      position.targetBuybackPrice &&
      currentPrice.lte(position.targetBuybackPrice)
    ) {
      await executeSellBuyback(currentPrice, position, state, settings);
    }
  }
}

/**
 * Wykonuje odkup pozycji short
 */
async function executeSellBuyback(currentPrice, position, state, settings) {
  const amount = new Decimal(position.amount);
  const buybackValue = amount.mul(currentPrice);
  const profit = new Decimal(position.sellValue).minus(buybackValue);

  if (profit.lt(0)) return;

  const baseAsset = settings.baseAsset || settings.sell?.currency || "BTC";
  const quoteAsset = settings.quoteAsset || settings.buy?.currency || "USDT";
  const symbol = `${baseAsset}${quoteAsset}`;

  // Wykonaj zlecenie BUY przez ExchangeService (odkup short)
  const exchangeResult = await ExchangeService.placeSpotBuy(
    state.walletAddress,
    symbol,
    buybackValue,
    currentPrice,
  );

  if (!exchangeResult.success) {
    console.error(
      `Failed to execute buyback on exchange: ${exchangeResult.error}`,
    );
    return;
  }

  // Użyj rzeczywistej wykonanej ilości i średniej ceny z giełdy
  const executedAmount = exchangeResult.executedQty || amount;
  const executedPrice = exchangeResult.avgPrice || currentPrice;
  const executedBuybackValue = executedPrice.mul(executedAmount);
  const executedProfit = new Decimal(position.sellValue).minus(
    executedBuybackValue,
  );

  const buybackPriceNum = toNum(executedPrice);
  position.buyPrice = buybackPriceNum;
  position.buyValue = executedBuybackValue.toNumber();
  position.profit = executedProfit.toNumber();
  position.status = PositionStatus.CLOSED;
  position.closedAt = new Date().toISOString();
  position.save();

  state.openSellPositionIds = state.openSellPositionIds.filter(
    (id) => id !== position.id,
  );
  state.sellTrendCounter = Math.max(0, state.sellTrendCounter - 1);
  state.totalBuyTransactions += 1;
  state.totalBoughtValue = new Decimal(state.totalBoughtValue || 0)
    .plus(executedBuybackValue)
    .toNumber();
  // Spójne przeliczenie totalProfit na podstawie zamkniętych pozycji
  state.totalProfit = Position.getTotalClosedProfit(
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

  console.log(
    `🔵 BUYBACK executed: price=${buybackPriceNum}, trend→${state.sellTrendCounter} focus=${buybackPriceNum}`,
  );
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
export function getGridState(walletAddress, orderId) {
  return GridState.findByWalletAndOrderId(walletAddress, orderId);
}

/**
 * Pobiera otwarte pozycje
 */
export function getOpenPositions(walletAddress, orderId) {
  return Position.findOpenByWalletAndOrderId(walletAddress, orderId);
}

/**
 * Pobiera wszystkie pozycje (OPEN i CLOSED) dla historii
 */
export function getAllPositions(walletAddress, orderId) {
  return Position.findByWalletAndOrderId(walletAddress, orderId);
}

/**
 * Zatrzymuje GRID
 */
export function stopGrid(walletAddress, orderId) {
  const state = GridState.findByWalletAndOrderId(walletAddress, orderId);
  if (state) {
    state.isActive = false;
    state.lastUpdated = new Date().toISOString();
    state.save();
  }
}

/**
 * Uruchamia GRID
 */
export function startGrid(walletAddress, orderId) {
  const state = GridState.findByWalletAndOrderId(walletAddress, orderId);
  if (state) {
    state.isActive = true;
    state.lastUpdated = new Date().toISOString();
    state.save();
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
