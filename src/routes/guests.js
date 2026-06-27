import { Router } from "express";
import multer from "multer";
import { parse } from "csv-parse/sync";
import Guest from "../models/Guest.js";
import { getActiveEvent } from "./events.js";
import { makeToken } from "../utils/token.js";
import { rsvpUrl } from "../utils/rsvpUrl.js";
import { adminOnly } from "../middleware/auth.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * GET /api/guests?page=&limit=&q=
 * Paginated + searchable. Returns { items, total, page, pages, stats }.
 * `stats` is computed over the WHOLE event (not just the page/search).
 */
router.get("/", async (req, res) => {
  const event = await getActiveEvent();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const q = (req.query.q || "").trim();
  // `vip=true` -> the VIP tab; otherwise normal guests (absent/false isVip).
  const vip = req.query.vip === "true";
  const vipMatch = vip ? true : { $ne: true };

  const filter = { event: event._id, isVip: vipMatch };
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ name: rx }, { seatNumber: rx }, { address: rx }];
  }

  const [total, docs, statsAgg] = await Promise.all([
    Guest.countDocuments(filter),
    Guest.find(filter).sort({ createdAt: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Guest.aggregate([
      { $match: { event: event._id, isVip: vipMatch } },
      {
        $group: {
          _id: "$rsvp.status",
          count: { $sum: 1 },
          heads: { $sum: { $add: [1, { $ifNull: ["$rsvp.guestCount", 0] }] } },
        },
      },
    ]),
  ]);

  const stats = { total: 0, attending: 0, declined: 0, pending: 0, totalHeads: 0 };
  for (const g of statsAgg) {
    stats.total += g.count;
    if (g._id === "attending") {
      stats.attending = g.count;
      stats.totalHeads = g.heads;
    } else if (g._id === "declined") stats.declined = g.count;
    else stats.pending += g.count;
  }

  res.json({
    items: docs.map((g) => ({ ...g, rsvpUrl: rsvpUrl(g.token) })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    stats,
  });
});

// POST /api/guests  -> add one guest manually (admin only)
router.post("/", adminOnly, async (req, res) => {
  const event = await getActiveEvent();
  const { name, address = "", seatNumber = "", isVip = false } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });

  const guest = await Guest.create({
    event: event._id,
    name: name.trim(),
    address,
    seatNumber,
    isVip: !!isVip,
    token: makeToken(),
  });
  res.status(201).json(guest);
});

// PUT /api/guests/:id  -> edit a guest's details (admin only)
router.put("/:id", adminOnly, async (req, res) => {
  const { name, address, seatNumber } = req.body;
  const update = {};
  if (name !== undefined) update.name = name;
  if (address !== undefined) update.address = address;
  if (seatNumber !== undefined) update.seatNumber = seatNumber;

  const guest = await Guest.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!guest) return res.status(404).json({ error: "Guest not found." });
  res.json(guest);
});

// DELETE /api/guests/:id  (admin only)
router.delete("/:id", adminOnly, async (req, res) => {
  const guest = await Guest.findByIdAndDelete(req.params.id);
  if (!guest) return res.status(404).json({ error: "Guest not found." });
  res.json({ ok: true });
});

/**
 * POST /api/guests/import  (multipart, field 'file')
 * CSV columns (case-insensitive, flexible): name, address, seat / seatNumber / set
 * Returns { added, skipped, errors }.
 */
router.post("/import", adminOnly, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No CSV file uploaded (field 'file')." });

  const event = await getActiveEvent();
  const isVip = req.query.vip === "true"; // import straight into the VIP list

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
      isVip,
      token: makeToken(),
    });
  }

  const inserted = docs.length ? await Guest.insertMany(docs) : [];
  res.json({ added: inserted.length, skipped, total: records.length });
});

export default router;
