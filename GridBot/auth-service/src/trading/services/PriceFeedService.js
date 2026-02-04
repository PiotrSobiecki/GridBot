import WebSocket from 'ws';
import Decimal from 'decimal.js';

/**
 * Serwis do pobierania cen w czasie rzeczywistym
 */

const SIMULATION_MODE = process.env.SIMULATION_MODE !== 'false';
const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws';

// Aktualne ceny: symbol -> price
const currentPrices = new Map();
const lastUpdateTime = new Map();

// Symulowane ceny początkowe
const SIMULATED_PRICES = {
  BTCUSDT: '94000',
  ETHUSDT: '3200',
  DOGEUSDT: '0.35',
  SOLUSDT: '180'
};

// WebSocket klienci do broadcastowania cen
const wsClients = new Set();

let binanceWs = null;
let simulationInterval = null;

/**
 * Inicjalizuje serwis cen
 */
export function init(wss) {
  if (SIMULATION_MODE) {
    console.log('🎮 Price feed running in SIMULATION mode');
    Object.entries(SIMULATED_PRICES).forEach(([symbol, price]) => {
      currentPrices.set(symbol, new Decimal(price));
      lastUpdateTime.set(symbol, Date.now());
    });
    startSimulation();
  } else {
    console.log('📡 Connecting to Binance WebSocket...');
    connectToBinance();
  }
  
  // Obsługa WebSocket klientów
  if (wss) {
    wss.on('connection', (ws) => {
      wsClients.add(ws);
      console.log('📱 New price feed client connected');
      
      // Wyślij aktualne ceny
      ws.send(JSON.stringify({
        type: 'prices',
        data: getAllPrices()
      }));
      
      ws.on('close', () => {
        wsClients.delete(ws);
      });
    });
  }
}

/**
 * Łączy się z WebSocket Binance
 */
function connectToBinance() {
  try {
    const streams = 'btcusdt@trade/ethusdt@trade/dogeusdt@trade/solusdt@trade';
    const url = `${BINANCE_WS_URL}/${streams}`;
    
    binanceWs = new WebSocket(url);
    
    binanceWs.on('open', () => {
      console.log('✅ Connected to Binance WebSocket');
    });
    
    binanceWs.on('message', (data) => {
      processMessage(data.toString());
    });
    
    binanceWs.on('close', (code, reason) => {
      console.warn(`⚠️ WebSocket closed: ${code} - ${reason}`);
      if (code !== 1000) {
        setTimeout(connectToBinance, 5000);
      }
    });
    
    binanceWs.on('error', (error) => {
      console.error('❌ WebSocket error:', error.message);
    });
  } catch (error) {
    console.error('❌ Failed to connect to WebSocket:', error.message);
    // Fallback do symulacji
    Object.entries(SIMULATED_PRICES).forEach(([symbol, price]) => {
      currentPrices.set(symbol, new Decimal(price));
      lastUpdateTime.set(symbol, Date.now());
    });
    startSimulation();
  }
}

/**
 * Przetwarza wiadomość z WebSocket
 */
function processMessage(message) {
  try {
    const json = JSON.parse(message);
    
    if (json.s && json.p) {
      const symbol = json.s;
      const price = new Decimal(json.p);
      
      currentPrices.set(symbol, price);
      lastUpdateTime.set(symbol, Date.now());
      
      broadcastPrice(symbol, price);
    }
  } catch (error) {
    console.error('Error processing message:', error.message);
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
      
      const decimals = symbol.includes('DOGE') ? 5 : 2;
      const roundedPrice = newPrice.toDecimalPlaces(decimals);
      
      currentPrices.set(symbol, roundedPrice);
      lastUpdateTime.set(symbol, Date.now());
      
      broadcastPrice(symbol, roundedPrice);
    });
  }, 2000);
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
    type: 'price',
    data: {
      symbol,
      price: price.toString(),
      timestamp: Date.now()
    }
  });
  
  wsClients.forEach(client => {
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
 * Pobiera wszystkie aktualne ceny
 */
export function getAllPrices() {
  const result = {};
  currentPrices.forEach((price, symbol) => {
    result[symbol] = price.toString();
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
  if (binanceWs) {
    binanceWs.close(1000, 'Shutting down');
  }
}

export default {
  init,
  getPrice,
  getAllPrices,
  isPriceStale,
  setPrice,
  cleanup,
  stopSimulation
};
