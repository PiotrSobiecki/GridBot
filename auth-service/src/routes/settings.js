import express from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
// Use SQLite model instead of MongoDB
import UserSettings from '../trading/models/UserSettings.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'gridbot-secret-key';

// Middleware autoryzacji
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.walletAddress = decoded.walletAddress;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Pobierz wszystkie ustawienia użytkownika
router.get('/', authMiddleware, (req, res) => {
  try {
    let settings = UserSettings.findOne({ walletAddress: req.walletAddress });
    
    if (!settings) {
      settings = new UserSettings({ walletAddress: req.walletAddress });
      settings.save();
    }
    
    res.json({
      walletAddress: settings.walletAddress,
      wallet: settings.wallet,
      orders: settings.orders
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Aktualizuj portfel
router.put('/wallet', authMiddleware, (req, res) => {
  try {
    const { wallet } = req.body;
    
    let settings = UserSettings.findOne({ walletAddress: req.walletAddress });
    
    if (!settings) {
      settings = new UserSettings({ walletAddress: req.walletAddress });
    }
    
    settings.wallet = wallet;
    settings.save();
    
    res.json(settings.wallet);
  } catch (error) {
    console.error('Update wallet error:', error);
    res.status(500).json({ error: 'Failed to update wallet' });
  }
});

// Pobierz wszystkie zlecenia
router.get('/orders', authMiddleware, (req, res) => {
  try {
    const settings = UserSettings.findOne({ walletAddress: req.walletAddress });
    res.json(settings?.orders || []);
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({ error: 'Failed to get orders' });
  }
});

// Dodaj nowe zlecenie
router.post('/orders', authMiddleware, (req, res) => {
  try {
    const orderData = req.body;
    
    let settings = UserSettings.findOne({ walletAddress: req.walletAddress });
    
    if (!settings) {
      settings = new UserSettings({ walletAddress: req.walletAddress });
    }
    
    // Ensure order has an ID
    if (!orderData.id) {
      orderData.id = uuidv4();
    }
    
    settings.orders.push(orderData);
    settings.save();
    
    res.json(orderData);
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Aktualizuj zlecenie
router.put('/orders/:orderId', authMiddleware, (req, res) => {
  try {
    const { orderId } = req.params;
    const updateData = req.body;
    
    let settings = UserSettings.findOne({ walletAddress: req.walletAddress });
    
    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }
    
    const orderIndex = settings.orders.findIndex(o => o.id === orderId);
    
    if (orderIndex === -1) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Merge update data with existing order
    settings.orders[orderIndex] = {
      ...settings.orders[orderIndex],
      ...updateData,
      id: orderId // Preserve the ID
    };
    
    settings.save();
    
    res.json(settings.orders[orderIndex]);
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

// Usuń zlecenie
router.delete('/orders/:orderId', authMiddleware, (req, res) => {
  try {
    const { orderId } = req.params;
    
    let settings = UserSettings.findOne({ walletAddress: req.walletAddress });
    
    if (!settings) {
      return res.status(404).json({ error: 'Settings not found' });
    }
    
    settings.orders = settings.orders.filter(o => o.id !== orderId);
    settings.save();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

// Pobierz historię transakcji (z pozycji w SQLite)
router.get('/transactions', authMiddleware, (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const { Position, PositionStatus } = require('../trading/models/Position.js');
    
    const positions = Position.findByWalletAndOrderId(req.walletAddress, null, PositionStatus.CLOSED);
    
    res.json({
      total: positions.length,
      transactions: positions.slice(offset, offset + parseInt(limit)).map(p => p.toJSON())
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: 'Failed to get transactions' });
  }
});

export default router;
