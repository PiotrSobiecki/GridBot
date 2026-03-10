// MUSI BYĆ NAJPIERW - przed wszystkimi importami używającymi process.env
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ładuj .env: najpierw z głównego katalogu projektu, potem z auth-service (nadpisuje)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Teraz można importować moduły używające process.env
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { createServer } from "http";
import { WebSocketServer } from "ws";

import rateLimit from "express-rate-limit";

// Routes
import authRoutes from "./routes/auth.js";
import settingsRoutes from "./routes/settings.js";
import tradingRoutes from "./routes/trading.js";
import swaggerSpec from "./swagger.js";
import { getDocsHtml } from "./docs-html.js";

// Trading services
import * as PriceFeedService from "./trading/services/PriceFeedService.js";
import * as GridSchedulerService from "./trading/services/GridSchedulerService.js";

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3001;

// WebSocket server for price feeds
const wss = new WebSocketServer({ server, path: "/ws/prices" });

// SQLite is initialized automatically when importing models
console.log("✅ Using SQLite database (no MongoDB required)");

// Middleware - CORS (allow ngrok and localhost)
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);

      // Allow localhost and ngrok
      if (
        origin.includes("localhost") ||
        origin.includes("127.0.0.1") ||
        origin.includes("ngrok") ||
        origin.includes("ngrok-free.app")
      ) {
        return callback(null, true);
      }

      callback(null, true); // Allow all for demo
    },
    credentials: true,
  })
);
// Zwiększ limit rozmiaru requestu dla dużych payloadów (np. pozycje z calculationDetails)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Konfiguracja sesji - użyj PostgreSQL store na produkcji, MemoryStore lokalnie
function setupSessionStore() {
  const DATABASE_URL = process.env.DATABASE_URL;
  
  if (DATABASE_URL) {
    // Produkcja - użyj PostgreSQL store
    const PgSession = connectPgSimple(session);
    const { Pool } = pg;
    const pgPool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
    });
    
    const sessionStore = new PgSession({
      pool: pgPool,
      tableName: "session", // tabela dla sesji w PostgreSQL
      createTableIfMissing: true, // automatycznie utworzy tabelę jeśli nie istnieje
    });
    
    console.log("✅ Using PostgreSQL session store");
    return sessionStore;
  } else {
    // Lokalnie - użyj MemoryStore (dla developmentu)
    console.log("ℹ️ Using MemoryStore for sessions (development mode)");
    return undefined; // undefined = domyślny MemoryStore
  }
}

const sessionStore = setupSessionStore();

app.use(
  session({
    store: sessionStore,
    secret: process.env.JWT_SECRET || "dev-session-key-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Rate limiting – ochrona endpointów auth przed brute-force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minut
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

// Routes
app.use("/auth", authLimiter, authRoutes);
app.use("/settings", settingsRoutes);
app.use("/api/trading", tradingRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "gridbot-unified",
    features: ["auth", "settings", "trading", "price-feed"],
  });
});

// API docs – Swagger UI z przyciskiem Connect wallet (bez cache, zeby zawsze brac aktualna spec)
app.get("/docs/openapi.json", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.json(swaggerSpec);
});
app.get(["/docs", "/docs/"], (req, res) => {
  const baseUrl = (req.protocol + "://" + req.get("host")).replace(/\/$/, "");
  res.type("html").send(getDocsHtml(baseUrl));
});

// Serve frontend static files – sprawdzamy kilka możliwych lokalizacji (dev z repo, docker, cwd)
function findFrontendDist() {
  const candidates = [
    process.env.FRONTEND_DIST_PATH,
    path.join(__dirname, "../frontend/dist"),   // auth-service/frontend/dist (np. Docker)
    path.join(__dirname, "../../frontend/dist"), // GridBot/frontend/dist (dev z auth-service)
    path.resolve(process.cwd(), "frontend/dist"),
    path.resolve(process.cwd(), "../frontend/dist"),
  ].filter(Boolean);
  for (const dir of candidates) {
    const indexFile = path.join(dir, "index.html");
    if (fs.existsSync(dir) && fs.existsSync(indexFile)) return dir;
  }
  return null;
}
const frontendPath = findFrontendDist();
const frontendExists = frontendPath !== null;

if (frontendExists) {
  console.log("📦 Serving frontend from:", frontendPath);
  app.use(express.static(frontendPath));

  // SPA fallback - serve index.html for all non-API routes
  app.get("*", (req, res, next) => {
    if (
      req.path.startsWith("/auth") ||
      req.path.startsWith("/settings") ||
      req.path.startsWith("/api") ||
      req.path.startsWith("/health") ||
      req.path.startsWith("/ws") ||
      req.path.startsWith("/docs")
    ) {
      return next();
    }
    res.sendFile(path.join(frontendPath, "index.html"));
  });
} else {
  console.log("ℹ️ Frontend not found - serving API only.");
  console.log("   Aby serwować frontend z backendem: w katalogu frontend uruchom: npm run build");
  
  // API-only fallback - return 404 for non-API routes
  app.get("*", (req, res, next) => {
    if (
      req.path.startsWith("/auth") ||
      req.path.startsWith("/settings") ||
      req.path.startsWith("/docs") ||
      req.path.startsWith("/api") ||
      req.path.startsWith("/health") ||
      req.path.startsWith("/ws")
    ) {
      return next();
    }
    res.status(404).json({
      error: "Not Found",
      message: "API endpoint not found. Frontend is deployed separately.",
      availableEndpoints: ["/auth", "/settings", "/api/trading", "/health"]
    });
  });
}

// Centralny error handler – łapie niezłapane błędy z route'ów
app.use((err, req, res, _next) => {
  console.error(`❌ Unhandled error on ${req.method} ${req.path}:`, err.message);
  if (process.env.NODE_ENV !== "production") {
    console.error(err.stack);
  }
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message || "Internal server error",
  });
});

// Initialize trading services (po załadowaniu .env)
PriceFeedService.init(wss);
GridSchedulerService.start();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  GridSchedulerService.stop();
  PriceFeedService.cleanup();
  process.exit(0);
});

server.listen(PORT, () => {
  console.log(`🚀 GridBot Unified Service running on port ${PORT}`);
  console.log(`   📡 REST API: http://localhost:${PORT}`);
  console.log(`   🔌 WebSocket: ws://localhost:${PORT}/ws/prices`);
});
