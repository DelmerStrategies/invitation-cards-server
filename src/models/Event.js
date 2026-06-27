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

    // Editable invitation body text (one paragraph per line). Default = the
    // wording originally baked into the card template.
    bodyText: {
      type: String,
      default:
        "بەخۆشحاڵییەوە بەڕێزتان بانگهێشتکراوون بۆ مەڕاسیمی ئیمزاکردنی رێککەوتنی سیاسی نێوان یەکێتیی نیشتمانیی کوردستان و جوڵانەوەی نەوەی نوێ..\n" +
        "ئامانجی ئەم رێککەوتنە گێڕانەوەی باڵانسی هێزەو رێکخستنەوەی رێڕەوی حوکمڕانییە و چەسپاندنی دادپەروەرییە و خزمەتکردنێکی باشتر و شایستەی هاوڵاتییانە..\n" +
        "ئامادەبوونتان مایەی خۆشحاڵیمانە",
      maxlength: 3000,
    },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Event", eventSchema);
