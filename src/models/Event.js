import mongoose from "mongoose";

/**
 * An Event holds the details shown on the RSVP page. The card design itself is
 * a static file (see server/assets/template.png and src/config/template.js),
 * so template/placement are no longer stored here.
 */
const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    date: { type: Date },
    // Default venue address shown on the RSVP page (a guest row can override it).
    venueAddress: { type: String, default: "", maxlength: 300 },

    // Editable header/office line printed on the card (admin can type anything).
    orgText: {
      type: String,
      default: "مەکتەبی پەیوەندییەکانی یەکێتیی نیشتمانیی کوردستان و نەوەی نوێ",
      maxlength: 400,
    },
    // Whether the logos are shown on the card.
    showLogo: { type: Boolean, default: true },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Event", eventSchema);
