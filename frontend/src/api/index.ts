// Unified API - wszystko na jednym serwerze Node.js
// W produkcji używamy relatywnych URL-i (ten sam origin)
const API_URL = import.meta.env.VITE_API_URL || (
  typeof window !== 'undefined' && window.location.hostname !== 'localhost' 
    ? '' // Relative URL for production/ngrok
    : 'http://localhost:3001'
);
const AUTH_API = API_URL;
const TRADING_API = API_URL;

class ApiClient {
  private token: string | null = null;
  
  setToken(token: string | null) {
    this.token = token;
  }
  
  private async request<T>(
    baseUrl: string,
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>)
    };
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    
    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers,
      credentials: 'include'
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }
    
    return response.json();
  }
  
  // Auth API
  async getNonce(): Promise<{ nonce: string }> {
    return this.request(AUTH_API, '/auth/nonce');
  }
  
  async verify(message: string, signature: string): Promise<{ success: boolean; token: string; walletAddress: string }> {
    return this.request(AUTH_API, '/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ message, signature })
    });
  }
  
  async checkSession(): Promise<{ authenticated: boolean; walletAddress?: string }> {
    return this.request(AUTH_API, '/auth/session');
  }
  
  async logout(): Promise<void> {
    await this.request(AUTH_API, '/auth/logout', { method: 'POST' });
  }
  
  // Settings API
  async getSettings(): Promise<any> {
    return this.request(AUTH_API, '/settings');
  }
  
  async updateWallet(wallet: any[]): Promise<any> {
    return this.request(AUTH_API, '/settings/wallet', {
      method: 'PUT',
      body: JSON.stringify({ wallet })
    });
  }
  
  async getOrders(): Promise<any[]> {
    return this.request(AUTH_API, '/settings/orders');
  }
  
  async createOrder(order: any): Promise<any> {
    return this.request(AUTH_API, '/settings/orders', {
      method: 'POST',
      body: JSON.stringify(order)
    });
  }
  
  async updateOrder(orderId: string, updates: any): Promise<any> {
    return this.request(AUTH_API, '/settings/orders/' + orderId, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  }
  
  async deleteOrder(orderId: string): Promise<void> {
    await this.request(AUTH_API, '/settings/orders/' + orderId, {
      method: 'DELETE'
    });
  }
  
  // Trading API
  async initGrid(walletAddress: string, settings: any): Promise<any> {
    return this.request(TRADING_API, '/api/trading/grid/init', {
      method: 'POST',
      headers: { 'X-Wallet-Address': walletAddress },
      body: JSON.stringify(settings)
    });
  }
  
  async getGridState(walletAddress: string, orderId: string): Promise<any> {
    return this.request(TRADING_API, `/api/trading/grid/state/${orderId}`, {
      headers: { 'X-Wallet-Address': walletAddress }
    });
  }
  
  async startGrid(walletAddress: string, orderId: string): Promise<void> {
    await this.request(TRADING_API, `/api/trading/grid/start/${orderId}`, {
      method: 'POST',
      headers: { 'X-Wallet-Address': walletAddress }
    });
  }
  
  async stopGrid(walletAddress: string, orderId: string): Promise<void> {
    await this.request(TRADING_API, `/api/trading/grid/stop/${orderId}`, {
      method: 'POST',
      headers: { 'X-Wallet-Address': walletAddress }
    });
  }
  
  async getPositions(walletAddress: string, orderId: string): Promise<any[]> {
    return this.request(TRADING_API, `/api/trading/positions/${orderId}`, {
      headers: { 'X-Wallet-Address': walletAddress }
    });
  }
  
  async getPrices(): Promise<Record<string, number>> {
    return this.request(TRADING_API, '/api/trading/prices');
  }
  
  async setPrice(symbol: string, price: number): Promise<void> {
    await this.request(TRADING_API, `/api/trading/prices/${symbol}`, {
      method: 'POST',
      body: JSON.stringify({ price })
    });
  }
  
  async processPrice(walletAddress: string, orderId: string, settings: any, price: number): Promise<any> {
    return this.request(TRADING_API, `/api/trading/grid/process-price/${orderId}?price=${price}`, {
      method: 'POST',
      headers: { 'X-Wallet-Address': walletAddress },
      body: JSON.stringify(settings)
    });
  }
  
  // Wallet API
  async getWalletBalances(walletAddress: string): Promise<Record<string, string>> {
    return this.request(TRADING_API, '/api/trading/wallet/balances', {
      headers: { 'X-Wallet-Address': walletAddress }
    });
  }
  
  async setWalletBalance(walletAddress: string, currency: string, balance: number): Promise<void> {
    await this.request(TRADING_API, '/api/trading/wallet/balance', {
      method: 'POST',
      headers: { 'X-Wallet-Address': walletAddress },
      body: JSON.stringify({ currency, balance })
    });
  }
  
  // WebSocket for real-time prices
  connectPriceWebSocket(onPrice: (data: { symbol: string; price: string; timestamp: number }) => void): WebSocket {
    const wsUrl = API_URL.replace('http', 'ws') + '/ws/prices';
    const ws = new WebSocket(wsUrl);
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'price') {
        onPrice(message.data);
      } else if (message.type === 'prices') {
        // Initial prices
        Object.entries(message.data).forEach(([symbol, price]) => {
          onPrice({ symbol, price: price as string, timestamp: Date.now() });
        });
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    return ws;
  }
}

export const api = new ApiClient();
