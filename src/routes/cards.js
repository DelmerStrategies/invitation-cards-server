import { Router } from "express";
import archiver from "archiver";
import QRCode from "qrcode";
import Guest from "../models/Guest.js";
import { getActiveEvent } from "./events.js";
import { generateCardPng, generateBulkPdf, generatePerGuestPdfs } from "../services/cardGenerator.js";
import { rsvpUrl } from "../utils/rsvpUrl.js";

// Make a filesystem-safe file name, keeping Kurdish/Arabic letters.
function safeName(s = "") {
  return String(s).replace(/[\/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

const router = Router();

const buildQrUrl = (guest) => rsvpUrl(guest.token);

// GET /api/cards/qr/:id  -> just the QR code PNG for one guest (shown clickable
// in the dashboard so you can scan it from a phone or click to open).
router.get("/qr/:id", async (req, res) => {
  const guest = await Guest.findById(req.params.id);
  if (!guest) return res.status(404).json({ error: "Guest not found." });
  try {
    const png = await QRCode.toBuffer(buildQrUrl(guest), {
      type: "png",
      width: 300,
      margin: 1,
      errorCorrectionLevel: "M",
    });
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "no-store");
    res.send(png);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/cards/preview/:id  -> single card PNG (used for dashboard preview)
router.get("/preview/:id", async (req, res) => {
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

// GET /api/cards/pdf  -> bulk PDF of every guest's card
router.get("/pdf", async (req, res) => {
  const event = await getActiveEvent();
  const guests = await Guest.find({ event: event._id }).sort({ createdAt: 1 });
  if (!guests.length) return res.status(400).json({ error: "No guests to generate." });

  try {
    const pdf = await generateBulkPdf(guests, buildQrUrl, event);
    // Use octet-stream (not application/pdf) so browser PDF-viewer extensions
    // don't hijack the response; we force the .pdf filename for the download.
    res.set("Content-Type", "application/octet-stream");
    res.set("Content-Disposition", 'attachment; filename="invitation-cards.pdf"');
    res.send(pdf);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/cards/zip  -> a ZIP containing one separate PDF per guest
router.get("/zip", async (req, res) => {
  const event = await getActiveEvent();
  const guests = await Guest.find({ event: event._id }).sort({ createdAt: 1 });
  if (!guests.length) return res.status(400).json({ error: "هیچ میوانێک نییە بۆ دروستکردن." });

  let items;
  try {
    items = await generatePerGuestPdfs(guests, buildQrUrl, event);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  res.set("Content-Type", "application/zip");
  res.set("Content-Disposition", 'attachment; filename="invitation-cards.zip"');

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => {
    console.error("[zip] error", err);
    res.destroy(err);
  });
  archive.pipe(res);

  items.forEach(({ guest, pdf }, i) => {
    const prefix = String(i + 1).padStart(3, "0");
    const name = safeName(guest.name) || "guest";
    archive.append(pdf, { name: `${prefix} - ${name}.pdf` });
  });

  await archive.finalize();
});

export default router;
