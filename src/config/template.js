/**
 * Static invitation design.
 *
 * The design is an HTML file at server/assets/template.html, rendered per guest
 * with a headless browser (so RTL Kurdish/Arabic text and web fonts render
 * correctly). Two placeholders are substituted per guest:
 *   {{GUEST_NAME}}  -> the invited person's name
 *   {{QR_DATA_URI}} -> a real QR code linking to their RSVP page
 *
 * To change the design, edit assets/template.html. Keep the #card element and
 * both placeholders.
 */
export const TEMPLATE = {
  file: "template.html",
  cardSelector: ".card", // the element captured as the card image
  // Render scale factor — higher = crisper for print (3 ≈ print quality).
  // Lower to 2 for ~2x faster generation + smaller files if print quality allows.
  scale: Number(process.env.PDF_SCALE) || 3,
  // How many cards to render in parallel. Higher = faster but more RAM/CPU.
  // On a small VPS (≤2GB) keep this 2–3; bump up on a bigger box.
  concurrency: Math.max(1, Number(process.env.PDF_CONCURRENCY) || 3),
};
