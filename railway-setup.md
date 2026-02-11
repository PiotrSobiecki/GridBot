# Wdrożenie GridBot na Railway

## Krok 1: Przygotowanie projektu

1. **Zainstaluj Railway CLI** (opcjonalnie, jeśli chcesz używać CLI):
   ```bash
   npm i -g @railway/cli
   ```

2. **Zaloguj się do Railway**:
   ```bash
   railway login
   ```

## Krok 2: Utworzenie projektu na Railway

### Opcja A: Przez Railway Dashboard
1. Przejdź na https://railway.app
2. Kliknij **"New Project"**
3. Wybierz **"Deploy from GitHub repo"** (jeśli masz repo) lub **"Empty Project"**

### Opcja B: Przez Railway CLI
```bash
railway init
```

## Krok 3: Dodanie Postgres Database

1. W projekcie Railway kliknij **"New"** → **"Database"** → **"Add PostgreSQL"**
2. Railway automatycznie utworzy bazę i doda zmienną `DATABASE_URL` do projektu

## Krok 4: Konfiguracja zmiennych środowiskowych

W projekcie Railway przejdź do **Variables** i dodaj:

### Wymagane zmienne:
- `DATABASE_URL` - automatycznie dodana przez Railway (z Postgres service)
- `API_ENCRYPTION_KEY` - 32-bajtowy klucz w hex (64 znaki)
  ```bash
  # Wygeneruj lokalnie:
  openssl rand -hex 32
  ```

### Opcjonalne (dla fallback API keys):
- `API_KEY_ASTER` - klucz API AsterDex (jeśli chcesz globalny fallback)
- `API_KEY_SECRET_ASTER` - secret API AsterDex

### Inne zmienne (jeśli potrzebne):
- `PORT` - Railway automatycznie ustawi, ale możesz nadpisać
- `NODE_ENV=production`
- `GRID_SCHEDULER_INTERVAL_SEC=1` - interwał schedulera (domyślnie 1s)

## Krok 5: Wdrożenie auth-service

### Opcja A: Przez Railway Dashboard
1. W projekcie Railway kliknij **"New"** → **"GitHub Repo"** (lub **"Empty Service"**)
2. Wybierz repozytorium GridBot
3. Ustaw **Root Directory** na `auth-service`
4. Railway automatycznie wykryje `package.json` i użyje Nixpacks do budowy
5. Projekt ma już skonfigurowane pliki:
   - `nixpacks.toml` - konfiguracja Nixpacks
   - `.nvmrc` - wersja Node.js (20)
   - `railway.toml` - konfiguracja Railway
   - `start.sh` - backup script (jeśli potrzebny)

### Opcja B: Przez Railway CLI
```bash
cd auth-service
railway link  # Połącz z projektem Railway
railway up    # Wdróż
```

## Krok 6: Wdrożenie frontend (opcjonalnie)

Frontend możesz wdrożyć osobno lub użyć Railway Static Files:

1. W projekcie Railway kliknij **"New"** → **"GitHub Repo"**
2. Wybierz repozytorium GridBot
3. Ustaw **Root Directory** na `frontend`
4. Railway wykryje Vite/React i wdroży

**LUB** użyj Vercel/Netlify dla frontendu (prostsze dla React).

## Krok 7: Konfiguracja CORS (jeśli frontend na innym domenie)

W `auth-service/src/index.js` upewnij się że CORS pozwala na domenę frontendu:
```js
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
```

Dodaj `FRONTEND_URL` do zmiennych Railway.

## Uwagi

1. **Modele są async** - wszystkie modele (User, GridState, Position, UserSettings) 
   używają async/await i działają zarówno z SQLite (lokalnie) jak i PostgreSQL (produkcja).

2. **Szyfrowanie kluczy API** - już działa przez `CryptoService.js`, 
   wystarczy ustawić `API_ENCRYPTION_KEY` w Railway.

3. **Lokalnie nadal SQLite** - jeśli nie ma `DATABASE_URL` w env, 
   backend używa SQLite jak wcześniej. Na produkcji (Railway) automatycznie używa PostgreSQL.

4. **Logi** - możesz sprawdzić logi w Railway Dashboard → **Deployments** → **View Logs**

## Troubleshooting

- **Błąd połączenia z bazą**: Sprawdź czy `DATABASE_URL` jest ustawiona
- **Błąd szyfrowania**: Upewnij się że `API_ENCRYPTION_KEY` ma 64 znaki (32 bajty hex)
- **Port**: Railway automatycznie ustawia `PORT`, nie trzeba go konfigurować
