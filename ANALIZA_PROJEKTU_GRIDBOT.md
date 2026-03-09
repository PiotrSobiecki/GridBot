## Analiza projektu GridBot – pełny raport

### Ogólna ocena

- **Jakość kodu:** ~**45–50%** dobrze napisanego kodu  
- Projekt działa, ale ma sporo problemów architektonicznych, bezpieczeństwa i wydajności.

---

### KRYTYCZNE (naprawić natychmiast)

1. **Brak autoryzacji na endpointach tradingowych**
   - `routes/trading.js` używa tylko nagłówka `X-Wallet-Address` bez JWT.
   - Każdy może:
     - inicjować/zatrzymywać grid cudzych portfeli,
     - usuwać pozycje,
     - ustawiać ceny i salda (`POST /prices/:symbol`, `POST /wallet/balance`).

2. **Brak sprawdzenia własności zlecenia**
   - `PUT /orders/:orderId` i `DELETE /orders/:orderId` w `settings.js` nie weryfikują, czy zlecenie należy do zalogowanego użytkownika.

3. **Słaby domyślny `JWT_SECRET`**
   - W kodzie jest fallback `"gridbot-secret-key"` jako sekretny klucz – niebezpieczne w produkcji.

4. **Odwrotna logika `SIMULATION_MODE`**
   - `PriceFeedService.js:14`:
     ```js
     const SIMULATION_MODE = process.env.SIMULATION_MODE === "false";
     ```
   - Symulacja włącza się, gdy env = `"false"` – odwrotna, myląca logika.

5. **Brak `await` w `manualProcess`**
   - `GridSchedulerService.js:293` wywołuje asynchroniczne `getOrderSettings` bez `await`.

6. **Brak `await` w paper trading**
   - `ExchangeService.executePaperBuy/executePaperSell` wołają `WalletService` bez `await`.

---

### WAŻNE (poprawić wkrótce)

1. **Ceny pobierane per wallet zamiast per giełda**
   - 3 wallety na BingX = 3× ten sam request `ticker/24hr` (x4 symbole = 12 requestów zamiast 4).

2. **N+1 w schedulerze**
   - Dla każdego aktywnego stanu osobne `Order.findById()`.
   - `GridState.findByWalletAndOrderId` wywoływane wielokrotnie w jednym cyklu `processPrice`.

3. **Brak transakcji**
   - Usunięcie zlecenia to 3 osobne operacje:
     - `order.delete()`,
     - `DELETE grid_states`,
     - `DELETE positions`.
   - Brak transakcji → możliwa niespójność danych przy błędzie w środku.

4. **Zduplikowana funkcja `getExchange`**
   - Ta sama logika w 5 plikach:
     - `GridSchedulerService.js`,
     - `PriceFeedService.js`,
     - `WalletService.js`,
     - `ExchangeService.js`,
     - `routes/trading.js`.

5. **Podwójna definicja tabel**
   - `UserSettings.js` model ma IIFE z `CREATE TABLE IF NOT EXISTS user_settings` (z kolumną `orders`),
   - `db.js` tworzy tę samą tabelę bez `orders` → ryzyko konfliktu schematu.

6. **Nieużywany kod**
   - `mongoose` w `package.json`,
   - `sockjs-client` / `stompjs` na froncie,
   - `connectPriceWebSocket` zdefiniowane, ale nigdzie nie wywołane,
   - `USE_ASTER_SPOT` – zmienna nieużywana.

7. **Endpoint `/transactions` nie działa**
   - `Position.findByWalletAndOrderId(walletAddress, null, CLOSED)` generuje `WHERE order_id = NULL`, co zwraca 0 wyników.

---

### ŚREDNIE (poprawić przy okazji)

1. **`GridAlgorithmService.js` ma ~2900 linii**
   - Zbyt duży, trudny w utrzymaniu.
   - Warto wydzielić np. `SwingService`, `TransactionLogger`, `WalletValidator`.

2. **`OrderSettings.tsx` ma ~1300 linii**
   - Rozbić na mniejsze komponenty.

3. **Frontend nie używa React Query**
   - Zainstalowany `@tanstack/react-query`, ale cały fetch idzie przez ręczne `setInterval` + `useEffect`.

4. **Zustand bez selektorów**
   - `useStore()` bez selektora powoduje re-render przy każdej zmianie store'a.

5. **Duplikacja pollingu cen**
   - `Dashboard` i `PriceDisplay` niezależnie fetchują ceny.

6. **Brak walidacji wejścia**
   - Endpointy nie walidują `req.body` (np. `refreshInterval` może być ujemne, `minProfitPercent` może być stringiem).

7. **`ssl: { rejectUnauthorized: false }`**
   - W `db.js` dla Postgres – osłabia weryfikację SSL.

8. **`CryptoService`**
   - Przy braku `API_ENCRYPTION_KEY` klucze API mogą być zapisywane „plain text”.

9. **`docker-compose.yml` używa MongoDB**
   - Backend już nie korzysta z MongoDB.

10. **Hardcoded listy krypto**
    - `["BTC","ETH","BNB","ASTER"]` w kilku plikach frontendu,
    - `TICKER_SYMBOLS` w serwisach BingX/Aster – lepiej pobierać z `exchangeInfo`.

---

### Oceny per obszar

| Obszar             | Ocena | Komentarz                                           |
|--------------------|:-----:|-----------------------------------------------------|
| **Bezpieczeństwo** |  3/10 | Brak auth na tradingu, słaby JWT fallback          |
| **Obsługa błędów** |  6/10 | `try/catch` jest, brak centralnego handlera        |
| **Wydajność**      |  5/10 | N+1, duplikacja requestów, brak cache              |
| **Architektura DB**|  5/10 | Brak transakcji, podwójna definicja tabel          |
| **Duplikacja kodu**|  5/10 | `getExchange` 5×, logi buy/sell identyczne         |
| **API design**     |  6/10 | REST OK, ale niespójna autoryzacja                 |
| **Modele danych**  |  6/10 | Brak walidacji, ale parametryzowane query          |
| **Serwisy**        |  5/10 | Za duże pliki, błędy z `await`                     |
| **Frontend**       |  6/10 | Działa, ale polling zamiast WS, brak React Query   |
| **DevOps/Config**  |  5/10 | Docker OK, ale nieużywany MongoDB, brak `.env.example` |

---

### TOP 5 rekomendacji (priorytet)

1. **Dodać JWT middleware do `routes/trading.js`**
   - Tak jak jest w `settings.js`, wszystkie endpointy tradingowe powinny być chronione JWT (lub innym silnym mechanizmem auth).

2. **Globalne pobieranie cen per giełda – nie per wallet**
   - Utrzymywać cache cen per giełda (np. `bingx`, `asterdex`) i odświeżać go raz na interwał.
   - Wszystkie wallety powinny czytać z tego cache, zamiast robić osobne requesty do API.

3. **Usunąć IIFE z `UserSettings.js`**
   - Definicja tabeli `user_settings` w modelu koliduje z nową strukturą z `db.js` (kolumna `orders`).
   - Zostawić jedną, centralną definicję schematu w `db.js`.

4. **Naprawić `SIMULATION_MODE`**
   - Zmienić na coś w stylu:
     ```js
     const SIMULATION_MODE = process.env.SIMULATION_MODE === "true";
     ```
   - Czytelnie: symulacja włączona, gdy wartość env = `"true"`.

5. **Wydzielić `getExchange` do wspólnego helpera**
   - Jeden plik (np. `trading/services/ExchangeConfigService.js`), eksportujący `getExchangeForWallet(walletAddress)`.
   - Wszystkie serwisy i route’y powinny używać tego helpera zamiast duplikować logikę.

