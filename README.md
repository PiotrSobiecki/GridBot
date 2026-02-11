# GridBot - Trading Bot Application

## Architektura

```
GridBot/
├── frontend/          # React + Vite (UI)
├── auth-service/      # Node.js (Web3 SIWE Auth & Trading Logic)
└── docker-compose.yml # Orchestration
```

## Technologie

- **Frontend**: React 18, Vite, TailwindCSS, ethers.js, wagmi
- **Auth Service**: Node.js, Express, siwe, ethers (Web3 Auth & Trading Logic)

## Uruchomienie

### Development
```bash
# Frontendcd
cd frontend && npm install && npm run dev

# Auth Service
cd auth-service && npm install && npm run dev
```

### Docker
```bash
docker-compose up --build
```

## Algorytm GRID

### Licznik Trendu
- Trend 0 = brak pozycji
- Każdy zakup zwiększa trend o 1
- Każda sprzedaż zmniejsza trend o 1

### Kalkulacja Ceny
- **Nowy cel zakupu**: `Poprzedni_Focus - (Procent_Trendu * Cena)`
- **Cel sprzedaży**: `Cena_Zakupu + min_zarobek_proc`

### Dynamiczne Wartości
Wartość transakcji zmienia się według progów cenowych (104k, 100k, 89k)

## API Endpoints

### Auth Service (port 3001)
- `GET /auth/nonce` - Pobierz nonce dla SIWE
- `POST /auth/verify` - Weryfikuj podpis SIWE
- `GET /auth/session` - Sprawdź sesję
- `POST /auth/logout` - Wyloguj
- `GET /api/trading/*` - Trading endpoints
- `WS /ws/prices` - WebSocket dla cen
