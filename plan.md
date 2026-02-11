Plan wdrożenia z AsterDex Spot (konkretny, pod Twoje API)

1. Warstwa AsterDex Spot w backendzie
   Nowy serwis w auth-service, np. src/trading/services/AsterSpotService.js:
   Konfiguracja:
   BASE_URL = 'https://sapi.asterdex.com'
   klucze z process.env.API_KEY_ASTER, process.env.API_KEY_SECRET_ASTER
   Niesygnowane (MARKET_DATA):
   GET /api/v1/exchangeInfo – pełna lista par + info, zcache’owana w pamięci.
   GET /api/v1/ticker/price (bez symbol) – wszystkie ostatnie ceny.
   Sygnowane (TRADE / USER_DATA) – przygotować helper:
   budowa queryString + timestamp + opcjonalny recvWindow,
   signature = HMAC-SHA256(secret, totalParams),
   nagłówek X-MBX-APIKEY.
   Na razie tylko szkic metody placeOrder({ symbol, side, type, quantity, price, ... }) – jeszcze bez podpinania do algorytmu.
2. Lista par + waluty w zleceniu
   Na podstawie exchangeInfo:
   wyciągnąć listę wszystkich spot symboli + oznaczyć:
   „baseAsset” – krypto,
   „quoteAsset” – stablecoiny (USDT, USDC, DAI, itp.).
   Backend:
   dodać endpoint np. GET /api/aster/symbols zwracający:
   symbols: [{ symbol, baseAsset, quoteAsset, status, ... }],
   osobne listy baseAssets, quoteAssets.
   Front:
   w OrderSettings dodać w sekcji ogólnej:
   Select baseAsset (lista krypto),
   Select quoteAsset (lista stable),
   dopisać te pola do OrderSettings (typy, Dashboard.defaultOrder, UserSettings).
3. Ticker na górze – wszystkie pary z AsterDex
   Backend:
   wrapper nad GET /api/v1/ticker/price (wszystkie pary), cache na np. 15–30 s.
   endpoint GET /api/trading/prices już masz – podpiąć go do AsterDex zamiast mocka.
   Front (PriceDisplay):
   zamiast 4 sztywnych symboli:
   pobiera listę symboli z backendu,
   wyświetla w poziomowym tickerze (auto‑scroll/karuzela),
   highlight aktualnie wybranej pary z aktywnego zlecenia (base/quote).
4. Podpięcie parametrów zlecenia do algorytmu
   Upewnić się, że wszystkie pola z UI są przeniesione:
   buy/sell.mode, walletProtection, maxValue, additional*, max*, swing\*, trendPercents, progi cenowe itp.
   Zrobić mały „audit”:
   porównać strukturę OrderSettings front vs:
   auth-service/src/trading/models/UserSettings.js,
   użycie w GridAlgorithmService (JS).
   Tam, gdzie jeszcze coś jest „po starym typie” (trend zamiast minPrice/maxPrice), dokończyć migrację.
5. Realne tradowanie na spocie
   W GridAlgorithmService (najpierw wersja JS w auth-service):
   w executeBuy:
   zamiast samego WalletService.executeBuy(...):
   wywołać AsterSpotService.placeOrder(...) z typem BUY na symbolu baseAsset+quoteAsset,
   dopiero po sukcesie aktualizować lokalny WalletService/GridState.
   analogicznie w executeBuySell, executeSellShort, executeSellBuyback → SELL.
   Na początek można:
   dodać tryb „paper trading” (flaga w .env), który zamiast realnego AsterDex tylko symuluje zlecenia (używając obecnego WalletService).
6. Harmonogram/trigger dla algorytmu
   Cron/scheduler (pewnie już jest GridSchedulerService):
   co X sekund (np. 10–30 s) dla każdego aktywnego zlecenia:
   bierze cenę z PriceFeedService (AsterDex),
   woła processPrice(walletAddress, orderId, currentPrice, settings).
   Upewnić się, że Start/Stop w UI tylko ustawia flagę isActive i ewentualnie inicjuje stan, a cała reszta leci przez scheduler.
