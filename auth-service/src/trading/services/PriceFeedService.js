import WebSocket from "ws";
import Decimal from "decimal.js";
import * as AsterSpotService from "./AsterSpotService.js";
import * as BingXService from "./BingXService.js";
import UserSettings from "../models/UserSettings.js";

/**
 * Serwis do pobierania cen w czasie rzeczywistym
 * Działa na wybranej giełdzie (AsterDex lub BingX)
 */

// Tryb symulacji: włączony tylko gdy SIMULATION_MODE === "true"
// Domyślnie (brak zmiennej) = FAŁSZ => używamy prawdziwych cen
const SIMULATION_MODE = process.env.SIMULATION_MODE === "false";
const USE_ASTER_SPOT = process.env.USE_ASTER_SPOT === "true";

// Aktualne ceny per giełda: exchange -> Map<symbol, price>
const currentPricesByExchange = new Map(); // exchange -> Map<symbol, price>
// Zmiana ceny z 24h per giełda: exchange -> Map<symbol, priceChangePercent>
const priceChangesByExchange = new Map(); // exchange -> Map<symbol, number>
const lastUpdateTimeByExchange = new Map(); // exchange -> Map<symbol, timestamp>

// Dla kompatybilności wstecznej - globalne mapy (używają najnowszych cen)
const currentPrices = new Map();
const priceChanges = new Map();
const lastUpdateTime = new Map();

// Symulowane ceny początkowe
const SIMULATED_PRICES = {
  BTCUSDT: "94000",
  ETHUSDT: "3200",
  DOGEUSDT: "0.35",
  SOLUSDT: "180",
};

// WebSocket klienci do broadcastowania cen
const wsClients = new Set();

let simulationInterval = null;
let asterInterval = null;

/**
 * Inicjalizuje serwis cen.
 * Ceny z Aster odświeżane przy każdym cyku schedulera (zgodnie z refreshInterval z każdego zlecenia w bazie).
 */
export function init(wss) {
  if (SIMULATION_MODE) {
    console.log("🎮 Price feed running in SIMULATION mode");
    Object.entries(SIMULATED_PRICES).forEach(([symbol, price]) => {
      currentPrices.set(symbol, new Decimal(price));
      lastUpdateTime.set(symbol, Date.now());
    });
    startSimulation();
  } else {
    console.log(
      "📡 Price feed – odświeżanie przy cyku schedulera (refreshInterval z zleceń)",
    );
    AsterSpotService.init();
    BingXService.init();
    // Nie pobieramy cen tutaj - scheduler będzie je pobierał dla każdego portfela z jego giełdy
  }

  // Obsługa WebSocket klientów
  if (wss) {
    wss.on("connection", (ws) => {
      wsClients.add(ws);
      console.log("📱 New price feed client connected");

      // Wyślij aktualne ceny
      ws.send(
        JSON.stringify({
          type: "prices",
          data: getAllPrices(),
        }),
      );

      ws.on("close", () => {
        wsClients.delete(ws);
      });
    });
  }
}

/**
 * Symuluje zmiany cen
 */
function startSimulation() {
  if (simulationInterval) return;

  simulationInterval = setInterval(() => {
    currentPrices.forEach((price, symbol) => {
      // Losowa zmiana -0.5% do +0.5%
      const changePercent = (Math.random() - 0.5) * 0.01;
      const newPrice = price.mul(Decimal.add(1, changePercent));

      const decimals = symbol.includes("DOGE") ? 5 : 2;
      const roundedPrice = newPrice.toDecimalPlaces(decimals);

      currentPrices.set(symbol, roundedPrice);
      lastUpdateTime.set(symbol, Date.now());

      broadcastPrice(symbol, roundedPrice);
    });
  }, 2000);
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
 * Odświeża ceny z wybranej giełdy (eksportowane – wywoływane z GridSchedulerService przy każdym cyku).
 * @param {string} walletAddress - adres portfela (do określenia giełdy)
 * @param {string} exchange - opcjonalna giełda ("asterdex" lub "bingx"), ma priorytet nad UserSettings.exchange
 */
export async function refreshFromAster(walletAddress = null, exchange = null) {
  return _refreshFromExchange(walletAddress, exchange);
}

async function _refreshFromExchange(walletAddress = null, forcedExchange = null) {
  try {
    if (!walletAddress) {
      console.warn(`⚠️ refreshFromExchange called without walletAddress - skipping`);
      return;
    }
    
    // Jeśli podano forcedExchange, użyj go (z zlecenia), w przeciwnym razie pobierz z UserSettings
    let exchange = forcedExchange;
    if (!exchange) {
      exchange = await getExchange(walletAddress);
    }
    
    const exchangeService = exchange === "bingx" ? BingXService : AsterSpotService;
    const exchangeName = exchange === "bingx" ? "BingX" : "AsterDex";
    
    console.log(`📡 Fetching prices from ${exchangeName} API (wallet: ${walletAddress}, exchange: ${exchange}${forcedExchange ? " [from order]" : " [from UserSettings]"})`);
    
    const tickers = await exchangeService.fetchAllTickerPrices(walletAddress);
    const now = Date.now();

    if (!Array.isArray(tickers)) {
      console.error(
        `❌ ${exchangeName} API zwróciło nie-tablicę:`,
        typeof tickers,
      );
      return;
    }

    // Inicjalizuj mapy dla tej giełdy jeśli nie istnieją
    if (!currentPricesByExchange.has(exchange)) {
      currentPricesByExchange.set(exchange, new Map());
      priceChangesByExchange.set(exchange, new Map());
      lastUpdateTimeByExchange.set(exchange, new Map());
    }

    const exchangePrices = currentPricesByExchange.get(exchange);
    const exchangeChanges = priceChangesByExchange.get(exchange);
    const exchangeUpdateTimes = lastUpdateTimeByExchange.get(exchange);

    let loadedCount = 0;
    tickers.forEach((t) => {
      if (!t.symbol || !t.price) return;
      const symbol = String(t.symbol).toUpperCase();
      try {
        const priceDec = new Decimal(t.price);
        if (priceDec.gt(0)) {
          // Zapisz per giełda
          exchangePrices.set(symbol, priceDec);
          if (
            t.priceChangePercent != null &&
            !isNaN(parseFloat(t.priceChangePercent))
          ) {
            exchangeChanges.set(symbol, parseFloat(t.priceChangePercent));
          }
          exchangeUpdateTimes.set(symbol, now);
          
          // Dla kompatybilności wstecznej - aktualizuj też globalne mapy
          currentPrices.set(symbol, priceDec);
          if (
            t.priceChangePercent != null &&
            !isNaN(parseFloat(t.priceChangePercent))
          ) {
            priceChanges.set(symbol, parseFloat(t.priceChangePercent));
          }
          lastUpdateTime.set(symbol, now);
          
          broadcastPrice(symbol, priceDec);
          loadedCount++;
        }
      } catch (err) {
        // ignoruj błąd parsowania
      }
    });

    if (loadedCount > 0) {
      console.log(`✅ Loaded ${loadedCount} prices from ${exchangeName} API`);
      if (process.env.GRID_DEBUG_CONDITIONS) {
        const sampleSymbols = Array.from(exchangePrices.keys())
          .slice(0, 3)
          .map((s) => `${s}=${exchangePrices.get(s).toString()}`)
          .join(", ");
        console.log(`📋 ${exchangeName} prices: ${sampleSymbols}`);
      }
    }
  } catch (error) {
    const exchange = await getExchange(walletAddress);
    const exchangeName = exchange === "bingx" ? "BingX" : "AsterDex";
    console.error(
      `❌ Failed to refresh prices from ${exchangeName}:`,
      error.message,
    );
  }
}

/**
 * Zatrzymuje symulację
 */
export function stopSimulation() {
  if (simulationInterval) {
    clearInterval(simulationInterval);
    simulationInterval = null;
  }
}

/**
 * Wysyła cenę przez WebSocket do wszystkich klientów
 */
function broadcastPrice(symbol, price) {
  const data = JSON.stringify({
    type: "price",
    data: {
      symbol,
      price: price.toString(),
      timestamp: Date.now(),
    },
  });

  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

/**
 * Pobiera aktualną cenę dla symbolu (z wybranej giełdy lub globalnie)
 * @param {string} symbol - symbol pary (np. "BTCUSDT")
 * @param {string} walletAddress - adres portfela (opcjonalnie, do określenia giełdy)
 * @returns {Promise<Decimal>} - cena jako Decimal
 */
export async function getPrice(symbol, walletAddress = null) {
  if (walletAddress) {
    try {
      const exchange = await getExchange(walletAddress);
      const exchangePrices = currentPricesByExchange.get(exchange);
      if (exchangePrices) {
        const price = exchangePrices.get(symbol.toUpperCase());
        if (price) return price;
      }
    } catch (e) {
      // Fallback do globalnych cen
    }
  }
  
  // Fallback: użyj globalnych cen (kompatybilność wsteczna)
  const price = currentPrices.get(symbol.toUpperCase());
  return price || new Decimal(0);
}

/**
 * Synchronous version dla kompatybilności wstecznej
 * Używa globalnych cen (najnowsze z dowolnej giełdy)
 */
export function getPriceSync(symbol) {
  const price = currentPrices.get(symbol.toUpperCase());
  return price || new Decimal(0);
}

/**
 * Pobiera cenę dla symbolu z konkretnej giełdy (synchronous)
 */
export function getPriceForExchange(symbol, exchange = "asterdex") {
  const exchangePrices = currentPricesByExchange.get(exchange);
  if (exchangePrices) {
    const price = exchangePrices.get(symbol.toUpperCase());
    if (price) return price;
  }
  // Fallback do globalnych cen
  return getPriceSync(symbol);
}

/**
 * Pobiera wszystkie aktualne ceny wraz z zmianą z 24h
 */
export function getAllPrices() {
  const result = {};
  currentPrices.forEach((price, symbol) => {
    const change24h = priceChanges.get(symbol);
    result[symbol] = {
      price: price.toString(),
      priceChangePercent: change24h != null ? change24h : null,
    };
  });
  return result;
}

/**
 * Sprawdza czy cena jest aktualna (nie starsza niż 30 sekund)
 */
export function isPriceStale(symbol) {
  const lastUpdate = lastUpdateTime.get(symbol.toUpperCase());
  if (!lastUpdate) return true;
  return Date.now() - lastUpdate > 30000;
}

/**
 * Ustawia cenę ręcznie (dla testów)
 */
export function setPrice(symbol, price) {
  const sym = symbol.toUpperCase();
  const priceDec = new Decimal(price);
  currentPrices.set(sym, priceDec);
  lastUpdateTime.set(sym, Date.now());
  broadcastPrice(sym, priceDec);
}

/**
 * Zamyka połączenia
 */
export function cleanup() {
  stopSimulation();
  if (asterInterval) {
    clearInterval(asterInterval);
    asterInterval = null;
  }
}

export default {
  init,
  getPrice,
  getAllPrices,
  isPriceStale,
  setPrice,
  refreshFromAster,
  cleanup,
  stopSimulation,
};
