// Unified API - wszystko na jednym serwerze Node.js
// W produkcji używamy relatywnych URL-i (ten sam origin)
const API_URL =
  import.meta.env.VITE_API_URL ||
  (typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? "" // Relative URL for production/ngrok
    : "http://localhost:3001");
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
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers,
      credentials: "include",
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: "Request failed" }));
      throw new Error(error.error || "Request failed");
    }

    return response.json();
  }

  // Auth API
  async getNonce(): Promise<{ nonce: string }> {
    return this.request(AUTH_API, "/auth/nonce");
  }

  async verify(
    message: string,
    signature: string
  ): Promise<{ success: boolean; token: string; walletAddress: string }> {
    return this.request(AUTH_API, "/auth/verify", {
      method: "POST",
      body: JSON.stringify({ message, signature }),
    });
  }

  async checkSession(): Promise<{
    authenticated: boolean;
    walletAddress?: string;
  }> {
    return this.request(AUTH_API, "/auth/session");
  }

  async logout(): Promise<void> {
    await this.request(AUTH_API, "/auth/logout", { method: "POST" });
  }

  // Settings API
  async getSettings(): Promise<any> {
    return this.request(AUTH_API, "/settings");
  }

  async updateWallet(wallet: any[]): Promise<any> {
    return this.request(AUTH_API, "/settings/wallet", {
      method: "PUT",
      body: JSON.stringify({ wallet }),
    });
  }

  async getOrders(): Promise<any[]> {
    return this.request(AUTH_API, "/settings/orders");
  }

  async createOrder(order: any): Promise<any> {
    return this.request(AUTH_API, "/settings/orders", {
      method: "POST",
      body: JSON.stringify(order),
    });
  }

  async updateOrder(orderId: string, updates: any): Promise<any> {
    return this.request(AUTH_API, "/settings/orders/" + orderId, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
  }

  async deleteOrder(orderId: string): Promise<void> {
    await this.request(AUTH_API, "/settings/orders/" + orderId, {
      method: "DELETE",
    });
  }

  // API Settings (Aster/BingX keys, account meta)
  async getApiSettings(): Promise<{
    aster?: { name?: string; avatar?: string; hasKeys?: boolean };
    bingx?: { name?: string; avatar?: string; hasKeys?: boolean };
  }> {
    return this.request(AUTH_API, "/settings/api");
  }

  async saveAsterApiSettings(payload: {
    name?: string;
    avatar?: string;
    apiKey?: string;
    apiSecret?: string;
  }): Promise<{
    aster: { name?: string; avatar?: string; hasKeys?: boolean };
  }> {
    return this.request(AUTH_API, "/settings/api/aster", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async saveBingXApiSettings(payload: {
    name?: string;
    avatar?: string;
    apiKey?: string;
    apiSecret?: string;
  }): Promise<{
    bingx: { name?: string; avatar?: string; hasKeys?: boolean };
  }> {
    return this.request(AUTH_API, "/settings/api/bingx", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async setExchange(exchange: "asterdex" | "bingx"): Promise<{ exchange: string }> {
    return this.request(AUTH_API, "/settings/exchange", {
      method: "PUT",
      body: JSON.stringify({ exchange }),
    });
  }

  // Trading API – auth via Bearer token (JWT), no X-Wallet-Address needed
  async initGrid(settings: any): Promise<any> {
    return this.request(TRADING_API, "/api/trading/grid/init", {
      method: "POST",
      body: JSON.stringify(settings),
    });
  }

  async getGridState(orderId: string): Promise<any> {
    return this.request(TRADING_API, `/api/trading/grid/state/${orderId}`);
  }

  async getGridStates(): Promise<any[]> {
    return this.request(TRADING_API, `/api/trading/grid/states`);
  }

  async startGrid(orderId: string): Promise<void> {
    await this.request(TRADING_API, `/api/trading/grid/start/${orderId}`, {
      method: "POST",
    });
  }

  async stopGrid(orderId: string): Promise<void> {
    await this.request(TRADING_API, `/api/trading/grid/stop/${orderId}`, {
      method: "POST",
    });
  }

  async getPositions(orderId: string): Promise<any[]> {
    return this.request(TRADING_API, `/api/trading/positions/${orderId}`);
  }

  async deletePosition(positionId: string): Promise<void> {
    await this.request(TRADING_API, `/api/trading/positions/${positionId}`, {
      method: "DELETE",
    });
  }

  async getPrices(): Promise<
    Record<
      string,
      string | number | { price: string | number; priceChangePercent?: number | null }
    >
  > {
    return this.request(TRADING_API, "/api/trading/prices");
  }

  async getAsterSymbols(): Promise<{
    symbols: any[];
    baseAssets: string[];
    quoteAssets: string[];
  }> {
    return this.request(TRADING_API, "/api/trading/aster/symbols");
  }

  async setPrice(symbol: string, price: number): Promise<void> {
    await this.request(TRADING_API, `/api/trading/prices/${symbol}`, {
      method: "POST",
      body: JSON.stringify({ price }),
    });
  }

  async processPrice(
    orderId: string,
    settings: any,
    price: number
  ): Promise<any> {
    return this.request(
      TRADING_API,
      `/api/trading/grid/process-price/${orderId}?price=${price}`,
      {
        method: "POST",
        body: JSON.stringify(settings),
      }
    );
  }

  // Wallet API
  async getWalletBalances(): Promise<Record<string, string>> {
    return this.request(TRADING_API, "/api/trading/wallet/balances");
  }

  async setWalletBalance(
    currency: string,
    balance: number
  ): Promise<void> {
    await this.request(TRADING_API, "/api/trading/wallet/balance", {
      method: "POST",
      body: JSON.stringify({ currency, balance }),
    });
  }

  async refreshWallet(): Promise<Record<string, string>> {
    const result = await this.request<{ success: boolean; balances: Record<string, string> }>(
      TRADING_API,
      "/api/trading/wallet/refresh",
      {
        method: "POST",
      }
    );
    return result.balances || {};
  }
}

export const api = new ApiClient();
