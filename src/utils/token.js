import { customAlphabet } from "nanoid";

// URL-safe, unambiguous alphabet (no look-alike chars). 12 chars ≈ very low collision risk.
const nanoid = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 12);

export function makeToken() {
  return nanoid();
}
