import crypto from "crypto";
import UserSettings from "../models/UserSettings.js";
import { decrypt } from "./CryptoService.js";

// Dokładnie jak w dokumentacji BingX
const HOST = "open-api.bingx.com";
const PROTOCOL = "https";

// Funkcja do pobierania kluczy API.
// ZASADA:
// - dla konkretnych walleti (private endpoints) używamy TYLKO kluczy zapisanych w DB dla tego portfela;
// - globalne klucze z .env są używane WYŁĄCZNIE dla walletAddress = null (globalne ceny itp.).
async function getApiKeys(walletAddress) {
  // 1) Spróbuj z bazy (apiConfig.bingx) dla danego portfela
  if (walletAddress) {
    try {
      const settings = await UserSettings.findOne({
        walletAddress: walletAddress.toLowerCase(),
      });
      const apiConfig = settings?.apiConfig || {};
      const bingx = apiConfig.bingx || {};

      const apiKeyDecrypted = decrypt(
        bingx.apiKeyEncrypted || bingx.apiKey || null,
      );
      const apiSecretDecrypted = decrypt(
        bingx.apiSecretEncrypted || bingx.apiSecret || null,
      );

      if (apiKeyDecrypted && apiSecretDecrypted) {
        return {
          API_KEY: apiKeyDecrypted,
          API_SECRET: apiSecretDecrypted,
          source: "db",
        };
      }
    } catch (e) {
      console.warn(
        `⚠️ BingXService: failed to load API keys from DB for wallet=${walletAddress}:`,
        e.message,
      );
    }

    // Dla portfeli użytkowników NIE robimy fallbacku do globalnych kluczy z .env.
    // Jeśli użytkownik nie ma własnych kluczy – zwracamy brak kluczy.
    return { API_KEY: null, API_SECRET: null, source: "db-missing" };
  }

  // 2) Fallback do zmiennych środowiskowych (.env) – globalne klucze
  const API_KEY = process.env.API_KEY_BINGX;
  const API_SECRET = process.env.API_KEY_SECRET_BINGX;

  if (!API_KEY || !API_SECRET) {
    return { API_KEY: null, API_SECRET: null, source: "env-missing" };
  }

  return { API_KEY, API_SECRET, source: "env" };
}

// Sprawdź klucze przy pierwszym użyciu
let keysChecked = false;
async function checkKeysOnce() {
  if (!keysChecked) {
    const { API_KEY, API_SECRET } = await getApiKeys(null);
    if (API_KEY && API_SECRET) {
      console.log(
        "✅ BingXService: API keys loaded successfully (signed endpoints enabled)",
      );
    }
    keysChecked = true;
  }
}

/**
 * Inicjalizuje serwis - sprawdza klucze API
 */
export function init() {
  checkKeysOnce();
}

/**
 * Buduje string parametrów wg dokumentacji BingX: posortowane klucze, opcjonalnie URL-encoded.
 * Zgodne z przykładem: getParameters(API, timestamp, urlEncode)
 */
function getParameters(payload, timestamp, urlEncode) {
  const paramsObj = { ...payload };
  if (timestamp != null) {
    paramsObj.timestamp = timestamp;
  }
  const sortedKeys = Object.keys(paramsObj).sort();
  let parameters = "";
  for (let i = 0; i < sortedKeys.length; i++) {
    if (i > 0) parameters += "&";
    const key = sortedKeys[i];
    let value = paramsObj[key];
    if (value === undefined || value === null) continue;
    value = String(value);
    if (urlEncode) {
      value = encodeURIComponent(value);
    }
    parameters += key + "=" + value;
  }
  return parameters;
}

/**
 * Wykonuje żądanie HTTP do BingX API
 * Dla signed: używa posortowanych parametrów, podpis z niezakodowanego stringa, URL z zakodowanymi parametrami (zgodnie z przykładem BingX).
 * @param {string} path - ścieżka endpointu (np. "/openApi/spot/v1/ticker/price")
 * @param {Object} options - opcje żądania
 * @returns {Promise<Object>}
 */
async function httpRequest(
  path,
  { method = "GET", query = {}, signed = false, walletAddress = null } = {},
) {
  await checkKeysOnce();

  let fullPath = path;
  if (!fullPath.startsWith("/")) {
    fullPath = "/" + fullPath;
  }

  let fullUrl;
  let res;

  if (signed) {
    const timestamp = Date.now();
    const { API_KEY, API_SECRET } = await getApiKeys(walletAddress);
    if (!API_SECRET) {
      throw new Error("API_KEY_SECRET_BINGX not set - cannot sign request");
    }
    // Podpis z niezakodowanego stringa (jak w przykładzie BingX)
    const paramsStr = getParameters(query, timestamp, false);
    const signature = crypto
      .createHmac("sha256", API_SECRET)
      .update(paramsStr)
      .digest("hex");
    // URL dokładnie jak w doc: protocol+"://"+host+path+"?"+params+"&signature="+sign
    const queryStr =
      getParameters(query, timestamp, true) + "&signature=" + signature;
    fullUrl = `${PROTOCOL}://${HOST}${fullPath}?${queryStr}`;

    const headers = {
      "X-BX-APIKEY": API_KEY,
    };
    console.log(`🔍 BingX API request: ${method} ${fullPath} (signed)`);

    res = await fetch(fullUrl, { method, headers });
  } else {
    // Zapytania publiczne (np. ticker) – zwykłe query bez podpisu
    const params = { ...query };
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        search.append(key, String(value));
      }
    });
    fullUrl = search.toString()
      ? `${PROTOCOL}://${HOST}${fullPath}?${search.toString()}`
      : `${PROTOCOL}://${HOST}${fullPath}`;

    console.log(`🔍 BingX API request: ${method} ${fullUrl}`);

    res = await fetch(fullUrl, { method });
  }

  let responseBody;
  const contentType = res.headers.get("content-type") || "";

  try {
    const textBody = await res.text();

    // Spróbuj sparsować jako JSON
    try {
      responseBody = JSON.parse(textBody);
    } catch (parseError) {
      // Jeśli nie jest JSON, użyj tekstu
      responseBody = textBody;
    }
  } catch (error) {
    console.error(
      `❌ BingXService: Failed to read response body for ${path}:`,
      error.message,
    );
    throw new Error(`Failed to read response: ${error.message}`);
  }

  // BingX zwraca code w odpowiedzi, sprawdź czy code !== 0
  // Uwaga: niektóre endpointy mogą zwracać code !== 0 ale res.ok = true
  if (!res.ok) {
    const errorMsg =
      typeof responseBody === "object" && responseBody.msg
        ? responseBody.msg
        : `${res.status} ${res.statusText}`;
    console.error(
      `❌ BingXService ${method} ${path} failed: ${errorMsg}`,
      responseBody,
    );
    throw new Error(
      responseBody?.msg ||
        responseBody?.message ||
        `BingXService error ${res.status}`,
    );
  }

  // Sprawdź code w odpowiedzi (nawet jeśli res.ok = true)
  if (
    typeof responseBody === "object" &&
    responseBody.code !== undefined &&
    responseBody.code !== 0
  ) {
    const errorMsg =
      responseBody.msg || `BingX API error code ${responseBody.code}`;
    console.error(
      `❌ BingXService ${method} ${path} API error: ${errorMsg}`,
      responseBody,
    );
    throw new Error(errorMsg);
  }

  return responseBody;
}

/**
 * Zwraca pełne informacje o giełdzie i parach (exchangeInfo)
 * GET /openApi/spot/v1/common/symbols
 */
export async function fetchExchangeInfo() {
  checkKeysOnce();
  const result = await httpRequest("/openApi/spot/v1/common/symbols", {
    method: "GET",
    signed: false,
  });

  // BingX zwraca data.symbols (tablica), nie data jako tablica; status może być 1 zamiast "TRADING"
  const rawSymbols =
    result?.data?.symbols ?? (Array.isArray(result?.data) ? result.data : null);
  if (rawSymbols && Array.isArray(rawSymbols)) {
    return {
      symbols: rawSymbols.map((s) => {
        const symbol = typeof s === "object" && s !== null ? s : {};
        const status =
          symbol.status === "TRADING" || symbol.status === 1
            ? "TRADING"
            : "BREAK";
        const symStr = (symbol.symbol || "").replace(/-/g, "");
        const base =
          symbol.baseAsset || (symStr ? symStr.replace(/USDT$/i, "") : "");
        const quote =
          symbol.quoteAsset || (symStr && /USDT$/i.test(symStr) ? "USDT" : "");
        return {
          symbol: symStr,
          baseAsset: base,
          quoteAsset: quote,
          status,
          filters: [
            {
              filterType: "LOT_SIZE",
              stepSize: String(symbol.stepSize ?? "0.00000001"),
              minQty: String(symbol.minQty ?? "0"),
              maxQty: String(symbol.maxQty ?? "0"),
            },
            {
              filterType: "PRICE_FILTER",
              tickSize: String(symbol.tickSize ?? "0.01"),
              minPrice: String(symbol.minPrice ?? "0"),
              maxPrice: String(symbol.maxPrice ?? "0"),
            },
            {
              filterType: "MIN_NOTIONAL",
              minNotional: String(symbol.minNotional ?? "5"),
            },
          ],
          basePrecision: symbol.basePrecision ?? 8,
          quotePrecision: symbol.quotePrecision ?? 8,
        };
      }),
    };
  }
  return { symbols: [] };
}

/**
 * Pobiera informacje o koncie SPOT (salda)
 * GET /openApi/spot/v1/account/balance
 * Dokumentacja: https://bingx-api.github.io/docs-v3/#/en/spot/account/Query%20Assets
 */
export async function fetchSpotAccount(walletAddress) {
  // Uwaga: BingX to CEX, więc nie używa walletAddress - używa API keys z UserSettings
  // walletAddress jest przekazywany tylko po to, żeby pobrać odpowiednie klucze API z bazy
  const response = await httpRequest("/openApi/spot/v1/account/balance", {
    method: "GET",
    signed: true,
    walletAddress, // Używane tylko do pobrania kluczy API z UserSettings
  });

  // BingX zwraca odpowiedź w formacie:
  // {
  //   "code": 0,
  //   "msg": "",
  //   "data": {
  //     "balances": [
  //       {
  //         "asset": "USDT",
  //         "free": "1000.0",
  //         "locked": "0.0"
  //       },
  //       ...
  //     ]
  //   }
  // }

  // Sprawdź czy response jest stringiem (jeśli tak, sparsuj)
  let parsedResponse = response;
  if (typeof response === "string") {
    try {
      parsedResponse = JSON.parse(response);
    } catch (e) {
      console.error(`❌ BingX: Failed to parse response string:`, e.message);
      return { balances: [] };
    }
  }

  // Zawsze loguj pełną odpowiedź dla debugowania (szczególnie dla USDC)
  console.log(
    `🔍 BingX account/balance response (parsed):`,
    JSON.stringify(parsedResponse, null, 2),
  );

  // BingX zwraca balances w response.data.balances
  if (parsedResponse && parsedResponse.data) {
    // Jeśli response.data.balances jest tablicą
    if (Array.isArray(parsedResponse.data.balances)) {
      console.log(
        `✅ BingX: Found ${parsedResponse.data.balances.length} balances in response.data.balances`,
      );
      // Loguj wszystkie salda (szczególnie USDC)
      parsedResponse.data.balances.forEach((b) => {
        const asset = b.asset || b.coin || b.currency;
        const free = parseFloat(b.free || b.available || "0");
        const locked = parseFloat(b.locked || b.freeze || b.frozen || "0");
        const total = free + locked;
        if (total > 0) {
          console.log(
            `💰 BingX balance: ${asset} = ${total} (free: ${free}, locked: ${locked})`,
          );
        }
      });
      return { balances: parsedResponse.data.balances };
    }
    // Jeśli response.data ma inne pole z tablicą (np. assets)
    if (Array.isArray(parsedResponse.data.assets)) {
      console.log(
        `✅ BingX: Found ${parsedResponse.data.assets.length} balances in response.data.assets`,
      );
      return { balances: parsedResponse.data.assets };
    }
    // Sprawdź wszystkie klucze w data
    const dataKeys = Object.keys(parsedResponse.data);
    console.log(`🔍 BingX response.data keys:`, dataKeys);
    for (const key of dataKeys) {
      if (
        Array.isArray(parsedResponse.data[key]) &&
        parsedResponse.data[key].length > 0
      ) {
        // Sprawdź czy pierwszy element ma pola asset/free/locked
        const firstItem = parsedResponse.data[key][0];
        if (
          firstItem &&
          (firstItem.asset || firstItem.coin || firstItem.currency)
        ) {
          console.log(
            `✅ BingX: Found ${parsedResponse.data[key].length} balances in response.data.${key}`,
          );
          return { balances: parsedResponse.data[key] };
        }
      }
    }
  }

  // Jeśli response ma balances bezpośrednio (fallback)
  if (Array.isArray(parsedResponse?.balances)) {
    console.log(
      `✅ BingX: Found ${parsedResponse.balances.length} balances in response.balances`,
    );
    return { balances: parsedResponse.balances };
  }

  // Loguj pełną odpowiedź jeśli nie znaleziono balances
  console.warn(
    `⚠️ BingX account/balance - nie znaleziono tablicy balances. Response type: ${typeof parsedResponse}, keys: ${Object.keys(parsedResponse || {}).join(", ")}`,
  );
  console.warn(`⚠️ Full response:`, JSON.stringify(parsedResponse, null, 2));

  // Zwróć pustą tablicę balances jeśli nie znaleziono
  return { balances: [] };
}

/**
 * Pobiera cenę dla konkretnego symbolu
 * GET /openApi/spot/v1/ticker/price?symbol=BTCUSDT
 * @param {string} symbol - Symbol pary (np. "BTCUSDT")
 * @returns {Promise<{symbol: string, price: string, priceChangePercent: number | null}>}
 */
export async function fetchSpotTickerPrice(symbol) {
  const result = await httpRequest("/openApi/spot/v1/ticker/price", {
    method: "GET",
    signed: false,
    query: { symbol },
  });

  // BingX zwraca: { code: 0, msg: "", data: { symbol: "BTCUSDT", price: "67000.0" } }
  // lub może być tablica: { code: 0, msg: "", data: [{ symbol: "BTCUSDT", price: "67000.0" }] }

  if (result) {
    // Jeśli result.data jest obiektem (pojedynczy ticker)
    if (
      result.data &&
      typeof result.data === "object" &&
      !Array.isArray(result.data)
    ) {
      return {
        symbol: result.data.symbol || symbol,
        price: result.data.price,
        priceChangePercent: null, // BingX price endpoint nie zwraca zmiany 24h
      };
    }
    // Jeśli result.data jest tablicą (wiele tickerów)
    if (Array.isArray(result.data) && result.data.length > 0) {
      const ticker =
        result.data.find((t) => t.symbol === symbol) || result.data[0];
      return {
        symbol: ticker.symbol || symbol,
        price: ticker.price,
        priceChangePercent: null,
      };
    }
    // Jeśli result jest bezpośrednio tickerem
    if (result.symbol && result.price) {
      return {
        symbol: result.symbol,
        price: result.price,
        priceChangePercent: null,
      };
    }
  }

  console.error(
    `❌ BingX fetchSpotTickerPrice - invalid response for ${symbol}:`,
    JSON.stringify(result, null, 2),
  );
  throw new Error(`Invalid response for ${symbol}`);
}

/**
 * Pobiera ticker 24h z lastPrice (jak w oficjalnym przykładzie BingX).
 * URI: /openApi/spot/v1/ticker/24hr, payload: { symbol: "BTC-USDT" }, signed.
 * URL: protocol+"://"+host+path+"?"+getParameters(..., true)+"&signature="+sign
 * @param {string} symbol - Symbol pary w formacie BingX (np. "BTC-USDT")
 * @param {string|null} walletAddress - adres portfela (do kluczy API)
 * @returns {Promise<{symbol: string, lastPrice: string, priceChangePercent: string|null}>}
 */
export async function fetch24hrTicker(symbol, walletAddress = null) {
  // Jeśli podano walletAddress → użyj kluczy usera (dla niestandardowych krypto).
  // Dla globalnych krypto (pasek górny) walletAddress = null → klucze z ENV.
  const result = await httpRequest("/openApi/spot/v1/ticker/24hr", {
    method: "GET",
    signed: true,
    walletAddress: walletAddress || null,
    query: { symbol },
  });

  if (result && result.data) {
    // BingX ticker/24hr zwraca data jako tablicę: [ { symbol, lastPrice, priceChangePercent, ... } ]
    const raw = result.data;
    const d = Array.isArray(raw) ? raw[0] : raw;
    if (d) {
      const price = d.lastPrice ?? d.lastPr ?? d.price;
      if (price != null) {
        return {
          symbol: d.symbol || symbol,
          lastPrice: String(price),
          priceChangePercent:
            d.priceChangePercent != null ? String(d.priceChangePercent) : null,
        };
      }
    }
  }
  console.error(
    `❌ BingX fetch24hrTicker - invalid response for ${symbol}:`,
    JSON.stringify(result, null, 2),
  );
  throw new Error(`Invalid response for ${symbol}`);
}

// BingX używa formatu "BTC-USDT" (z myślnikiem), nie "BTCUSDT"
// Domyślna lista symboli, jeśli exchangeInfo jest niedostępne
// (ograniczona do kilku głównych krypto, tak jak w UI)
// Globalne krypto pobierane z kluczy ENV na pasek górny
const BINGX_GLOBAL_BASES = ["BTC", "ETH", "BNB", "SOL", "XRP", "DOGE"];

const DEFAULT_TICKER_SYMBOLS = BINGX_GLOBAL_BASES.map((b) => `${b}-USDT`);

// Cache listy symboli, żeby nie pytać exchangeInfo przy każdym odświeżeniu cen
let cachedTickerSymbols = null;
let cachedTickerSymbolsAt = 0;
const TICKER_SYMBOLS_TTL_MS = 5 * 60 * 1000; // 5 minut

async function getTickerSymbols() {
  const now = Date.now();
  if (
    cachedTickerSymbols &&
    now - cachedTickerSymbolsAt < TICKER_SYMBOLS_TTL_MS
  ) {
    return cachedTickerSymbols;
  }

  try {
    const info = await fetchExchangeInfo();
    const symbols = Array.isArray(info?.symbols) ? info.symbols : [];

    // Interesują nas pary z USDT jako quote
    const usdtPairs = symbols.filter(
      (s) => s.quoteAsset && s.quoteAsset.toUpperCase() === "USDT",
    );

    // Ticker globalny (pasek górny) – tylko 6 globalnych krypto z kluczy ENV
    const filtered = usdtPairs.filter((s) =>
      BINGX_GLOBAL_BASES.includes((s.baseAsset || "").toUpperCase()),
    );

    if (filtered.length === 0) {
      // Jeśli z jakiegoś powodu nic nie znaleźliśmy – fallback do domyślnej listy
      cachedTickerSymbols = DEFAULT_TICKER_SYMBOLS;
      cachedTickerSymbolsAt = now;
      return DEFAULT_TICKER_SYMBOLS;
    }

    // Zwracamy tylko wybrane pary w formacie BingX (BTC-USDT itd.)
    const finalList = filtered.map((s) => toBingxSymbol(s.symbol));

    cachedTickerSymbols = finalList;
    cachedTickerSymbolsAt = now;
    return finalList;
  } catch (error) {
    console.warn(
      "⚠️ BingXService: failed to build ticker symbols from exchangeInfo, using defaults:",
      error.message,
    );
    cachedTickerSymbols = DEFAULT_TICKER_SYMBOLS;
    cachedTickerSymbolsAt = now;
    return DEFAULT_TICKER_SYMBOLS;
  }
}

/**
 * Zwraca ceny tylko dla wybranych kryptowalut.
 * Format: [{ symbol: "BTCUSDT", price: "94000.0", priceChangePercent: "2.45" }, ...]
 * Używa tego samego wzorca co w dokumentacji: GET z payload (symbol) + signed (timestamp, signature, X-BX-APIKEY).
 */
export async function fetchAllTickerPrices(walletAddress = null) {
  try {
    // Ustal listę symboli na podstawie exchangeInfo (z cache), z fallbackiem do domyślnej listy.
    const tickerSymbols = await getTickerSymbols();

    console.log(
      `📡 BingX: Starting to fetch prices for ${tickerSymbols.length} symbols (signed)`,
    );
    const prices = [];

    const batchPromises = tickerSymbols.map(async (symbol) => {
      try {
        const ticker24hr = await fetch24hrTicker(symbol, walletAddress);

        if (!ticker24hr || !ticker24hr.lastPrice) {
          console.warn(`⚠️ BingX: No price data for ${symbol}`);
          return null;
        }

        const price = ticker24hr.lastPrice;
        const priceChangePercent = ticker24hr.priceChangePercent
          ? parseFloat(ticker24hr.priceChangePercent)
          : null;

        // Konwertuj symbol z formatu BingX (BTC-USDT) na format używany w aplikacji (BTCUSDT)
        const normalizedSymbol = (ticker24hr.symbol || symbol).replace("-", "");

        const result = {
          symbol: normalizedSymbol, // Zwróć w formacie BTCUSDT dla kompatybilności
          price: price,
          priceChangePercent: priceChangePercent,
        };

        console.log(
          `✅ BingX: Got price for ${symbol} (normalized: ${normalizedSymbol}): ${price} (24h change: ${priceChangePercent !== null ? priceChangePercent + "%" : "N/A"})`,
        );
        return result;
      } catch (err) {
        console.error(`❌ Błąd ceny dla ${symbol} z BingX:`, err.message);
        // Nie loguj stack trace dla błędów API (są zbyt długie)
        return null;
      }
    });

    const results = await Promise.all(batchPromises);
    results.forEach((p) => {
      if (p !== null) prices.push(p);
    });

    console.log(
      `✅ Pobrano ${prices.length}/${tickerSymbols.length} cen z BingX API`,
    );

    if (prices.length === 0) {
      console.error(
        `❌ BingX: No prices fetched! Check API endpoints and response format.`,
      );
      console.error(`❌ BingX: Tried symbols: ${tickerSymbols.join(", ")}`);
    }

    return prices;
  } catch (error) {
    console.error(
      `❌ Błąd pobierania cen z BingX:`,
      error.message,
      error.stack,
    );
    throw error;
  }
}

/**
 * Składa zlecenie na giełdzie BingX
 * POST /openApi/spot/v1/trade/order
 * @param {Object} params - parametry zlecenia:
 *   - symbol: string (np. "BTCUSDT")
 *   - side: "BUY" | "SELL"
 *   - type: "MARKET" | "LIMIT"
 *   - quantity?: string (dla MARKET SELL lub LIMIT)
 *   - quoteOrderQty?: string (dla MARKET BUY)
 *   - price?: string (dla LIMIT)
 * @returns {Promise<Object>} - odpowiedź z giełdy
 */
/** Konwersja symbolu aplikacji (ETHUSDT) na format BingX (ETH-USDT). */
function toBingxSymbol(symbol) {
  if (!symbol || typeof symbol !== "string") return symbol;
  return symbol.replace(/^([A-Z0-9]+)(USDT)$/i, "$1-$2");
}

export async function placeOrder(params, walletAddress) {
  const bingxSymbol = toBingxSymbol(params.symbol || "");
  const queryParams = {
    symbol: bingxSymbol,
    side: params.side,
    type: params.type,
  };

  if (params.quantity) queryParams.quantity = params.quantity;
  if (params.quoteOrderQty) queryParams.quoteOrderQty = params.quoteOrderQty;
  if (params.price) queryParams.price = params.price;
  if (params.timeInForce) queryParams.timeInForce = params.timeInForce;
  if (params.newClientOrderId)
    queryParams.newClientOrderId = params.newClientOrderId;

  const result = await httpRequest("/openApi/spot/v1/trade/order", {
    method: "POST",
    query: queryParams,
    signed: true,
    walletAddress,
  });

  // Konwertuj odpowiedź BingX na format podobny do AsterDex
  if (result && result.data) {
    return {
      orderId: result.data.orderId || result.data.orderIdStr,
      status: result.data.status,
      executedQty:
        result.data.executedQty || result.data.cumulativeFilledQty || "0",
      avgPrice: result.data.avgPrice || result.data.price || "0",
    };
  }

  return result;
}

export default {
  init,
  fetchExchangeInfo,
  fetchAllTickerPrices,
  fetchSpotAccount,
  placeOrder,
};
