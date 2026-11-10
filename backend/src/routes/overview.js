import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { wrap, getSetting } from "../util.js";
import { mlJson } from "../ml.js";

const router = Router();
const DATASET = process.env.DEFAULT_DATASET || "HI-Small";

router.get("/", requireAuth, wrap(async (req, res) => {
  const me = req.user;
  const staff = ["investigator", "compliance_manager", "admin"].includes(me.role);
  const manager = ["compliance_manager", "admin"].includes(me.role);
  const out = { role: me.role, cases: null };

  const labels = await pool.query("SELECT label, count(*)::int AS n FROM feedback_labels GROUP BY label");
  out.feedback = { confirmed: 0, false_positive: 0 };
  for (const r of labels.rows) out.feedback[r.label === 1 ? "confirmed" : "false_positive"] = r.n;

  if (staff) {
    out.cases = { open: 0, investigating: 0, escalated: 0, closed: 0 };
    for (const r of (await pool.query("SELECT status, count(*)::int AS n FROM cases GROUP BY status")).rows) out.cases[r.status] = r.n;
    out.mine = (await pool.query("SELECT count(*)::int AS n FROM cases WHERE assignee_id = $1 AND status <> 'closed'", [me.id])).rows[0].n;
    out.recent_cases = (await pool.query(
      `SELECT c.id, c.title, c.status, c.verdict, c.updated_at, a.name AS assignee_name
         FROM cases c LEFT JOIN users a ON a.id = c.assignee_id ORDER BY c.updated_at DESC LIMIT 6`)).rows;
    out.activity = (await pool.query(
      `SELECT l.action, l.entity, l.entity_id, l.created_at, u.name AS user_name
         FROM audit_log l LEFT JOIN users u ON u.id = l.user_id
        WHERE l.action NOT IN ('alerts_viewed', 'evidence_viewed', 'login', 'login_failed') ${manager ? "" : "AND l.user_id = $1"}
        ORDER BY l.id DESC LIMIT 8`, manager ? [] : [me.id])).rows;
    try {
      const k = await getSetting("review_budget_k", 200);
      out.alert_days = (await mlJson(`/days?dataset=${DATASET}&k=${k}`)).days;
    } catch {
      out.alert_days = [];
    }
  }
  res.json(out);
}));

export default router;
