import Decimal from "decimal.js";
import * as AsterSpotService from "./AsterSpotService.js";
import * as BingXService from "./BingXService.js";
import * as WalletService from "./WalletService.js";
import UserSettings from "../models/UserSettings.js";

// Cache dla exchangeInfo per giełda (aby nie pobierać za każdym razem)
const exchangeInfoCache = new Map(); // exchange -> { data, time }
const EXCHANGE_INFO_CACHE_MS = 5 * 60 * 1000; // 5 minut

/**
 * Czyści cache exchangeInfo dla wszystkich giełd (używane po zmianie giełdy)
 */
export function clearExchangeInfoCache() {
  exchangeInfoCache.clear();
  console.log('🔄 ExchangeInfo cache cleared');
}

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
 * Zwraca odpowiedni serwis giełdy
 * @param {"asterdex"|"bingx"} exchange
 * @returns {Object} - serwis giełdy
 */
function getExchangeService(exchange) {
  return exchange === "bingx" ? BingXService : AsterSpotService;
}

/** Dla BingX symbole mogą być "ETH-USDT" lub "ETHUSDT" – porównujemy znormalizowane (bez - i _). */
function symbolMatchesExchange(symbolFromExchange, symbolWeWant, exchange) {
  const want = (symbolWeWant || "").toUpperCase();
  const from = (symbolFromExchange || "").toUpperCase();
  if (exchange === "bingx") {
    return from.replace(/[-_]/g, "") === want.replace(/[-_]/g, "");
  }
  return from === want;
}

/**
 * Pobiera exchangeInfo dla symbolu (cache'uje przez 5 minut)
 * @param {string} symbol - np. "BTCUSDT"
 * @param {string} walletAddress - adres portfela (do określenia giełdy)
 * @param {string|null} forcedExchange - wymuś konkretną giełdę, jeśli null używa globalnej z UserSettings
 * @returns {Promise<{stepSize?: string, tickSize?: string}>}
 */
async function getSymbolPrecision(symbol, walletAddress = null, forcedExchange = null) {
  const exchange = forcedExchange || await getExchange(walletAddress);
  const exchangeService = getExchangeService(exchange);
  
  const now = Date.now();
  const cacheKey = exchange;
  const cached = exchangeInfoCache.get(cacheKey);
  
  if (!cached || now - cached.time > EXCHANGE_INFO_CACHE_MS) {
    try {
      const exchangeInfo = await exchangeService.fetchExchangeInfo();
      exchangeInfoCache.set(cacheKey, {
        data: exchangeInfo,
        time: now,
      });
    } catch (error) {
      console.warn(`⚠️ Failed to fetch exchangeInfo from ${exchange}: ${error.message}`);
      return { stepSize: null, tickSize: null };
    }
  }

  const cachedData = exchangeInfoCache.get(cacheKey);
  const upperSymbol = symbol.toUpperCase();
  const symbolInfo = cachedData?.data?.symbols?.find(
    (s) => symbolMatchesExchange(s.symbol, upperSymbol, exchange)
  );

  if (!symbolInfo) {
    console.warn(`⚠️ Symbol ${upperSymbol} not found in exchangeInfo`);
    return { stepSize: null, tickSize: null };
  }

  // Znajdź stepSize (dla quantity) i tickSize (dla price)
  const lotSizeFilter = symbolInfo.filters?.find(
    (f) => f.filterType === "LOT_SIZE"
  );
  const priceFilter = symbolInfo.filters?.find(
    (f) => f.filterType === "PRICE_FILTER"
  );

  // Dla quoteOrderQty może być osobny filtr MIN_NOTIONAL lub używać stepSize z quotePrecision
  const minNotionalFilter = symbolInfo.filters?.find(
    (f) => f.filterType === "MIN_NOTIONAL"
  );

  // Dla par z USDT (i innych stablecoinów) kwota w quote ma być zaokrąglona do 2 miejsc
  // (BingX zwraca quotePrecision=2, AsterDex może zwracać 8 – ujednolicamy do 2)
  const quoteAsset = (
    symbolInfo.quoteAsset ||
    (upperSymbol.endsWith("USDT") ? "USDT" : "") ||
    ""
  ).toUpperCase();
  const isStableQuote = ["USDT", "USDC", "BUSD", "DAI"].includes(quoteAsset);
  const quotePrecision =
    isStableQuote ? 2 : (symbolInfo.quotePrecision ?? null);

  return {
    stepSize: lotSizeFilter?.stepSize || null,
    tickSize: priceFilter?.tickSize || null,
    minNotional: minNotionalFilter?.minNotional || null,
    quotePrecision, // Precyzja dla quote currency (2 dla USDT itd.)
    basePrecision: symbolInfo.basePrecision || null, // Precyzja dla base currency
  };
}

/**
 * Sprawdza czy symbol istnieje w exchangeInfo i zwraca informacje o dostępnych symbolach
 * @param {string} symbol - np. "XRPUSDT"
 * @param {string} walletAddress - adres portfela (do określenia giełdy)
 * @param {string|null} forcedExchange - wymuś konkretną giełdę, jeśli null używa globalnej z UserSettings
 * @returns {Promise<{valid: boolean, symbolInfo?: object, availableSymbols?: string[], error?: string}>}
 */
async function validateSymbol(symbol, walletAddress = null, forcedExchange = null) {
  const exchange = forcedExchange || await getExchange(walletAddress);
  const exchangeService = getExchangeService(exchange);
  
  const now = Date.now();
  const cacheKey = exchange;
  const cached = exchangeInfoCache.get(cacheKey);
  
  if (!cached || now - cached.time > EXCHANGE_INFO_CACHE_MS) {
    try {
      const exchangeInfo = await exchangeService.fetchExchangeInfo();
      exchangeInfoCache.set(cacheKey, {
        data: exchangeInfo,
        time: now,
      });
    } catch (error) {
      return {
        valid: false,
        error: `Failed to fetch exchangeInfo from ${exchange}: ${error.message}`,
      };
    }
  }

  const cachedData = exchangeInfoCache.get(cacheKey);
  const upperSymbol = symbol.toUpperCase();
  const symbolInfo = cachedData?.data?.symbols?.find(
    (s) => symbolMatchesExchange(s.symbol, upperSymbol, exchange) && s.status === "TRADING"
  );

  if (symbolInfo) {
    return { valid: true, symbolInfo };
  }

  // Jeśli symbol nie istnieje, znajdź dostępne symbole dla tego baseAsset
  const [baseAsset, quoteAsset] = parseSymbol(symbol);
  const availableSymbols = cachedData?.data?.symbols
    ?.filter(
      (s) =>
        (s.baseAsset === baseAsset || (exchange === "bingx" && (s.baseAsset || "").toUpperCase() === baseAsset)) &&
        (s.quoteAsset === quoteAsset || (exchange === "bingx" && (s.quoteAsset || "").toUpperCase() === quoteAsset)) &&
        s.status === "TRADING"
    )
    .map((s) => s.symbol)
    .slice(0, 10) || [];

  const exchangeName = exchange === "bingx" ? "BingX" : "AsterDex";
  return {
    valid: false,
    availableSymbols,
    error: `Symbol ${upperSymbol} is not available on ${exchangeName} Spot. ${
      availableSymbols.length > 0
        ? `Available symbols for ${baseAsset}/${quoteAsset}: ${availableSymbols.join(", ")}`
        : `No trading pairs found for ${baseAsset}/${quoteAsset} on Spot.`
    }`,
  };
}

/**
 * Zaokrągla quantity zgodnie z stepSize z exchangeInfo
 * Jeśli wartość transakcji po zaokrągleniu w dół byłaby < 5 USDT, zaokrągla w górę
 * @param {Decimal} quantity - ilość do zaokrąglenia
 * @param {string|null} stepSize - stepSize z exchangeInfo (np. "0.00001")
 * @param {Decimal|null} currentPrice - aktualna cena (do sprawdzenia wartości transakcji)
 * @returns {string} - zaokrąglona ilość jako string
 */
function roundQuantityToStepSize(quantity, stepSize, currentPrice = null) {
  if (!stepSize || stepSize === "0") {
    // Fallback: zaokrąglij do 8 miejsc (jak w GridAlgorithmService)
    return quantity.toDecimalPlaces(8, Decimal.ROUND_DOWN).toString();
  }

  const stepDecimal = new Decimal(stepSize);
  if (stepDecimal.isZero()) {
    return quantity.toDecimalPlaces(8, Decimal.ROUND_DOWN).toString();
  }

  // Upewnij się, że zaokrąglona wartość jest wielokrotnością stepSize
  // Oblicz ile "kroków" stepSize mieści się w quantity (zaokrąglij w dół)
  const steps = quantity.div(stepDecimal).floor();
  let finalQty = steps.mul(stepDecimal);

  // Sprawdź czy wartość transakcji po zaokrągleniu w dół jest >= 5 USDT
  // Jeśli nie, zaokrąglij w górę (dodaj jeden krok stepSize)
  if (currentPrice && currentPrice.gt(0)) {
    const minOrderValue = new Decimal(5); // Minimum 5 USDT dla AsterDex
    const valueAfterRoundDown = finalQty.mul(currentPrice);
    
    if (valueAfterRoundDown.lt(minOrderValue)) {
      // Zaokrąglij w górę - dodaj jeden krok stepSize
      const stepsUp = steps.plus(1);
      finalQty = stepsUp.mul(stepDecimal);
      
      const valueAfterRoundUp = finalQty.mul(currentPrice);
      console.log(
        `📊 SELL quantity rounded UP: qty=${quantity.toString()} -> ${finalQty.toString()} ` +
        `(value: ${valueAfterRoundDown.toFixed(2)} -> ${valueAfterRoundUp.toFixed(2)} USDT, min=5 USDT)`
      );
    }
  }

  // Zwróć jako string z odpowiednią precyzją (usunięcie niepotrzebnych zer)
  return finalQty.toString();
}

/**
 * Zaokrągla quoteOrderQty zgodnie z precyzją quote currency
 * @param {Decimal} quoteAmount - ilość quote currency do zaokrąglenia
 * @param {number|null} quotePrecision - precyzja quote currency (liczba miejsc po przecinku)
 * @returns {string} - zaokrąglona ilość jako string
 */
function roundQuoteOrderQty(quoteAmount, quotePrecision) {
  if (quotePrecision != null && quotePrecision >= 0) {
    // Zaokrąglij do określonej liczby miejsc po przecinku (w dół dla bezpieczeństwa)
    return quoteAmount.toDecimalPlaces(quotePrecision, Decimal.ROUND_DOWN).toString();
  }
  
  // Fallback: zaokrąglij do 2 miejsc dla USDT (standardowa precyzja stablecoinów)
  return quoteAmount.toDecimalPlaces(2, Decimal.ROUND_DOWN).toString();
}

// Odczyt z env przy każdym użyciu (po załadowaniu dotenv), bez spacji/błędów
function isPaperTrading() {
  const v = String(process.env.PAPER_TRADING ?? "")
    .trim()
    .toLowerCase();
  return v !== "false" && v !== "0";
}

let _logged = false;
function logPaperModeOnce() {
  if (_logged) return;
  _logged = true;
  const paper = isPaperTrading();
  console.log(
    paper
      ? "📋 Paper trading: WŁĄCZONY (zlecenia symulowane)"
      : "💰 Paper trading: WYŁĄCZONY (realne zlecenia)"
  );
}

/**
 * Serwis do wykonywania realnych zleceń spot na AsterDex
 * W trybie paper-trading symuluje zlecenia używając WalletService
 */

/**
 * Wykonuje zlecenie zakupu (BUY) na spocie
 * @param {string} walletAddress - adres portfela
 * @param {string} symbol - symbol pary (np. BTCUSDC)
 * @param {Decimal} quoteAmount - ilość quote currency do wydania (np. 1000 USDC)
 * @param {Decimal} expectedPrice - oczekiwana cena (dla logowania)
 * @param {string|null} forcedExchange - wymuś konkretną giełdę (np. "bingx" lub "asterdex"), jeśli null używa globalnej z UserSettings
 * @returns {Promise<{success: boolean, orderId?: string, executedQty?: Decimal, avgPrice?: Decimal, error?: string}>}
 */
export async function placeSpotBuy(
  walletAddress,
  symbol,
  quoteAmount,
  expectedPrice,
  forcedExchange = null
) {
  logPaperModeOnce();
  if (isPaperTrading()) {
    // Tryb paper-trading - symulacja bez realnych zleceń
    return executePaperBuy(walletAddress, symbol, quoteAmount, expectedPrice);
  }

  try {
    // Użyj wymuszonej giełdy (z zlecenia) lub pobierz globalną z UserSettings
    const exchange = forcedExchange || await getExchange(walletAddress);
    const exchangeService = getExchangeService(exchange);
    const exchangeName = exchange === "bingx" ? "BingX" : "AsterDex";
    
    // Walidacja symbolu przed wysłaniem zlecenia (użyj wymuszonej giełdy jeśli podana)
    const validation = await validateSymbol(symbol, walletAddress, exchange);
    if (!validation.valid) {
      console.error(`❌ Invalid symbol ${symbol}:`, validation.error);
      return {
        success: false,
        error: validation.error || `Symbol ${symbol} is not available on ${exchangeName} Spot`,
      };
    }

    // Pobierz precyzję dla symbolu (dla quoteOrderQty) - użyj wymuszonej giełdy jeśli podana
    const precision = await getSymbolPrecision(symbol, walletAddress, exchange);
    const roundedQuoteQty = roundQuoteOrderQty(
      quoteAmount,
      precision.quotePrecision
    );

    console.log(
      `📊 BUY precision for ${symbol} (${exchangeName}): quotePrecision=${
        precision.quotePrecision
      }, quoteQty=${quoteAmount.toString()} -> ${roundedQuoteQty}`
    );

    // Realne zlecenie MARKET BUY
    // Dla MARKET BUY używamy quoteOrderQty (ile quote currency wydać)
    const orderParams = {
      symbol: symbol.toUpperCase(),
      side: "BUY",
      type: "MARKET",
      quoteOrderQty: roundedQuoteQty,
    };

    const orderResult = await exchangeService.placeOrder(
      orderParams,
      walletAddress
    );

    if (orderResult && orderResult.orderId) {
      const executedQty = new Decimal(orderResult.executedQty || 0);
      const avgPrice = new Decimal(orderResult.avgPrice || expectedPrice);

      // Zsynchronizuj portfel z rzeczywistym stanem z giełdy
      await syncWalletAfterTrade(
        walletAddress,
        symbol,
        "BUY",
        executedQty,
        avgPrice.mul(executedQty)
      );

      console.log(
        `✅ Real BUY executed on ${exchangeName}: ${symbol} qty=${executedQty} avgPrice=${avgPrice} orderId=${orderResult.orderId}`
      );

      return {
        success: true,
        orderId: String(orderResult.orderId),
        executedQty,
        avgPrice,
      };
    }

    return {
      success: false,
      error: "Order placed but no orderId returned",
    };
  } catch (error) {
    const exchange = forcedExchange || await getExchange(walletAddress);
    const exchangeName = exchange === "bingx" ? "BingX" : "AsterDex";
    console.error(`❌ Failed to place BUY order on ${exchangeName}:`, error.message);
    return {
      success: false,
      error: error.message || "Failed to place order",
    };
  }
}

/**
 * Wykonuje zlecenie sprzedaży (SELL) na spocie
 * @param {string} walletAddress - adres portfela
 * @param {string} symbol - symbol pary (np. BTCUSDC)
 * @param {Decimal} baseAmount - ilość base currency do sprzedania (np. 0.01 BTC)
 * @param {Decimal} expectedPrice - oczekiwana cena (dla logowania)
 * @param {string|null} forcedExchange - wymuś konkretną giełdę (np. "bingx" lub "asterdex"), jeśli null używa globalnej z UserSettings
 * @returns {Promise<{success: boolean, orderId?: string, executedQty?: Decimal, avgPrice?: Decimal, error?: string}>}
 */
export async function placeSpotSell(
  walletAddress,
  symbol,
  baseAmount,
  expectedPrice,
  forcedExchange = null
) {
  logPaperModeOnce();
  if (isPaperTrading()) {
    // Tryb paper-trading - symulacja bez realnych zleceń
    return executePaperSell(walletAddress, symbol, baseAmount, expectedPrice);
  }

  try {
    // Użyj wymuszonej giełdy (z zlecenia) lub pobierz globalną z UserSettings
    const exchange = forcedExchange || await getExchange(walletAddress);
    const exchangeService = getExchangeService(exchange);
    const exchangeName = exchange === "bingx" ? "BingX" : "AsterDex";
    
    // Walidacja symbolu przed wysłaniem zlecenia
    const validation = await validateSymbol(symbol, walletAddress);
    if (!validation.valid) {
      console.error(`❌ Invalid symbol ${symbol}:`, validation.error);
      return {
        success: false,
        error: validation.error || `Symbol ${symbol} is not available on ${exchangeName} Spot`,
      };
    }

    // Pobierz precyzję dla symbolu (stepSize dla quantity)
    const precision = await getSymbolPrecision(symbol, walletAddress);
    const roundedQuantity = roundQuantityToStepSize(
      baseAmount,
      precision.stepSize,
      expectedPrice // Przekaż cenę, żeby sprawdzić czy wartość >= 5 USDT
    );

    // Sprawdź wartość transakcji po zaokrągleniu
    const roundedQtyDecimal = new Decimal(roundedQuantity);
    const orderValue = roundedQtyDecimal.mul(expectedPrice);
    console.log(
      `📊 SELL precision for ${symbol} (${exchangeName}): stepSize=${
        precision.stepSize
      }, qty=${baseAmount.toString()} -> ${roundedQuantity}, value=${orderValue.toFixed(2)} USDT`
    );

    // Realne zlecenie MARKET SELL
    // Dla MARKET SELL używamy quantity (ile base currency sprzedać)
    const orderParams = {
      symbol: symbol.toUpperCase(),
      side: "SELL",
      type: "MARKET",
      quantity: roundedQuantity,
    };

    const orderResult = await exchangeService.placeOrder(
      orderParams,
      walletAddress
    );

    if (orderResult && orderResult.orderId) {
      // Giełda potrafi zwrócić "0" jako string – wtedy użyj naszych wartości.
      const rawQty = orderResult.executedQty;
      const rawPrice = orderResult.avgPrice;

      const executedQty =
        rawQty !== undefined && rawQty !== null && rawQty !== "0"
          ? new Decimal(rawQty)
          : new Decimal(baseAmount);

      const avgPrice =
        rawPrice !== undefined && rawPrice !== null && rawPrice !== "0"
          ? new Decimal(rawPrice)
          : new Decimal(expectedPrice);
      const quoteReceived = avgPrice.mul(executedQty);

      // Zsynchronizuj portfel z rzeczywistym stanem z giełdy
      await syncWalletAfterTrade(
        walletAddress,
        symbol,
        "SELL",
        executedQty,
        quoteReceived
      );

      console.log(
        `✅ Real SELL executed on ${exchangeName}: ${symbol} qty=${executedQty} avgPrice=${avgPrice} orderId=${orderResult.orderId}`
      );

      return {
        success: true,
        orderId: String(orderResult.orderId),
        executedQty,
        avgPrice,
      };
    }

    return {
      success: false,
      error: "Order placed but no orderId returned",
    };
  } catch (error) {
    const exchange = forcedExchange || await getExchange(walletAddress);
    const exchangeName = exchange === "bingx" ? "BingX" : "AsterDex";
    console.error(`❌ Failed to place SELL order on ${exchangeName}:`, error.message);
    return {
      success: false,
      error: error.message || "Failed to place order",
    };
  }
}

/**
 * Symuluje zakup w trybie paper-trading
 */
async function executePaperBuy(
  walletAddress,
  symbol,
  quoteAmount,
  expectedPrice
) {
  const [baseAsset, quoteAsset] = parseSymbol(symbol);
  if (!baseAsset || !quoteAsset) {
    return {
      success: false,
      error: `Invalid symbol format: ${symbol}`,
    };
  }

  const baseAmount = quoteAmount.div(expectedPrice);

  const success = WalletService.executeBuy(
    walletAddress,
    quoteAsset,
    baseAsset,
    quoteAmount,
    baseAmount
  );

  if (success) {
    console.log(
      `📝 Paper BUY: ${symbol} -${quoteAmount} ${quoteAsset} -> +${baseAmount} ${baseAsset}`
    );
    return {
      success: true,
      orderId: `paper-${Date.now()}`,
      executedQty: baseAmount,
      avgPrice: expectedPrice,
    };
  }

  return {
    success: false,
    error: "Insufficient balance (paper trading)",
  };
}

/**
 * Symuluje sprzedaż w trybie paper-trading
 */
async function executePaperSell(
  walletAddress,
  symbol,
  baseAmount,
  expectedPrice
) {
  const [baseAsset, quoteAsset] = parseSymbol(symbol);
  if (!baseAsset || !quoteAsset) {
    return {
      success: false,
      error: `Invalid symbol format: ${symbol}`,
    };
  }

  const quoteReceived = baseAmount.mul(expectedPrice);

  const success = WalletService.executeSell(
    walletAddress,
    baseAsset,
    quoteAsset,
    baseAmount,
    quoteReceived
  );

  if (success) {
    console.log(
      `📝 Paper SELL: ${symbol} -${baseAmount} ${baseAsset} -> +${quoteReceived} ${quoteAsset}`
    );
    return {
      success: true,
      orderId: `paper-${Date.now()}`,
      executedQty: baseAmount,
      avgPrice: expectedPrice,
    };
  }

  return {
    success: false,
    error: "Insufficient balance (paper trading)",
  };
}

/**
 * Parsuje symbol na baseAsset i quoteAsset
 * @param {string} symbol - np. "BTCUSDT"
 * @returns {[string, string]|null} - [baseAsset, quoteAsset] lub null
 */
function parseSymbol(symbol) {
  const upper = symbol.toUpperCase();
  // Na Aster spot jako stable obsługujemy tylko USDT
  const quote = "USDT";
  if (upper.endsWith(quote)) {
    const base = upper.slice(0, -quote.length);
    return [base, quote];
  }
  return null;
}

/**
 * Synchronizuje portfel po realnej transakcji (pobiera aktualne salda z giełdy)
 */
async function syncWalletAfterTrade(
  walletAddress,
  symbol,
  side,
  baseAmount,
  quoteAmount
) {
  try {
    // TODO: W przyszłości pobrać rzeczywiste salda z AsterDex API
    // Na razie tylko logujemy
    console.log(
      `💼 Wallet sync needed for ${walletAddress} after ${side} ${symbol}`
    );
  } catch (error) {
    console.error("Failed to sync wallet after trade:", error.message);
  }
}

export default {
  placeSpotBuy,
  placeSpotSell,
  clearExchangeInfoCache,
};
