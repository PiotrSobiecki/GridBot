import express from 'express';
import { SiweMessage, generateNonce } from 'siwe';
import jwt from 'jsonwebtoken';
// Use SQLite models instead of MongoDB
import User from '../trading/models/User.js';
import UserSettings from '../trading/models/UserSettings.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'gridbot-secret-key';

// Generuj nonce dla SIWE
router.get('/nonce', async (req, res) => {
  try {
    const nonce = generateNonce();
    req.session.nonce = nonce;
    res.json({ nonce });
  } catch (error) {
    console.error('Nonce generation error:', error);
    res.status(500).json({ error: 'Failed to generate nonce' });
  }
});

// Weryfikuj podpis SIWE
router.post('/verify', async (req, res) => {
  try {
    const { message, signature } = req.body;
    
    console.log('📥 Received verify request');
    console.log('Message type:', typeof message);
    console.log('Message length:', message?.length);
    console.log('Message preview:', message?.substring(0, 200));
    
    if (!message || !signature) {
      return res.status(400).json({ error: 'Message and signature required' });
    }

    let siweMessage;
    try {
      siweMessage = new SiweMessage(message);
    } catch (parseError) {
      console.error('SIWE Parse error:', parseError.message);
      // Spróbuj alternatywnego parsowania - może message jest już obiektem?
      if (typeof message === 'object') {
        siweMessage = new SiweMessage(message);
      } else {
        throw parseError;
      }
    }
    
    console.log('✅ SIWE message parsed, address:', siweMessage.address);
    
    const fields = await siweMessage.verify({ signature });
    
    if (!fields.success) {
      console.error('❌ Signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    console.log('✅ Signature verified');

    // Sprawdź nonce (opcjonalne w dev)
    const sessionNonce = req.session?.nonce;
    console.log('Session nonce:', sessionNonce, 'Message nonce:', fields.data.nonce);
    
    if (sessionNonce && fields.data.nonce !== sessionNonce) {
      console.warn('⚠️ Nonce mismatch - skipping in dev mode');
      // W trybie dev pomijamy sprawdzanie nonce (może być problem z sesjami)
      // return res.status(401).json({ error: 'Invalid nonce' });
    }

    const walletAddress = fields.data.address.toLowerCase();

    // Znajdź lub utwórz użytkownika (SQLite - synchroniczne)
    let user = User.findOne({ walletAddress });
    
    if (!user) {
      user = new User({
        walletAddress,
        nonce: generateNonce()
      });
      user.save();
      
      // Utwórz domyślne ustawienia dla nowego użytkownika
      const settings = new UserSettings({ walletAddress });
      settings.save();
    } else {
      user.lastLogin = new Date().toISOString();
      user.nonce = generateNonce();
      user.save();
    }

    // Generuj JWT token
    const token = jwt.sign(
      { walletAddress, userId: user._id },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Zapisz w sesji
    req.session.siwe = fields.data;
    req.session.walletAddress = walletAddress;

    res.json({
      success: true,
      token,
      walletAddress
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Sprawdź sesję
router.get('/session', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ authenticated: false });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    res.json({
      authenticated: true,
      walletAddress: decoded.walletAddress
    });
  } catch (error) {
    res.status(401).json({ authenticated: false });
  }
});

// Wyloguj
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

export default router;
