import { Router } from "express";
import Event from "../models/Event.js";
import { adminOnly } from "../middleware/auth.js";

const router = Router();

/** Get the active event, creating a default one if none exists. */
export async function getActiveEvent() {
  let event = await Event.findOne({ isActive: true }).sort({ createdAt: -1 });
  if (!event) {
    event = await Event.create({ title: "My Event" });
  }
  return event;
}

// GET /api/event  -> the active event
router.get("/", async (req, res) => {
  const event = await getActiveEvent();
  res.json(event);
});

// PUT /api/event  -> update title/date/venueAddress (admin only)
router.put("/", adminOnly, async (req, res) => {
  const event = await getActiveEvent();
  const { title, date, venueAddress, orgText, showLogo } = req.body;

  if (title !== undefined) event.title = title;
  if (date !== undefined) event.date = date;
  if (venueAddress !== undefined) event.venueAddress = venueAddress;
  if (orgText !== undefined) event.orgText = orgText;
  if (showLogo !== undefined) event.showLogo = !!showLogo;

  await event.save();
  res.json(event);
});

export default router;
