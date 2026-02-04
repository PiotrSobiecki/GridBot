import express from 'express';
import Decimal from 'decimal.js';
import * as GridAlgorithmService from '../trading/services/GridAlgorithmService.js';
import * as PriceFeedService from '../trading/services/PriceFeedService.js';
import * as WalletService from '../trading/services/WalletService.js';
import * as GridSchedulerService from '../trading/services/GridSchedulerService.js';
import UserSettings from '../models/UserSettings.js';

const router = express.Router();

/**
 * Inicjalizuje algorytm GRID dla zlecenia
 */
router.post('/grid/init', async (req, res) => {
  try {
    const walletAddress = req.headers['x-wallet-address'];
    const settings = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Missing X-Wallet-Address header' });
    }
    
    console.log(`🚀 Initializing GRID for wallet ${walletAddress} with order ${settings.id}`);
    
    const state = GridAlgorithmService.initializeGridState(walletAddress, settings);
    res.json(state.toJSON());
  } catch (error) {
    console.error('Error initializing grid:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Pobiera stan algorytmu GRID
 */
router.get('/grid/state/:orderId', (req, res) => {
  try {
    const walletAddress = req.headers['x-wallet-address'];
    const { orderId } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Missing X-Wallet-Address header' });
    }
    
    const state = GridAlgorithmService.getGridState(walletAddress, orderId);
    
    if (!state) {
      return res.status(404).json({ error: 'Grid state not found' });
    }
    
    res.json(state.toJSON());
  } catch (error) {
    console.error('Error getting grid state:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Pobiera wszystkie stany GRID dla portfela
 */
router.get('/grid/states', (req, res) => {
  try {
    const walletAddress = req.headers['x-wallet-address'];
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Missing X-Wallet-Address header' });
    }
    
    const { GridState } = require('../trading/models/GridState.js');
    const states = GridState.findAllByWallet(walletAddress);
    
    res.json(states.map(s => s.toJSON()));
  } catch (error) {
    console.error('Error getting grid states:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Uruchamia algorytm GRID
 */
router.post('/grid/start/:orderId', (req, res) => {
  try {
    const walletAddress = req.headers['x-wallet-address'];
    const { orderId } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Missing X-Wallet-Address header' });
    }
    
    console.log(`▶️ Starting GRID for wallet ${walletAddress} order ${orderId}`);
    GridAlgorithmService.startGrid(walletAddress, orderId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error starting grid:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Zatrzymuje algorytm GRID
 */
router.post('/grid/stop/:orderId', (req, res) => {
  try {
    const walletAddress = req.headers['x-wallet-address'];
    const { orderId } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Missing X-Wallet-Address header' });
    }
    
    console.log(`⏹️ Stopping GRID for wallet ${walletAddress} order ${orderId}`);
    GridAlgorithmService.stopGrid(walletAddress, orderId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error stopping grid:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Pobiera otwarte pozycje dla zlecenia
 */
router.get('/positions/:orderId', (req, res) => {
  try {
    const walletAddress = req.headers['x-wallet-address'];
    const { orderId } = req.params;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Missing X-Wallet-Address header' });
    }
    
    const positions = GridAlgorithmService.getOpenPositions(walletAddress, orderId);
    res.json(positions.map(p => p.toJSON()));
  } catch (error) {
    console.error('Error getting positions:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Oblicza następny cel zakupu (preview)
 */
router.post('/grid/calculate-buy-target', (req, res) => {
  try {
    const { focusPrice, trend } = req.query;
    const settings = req.body;
    
    const fp = new Decimal(focusPrice);
    const t = parseInt(trend);
    
    const target = GridAlgorithmService.calculateNextBuyTarget(fp, t, settings);
    
    res.json({
      focusPrice: fp.toString(),
      trend: t,
      targetPrice: target.toString()
    });
  } catch (error) {
    console.error('Error calculating buy target:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Oblicza następny cel sprzedaży (preview)
 */
router.post('/grid/calculate-sell-target', (req, res) => {
  try {
    const { focusPrice, trend } = req.query;
    const settings = req.body;
    
    const fp = new Decimal(focusPrice);
    const t = parseInt(trend);
    
    const target = GridAlgorithmService.calculateNextSellTarget(fp, t, settings);
    
    res.json({
      focusPrice: fp.toString(),
      trend: t,
      targetPrice: target.toString()
    });
  } catch (error) {
    console.error('Error calculating sell target:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Pobiera aktualne ceny
 */
router.get('/prices', (req, res) => {
  res.json(PriceFeedService.getAllPrices());
});

/**
 * Pobiera cenę dla konkretnego symbolu
 */
router.get('/prices/:symbol', (req, res) => {
  const { symbol } = req.params;
  const price = PriceFeedService.getPrice(symbol);
  const stale = PriceFeedService.isPriceStale(symbol);
  
  res.json({
    symbol: symbol.toUpperCase(),
    price: price.toString(),
    stale
  });
});

/**
 * Ręcznie ustawia cenę (dla testów/symulacji)
 */
router.post('/prices/:symbol', (req, res) => {
  const { symbol } = req.params;
  const { price } = req.body;
  
  PriceFeedService.setPrice(symbol, price);
  res.json({ success: true });
});

/**
 * Ręcznie wywołuje przetworzenie ceny (dla testów)
 */
router.post('/grid/process-price/:orderId', async (req, res) => {
  try {
    const walletAddress = req.headers['x-wallet-address'];
    const { orderId } = req.params;
    const { price } = req.query;
    const settings = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Missing X-Wallet-Address header' });
    }
    
    GridAlgorithmService.processPrice(walletAddress, orderId, new Decimal(price), settings);
    
    const state = GridAlgorithmService.getGridState(walletAddress, orderId);
    res.json(state ? state.toJSON() : null);
  } catch (error) {
    console.error('Error processing price:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ WALLET API ============

/**
 * Pobiera salda portfela
 */
router.get('/wallet/balances', (req, res) => {
  try {
    const walletAddress = req.headers['x-wallet-address'];
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Missing X-Wallet-Address header' });
    }
    
    const balances = WalletService.getAllBalances(walletAddress);
    res.json(balances);
  } catch (error) {
    console.error('Error getting balances:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Ustawia saldo (dla testów)
 */
router.post('/wallet/balance', (req, res) => {
  try {
    const walletAddress = req.headers['x-wallet-address'];
    const { currency, balance } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Missing X-Wallet-Address header' });
    }
    
    WalletService.setBalance(walletAddress, currency, new Decimal(balance));
    res.json({ success: true });
  } catch (error) {
    console.error('Error setting balance:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Synchronizuje salda z zewnętrznego źródła
 */
router.post('/wallet/sync', (req, res) => {
  try {
    const walletAddress = req.headers['x-wallet-address'];
    const balances = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Missing X-Wallet-Address header' });
    }
    
    WalletService.syncBalances(walletAddress, balances);
    res.json({ success: true });
  } catch (error) {
    console.error('Error syncing balances:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
