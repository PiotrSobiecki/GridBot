## Analiza projektu GridBot v2 – pełny raport (09.03.2026)

### Ogólna ocena

- **Jakość kodu:** ~**68–72%** dobrze napisanego kodu
- Projekt przeszedł znaczący refaktoring od pierwszej analizy (45–50%). Naprawiono krytyczne problemy bezpieczeństwa, wydajności i architektury. Pozostają problemy z rozmiarem plików, martwym kodem i brakiem testów.

---

### ✅ CO NAPRAWIONO OD PIERWSZEJ ANALIZY

1. **JWT middleware na wszystkich endpointach tradingowych** – `routes/trading.js` używa `authMiddleware` z JWT zamiast niezabezpieczonego `X-Wallet-Address`.
2. **Sprawdzanie własności zleceń** – `PUT /orders/:orderId` i `DELETE /orders/:orderId` weryfikują, czy zlecenie należy do zalogowanego użytkownika (403 Forbidden).
3. **JWT_SECRET bez niebezpiecznego fallbacku** – w produkcji brak `JWT_SECRET` powoduje `process.exit(1)`.
4. **Poprawna logika `SIMULATION_MODE`** – `=== "true"` zamiast odwróconej `=== "false"`.
5. **`await` na `manualProcess` i paper trading** – poprawione asynchroniczne wywołania.
6. **Ceny pobierane per giełda (nie per wallet)** – `currentPricesByExchange` cache, `refreshFromAster(null, exchange)`.
7. **N+1 w schedulerze rozwiązany** – `Order.findByIds()` + mapa `ordersById` zamiast osobnych `Order.findById()`.
8. **Transakcje DB przy usuwaniu zlecenia** – `BEGIN/COMMIT/ROLLBACK` dla PostgreSQL i SQLite.
9. **`getExchange` wydzielone** – `ExchangeConfigService.js` z `getExchangeForWallet()`.
10. **IIFE usunięte z `UserSettings.js`** – tabele tworzone centralnie w `db.js`.
11. **`mongoose` usunięte z `package.json`** backendu.
12. **MongoDB usunięte z `docker-compose.yml`**.
13. **`USE_ASTER_SPOT` usunięte** z `PriceFeedService.js`.
14. **Endpoint `/transactions` naprawiony** – `Position.findByWalletAndOrderId` obsługuje `orderId = null`.
15. **Tabela `orders` znormalizowana** – osobna tabela zamiast JSON w `user_settings`.
16. **Walidacja wejścia** – `validateOrderPayload` w `settings.js`.
17. **SSL konfiguracja** – `rejectUnauthorized: false` tylko przy jawnym `PG_SSL_INSECURE=true`.
18. **React Query dla cen** – `useQuery` w Dashboard zamiast ręcznych `setInterval`.
19. **Zustand z selektorami** – w kluczowych komponentach (Dashboard, OrderSettings, PriceDisplay).
20. **Brak duplikacji pollingu cen** – PriceDisplay czyta ze store, nie fetchuje sam.
21. **SwingService wydzielony** – `getSwingPercent` i `checkSwingTrailing` w osobnym pliku.
22. **Dynamiczne listy krypto** – `getTickerSymbols()` z `exchangeInfo` zamiast hardcoded.
23. **BingX nie robi fallbacku kluczy .env dla userów** – user bez kluczy = `source: "db-missing"`.
24. **CryptoService wymusza szyfrowanie w produkcji** – brak `API_ENCRYPTION_KEY` = throw Error.
25. **Wallet panel sortowany** – assety od największej wartości USD.

---

### KRYTYCZNE (naprawić natychmiast)

**Brak krytycznych problemów.** Wszystkie krytyczne problemy z pierwszej analizy zostały naprawione.

---

### WAŻNE (poprawić wkrótce)

1. **Frontend nadal wysyła `X-Wallet-Address` w nagłówkach tradingowych**
   - `api/index.ts` – 12 miejsc z `headers: { "X-Wallet-Address": walletAddress }`.
   - Backend ignoruje ten nagłówek (używa JWT `req.walletAddress`), więc nagłówek jest martwy.
   - **Ryzyko:** Mylące dla developerów, sugeruje że backend jeszcze czyta ten nagłówek.

2. **`connectPriceWebSocket` zdefiniowane, ale nigdzie nie wywoływane**
   - `api/index.ts:283` – metoda WebSocket gotowa, ale żaden komponent jej nie używa.
   - Powiązane: `sockjs-client` i `stompjs` w `package.json` frontendu (nieużywane).

3. **Martwe modele Mongoose w `src/models/`**
   - `auth-service/src/models/User.js` (50 linii) – Mongoose schema, import `mongoose`.
   - `auth-service/src/models/UserSettings.js` (228 linii) – Mongoose schema z `orderSchema`.
   - Żaden plik ich nie importuje. Mongoose nie jest w `package.json`.
   - **Ryzyko:** Wprowadzają w błąd nowych developerów.

4. **SQL injection w SQLite DELETE (settings.js)**
   - Linie 451–452: `String(orderId).replace(/'/g, "''")` – ręczne escapowanie zamiast parametryzowanych query.
   - SQLite `db.exec()` nie wspiera parametrów, ale powinno się użyć `db.prepare().run()`.

5. **`useStore()` bez selektorów w 5 komponentach**
   - `WalletPanel.tsx`, `PositionsTable.tsx`, `OrderTabs.tsx`, `SettingsApiPanel.tsx`, `ConnectWallet.tsx`.
   - Powoduje niepotrzebne re-rendery przy każdej zmianie store'a.

6. **Brak `.env.example`**
   - Brak pliku z listą wymaganych zmiennych środowiskowych.
   - Developer musi zgadywać: `JWT_SECRET`, `DATABASE_URL`, `API_KEY_BINGX`, `API_KEY_SECRET_BINGX`, `API_ENCRYPTION_KEY`, `PG_SSL_INSECURE`, `SIMULATION_MODE`, `GRID_SCHEDULER_INTERVAL_SEC`.

7. **Duplikacja `getExchangeService`**
   - `ExchangeService.js` ma lokalną sync wersję `getExchangeService(exchange)` (linia 25–26).
   - `ExchangeConfigService.js` ma async wersję `getExchangeService()`.
   - Dwie różne implementacje tej samej koncepcji.

---

### ŚREDNIE (poprawić przy okazji)

1. **`GridAlgorithmService.js` ma 2528 linii**
   - Zmniejszony z ~2900 (wydzielono SwingService), ale nadal za duży.
   - Kandydaci do wydzielenia: `BuyLogicService`, `SellLogicService`, `FocusPriceService`, `TransactionLogger`.

2. **`OrderSettings.tsx` ma 1756 linii**
   - Największy komponent na froncie. Zawiera helpery (`SettingsSection`, `InputField`, `SelectField`, `CheckboxField`, `ThresholdEditor`, `RangeThresholdEditor`) w tym samym pliku.
   - Rozbić na: `OrderForm.tsx`, `SettingsSection.tsx`, `ThresholdEditors.tsx`, `OrderFieldComponents.tsx`.

3. **`PositionsTable.tsx` ma 794 linii**
   - Duży komponent z inline `setInterval(fetchPositions, 30000)`.
   - Używa `alert()` zamiast toast/notyfikacji (linia ~105).

4. **Brak centralnego error handlera na backendzie**
   - Każdy endpoint ma własny `try/catch` z kopiowaną logiką `res.status(500).json`.
   - Brak express error middleware.

5. **Brak testów**
   - Zero plików testowych (`.test.js`, `.spec.js`, `.test.ts`, `.spec.ts`).
   - Brak frameworka testowego w zależnościach (jest, mocha, vitest).
   - Krytyczny algorytm tradingowy (2528 linii) bez żadnego testu jednostkowego.

6. **Cache cen bez TTL**
   - `currentPricesByExchange` w `PriceFeedService.js` – cache aktualizowany przez scheduler, ale brak mechanizmu wygaszania starych wpisów.
   - `isPriceStale()` – stały próg 30s, niekonfigurowalny.

7. **Kolumna `config` w tabeli `orders` jako JSON TEXT**
   - Część ustawień zlecenia jest w kolumnach (`base_asset`, `quote_asset`), reszta w `config TEXT` jako JSON.
   - Hybrydowe podejście – konsekwentniejsze byłoby albo pełna normalizacja albo pełny JSON.

8. **Brak rate limitingu na endpointach API**
   - Publiczny endpoint `/api/auth/nonce` może być spamowany.
   - Brak ochrony przed brute-force na żadnym endpoincie.

9. **Session secret z fallbackiem w dev**
   - `index.js:101` – `process.env.JWT_SECRET || "dev-session-key-change-in-production"`.
   - Mniej krytyczne (sesje nie przechowują wrażliwych danych), ale niezgodne z best practices.

10. **Pozycje mają zbędne kolumny swing**
    - `positions` tabela: `swing_high_price`, `swing_low_price` – nie używane przez algorytm.
    - Swing tracking jest w `grid_states` (`swing_buy_low_price`, `swing_sell_high_price`).

---

### Statystyki plików

#### Backend (auth-service/src)

| Plik | Linie | Status |
|------|------:|--------|
| `trading/services/GridAlgorithmService.js` | 2528 | ⚠️ Za duży |
| `trading/services/BingXService.js` | 595 | OK |
| `trading/services/ExchangeService.js` | 558 | OK |
| `routes/trading.js` | 500 | OK |
| `routes/settings.js` | 437 | OK |
| `trading/db.js` | 422 | OK |
| `trading/services/AsterSpotService.js` | 370 | OK |
| `trading/services/PriceFeedService.js` | 317 | OK |
| `trading/services/WalletService.js` | 309 | OK |
| `trading/services/GridSchedulerService.js` | 256 | OK |
| `trading/models/Order.js` | 169 | OK |
| `trading/models/Position.js` | 143 | OK |
| `trading/models/GridState.js` | 127 | OK |
| `trading/services/SwingService.js` | 107 | OK |
| `trading/models/UserSettings.js` | 60 | OK |
| `trading/services/CryptoService.js` | 54 | OK |
| `trading/services/ExchangeConfigService.js` | 37 | OK |
| `routes/auth.js` | 134 | OK |
| `models/User.js` (Mongoose – martwy) | 50 | ❌ Usunąć |
| `models/UserSettings.js` (Mongoose – martwy) | 228 | ❌ Usunąć |

#### Frontend (frontend/src)

| Plik | Linie | Status |
|------|------:|--------|
| `components/OrderSettings.tsx` | 1756 | ⚠️ Za duży |
| `components/PositionsTable.tsx` | 794 | ⚠️ Duży |
| `components/Dashboard.tsx` | 742 | OK |
| `components/SettingsApiPanel.tsx` | 561 | OK |
| `components/WalletPanel.tsx` | 426 | OK |
| `components/PriceDisplay.tsx` | 165 | OK |
| `components/OrderTabs.tsx` | 162 | OK |
| `components/ConnectWallet.tsx` | 136 | OK |
| `main.tsx` | 46 | OK |
| `App.tsx` | 32 | OK |

---

### Oceny per obszar

| Obszar | Poprzednio | Teraz | Komentarz |
|--------|:----------:|:-----:|-----------|
| **Bezpieczeństwo** | 3/10 | **8/10** | JWT na wszystkim, własność zleceń, szyfrowanie kluczy |
| **Obsługa błędów** | 6/10 | **7/10** | Transakcje DB, await poprawiony, brak centralnego handlera |
| **Wydajność** | 5/10 | **8/10** | Cache per giełda, brak N+1, React Query |
| **Architektura DB** | 5/10 | **8/10** | Osobna tabela orders, migracje, transakcje |
| **Duplikacja kodu** | 5/10 | **7/10** | getExchange wydzielone, ale drobna duplikacja |
| **API design** | 6/10 | **8/10** | Spójne JWT auth, walidacja wejścia |
| **Modele danych** | 6/10 | **7/10** | Walidacja, parametryzowane query (SQLite exception) |
| **Serwisy** | 5/10 | **6/10** | SwingService wydzielony, ale GridAlgorithm wciąż 2528 linii |
| **Frontend** | 6/10 | **7/10** | React Query, selektory, ale duże komponenty |
| **DevOps/Config** | 5/10 | **6/10** | MongoDB usunięte, brak .env.example, brak testów |

**Średnia ważona: 7.2/10** (poprzednio: 5.2/10)

---

### TOP 5 rekomendacji (priorytet)

1. **Usunąć martwy kod**
   - Usunąć `src/models/User.js` i `src/models/UserSettings.js` (Mongoose).
   - Usunąć `connectPriceWebSocket` z `api/index.ts`.
   - Usunąć `sockjs-client` i `stompjs` z frontendu `package.json`.
   - Usunąć `X-Wallet-Address` nagłówki z `api/index.ts` (backend ignoruje).
   - Usunąć zbędne kolumny `swing_high_price`, `swing_low_price` z tabeli `positions`.

2. **Rozbić duże pliki**
   - `GridAlgorithmService.js` (2528 linii) → `BuyLogicService`, `SellLogicService`, `FocusPriceService`.
   - `OrderSettings.tsx` (1756 linii) → `OrderForm`, `SettingsSection`, `ThresholdEditors`.

3. **Dodać testy**
   - Priorytet: algorytm tradingowy (`GridAlgorithmService`) – warunki kupna/sprzedaży, swing trailing.
   - Framework: `vitest` (szybki, ESM-native).
   - Cel: pokrycie krytycznej logiki biznesowej.

4. **Poprawić SQLite DELETE**
   - Zamienić `db.exec()` z interpolacją na `db.prepare().run()` z parametrami.
   - Eliminuje ryzyko SQL injection.

5. **Dodać `.env.example` i rate limiting**
   - Plik `.env.example` z listą wszystkich zmiennych i komentarzami.
   - `express-rate-limit` na endpointach auth.

---

### Porównanie z pierwszą analizą

| Metryka | v1 (pierwotna) | v2 (aktualna) |
|---------|:--------------:|:-------------:|
| Jakość kodu | 45–50% | **68–72%** |
| Krytyczne problemy | 6 | **0** |
| Ważne problemy | 7 | **7** (nowe, drobniejsze) |
| Średnie problemy | 10 | **10** (część nowa, część odziedziczona) |
| Bezpieczeństwo | 3/10 | **8/10** |
| Wydajność | 5/10 | **8/10** |
| Średnia ocena | 5.2/10 | **7.2/10** |
