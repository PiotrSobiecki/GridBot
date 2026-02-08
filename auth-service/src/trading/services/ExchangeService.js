import Decimal from "decimal.js";
import * as AsterSpotService from "./AsterSpotService.js";
import * as WalletService from "./WalletService.js";

// Cache dla exchangeInfo (aby nie pobierać za każdym razem)
let exchangeInfoCache = null;
let exchangeInfoCacheTime = 0;
const EXCHANGE_INFO_CACHE_MS = 5 * 60 * 1000; // 5 minut

/**
 * Pobiera exchangeInfo dla symbolu (cache'uje przez 5 minut)
 * @param {string} symbol - np. "BTCUSDT"
 * @returns {Promise<{stepSize?: string, tickSize?: string}>}
 */
async function getSymbolPrecision(symbol) {
  const now = Date.now();
  if (
    !exchangeInfoCache ||
    now - exchangeInfoCacheTime > EXCHANGE_INFO_CACHE_MS
  ) {
    try {
      exchangeInfoCache = await AsterSpotService.fetchExchangeInfo();
      exchangeInfoCacheTime = now;
    } catch (error) {
      console.warn(`⚠️ Failed to fetch exchangeInfo: ${error.message}`);
      return { stepSize: null, tickSize: null };
    }
  }

  const upperSymbol = symbol.toUpperCase();
  const symbolInfo = exchangeInfoCache?.symbols?.find(
    (s) => s.symbol === upperSymbol
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

  return {
    stepSize: lotSizeFilter?.stepSize || null,
    tickSize: priceFilter?.tickSize || null,
  };
}

/**
 * Zaokrągla quantity zgodnie z stepSize z exchangeInfo
 * @param {Decimal} quantity - ilość do zaokrąglenia
 * @param {string|null} stepSize - stepSize z exchangeInfo (np. "0.00001")
 * @returns {string} - zaokrąglona ilość jako string
 */
function roundQuantityToStepSize(quantity, stepSize) {
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
  const finalQty = steps.mul(stepDecimal);

  // Zwróć jako string z odpowiednią precyzją (usunięcie niepotrzebnych zer)
  return finalQty.toString();
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
      : "💰 Paper trading: WYŁĄCZONY (realne zlecenia na AsterDex)"
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
 * @returns {Promise<{success: boolean, orderId?: string, executedQty?: Decimal, avgPrice?: Decimal, error?: string}>}
 */
export async function placeSpotBuy(
  walletAddress,
  symbol,
  quoteAmount,
  expectedPrice
) {
  logPaperModeOnce();
  if (isPaperTrading()) {
    // Tryb paper-trading - symulacja bez realnych zleceń
    return executePaperBuy(walletAddress, symbol, quoteAmount, expectedPrice);
  }

  try {
    // Realne zlecenie MARKET BUY na AsterDex
    // Dla MARKET BUY używamy quoteOrderQty (ile quote currency wydać)
    const orderParams = {
      symbol: symbol.toUpperCase(),
      side: "BUY",
      type: "MARKET",
      quoteOrderQty: quoteAmount.toString(),
    };

    const orderResult = await AsterSpotService.placeOrder(
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
        `✅ Real BUY executed on AsterDex: ${symbol} qty=${executedQty} avgPrice=${avgPrice} orderId=${orderResult.orderId}`
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
    console.error(`❌ Failed to place BUY order on AsterDex:`, error.message);
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
 * @returns {Promise<{success: boolean, orderId?: string, executedQty?: Decimal, avgPrice?: Decimal, error?: string}>}
 */
export async function placeSpotSell(
  walletAddress,
  symbol,
  baseAmount,
  expectedPrice
) {
  logPaperModeOnce();
  if (isPaperTrading()) {
    // Tryb paper-trading - symulacja bez realnych zleceń
    return executePaperSell(walletAddress, symbol, baseAmount, expectedPrice);
  }

  try {
    // Pobierz precyzję dla symbolu (stepSize dla quantity)
    const precision = await getSymbolPrecision(symbol);
    const roundedQuantity = roundQuantityToStepSize(
      baseAmount,
      precision.stepSize
    );

    console.log(
      `📊 SELL precision for ${symbol}: stepSize=${
        precision.stepSize
      }, qty=${baseAmount.toString()} -> ${roundedQuantity}`
    );

    // Realne zlecenie MARKET SELL na AsterDex
    // Dla MARKET SELL używamy quantity (ile base currency sprzedać)
    const orderParams = {
      symbol: symbol.toUpperCase(),
      side: "SELL",
      type: "MARKET",
      quantity: roundedQuantity,
    };

    const orderResult = await AsterSpotService.placeOrder(
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
        `✅ Real SELL executed on AsterDex: ${symbol} qty=${executedQty} avgPrice=${avgPrice} orderId=${orderResult.orderId}`
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
    console.error(`❌ Failed to place SELL order on AsterDex:`, error.message);
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
};
