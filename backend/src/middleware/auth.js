import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";

// Checks the token, then reloads the user so role changes and deactivation apply at once.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing token" });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "invalid or expired token" });
  }
  try {
    const { rows } = await pool.query("SELECT id, name, role, active FROM users WHERE id = $1", [payload.id]);
    const u = rows[0];
    if (!u || !u.active) return res.status(401).json({ error: "account is disabled" });
    req.user = { id: u.id, name: u.name, role: u.role };
    next();
  } catch (e) {
    next(e);
  }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ error: "forbidden" });
