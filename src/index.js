import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "node:path";
import fs from "node:fs";
import { connectDB } from "./config/db.js";
import { authRequired } from "./middleware/auth.js";
import { warmupBrowser, closeBrowser } from "./services/cardGenerator.js";
import authRouter from "./routes/auth.js";
import eventsRouter from "./routes/events.js";
import guestsRouter from "./routes/guests.js";
import cardsRouter from "./routes/cards.js";
import rsvpRouter from "./routes/rsvp.js";

const app = express();
const PORT = process.env.PORT || 4000;
const isProd = process.env.NODE_ENV === "production";

const origins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Behind nginx in production — trust the first proxy so client IPs (used by the
// login rate limiter) and protocol are correct.
app.set("trust proxy", 1);

// Security headers. CSP is disabled because the SPA uses inline styles and
// data: URIs; CORP is cross-origin so the dashboard can load the QR <img> from
// the API origin during local dev (same-origin in production).
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(cors({ origin: origins }));
app.use(express.json({ limit: "1mb" }));

// Request log — so you can see every call hit the backend (incl. PDF downloads).
app.use((req, res, next) => {
  const t = Date.now();
  res.on("finish", () =>
    console.log(`[req] ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - t}ms)`)
  );
  next();
});

// --- API ---
app.get("/api/health", (req, res) => res.json({ ok: true }));

// Public: login + the guest-facing RSVP endpoints.
app.use("/api/auth", authRouter);
app.use("/api/rsvp", rsvpRouter);

// Admin-only: everything below requires a valid token.
app.use("/api/event", authRequired, eventsRouter);
app.use("/api/guests", authRequired, guestsRouter);
app.use("/api/cards", authRequired, cardsRouter);

// --- Serve the built React client in production (single-server deploy) ---
const clientDist = path.resolve("../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: anything not under /api returns index.html so client-side
  // routes like /r/:token and the dashboard work on direct load / QR scan.
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  app.get("/", (req, res) =>
    res.send("API running. Build the client (npm run build in /client) or use Vite dev on :5173.")
  );
}

// --- Central error handler ---
app.use((err, req, res, next) => {
  console.error("[error]", err);
  // Don't leak internal error details to clients in production.
  res.status(err.status || 500).json({
    error: isProd ? "هەڵەیەکی ناوخۆیی ڕوویدا." : err.message || "Internal server error",
  });
});

connectDB(process.env.MONGODB_URI)
  .then(() => {
    // Bind to 0.0.0.0 (IPv4, all interfaces) so Azure App Service's container
    // health ping can reach us. Node's default bind is IPv6 "::", which the
    // platform's IPv4 ping may not reach → it restarts the container every 230s.
    const server = app.listen(PORT, "0.0.0.0", () =>
      console.log(`[server] listening on 0.0.0.0:${PORT}`)
    );
    // NOTE: Chromium is intentionally NOT warmed up at startup. On a small
    // (1-core Basic) App Service instance, launching Chromium here starves the
    // event loop, so Azure's startup health probe never gets a response and the
    // platform kills the container at the 230s timeout. The browser now launches
    // lazily on the first PDF/ZIP request (getBrowser()), keeping startup instant.
    void warmupBrowser; // intentionally not called at boot — see note above

    // Graceful shutdown: stop accepting requests, close the browser, exit.
    const shutdown = async (sig) => {
      console.log(`[server] ${sig} received — shutting down`);
      server.close();
      await closeBrowser();
      process.exit(0);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  })
  .catch((err) => {
    console.error("[fatal] could not start:", err.message);
    process.exit(1);
  });
