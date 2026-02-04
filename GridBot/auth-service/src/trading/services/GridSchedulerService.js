import cron from 'node-cron';
import Decimal from 'decimal.js';
import { GridState } from '../models/GridState.js';
import * as GridAlgorithmService from './GridAlgorithmService.js';
import * as PriceFeedService from './PriceFeedService.js';
// Use SQLite model instead of MongoDB
import UserSettings from '../models/UserSettings.js';

/**
 * Serwis schedulera do automatycznego przetwarzania zleceń GRID
 */

let schedulerTask = null;
let isProcessing = false;

/**
 * Uruchamia scheduler
 */
export function start() {
  if (schedulerTask) {
    console.log('⚠️ Scheduler already running');
    return;
  }
  
  // Uruchom co 5 sekund
  schedulerTask = cron.schedule('*/5 * * * * *', () => {
    if (isProcessing) return;
    
    try {
      isProcessing = true;
      processActiveOrders();
    } catch (error) {
      console.error('❌ Scheduler error:', error.message);
    } finally {
      isProcessing = false;
    }
  });
  
  console.log('✅ Grid Scheduler started (every 5 seconds)');
}

/**
 * Zatrzymuje scheduler
 */
export function stop() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    console.log('⏹️ Grid Scheduler stopped');
  }
}

/**
 * Przetwarza wszystkie aktywne zlecenia
 */
function processActiveOrders() {
  const activeStates = GridState.findAllActive();
  
  for (const state of activeStates) {
    try {
      processOrder(state);
    } catch (error) {
      console.error(`❌ Error processing order ${state.orderId}:`, error.message);
    }
  }
}

/**
 * Przetwarza pojedyncze zlecenie
 */
function processOrder(state) {
  // Pobierz ustawienia zlecenia
  const settings = getOrderSettings(state.walletAddress, state.orderId);
  
  if (!settings) {
    console.warn(`⚠️ Settings not found for order ${state.orderId}`);
    return;
  }
  
  // Pobierz aktualną cenę
  const sellCurrency = settings.sell?.currency || 'BTC';
  const symbol = sellCurrency + 'USDT';
  const currentPrice = PriceFeedService.getPrice(symbol);
  
  if (currentPrice.eq(0)) {
    console.warn(`⚠️ Price not available for ${symbol}`);
    return;
  }
  
  // Przetwórz cenę
  GridAlgorithmService.processPrice(
    state.walletAddress,
    state.orderId,
    currentPrice,
    settings
  );
}

/**
 * Pobiera ustawienia zlecenia z SQLite
 */
function getOrderSettings(walletAddress, orderId) {
  try {
    const userSettings = UserSettings.findOne({ walletAddress: walletAddress.toLowerCase() });
    
    if (!userSettings || !userSettings.orders) {
      return null;
    }
    
    const order = userSettings.orders.find(o => o.id === orderId);
    return order || null;
  } catch (error) {
    console.error('Error fetching settings:', error.message);
    return null;
  }
}

/**
 * Ręcznie przetwarza cenę dla zlecenia (do testów)
 */
export function manualProcess(walletAddress, orderId, price) {
  const settings = getOrderSettings(walletAddress, orderId);
  
  if (!settings) {
    throw new Error(`Settings not found for order ${orderId}`);
  }
  
  return GridAlgorithmService.processPrice(walletAddress, orderId, new Decimal(price), settings);
}

export default {
  start,
  stop,
  manualProcess
};
