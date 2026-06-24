import jwt from "jsonwebtoken";

/** Protects admin-only routes: requires a valid Bearer token. */
export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  let token = header.startsWith("Bearer ") ? header.slice(7) : null;
  // Fallback: token via query param, for direct download links (e.g. the bulk
  // PDF) that are triggered by browser navigation and can't set a header.
  if (!token && req.query.token) token = String(req.query.token);
  if (!token) return res.status(401).json({ error: "Not authenticated." });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Session expired. Please log in again." });
  }
}
