/**
 * OpenAPI 3.0 – dokumentacja API GridBot
 * Dostępna pod /docs
 */
const spec = {
  openapi: "3.0.3",
  info: {
    title: "GridBot API",
    description: "Web3 SIWE Authentication & Trading Engine",
    version: "1.0.0",
  },
  servers: [
    { url: "/", description: "Relative" },
    { url: "http://localhost:3001", description: "Local" },
  ],
  tags: [
    { name: "Auth", description: "Logowanie SIWE" },
    { name: "Settings", description: "Ustawienia, zlecenia" },
    { name: "Trading", description: "Grid, pozycje, ceny" },
    { name: "Health", description: "Status" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      Error: { type: "object", properties: { error: { type: "string" } } },
      Nonce: { type: "object", properties: { nonce: { type: "string" } } },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Status serwisu",
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    service: { type: "string" },
                    features: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/auth/nonce": {
      get: {
        tags: ["Auth"],
        summary: "Pobierz nonce do podpisu SIWE",
        responses: { 200: { description: "Nonce" } },
      },
    },
    "/auth/verify": {
      post: {
        tags: ["Auth"],
        summary: "Zweryfikuj podpis i zwroc JWT",
        description: "message i signature z wlasnej aplikacji SIWE lub przycisku Connect wallet na stronie /docs.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["message", "signature"],
                properties: {
                  message: { type: "string" },
                  signature: { type: "string" },
                },
              },
            },
          },
        },
        responses: { 200: { description: "Token JWT" }, 401: { description: "Invalid" } },
      },
    },
    "/auth/session": {
      get: {
        tags: ["Auth"],
        summary: "Sesja",
        description: "Bez nagłówka Authorization: Bearer <token> zwraca authenticated: false. Z tokenem (np. po Connect wallet) zwraca authenticated: true i walletAddress.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "Session",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    authenticated: { type: "boolean" },
                    walletAddress: { type: "string", description: "Gdy authenticated: true" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/auth/logout": {
      post: { tags: ["Auth"], summary: "Wyloguj", responses: { 200: { description: "OK" } } },
    },
    "/settings": {
      get: {
        tags: ["Settings"],
        summary: "Ustawienia uzytkownika",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Settings" }, 401: { description: "Invalid token" } },
      },
    },
    "/settings/orders": {
      get: {
        tags: ["Settings"],
        summary: "Lista zlecen",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Orders" } },
      },
      post: {
        tags: ["Settings"],
        summary: "Utworz zlecenie",
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: { type: "object" },
              example: {
                name: "Zlecenie 1",
                isActive: false,
                exchange: "bingx",
                baseAsset: "BTC",
                quoteAsset: "USDT",
                tradeMode: "both",
                refreshInterval: 30,
                minProfitPercent: 0.5,
                focusPrice: 0,
                focusLocked: true,
                timeToNewFocus: 0,
                buy: { currency: "USDT", walletProtection: 100, mode: "walletLimit", maxValue: 0, addProfit: false },
                sell: { currency: "BTC", walletProtection: 0.01, mode: "walletLimit", maxValue: 0, addProfit: false },
                platform: { minTransactionValue: 0, checkFeeProfit: true },
                buyConditions: { minValuePer1Percent: 200, priceThreshold: 0, checkThresholdIfProfitable: true },
                sellConditions: { minValuePer1Percent: 200, priceThreshold: 0, checkThresholdIfProfitable: true },
                trendPercents: [
                  { trend: 0, buyPercent: 0.5, sellPercent: 0.5 },
                  { trend: 1, buyPercent: 1, sellPercent: 1 },
                  { trend: 2, buyPercent: 0.6, sellPercent: 0.3 }
                ],
                additionalBuyValues: [],
                additionalSellValues: [],
                maxBuyPerTransaction: [],
                maxSellPerTransaction: [],
                buySwingPercent: [{ minPrice: 0, maxPrice: null, value: 0.1 }],
                sellSwingPercent: [{ minPrice: 0, maxPrice: null, value: 0.1 }]
              }
            }
          }
        },
        responses: { 201: { description: "Created" }, 400: { description: "Validation" } },
      },
    },
    "/settings/orders/{orderId}": {
      put: {
        tags: ["Settings"],
        summary: "Aktualizuj zlecenie",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: { type: "object" },
              example: {
                name: "Zlecenie BTC 1",
                isActive: false,
                refreshInterval: 60,
                minProfitPercent: 0.6,
                focusPrice: 68500,
                tradeMode: "both",
                buy: { currency: "USDT", walletProtection: 100, mode: "walletLimit", maxValue: 0, addProfit: false },
                sell: { currency: "BTC", walletProtection: 0.01, mode: "walletLimit", maxValue: 0, addProfit: false },
                buyConditions: { minValuePer1Percent: 200, priceThreshold: 0, checkThresholdIfProfitable: true },
                sellConditions: { minValuePer1Percent: 200, priceThreshold: 0, checkThresholdIfProfitable: true },
                trendPercents: [
                  { trend: 0, buyPercent: 0.5, sellPercent: 0.5 },
                  { trend: 1, buyPercent: 1, sellPercent: 1 }
                ]
              }
            }
          }
        },
        responses: { 200: { description: "OK" }, 403: { description: "Forbidden" } },
      },
      delete: {
        tags: ["Settings"],
        summary: "Usun zlecenie",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "OK" }, 403: { description: "Forbidden" } },
      },
    },
    "/settings/transactions": {
      get: {
        tags: ["Settings"],
        summary: "Historia transakcji",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "offset", in: "query", schema: { type: "integer" } },
        ],
        responses: { 200: { description: "Transactions" } },
      },
    },
    "/api/trading/grid/init": {
      post: {
        tags: ["Trading"],
        summary: "Inicjalizuj GRID",
        description: "Body = pelny obiekt zlecenia (jak z GET /settings/orders). Pole id jest wymagane – id istniejacego zlecenia.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: { type: "object" },
              example: {
                id: "uuid-zlecenia-z-settings-orders",
                name: "Zlecenie 1",
                isActive: false,
                exchange: "bingx",
                baseAsset: "BTC",
                quoteAsset: "USDT",
                tradeMode: "both",
                refreshInterval: 30,
                minProfitPercent: 0.5,
                focusPrice: 68500,
                focusLocked: true,
                timeToNewFocus: 0,
                buy: { currency: "USDT", walletProtection: 100, mode: "walletLimit", maxValue: 0, addProfit: false },
                sell: { currency: "BTC", walletProtection: 0.01, mode: "walletLimit", maxValue: 0, addProfit: false },
                platform: { minTransactionValue: 0, checkFeeProfit: true },
                buyConditions: { minValuePer1Percent: 200, priceThreshold: 0, checkThresholdIfProfitable: true },
                sellConditions: { minValuePer1Percent: 200, priceThreshold: 0, checkThresholdIfProfitable: true },
                trendPercents: [
                  { trend: 0, buyPercent: 0.5, sellPercent: 0.5 },
                  { trend: 1, buyPercent: 1, sellPercent: 1 }
                ],
                additionalBuyValues: [],
                additionalSellValues: [],
                maxBuyPerTransaction: [],
                maxSellPerTransaction: [],
                buySwingPercent: [{ minPrice: 0, maxPrice: null, value: 0.1 }],
                sellSwingPercent: [{ minPrice: 0, maxPrice: null, value: 0.1 }]
              }
            }
          }
        },
        responses: { 200: { description: "GridState" } },
      },
    },
    "/api/trading/grid/state/{orderId}": {
      get: {
        tags: ["Trading"],
        summary: "Stan GRID",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "GridState" } },
      },
    },
    "/api/trading/grid/states": {
      get: {
        tags: ["Trading"],
        summary: "Wszystkie stany GRID",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "GridState[]" } },
      },
    },
    "/api/trading/grid/start/{orderId}": {
      post: {
        tags: ["Trading"],
        summary: "Uruchom GRID",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/api/trading/grid/stop/{orderId}": {
      post: {
        tags: ["Trading"],
        summary: "Zatrzymaj GRID",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/api/trading/positions/{orderId}": {
      get: {
        tags: ["Trading"],
        summary: "Pozycje dla zlecenia",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "orderId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Position[]" } },
      },
    },
    "/api/trading/positions/{positionId}": {
      delete: {
        tags: ["Trading"],
        summary: "Usun pozycje",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "positionId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "OK" }, 403: { description: "Forbidden" } },
      },
    },
    "/api/trading/prices": {
      get: {
        tags: ["Trading"],
        summary: "Aktualne ceny",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Prices" } },
      },
    },
    "/api/trading/aster/symbols": {
      get: {
        tags: ["Trading"],
        summary: "Symbole gieldy",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "symbols, baseAssets, quoteAssets" } },
      },
    },
    "/api/trading/wallet/balances": {
      get: {
        tags: ["Trading"],
        summary: "Salda portfela",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "balances" } },
      },
    },
    "/api/trading/wallet/refresh": {
      post: {
        tags: ["Trading"],
        summary: "Odswiez salda",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "balances" } },
      },
    },
  },
};

export default spec;
