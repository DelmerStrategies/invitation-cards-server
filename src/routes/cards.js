import { Router } from "express";
import archiver from "archiver";
import QRCode from "qrcode";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import Guest from "../models/Guest.js";
import { getActiveEvent } from "./events.js";
import { generateCardPng, generateBulkPdf, streamPerGuestPdfs } from "../services/cardGenerator.js";
import { rsvpUrl } from "../utils/rsvpUrl.js";
import { adminOnly } from "../middleware/auth.js";

// Make a filesystem-safe file name, keeping Kurdish/Arabic letters.
function safeName(s = "") {
  return String(s).replace(/[\/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

const router = Router();
const buildQrUrl = (guest) => rsvpUrl(guest.token);

// GET /api/cards/qr/:id  -> QR PNG for one guest (clickable in the dashboard).
router.get("/qr/:id", async (req, res) => {
  const guest = await Guest.findById(req.params.id);
  if (!guest) return res.status(404).json({ error: "Guest not found." });
  try {
    const png = await QRCode.toBuffer(buildQrUrl(guest), {
      type: "png", width: 300, margin: 1, errorCorrectionLevel: "M",
    });
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "no-store");
    res.send(png);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/cards/preview/:id  -> single card PNG (dashboard preview)
router.get("/preview/:id", adminOnly, async (req, res) => {
  const event = await getActiveEvent();
  const guest = await Guest.findById(req.params.id);
  if (!guest) return res.status(404).json({ error: "Guest not found." });
  try {
    const png = await generateCardPng(guest, buildQrUrl(guest), event);
    res.set("Content-Type", "image/png");
    res.send(png);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Build a ZIP (one PDF per guest) into a single Buffer, STREAMING: each card is
// rendered, appended to the archive, then released — so memory stays flat even
// for big batches on a small (B1) instance.
function streamZip(event, guests, onProgress, size) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sink = new Writable({ write(c, e, cb) { chunks.push(c); cb(); } });
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", reject);
    sink.on("finish", () => resolve(Buffer.concat(chunks)));
    archive.pipe(sink);
    streamPerGuestPdfs(guests, buildQrUrl, event, onProgress, (guest, pdf, i) => {
      const prefix = String(i + 1).padStart(3, "0");
      archive.append(pdf, { name: `${prefix} - ${safeName(guest.name) || "guest"}.pdf` });
    }, size)
      .then(() => archive.finalize())
      .catch(reject);
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Background export jobs (so big exports show progress instead of a frozen
// multi-minute request). In-memory store — fine for a single-admin tool.
// ──────────────────────────────────────────────────────────────────────────
const jobs = new Map();
const JOB_TTL = 15 * 60 * 1000; // keep finished jobs 15 min

// Periodically drop old jobs to free memory.
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.createdAt > JOB_TTL) jobs.delete(id);
}, 60 * 1000).unref();

async function startExport(type, vip = false, size = "a4") {
  const event = await getActiveEvent();
  const filter = { event: event._id, isVip: vip ? true : { $ne: true } };
  const guests = await Guest.find(filter).sort({ createdAt: 1 });
  if (!guests.length) return { error: "هیچ میوانێک نییە بۆ دروستکردن." };

  const stem = `${vip ? "vip-cards" : "invitation-cards"}-${size}`;
  const id = randomUUID();
  const job = {
    id, type, status: "running", total: guests.length, done: 0,
    buffer: null, filename: null, error: null, createdAt: Date.now(),
  };
  jobs.set(id, job);

  const onProgress = (done) => { job.done = done; };
  const run =
    type === "pdf"
      ? generateBulkPdf(guests, buildQrUrl, event, onProgress, size).then((buf) => ({
          buffer: buf, filename: `${stem}.pdf`,
        }))
      : streamZip(event, guests, onProgress, size).then((buf) => ({ buffer: buf, filename: `${stem}.zip` }));

  run
    .then(({ buffer, filename }) => {
      job.buffer = buffer;
      job.filename = filename;
      job.done = job.total;
      job.status = "ready";
    })
    .catch((err) => {
      console.error(`[export ${type}] failed:`, err);
      job.status = "error";
      job.error = err.message;
    });

  return { jobId: id, total: guests.length };
}

// POST /api/cards/pdf/start  | /api/cards/zip/start  -> { jobId, total }
const normSize = (s) => (s === "a5" ? "a5" : "a4");
router.post("/pdf/start", adminOnly, async (req, res) => {
  const r = await startExport("pdf", req.query.vip === "true", normSize(req.query.size));
  if (r.error) return res.status(400).json(r);
  res.json(r);
});
router.post("/zip/start", adminOnly, async (req, res) => {
  const r = await startExport("zip", req.query.vip === "true", normSize(req.query.size));
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// GET /api/cards/job/:id  -> progress
router.get("/job/:id", adminOnly, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found (maybe expired)." });
  res.json({ status: job.status, total: job.total, done: job.done, error: job.error });
});

// GET /api/cards/job/:id/download  -> the finished file
router.get("/job/:id/download", adminOnly, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found (maybe expired)." });
  if (job.status === "error") return res.status(400).json({ error: job.error });
  if (job.status !== "ready" || !job.buffer) return res.status(409).json({ error: "Not ready yet." });
  res.set("Content-Type", "application/octet-stream");
  res.set("Content-Disposition", `attachment; filename="${job.filename}"`);
  res.send(job.buffer);
});

export default router;
