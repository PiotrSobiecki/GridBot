# Plan: BingX – pobieranie cen z kluczy globalnych i usera

## Cel

Rozdzielenie logiki pobierania cen na BingX na dwa tryby:
- **Globalne** (klucze z ENV) – dla 6 głównych krypto na pasku górnym
- **Per-user** (klucze usera) – dla pozostałych krypto, jeśli user aktywnie je traduje

---

## 1. Pasek górny (PriceDisplay)

**Tylko dla BingX** pasek pokazuje **6 walut** pobieranych globalnie z kluczy ENV:

```
BTC, ETH, BNB, SOL, XRP, DOGE
```

- Endpoint backendu używa `walletAddress = null` → klucze z `.env`
- AsterDex bez zmian (BTC, ETH, BNB, ASTER)

---

## 2. Wybór walut do tradingu (OrderSettings)

Dla BingX endpoint `/api/trading/bingx/symbols` zwraca **wszystkie dostępne pary USDT** z giełdy (bez żadnego filtra `allowedBases`).

Użytkownik może wybrać dowolną kryptowalutę ze spotu BingX.

---

## 3. Logika pobierania ceny aktywnie tradowanych walut

### "Globalne" krypto (ENV keys):
```
BTC, ETH, BNB, SOL, XRP, DOGE
```
Ceny pobierane z globalnych kluczy ENV – tak jak dziś dla paska.

### "Niestandardowe" krypto (user keys):
Każde inne krypto (np. MED, LUNC, ASTER, PEPE itd.) które user ma ustawione w **aktywnym zleceniu BingX** → cena pobierana z kluczy API **konkretnego usera**.

---

## 4. Zmiany backendu

### `auth-service/src/routes/trading.js`

#### a) `/api/trading/aster/symbols` (pasek górny)
- BingX: `allowedBasesBingx = ["BTC", "ETH", "BNB", "SOL", "XRP", "DOGE"]`
  (usunąć TRX, ASTER, LINK, MED, LUNC z listy paskowej)
- AsterDex: bez zmian

#### b) `/api/trading/bingx/symbols` (dropdown wyboru walut)
- Usunąć filtr `allowedBases` → zwracać **wszystkie pary USDT** z BingX spot
- Ten endpoint służy tylko do wyboru w zleceniu, nie do paska

#### c) Nowy endpoint `/api/trading/bingx/price/:symbol` (cena per-user)
- Już istnieje – pobiera cenę z kluczami usera (`walletAddress`)
- Używany gdy symbol NIE jest w liście globalnych

#### d) `BingXService.js` → `getTickerSymbols()`
- `DEFAULT_TICKER_SYMBOLS` i `allowedBases` → zostawić tylko: `BTC, ETH, BNB, SOL, XRP, DOGE`
- Ta lista służy tylko do paska (globalny ticker)

---

## 5. Zmiany frontendu

### `PriceDisplay.tsx`
- Lista bazowa (domyślna przed załadowaniem z backendu): `BTC, ETH, BNB, SOL, XRP, DOGE`
- Usunąć filtr `hiddenFromBar` – nie będzie już potrzebny (lista paskowa jest już odfiltrowana na backendzie)

### `OrderSettings.tsx`
- Dropdown `baseAssets` dla BingX → wywołuje `/api/trading/bingx/symbols` (wszystkie USDT)
- Przy wyborze krypto:
  - Jeśli symbol jest w `["BTC", "ETH", "BNB", "SOL", "XRP", "DOGE"]` → cena z globalnego store (pobrana przez pasek)
  - Jeśli NIE jest → wywołaj `/api/trading/bingx/price/:symbol` z kluczami usera

### `Dashboard.tsx` / `OrderTabs.tsx`
- Przy wyświetlaniu ceny zlecenia:
  - Jeśli symbol jest w globalnej liście → bierz z `prices[]` (store)
  - Jeśli nie → wywołaj `api.getBingxPrice(symbol)` i zaktualizuj store

---

## 6. Stała lista "globalnych" krypto

Zdefiniować **jedną stałą** używaną zarówno w backendzie jak i frontendzie:

```ts
// frontend
export const BINGX_GLOBAL_SYMBOLS = ["BTC", "ETH", "BNB", "SOL", "XRP", "DOGE"];
```

```js
// backend
const BINGX_GLOBAL_BASES = ["BTC", "ETH", "BNB", "SOL", "XRP", "DOGE"];
```

---

## 7. Kolejność implementacji

1. Backend `trading.js` – zmiana listy paskowej i usunięcie filtra z `bingx/symbols`
2. Backend `BingXService.js` – aktualizacja `DEFAULT_TICKER_SYMBOLS` i `allowedBases`
3. Frontend `PriceDisplay.tsx` – aktualizacja domyślnej listy
4. Frontend `OrderSettings.tsx` – logika ceny per-user vs globalnej
5. Frontend `Dashboard.tsx` / `OrderTabs.tsx` – wyświetlanie ceny per-user
