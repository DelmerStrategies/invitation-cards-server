import { Router } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { authRequired } from "../middleware/auth.js";

const router = Router();

// Throttle login attempts to slow down brute-force / credential stuffing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "هەوڵی زۆر بۆ چوونەژوورەوە. تکایە دوای ماوەیەک هەوڵ بدەرەوە." },
});

// Constant-time string compare to avoid leaking length/timing.
function safeEqual(a = "", b = "") {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// POST /api/auth/login  { username, password } -> { token, username, role }
router.post("/login", loginLimiter, (req, res) => {
  const { username = "", password = "" } = req.body || {};

  const isAdmin =
    safeEqual(username, process.env.ADMIN_USERNAME || "") &&
    safeEqual(password, process.env.ADMIN_PASSWORD || "");
  // Read-only viewer account (optional — only active if VIEWER_* env vars set).
  const isViewer =
    !!process.env.VIEWER_USERNAME &&
    safeEqual(username, process.env.VIEWER_USERNAME || "") &&
    safeEqual(password, process.env.VIEWER_PASSWORD || "");

  if (!isAdmin && !isViewer) {
    return res.status(401).json({ error: "ناوی بەکارهێنەر یان وشەی نهێنی هەڵەیە." });
  }

  const role = isAdmin ? "admin" : "viewer";
  const token = jwt.sign({ sub: username, role }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, username, role });
});

// GET /api/auth/me  -> verify the current token is still valid
router.get("/me", authRequired, (req, res) => {
  res.json({ username: req.user.sub, role: req.user.role });
});

export default router;
