import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../audit.js";
import { wrap, httpError } from "../util.js";

const router = Router();
export const ROLES = ["investigator", "compliance_manager", "admin", "data_officer"];

router.post("/login", wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  const u = rows[0];
  if (!u || !u.active || !(await bcrypt.compare(password || "", u.password_hash))) {
    await audit(u?.id ?? null, "login_failed", "user", String(email || ""));
    throw httpError(401, "wrong email or password");
  }
  const token = jwt.sign({ id: u.id }, process.env.JWT_SECRET, { expiresIn: "8h" });
  await audit(u.id, "login", "user", String(u.id));
  res.json({ token, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
}));

router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

// Only admins create accounts.
router.post("/users", requireAuth, requireRole("admin"), wrap(async (req, res) => {
  const { email, name, password, role } = req.body || {};
  if (!ROLES.includes(role)) throw httpError(400, "bad role");
  if (!email || !/^\S+@\S+$/.test(email)) throw httpError(400, "enter a valid email");
  if (!name || !name.trim()) throw httpError(400, "enter a name");
  if (!password || password.length < 8) throw httpError(400, "password must be at least 8 characters");
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      "INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, email, name, role, active",
      [email.trim().toLowerCase(), name.trim(), hash, role]
    );
    await audit(req.user.id, "user_created", "user", String(rows[0].id), { role });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === "23505") throw httpError(409, "that email is already registered");
    throw e;
  }
}));

export default router;
