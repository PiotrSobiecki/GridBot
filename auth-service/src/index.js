// MUSI BYĆ NAJPIERW - przed wszystkimi importami używającymi process.env
import dotenv from "dotenv";
import path from "path";
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
import { createServer } from "http";
import { WebSocketServer } from "ws";

// Routes
import authRoutes from "./routes/auth.js";
import settingsRoutes from "./routes/settings.js";
import tradingRoutes from "./routes/trading.js";

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
app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    secret: process.env.JWT_SECRET || "gridbot-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Routes
app.use("/auth", authRoutes);
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

// Serve frontend static files (production)
const frontendPath = path.join(__dirname, "../../frontend/dist");
app.use(express.static(frontendPath));

// SPA fallback - serve index.html for all non-API routes
app.get("*", (req, res, next) => {
  if (
    req.path.startsWith("/auth") ||
    req.path.startsWith("/settings") ||
    req.path.startsWith("/api") ||
    req.path.startsWith("/health")
  ) {
    return next();
  }
  res.sendFile(path.join(frontendPath, "index.html"));
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
