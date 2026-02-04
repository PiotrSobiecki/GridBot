# GridBot - Trading Bot Application

## Architektura

```
GridBot/
├── frontend/          # React + Vite (UI)
├── auth-service/      # Node.js (Web3 SIWE Auth)
├── trading-engine/    # Java Spring Boot (Trading Logic)
└── docker-compose.yml # Orchestration
```

## Technologie

- **Frontend**: React 18, Vite, TailwindCSS, ethers.js, wagmi
- **Auth Service**: Node.js, Express, siwe, ethers
- **Trading Engine**: Java 17, Spring Boot 3, WebSocket

## Uruchomienie

### Development
```bash
# Frontendcd
cd frontend && npm install && npm run dev

# Auth Service
cd auth-service && npm install && npm run dev

# Trading Engine
cd trading-engine && ./mvnw spring-boot:run
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

### Trading Engine (port 8080)
- `GET /api/orders` - Lista zleceń
- `POST /api/orders` - Utwórz zlecenie
- `PUT /api/orders/{id}` - Aktualizuj zlecenie
- `DELETE /api/orders/{id}` - Usuń zlecenie
- `GET /api/wallet` - Stan portfela
- `WS /ws/prices` - WebSocket dla cen
