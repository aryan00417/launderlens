import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../audit.js";

const router = Router();
const ROLES = ["investigator", "compliance_manager", "admin", "data_officer"];

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password || "", u.password_hash))) {
    await audit(u?.id ?? null, "login_failed", "user", email);
    return res.status(401).json({ error: "wrong email or password" });
  }
  const token = jwt.sign({ id: u.id, role: u.role, name: u.name }, process.env.JWT_SECRET, { expiresIn: "8h" });
  await audit(u.id, "login", "user", String(u.id));
  res.json({ token, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
});

router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

// Only admins create accounts.
router.post("/users", requireAuth, requireRole("admin"), async (req, res) => {
  const { email, name, password, role } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: "bad role" });
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    "INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, email, name, role",
    [email, name, hash, role]
  );
  await audit(req.user.id, "user_created", "user", String(rows[0].id), { role });
  res.status(201).json(rows[0]);
});

export default router;
