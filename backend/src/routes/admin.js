import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../audit.js";
import { wrap, httpError } from "../util.js";
import { ROLES } from "./auth.js";

const router = Router();
router.use(requireAuth);

// ---- users (admin) ----
router.get("/users", requireRole("admin"), wrap(async (_req, res) => {
  const { rows } = await pool.query("SELECT id, email, name, role, active, created_at FROM users ORDER BY id");
  res.json({ users: rows });
}));

router.patch("/users/:id", requireRole("admin"), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { role, active } = req.body || {};
  if (!Number.isInteger(id)) throw httpError(400, "bad user id");
  if (role !== undefined && !ROLES.includes(role)) throw httpError(400, "bad role");
  if (active !== undefined && typeof active !== "boolean") throw httpError(400, "active must be true or false");
  if (id === req.user.id && ((role !== undefined && role !== "admin") || active === false)) {
    throw httpError(400, "you can't remove your own admin access");
  }
  const { rows } = await pool.query(
    "UPDATE users SET role = COALESCE($2::user_role, role), active = COALESCE($3::boolean, active) WHERE id = $1 RETURNING id, email, name, role, active",
    [id, role ?? null, active ?? null]);
  if (!rows.length) throw httpError(404, "user not found");
  await audit(req.user.id, "user_updated", "user", String(id), { role: role ?? null, active: active ?? null });
  res.json(rows[0]);
}));

router.post("/users/:id/password", requireRole("admin"), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body || {};
  if (!Number.isInteger(id)) throw httpError(400, "bad user id");
  if (!password || password.length < 8) throw httpError(400, "password must be at least 8 characters");
  const r = await pool.query("UPDATE users SET password_hash = $2 WHERE id = $1", [id, await bcrypt.hash(password, 10)]);
  if (!r.rowCount) throw httpError(404, "user not found");
  await audit(req.user.id, "password_reset", "user", String(id));
  res.json({ ok: true });
}));

// People a case can be assigned to.
router.get("/assignable", requireRole("compliance_manager", "admin"), wrap(async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, role FROM users WHERE active AND role IN ('investigator','compliance_manager','admin') ORDER BY name");
  res.json({ users: rows });
}));

// ---- audit log (read only) ----
router.get("/audit", requireRole("admin", "compliance_manager"), wrap(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const where = [];
  const params = [];
  for (const [key, col] of [["action", "l.action"], ["entity", "l.entity"], ["user_id", "l.user_id"]]) {
    if (req.query[key]) {
      params.push(key === "user_id" ? Number(req.query[key]) : String(req.query[key]));
      where.push(`${col} = $${params.length}`);
    }
  }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const rows = await pool.query(
    `SELECT l.id, l.action, l.entity, l.entity_id, l.detail, l.created_at, u.name AS user_name, u.role AS user_role
       FROM audit_log l LEFT JOIN users u ON u.id = l.user_id ${w}
      ORDER BY l.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  const total = await pool.query(`SELECT count(*)::int AS n FROM audit_log l ${w}`, params);
  const actions = await pool.query("SELECT DISTINCT action FROM audit_log ORDER BY action");
  res.json({ rows: rows.rows, total: total.rows[0].n, actions: actions.rows.map((r) => r.action) });
}));

// ---- settings ----
router.get("/settings", requireRole("admin", "compliance_manager"), wrap(async (_req, res) => {
  const { rows } = await pool.query("SELECT key, value, updated_at FROM settings ORDER BY key");
  res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
}));

router.put("/settings/review_budget_k", requireRole("admin"), wrap(async (req, res) => {
  const value = Number(req.body?.value);
  if (!Number.isInteger(value) || value < 1 || value > 200) throw httpError(400, "choose a whole number from 1 to 200");
  const old = await pool.query("SELECT value FROM settings WHERE key = 'review_budget_k'");
  await pool.query(
    `INSERT INTO settings (key, value, updated_by) VALUES ('review_budget_k', $1::jsonb, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(value), req.user.id]);
  await audit(req.user.id, "setting_changed", "setting", "review_budget_k", { from: old.rows[0]?.value ?? null, to: value });
  res.json({ key: "review_budget_k", value });
}));

export default router;
