// Build the public RSVP URL that a guest's QR / link points to.
// Driven by PUBLIC_BASE_URL (e.g. http://192.168.1.20:5173 for LAN phone
// testing, or https://rsvp.tomar-puk.com in production).
export function rsvpUrl(token) {
  const base = (process.env.PUBLIC_BASE_URL || "http://localhost:4000").replace(/\/$/, "");
  return `${base}/r/${token}`;
}
