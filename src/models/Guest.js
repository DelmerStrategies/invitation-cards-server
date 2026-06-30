import mongoose from "mongoose";

const guestSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 200 },
    // Per-guest address override. If empty, the event's venueAddress is used.
    address: { type: String, default: "", maxlength: 300 },
    seatNumber: { type: String, default: "", maxlength: 80 }, // "set number" / table / seat label

    // VIP guests are listed separately and their cards have NO QR code / no
    // clickable RSVP link. (Absent/false = a normal guest.)
    isVip: { type: Boolean, default: false, index: true },

    // When true, this guest may bring extra people (the RSVP page shows the
    // count + names inputs). Default false = confirm for themselves only.
    canInvite: { type: Boolean, default: false },

    // Unique, hard-to-guess token used in the QR link: /r/<token>
    token: { type: String, required: true, unique: true, index: true },

    rsvp: {
      status: {
        type: String,
        enum: ["pending", "attending", "declined"],
        default: "pending",
      },
      // How many additional people the guest brings (not counting themselves).
      guestCount: { type: Number, default: 0, min: 0 },
      guestNames: { type: [String], default: [] },
      respondedAt: { type: Date },
    },
  },
  { timestamps: true }
);

// Resolve the address to show: per-guest override, else event default.
guestSchema.methods.resolvedAddress = function (event) {
  return this.address || (event && event.venueAddress) || "";
};

export default mongoose.model("Guest", guestSchema);
