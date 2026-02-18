import crypto from "crypto";
import UserSettings from "../models/UserSettings.js";
import { decrypt } from "./CryptoService.js";

// Futures API dla cen (jak w asterbot) - zwraca więcej par niż spot
const FUTURES_BASE_URL = "https://fapi.asterdex.com";
// Spot API dla zleceń (jeśli będziemy używać spot)
const SPOT_BASE_URL = "https://sapi.asterdex.com";

// Funkcja do pobierania kluczy API (najpierw z bazy per portfel, potem z .env)
async function getApiKeys(walletAddress) {
  // 1) Spróbuj z bazy (apiConfig.aster) dla danego portfela
  if (walletAddress) {
    try {
      const settings = await UserSettings.findOne({
        walletAddress: walletAddress.toLowerCase(),
      });
      const apiConfig = settings?.apiConfig || {};
      const aster = apiConfig.aster || {};

      const apiKeyDecrypted = decrypt(
        aster.apiKeyEncrypted || aster.apiKey || null
      );
      const apiSecretDecrypted = decrypt(
        aster.apiSecretEncrypted || aster.apiSecret || null
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
        `⚠️ AsterSpotService: failed to load API keys from DB for wallet=${walletAddress}:`,
        e.message
      );
    }
  }

  // 2) Fallback do zmiennych środowiskowych (.env) – globalne klucze
  const API_KEY = process.env.API_KEY_ASTER;
  const API_SECRET = process.env.API_KEY_SECRET_ASTER;

  if (!API_KEY || !API_SECRET) {
    // Logi wyłączone - brak kluczy API jest normalny w trybie demo/bez realnego handlu
    return { API_KEY: null, API_SECRET: null, source: "env-missing" };
  }

  return { API_KEY, API_SECRET, source: "env" };
}

// Sprawdź klucze przy pierwszym użyciu (po załadowaniu .env, bez portfela)
let keysChecked = false;
async function checkKeysOnce() {
  if (!keysChecked) {
    const { API_KEY, API_SECRET } = await getApiKeys(null);
    if (API_KEY && API_SECRET) {
      console.log(
        "✅ AsterSpotService: API keys loaded successfully (signed endpoints enabled)"
      );
    }
    keysChecked = true;
  }
}

/**
 * Inicjalizuje serwis - sprawdza klucze API
 * Wywołaj to po załadowaniu .env
 */
export function init() {
  checkKeysOnce();
}

async function httpRequest(
  path,
  {
    method = "GET",
    query = {},
    signed = false,
    useFutures = false,
    walletAddress = null,
  } = {}
) {
  // Sprawdź klucze przy pierwszym użyciu (po załadowaniu .env)
  await checkKeysOnce();

  // Użyj futures API jeśli zaznaczone (dla cen), w przeciwnym razie spot API
  const baseUrl = useFutures ? FUTURES_BASE_URL : SPOT_BASE_URL;
  const url = new URL(path, baseUrl);

  const params = { ...query };

  if (signed) {
    const timestamp = Date.now();
    params.timestamp = timestamp;
  }

  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      search.append(key, String(value));
    }
  });

  if (signed) {
    const { API_KEY, API_SECRET } = await getApiKeys(walletAddress);
    if (!API_SECRET) {
      throw new Error("API_KEY_SECRET_ASTER not set - cannot sign request");
    }

    const payload = search.toString();
    const signature = crypto
      .createHmac("sha256", API_SECRET)
      .update(payload)
      .digest("hex");
    search.append("signature", signature);
  }

  url.search = search.toString();

  const headers = {};
  if (signed) {
    const { API_KEY } = await getApiKeys(walletAddress);
    if (API_KEY) {
      headers["X-MBX-APIKEY"] = API_KEY;
    }
  }

  const res = await fetch(url.toString(), { method, headers });

  // Odczytaj body tylko raz - użyj clone() jeśli potrzebujemy go wielokrotnie
  let responseBody;
  const contentType = res.headers.get("content-type") || "";
  
  try {
    if (contentType.includes("application/json")) {
      responseBody = await res.json();
    } else {
      responseBody = await res.text();
    }
  } catch (error) {
    console.error(`❌ AsterSpotService: Failed to parse response body for ${path}:`, error.message);
    throw new Error(`Failed to parse response: ${error.message}`);
  }

  if (!res.ok) {
    console.error(
      `❌ AsterSpotService ${method} ${path} failed: ${res.status} ${res.statusText}`,
      responseBody
    );
    throw new Error(
      responseBody?.msg || responseBody?.message || `AsterSpotService error ${res.status}`
    );
  }

  return responseBody;
}

/**
 * Zwraca pełne informacje o giełdzie i parach (exchangeInfo) - FUTURES
 */
export async function fetchFuturesExchangeInfo() {
  checkKeysOnce();
  return httpRequest("/fapi/v1/exchangeInfo", {
    method: "GET",
    signed: false,
    useFutures: true,
  });
}

/**
 * Zwraca pełne informacje o giełdzie i parach (exchangeInfo) - SPOT
 */
export async function fetchExchangeInfo() {
  checkKeysOnce(); // Sprawdź klucze przy pierwszym użyciu
  return httpRequest("/api/v1/exchangeInfo", { method: "GET", signed: false });
}

/**
 * Pobiera informacje o koncie SPOT (salda, uprawnienia itp.)
 * `GET /api/v1/account` (USER_DATA, HMAC SHA256)
 */
export async function fetchSpotAccount(walletAddress) {
  return httpRequest("/api/v1/account", {
    method: "GET",
    signed: true,
    walletAddress,
    // useFutures: false => domyślnie SPOT_BASE_URL
  });
}

/**
 * Pobiera cenę dla konkretnego symbolu z FUTURES API
 * @param {string} symbol - Symbol pary (np. "BTCUSDT")
 * @returns {Promise<{symbol: string, lastPrice: string}>}
 */
export async function fetchFuturesTickerPrice(symbol) {
  const result = await httpRequest("/fapi/v1/ticker/24hr", {
    method: "GET",
    signed: false,
    useFutures: true,
    query: { symbol },
  });
  return result;
}

/**
 * Pobiera cenę dla konkretnego symbolu z SPOT API
 * Używa endpointu /api/v1/ticker/price (zwraca tylko ostatnią cenę).
 * @param {string} symbol - Symbol pary (np. "BTCUSDT")
 * @returns {Promise<{symbol: string, price: string, priceChangePercent: number | null}>}
 */
export async function fetchSpotTickerPrice(symbol) {
  const result = await httpRequest("/api/v1/ticker/price", {
    method: "GET",
    signed: false,
    useFutures: false, // Użyj Spot API
    query: { symbol },
  });

  // Endpoint /api/v1/ticker/price zwraca { symbol, price, time } – bez zmiany 24h.
  // Dla spójności z PriceFeedService dodajemy pole priceChangePercent jako null.
  return {
    symbol: result.symbol,
    price: result.price,
    priceChangePercent: result.priceChangePercent ?? null,
  };
}

// Tylko te krypto pobieramy z API (zgodne z frontem: pasek + wybór BASE)
const TICKER_SYMBOLS = [
  "ASTERUSDT",
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
];

/**
 * Zwraca ceny tylko dla wybranych kryptowalut.
 * Ceny pobierane ze Spot API, zmiany cen (priceChangePercent) z Futures API (24h ticker).
 * Format: [{ symbol: "BTCUSDT", price: "94000.0", priceChangePercent: "2.45" }, ...]
 */
export async function fetchAllTickerPrices() {
  try {
    const prices = [];

    // Pobierz ceny ze Spot API i zmiany z Futures API równolegle
    const batchPromises = TICKER_SYMBOLS.map(async (symbol) => {
      try {
        // Pobierz cenę ze Spot API
        const spotTicker = await fetchSpotTickerPrice(symbol);
        
        if (!spotTicker || !spotTicker.price) {
          return null;
        }

        // Pobierz zmianę cen z Futures API (24h ticker)
        let priceChangePercent = null;
        try {
          const futuresTicker = await fetchFuturesTickerPrice(symbol);
          if (futuresTicker && futuresTicker.priceChangePercent != null) {
            priceChangePercent = parseFloat(futuresTicker.priceChangePercent);
          }
        } catch (futuresErr) {
          // Jeśli Futures API nie działa, zostaw priceChangePercent jako null
          // Cena ze Spot jest ważniejsza niż zmiana z Futures
        }

        return {
          symbol: spotTicker.symbol,
          price: spotTicker.price, // Cena ze Spot API
          priceChangePercent: priceChangePercent, // Zmiana z Futures API (24h)
        };
      } catch (err) {
        // Jeśli symbol nie jest dostępny na Spot API, spróbuj z Futures API jako fallback
        if (err.message && err.message.includes("Invalid symbol")) {
          try {
            console.warn(`⚠️ Symbol ${symbol} niedostępny na Spot API, próba z Futures API...`);
            const futuresTicker = await fetchFuturesTickerPrice(symbol);
            if (futuresTicker && futuresTicker.lastPrice) {
              return {
                symbol: futuresTicker.symbol,
                price: futuresTicker.lastPrice,
                priceChangePercent: futuresTicker.priceChangePercent != null
                  ? parseFloat(futuresTicker.priceChangePercent)
                  : null,
              };
            }
          } catch (futuresErr) {
            console.warn(`⚠️ Błąd ceny dla ${symbol} również z Futures API:`, futuresErr.message);
          }
        } else {
          console.warn(`⚠️ Błąd ceny dla ${symbol} ze Spot API:`, err.message);
        }
      }
      return null;
    });

    const results = await Promise.all(batchPromises);
    results.forEach((p) => {
      if (p !== null) prices.push(p);
    });

    console.log(
      `✅ Pobrano ${prices.length}/${TICKER_SYMBOLS.length} cen (Spot API) + zmiany (Futures API)`
    );
    return prices;
  } catch (error) {
    console.error(
      `❌ Błąd pobierania cen:`,
      error.message,
      error.stack
    );
    throw error;
  }
}

/**
 * Składa zlecenie na giełdzie (TRADE endpoint - wymaga podpisu)
 * @param {Object} params - parametry zlecenia:
 *   - symbol: string (np. "BTCUSDC")
 *   - side: "BUY" | "SELL"
 *   - type: "MARKET" | "LIMIT" | ...
 *   - quantity?: string (dla MARKET SELL lub LIMIT)
 *   - quoteOrderQty?: string (dla MARKET BUY)
 *   - price?: string (dla LIMIT)
 *   - timeInForce?: "GTC" | "IOC" | "FOK" (dla LIMIT)
 * @returns {Promise<Object>} - odpowiedź z giełdy (orderId, status, executedQty, avgPrice, etc.)
 */
export async function placeOrder(params, walletAddress) {
  const queryParams = {
    symbol: params.symbol,
    side: params.side,
    type: params.type,
  };

  if (params.quantity) queryParams.quantity = params.quantity;
  if (params.quoteOrderQty) queryParams.quoteOrderQty = params.quoteOrderQty;
  if (params.price) queryParams.price = params.price;
  if (params.timeInForce) queryParams.timeInForce = params.timeInForce;
  if (params.newClientOrderId)
    queryParams.newClientOrderId = params.newClientOrderId;
  if (params.recvWindow) queryParams.recvWindow = params.recvWindow;

  return httpRequest("/api/v1/order", {
    method: "POST",
    query: queryParams,
    signed: true,
    walletAddress,
  });
}

export default {
  init,
  fetchExchangeInfo,
  fetchAllTickerPrices,
  fetchSpotAccount,
  placeOrder,
};
