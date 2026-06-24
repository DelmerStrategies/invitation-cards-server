import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import Guest from "../models/Guest.js";
import { getActiveEvent } from "./events.js";
import { makeToken } from "../utils/token.js";
import { rsvpUrl } from "../utils/rsvpUrl.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// GET /api/guests  -> all guests for the active event (with their RSVP link)
router.get("/", async (req, res) => {
  const event = await getActiveEvent();
  const guests = await Guest.find({ event: event._id }).sort({ createdAt: 1 }).lean();
  res.json(guests.map((g) => ({ ...g, rsvpUrl: rsvpUrl(g.token) })));
});

// POST /api/guests  -> add one guest manually
router.post("/", async (req, res) => {
  const event = await getActiveEvent();
  const { name, address = "", seatNumber = "" } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });

  const guest = await Guest.create({
    event: event._id,
    name: name.trim(),
    address,
    seatNumber,
    token: makeToken(),
  });
  res.status(201).json(guest);
});

// PUT /api/guests/:id  -> edit a guest's details
router.put("/:id", async (req, res) => {
  const { name, address, seatNumber } = req.body;
  const update = {};
  if (name !== undefined) update.name = name;
  if (address !== undefined) update.address = address;
  if (seatNumber !== undefined) update.seatNumber = seatNumber;

  const guest = await Guest.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!guest) return res.status(404).json({ error: "Guest not found." });
  res.json(guest);
});

// DELETE /api/guests/:id
router.delete("/:id", async (req, res) => {
  const guest = await Guest.findByIdAndDelete(req.params.id);
  if (!guest) return res.status(404).json({ error: "Guest not found." });
  res.json({ ok: true });
});

/**
 * POST /api/guests/import  (multipart, field 'file')
 * CSV columns (case-insensitive, flexible): name, address, seat / seatNumber / set
 * Returns { added, skipped, errors }.
 */
router.post("/import", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No CSV file uploaded (field 'file')." });

  const event = await getActiveEvent();

  let records;
  try {
    records = parse(req.file.buffer.toString("utf8"), {
      columns: (header) => header.map((h) => h.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
    });
  } catch (err) {
    return res.status(400).json({ error: "Could not parse CSV: " + err.message });
  }

  const docs = [];
  let skipped = 0;
  for (const row of records) {
    const name = row.name || row["full name"] || row.guest || "";
    if (!name.trim()) {
      skipped++;
      continue;
    }
    docs.push({
      event: event._id,
      name: name.trim(),
      address: row.address || row.place || "",
      seatNumber: row.seatnumber || row.seat || row.set || row["seat number"] || "",
      token: makeToken(),
    });
  }

  const inserted = docs.length ? await Guest.insertMany(docs) : [];
  res.json({ added: inserted.length, skipped, total: records.length });
});

export default router;
