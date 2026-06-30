import { Router } from "express";
import Guest from "../models/Guest.js";
import Event from "../models/Event.js";

const router = Router();

// GET /api/rsvp/:token  -> public: details a guest needs to see when scanning
router.get("/:token", async (req, res) => {
  const guest = await Guest.findOne({ token: req.params.token });
  if (!guest) return res.status(404).json({ error: "بانگهێشتنامە نەدۆزرایەوە." });

  const event = await Event.findById(guest.event);
  res.json({
    guestName: guest.name,
    eventTitle: event?.title || "",
    eventDate: event?.date || null,
    address: guest.resolvedAddress(event),
    seatNumber: guest.seatNumber,
    canInvite: !!guest.canInvite,
    rsvp: guest.rsvp,
  });
});

// POST /api/rsvp/:token  -> public: submit the response
// body: { status: 'attending'|'declined', guestCount, guestNames: [] }
router.post("/:token", async (req, res) => {
  const guest = await Guest.findOne({ token: req.params.token });
  if (!guest) return res.status(404).json({ error: "بانگهێشتنامە نەدۆزرایەوە." });

  const { status, guestCount = 0, guestNames = [] } = req.body;
  if (!["attending", "declined"].includes(status)) {
    return res.status(400).json({ error: "تکایە وەڵامێکی دروست هەڵبژێرە." });
  }

  // Extra people are only honored when THIS guest is allowed to invite
  // (guest.canInvite). Otherwise forced to empty — can't be bypassed via API.
  guest.rsvp.status = status;
  if (status === "attending" && guest.canInvite) {
    const MAX_GUESTS = 50;
    const count = Math.min(MAX_GUESTS, Math.max(0, Math.floor(Number(guestCount) || 0)));
    guest.rsvp.guestCount = count;
    guest.rsvp.guestNames = Array.isArray(guestNames)
      ? guestNames.slice(0, count || MAX_GUESTS).map((n) => String(n).trim().slice(0, 80)).filter(Boolean)
      : [];
  } else {
    guest.rsvp.guestCount = 0;
    guest.rsvp.guestNames = [];
  }
  guest.rsvp.respondedAt = new Date();
  await guest.save();

  res.json({ ok: true, rsvp: guest.rsvp });
});

export default router;
