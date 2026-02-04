import Decimal from "decimal.js";
import { GridState } from "../models/GridState.js";
import { Position, PositionStatus, PositionType } from "../models/Position.js";
import * as WalletService from "./WalletService.js";

/**
 * Główny serwis implementujący algorytm GRID
 */

const PRICE_SCALE = 2;
const AMOUNT_SCALE = 8;
const DEFAULT_FEE_PERCENT = new Decimal("0.1");

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
export function processPrice(walletAddress, orderId, currentPrice, settings) {
  const state = GridState.findByWalletAndOrderId(walletAddress, orderId);

  if (!state) {
    console.warn(
      `Grid state not found for wallet ${walletAddress} and order ${orderId}`
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
    executeBuy(price, state, settings);
  }

  // Sprawdź zamknięcie pozycji kupna (sprzedaż z zyskiem)
  checkAndExecuteBuySells(price, state, settings);

  // Sprawdź warunki sprzedaży short
  if (shouldSellShort(price, state, settings)) {
    executeSellShort(price, state, settings);
  }

  // Sprawdź zamknięcie pozycji short (odkup z zyskiem)
  checkAndExecuteSellBuybacks(price, state, settings);

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
          settings
        ).toNumber();
        state.nextSellTarget = calculateNextSellTarget(
          currentPrice,
          0,
          settings
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

  const currency = buySettings.currency || "USDC";
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
 */
function meetsMinTransactionValue(transactionValue, settings) {
  if (!settings.platform?.minTransactionValue) return true;
  return transactionValue.gte(
    new Decimal(settings.platform.minTransactionValue)
  );
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
        settings
      );

  if (currentPrice.gt(buyTarget)) {
    return false;
  }

  // #8 Sprawdź min wahanie
  return meetsMinSwing(
    new Decimal(state.currentFocusPrice),
    currentPrice,
    state.buyTrendCounter,
    settings,
    true
  );
}

/**
 * Wykonuje zakup
 */
function executeBuy(currentPrice, state, settings) {
  const currentTrend = state.buyTrendCounter;

  // Oblicz wartość transakcji
  const transactionValue = calculateTransactionValue(
    currentPrice,
    currentTrend,
    settings,
    true
  );

  // #3 Sprawdź min wartość
  if (!meetsMinTransactionValue(transactionValue, settings)) {
    return;
  }

  // #2 Sprawdź portfel
  if (!canExecuteBuy(transactionValue, state, settings)) {
    return;
  }

  // Oblicz ilość kupowanej waluty
  const amount = transactionValue
    .div(currentPrice)
    .toDecimalPlaces(AMOUNT_SCALE, Decimal.ROUND_DOWN);

  // Oblicz cel sprzedaży (z min profitem)
  const minProfitPercent = new Decimal(settings.minProfitPercent || 0.5);
  const targetSellPrice = currentPrice
    .mul(Decimal.add(1, minProfitPercent.div(100)))
    .toDecimalPlaces(PRICE_SCALE, Decimal.ROUND_UP);

  // Oblicz oczekiwany profit
  const expectedProfit = targetSellPrice.minus(currentPrice).mul(amount);

  // #3 Sprawdź fee
  if (!checkFeeDoesNotEatProfit(transactionValue, expectedProfit, settings)) {
    return;
  }

  // Wykonaj transakcję w portfelu
  const buyCurrency = settings.buy?.currency || "USDC";
  const sellCurrency = settings.sell?.currency || "BTC";

  const success = WalletService.executeBuy(
    state.walletAddress,
    buyCurrency,
    sellCurrency,
    transactionValue,
    amount
  );

  if (!success) {
    console.error("Failed to execute buy in wallet");
    return;
  }

  // Zapisz pozycję
  const position = new Position({
    walletAddress: state.walletAddress,
    orderId: state.orderId,
    type: PositionType.BUY,
    buyPrice: currentPrice.toNumber(),
    amount: amount.toNumber(),
    buyValue: transactionValue.toNumber(),
    trendAtBuy: currentTrend,
    targetSellPrice: targetSellPrice.toNumber(),
    status: PositionStatus.OPEN,
  });
  position.save();

  // Aktualizuj stan
  state.openPositionIds.push(position.id);
  state.buyTrendCounter = currentTrend + 1;
  state.totalBuyTransactions += 1;
  state.totalBoughtValue = new Decimal(state.totalBoughtValue || 0)
    .plus(transactionValue)
    .toNumber();
  state.currentFocusPrice = currentPrice.toNumber();
  state.focusLastUpdated = new Date().toISOString();
  state.nextBuyTarget = calculateNextBuyTarget(
    currentPrice,
    state.buyTrendCounter,
    settings
  ).toNumber();

  console.log(
    `🟢 BUY executed: price=${currentPrice}, amount=${amount}, value=${transactionValue}, trend=${currentTrend}`
  );
}

/**
 * Sprawdza i wykonuje sprzedaż pozycji kupna (z zyskiem)
 */
function checkAndExecuteBuySells(currentPrice, state, settings) {
  if (!state.openPositionIds || state.openPositionIds.length === 0) return;

  const positions = Position.findByIds(state.openPositionIds);

  // Sortuj po cenie docelowej
  positions.sort((a, b) => (a.targetSellPrice || 0) - (b.targetSellPrice || 0));

  for (const position of positions) {
    if (position.status !== PositionStatus.OPEN) continue;
    if (
      position.targetSellPrice &&
      currentPrice.gte(position.targetSellPrice)
    ) {
      executeBuySell(currentPrice, position, state, settings);
    }
  }
}

/**
 * Wykonuje sprzedaż pozycji kupna
 */
function executeBuySell(currentPrice, position, state, settings) {
  const amount = new Decimal(position.amount);
  const sellValue = amount.mul(currentPrice);
  const profit = sellValue.minus(position.buyValue);

  // Nigdy nie sprzedawaj ze stratą
  if (profit.lt(0)) return;

  const sellCurrency = settings.sell?.currency || "BTC";
  const buyCurrency = settings.buy?.currency || "USDC";

  const success = WalletService.executeSell(
    state.walletAddress,
    sellCurrency,
    buyCurrency,
    amount,
    sellValue
  );

  if (!success) return;

  // Aktualizuj pozycję
  position.sellPrice = currentPrice.toNumber();
  position.sellValue = sellValue.toNumber();
  position.profit = profit.toNumber();
  position.status = PositionStatus.CLOSED;
  position.closedAt = new Date().toISOString();
  position.save();

  // Aktualizuj stan
  state.openPositionIds = state.openPositionIds.filter(
    (id) => id !== position.id
  );
  state.buyTrendCounter = Math.max(0, state.buyTrendCounter - 1);
  state.totalSellTransactions += 1;
  state.totalSoldValue = new Decimal(state.totalSoldValue || 0)
    .plus(sellValue)
    .toNumber();
  state.totalProfit = new Decimal(state.totalProfit || 0)
    .plus(profit)
    .toNumber();
  state.currentFocusPrice = currentPrice.toNumber();
  state.focusLastUpdated = new Date().toISOString();
  state.nextBuyTarget = calculateNextBuyTarget(
    currentPrice,
    state.buyTrendCounter,
    settings
  ).toNumber();

  console.log(`🔴 SELL executed: price=${currentPrice}, profit=${profit}`);
}

/**
 * Sprawdza czy spełnione są warunki sprzedaży short
 */
function shouldSellShort(currentPrice, state, settings) {
  if (!settings.sellConditions) return false;

  // Sprawdź próg cenowy
  const priceThreshold = settings.sellConditions.priceThreshold;
  if (priceThreshold && currentPrice.lt(priceThreshold)) {
    if (settings.sellConditions.checkThresholdIfProfitable) {
      return false;
    }
    if ((state.totalProfit || 0) <= 0) {
      return false;
    }
  }

  // Sprawdź cel sprzedaży
  let sellTarget = state.nextSellTarget
    ? new Decimal(state.nextSellTarget)
    : calculateNextSellTarget(
        new Decimal(state.currentFocusPrice),
        state.sellTrendCounter,
        settings
      );

  if (currentPrice.lt(sellTarget)) {
    return false;
  }

  // #8 Sprawdź min wahanie
  return meetsMinSwing(
    new Decimal(state.currentFocusPrice),
    currentPrice,
    state.sellTrendCounter,
    settings,
    false
  );
}

/**
 * Wykonuje sprzedaż short
 */
function executeSellShort(currentPrice, state, settings) {
  const currentTrend = state.sellTrendCounter;

  const transactionValue = calculateTransactionValue(
    currentPrice,
    currentTrend,
    settings,
    false
  );

  if (!meetsMinTransactionValue(transactionValue, settings)) {
    return;
  }

  const amount = transactionValue
    .div(currentPrice)
    .toDecimalPlaces(AMOUNT_SCALE, Decimal.ROUND_DOWN);

  if (!canExecuteSell(amount, state, settings)) {
    return;
  }

  // Cel odkupu (z min profitem)
  const minProfitPercent = new Decimal(settings.minProfitPercent || 0.5);
  const targetBuybackPrice = currentPrice
    .mul(Decimal.sub(1, minProfitPercent.div(100)))
    .toDecimalPlaces(PRICE_SCALE, Decimal.ROUND_DOWN);

  const expectedProfit = currentPrice.minus(targetBuybackPrice).mul(amount);

  if (!checkFeeDoesNotEatProfit(transactionValue, expectedProfit, settings)) {
    return;
  }

  const sellCurrency = settings.sell?.currency || "BTC";
  const buyCurrency = settings.buy?.currency || "USDC";

  const success = WalletService.executeSell(
    state.walletAddress,
    sellCurrency,
    buyCurrency,
    amount,
    transactionValue
  );

  if (!success) return;

  const position = new Position({
    walletAddress: state.walletAddress,
    orderId: state.orderId,
    type: PositionType.SELL,
    sellPrice: currentPrice.toNumber(),
    amount: amount.toNumber(),
    sellValue: transactionValue.toNumber(),
    trendAtBuy: currentTrend,
    targetBuybackPrice: targetBuybackPrice.toNumber(),
    status: PositionStatus.OPEN,
  });
  position.save();

  state.openSellPositionIds.push(position.id);
  state.sellTrendCounter = currentTrend + 1;
  state.totalSellTransactions += 1;
  state.totalSoldValue = new Decimal(state.totalSoldValue || 0)
    .plus(transactionValue)
    .toNumber();
  state.currentFocusPrice = currentPrice.toNumber();
  state.focusLastUpdated = new Date().toISOString();
  state.nextSellTarget = calculateNextSellTarget(
    currentPrice,
    state.sellTrendCounter,
    settings
  ).toNumber();

  console.log(
    `🟡 SELL SHORT executed: price=${currentPrice}, amount=${amount}`
  );
}

/**
 * Sprawdza i wykonuje odkup pozycji short
 */
function checkAndExecuteSellBuybacks(currentPrice, state, settings) {
  if (!state.openSellPositionIds || state.openSellPositionIds.length === 0)
    return;

  const positions = Position.findByIds(state.openSellPositionIds);

  for (const position of positions) {
    if (position.status !== PositionStatus.OPEN) continue;
    if (
      position.targetBuybackPrice &&
      currentPrice.lte(position.targetBuybackPrice)
    ) {
      executeSellBuyback(currentPrice, position, state, settings);
    }
  }
}

/**
 * Wykonuje odkup pozycji short
 */
function executeSellBuyback(currentPrice, position, state, settings) {
  const amount = new Decimal(position.amount);
  const buybackValue = amount.mul(currentPrice);
  const profit = new Decimal(position.sellValue).minus(buybackValue);

  if (profit.lt(0)) return;

  const buyCurrency = settings.buy?.currency || "USDC";
  const sellCurrency = settings.sell?.currency || "BTC";

  const success = WalletService.executeBuy(
    state.walletAddress,
    buyCurrency,
    sellCurrency,
    buybackValue,
    amount
  );

  if (!success) return;

  position.buyPrice = currentPrice.toNumber();
  position.buyValue = buybackValue.toNumber();
  position.profit = profit.toNumber();
  position.status = PositionStatus.CLOSED;
  position.closedAt = new Date().toISOString();
  position.save();

  state.openSellPositionIds = state.openSellPositionIds.filter(
    (id) => id !== position.id
  );
  state.sellTrendCounter = Math.max(0, state.sellTrendCounter - 1);
  state.totalBuyTransactions += 1;
  state.totalBoughtValue = new Decimal(state.totalBoughtValue || 0)
    .plus(buybackValue)
    .toNumber();
  state.totalProfit = new Decimal(state.totalProfit || 0)
    .plus(profit)
    .toNumber();
  state.currentFocusPrice = currentPrice.toNumber();
  state.focusLastUpdated = new Date().toISOString();
  state.nextSellTarget = calculateNextSellTarget(
    currentPrice,
    state.sellTrendCounter,
    settings
  ).toNumber();

  console.log(`🔵 BUYBACK executed: price=${currentPrice}, profit=${profit}`);
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
 * #5 Pobiera procent dla trendu
 */
function getTrendPercent(trend, settings, isBuy) {
  const trendPercents = settings.trendPercents;

  if (!trendPercents || trendPercents.length === 0) {
    return new Decimal(0.5); // Domyślnie 0.5%
  }

  // Znajdź najwyższy trend <= aktualny trend
  let result = trendPercents[0];
  for (const tp of trendPercents) {
    if (tp.trend <= trend) {
      result = tp;
    }
  }

  const percent = isBuy ? result.buyPercent : result.sellPercent;
  return new Decimal(percent || 0.5);
}

/**
 * #4, #6, #7 Oblicza wartość transakcji
 */
function calculateTransactionValue(currentPrice, trend, settings, isBuy) {
  const trendPercent = getTrendPercent(trend, settings, isBuy);

  // #4 Podstawowa wartość na 1%
  let minValuePer1Percent;
  if (isBuy && settings.buyConditions?.minValuePer1Percent) {
    minValuePer1Percent = new Decimal(
      settings.buyConditions.minValuePer1Percent
    );
  } else if (!isBuy && settings.sellConditions?.minValuePer1Percent) {
    minValuePer1Percent = new Decimal(
      settings.sellConditions.minValuePer1Percent
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
        baseValue = baseValue.plus(addVal.mul(trendPercent));
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
  stopGrid,
  startGrid,
};
