import WebSocket from "ws";
import Decimal from "decimal.js";
import * as AsterSpotService from "./AsterSpotService.js";

/**
 * Serwis do pobierania cen w czasie rzeczywistym
 * Działa wyłącznie na AsterDex spot API
 */

// Tryb symulacji: włączony tylko gdy SIMULATION_MODE === "true"
// Domyślnie (brak zmiennej) = FAŁSZ => używamy prawdziwych cen
const SIMULATION_MODE = process.env.SIMULATION_MODE === "false";
const USE_ASTER_SPOT = process.env.USE_ASTER_SPOT === "true";

// Aktualne ceny: symbol -> price
const currentPrices = new Map();
// Zmiana ceny z 24h: symbol -> priceChangePercent (liczba)
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
      "📡 Price feed from Aster – odświeżanie przy cyku schedulera (refreshInterval z zleceń)",
    );
    AsterSpotService.init();
    refreshFromAster();
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
 * Odświeża ceny z Aster (eksportowane – wywoływane z GridSchedulerService przy każdym cyku).
 */
export async function refreshFromAster() {
  return _refreshFromAster();
}

async function _refreshFromAster() {
  try {
    const tickers = await AsterSpotService.fetchAllTickerPrices();
    const now = Date.now();

    if (!Array.isArray(tickers)) {
      console.error(
        "❌ Aster API zwróciło nie-tablicę:",
        typeof tickers,
      );
      return;
    }

    let loadedCount = 0;
    tickers.forEach((t) => {
      if (!t.symbol || !t.price) return;
      const symbol = String(t.symbol).toUpperCase();
      try {
        const priceDec = new Decimal(t.price);
        if (priceDec.gt(0)) {
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

    if (loadedCount > 0 && process.env.GRID_DEBUG_CONDITIONS) {
      const sampleSymbols = Array.from(currentPrices.keys())
        .slice(0, 3)
        .map((s) => `${s}=${currentPrices.get(s).toString()}`)
        .join(", ");
      console.log(`📋 Ceny: ${sampleSymbols}`);
    }
  } catch (error) {
    console.error(
      "❌ Failed to refresh prices from Aster:",
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
 * Pobiera aktualną cenę dla symbolu
 */
export function getPrice(symbol) {
  const price = currentPrices.get(symbol.toUpperCase());
  return price || new Decimal(0);
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
