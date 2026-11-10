import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool } from "../db/pool.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../audit.js";
import { wrap, getSetting, httpError } from "../util.js";
import { mlJson } from "../ml.js";
import { buildReport } from "../report.js";

const router = Router();
router.use(requireAuth, requireRole("investigator", "compliance_manager", "admin"));

const isManager = (u) => ["compliance_manager", "admin"].includes(u.role);
const UPLOAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "uploads", "cases");
const ALLOWED_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg", ".txt", ".csv", ".docx", ".xlsx"]);

function parseId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw httpError(400, "bad case id");
  return id;
}

// One place decides who may do what. The API enforces it and the UI only shows these buttons.
export function allowedActions(user, c) {
  if (c.status === "closed") return [];
  const mgr = isManager(user);
  const mine = c.assignee_id === user.id;
  const out = [];
  if (mgr) out.push("assign_any");
  else if (!c.assignee_id) out.push("assign_self");
  if (c.status === "open" && (mgr || mine || !c.assignee_id)) out.push("start");
  if (c.status === "investigating" && (mgr || mine)) out.push("escalate");
  if (c.status === "escalated" && mgr) out.push("return");
  if ((c.status === "investigating" && (mgr || mine)) || (c.status === "escalated" && mgr)) out.push("close_false_positive");
  if ((c.status === "investigating" || c.status === "escalated") && mgr) out.push("close_confirmed");
  return out;
}

async function loadCase(id) {
  const c = await pool.query(
    `SELECT c.*, a.name AS assignee_name, u.name AS created_by_name
       FROM cases c LEFT JOIN users a ON a.id = c.assignee_id JOIN users u ON u.id = c.created_by
      WHERE c.id = $1`, [id]);
  if (!c.rows.length) return null;
  const [alerts, notes, events, files] = await Promise.all([
    pool.query("SELECT edge_id, rank, src, dst, amount, probability, band, txn_time, pattern, reason FROM case_alerts WHERE case_id = $1 ORDER BY rank", [id]),
    pool.query("SELECT n.id, n.body, n.created_at, u.name AS user_name FROM case_notes n JOIN users u ON u.id = n.user_id WHERE n.case_id = $1 ORDER BY n.id", [id]),
    pool.query("SELECT l.id, l.action, l.detail, l.created_at, u.name AS user_name FROM audit_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.entity = 'case' AND l.entity_id = $1 ORDER BY l.id", [String(id)]),
    pool.query("SELECT f.id, f.original_name, f.size_bytes, f.created_at, u.name AS uploaded_by_name FROM case_attachments f JOIN users u ON u.id = f.uploaded_by WHERE f.case_id = $1 ORDER BY f.id", [id]),
  ]);
  return { case: c.rows[0], alerts: alerts.rows, notes: notes.rows, events: events.rows, files: files.rows };
}

// ---- list ----
router.get("/", wrap(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status) { params.push(String(req.query.status)); where.push(`c.status = $${params.length}`); }
  if (req.query.mine === "1") { params.push(req.user.id); where.push(`c.assignee_id = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.status, c.verdict, c.dataset, c.day, c.group_label, c.created_at, c.updated_at,
            c.assignee_id, a.name AS assignee_name,
            (SELECT count(*) FROM case_alerts ca WHERE ca.case_id = c.id)::int AS alert_count,
            (SELECT max(probability) FROM case_alerts ca WHERE ca.case_id = c.id) AS max_probability
       FROM cases c LEFT JOIN users a ON a.id = c.assignee_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY CASE c.status WHEN 'escalated' THEN 0 WHEN 'open' THEN 1 WHEN 'investigating' THEN 2 ELSE 3 END,
               c.updated_at DESC
      LIMIT 200`, params);
  res.json({ cases: rows });
}));

// ---- create from an alert group ----
router.post("/", wrap(async (req, res) => {
  const { dataset = "HI-Small", day, group } = req.body || {};
  if (!day || !group) throw httpError(400, "day and group are required");

  const existing = await pool.query("SELECT id FROM cases WHERE dataset = $1 AND group_label = $2", [dataset, group]);
  if (existing.rows.length) return res.json({ id: existing.rows[0].id, existing: true });

  const k = await getSetting("review_budget_k", 200);
  const q = new URLSearchParams({ dataset, day, group, k: String(k), limit: "1000" });
  const data = await mlJson(`/alerts?${q}`);
  if (!data.alerts.length) throw httpError(404, "no alerts in that group");
  let ev = {};
  try {
    const ids = data.alerts.map((a) => a.edge_id).join(",");
    ev = (await mlJson(`/evidence?${new URLSearchParams({ dataset, edge_ids: ids })}`)).evidence;
  } catch {} // a case can still be opened without explanations

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const title = `Group ${group} (${data.alerts.length} alert${data.alerts.length === 1 ? "" : "s"})`;
    const c = await client.query(
      "INSERT INTO cases (dataset, day, group_label, title, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [dataset, day, group, title, req.user.id]);
    const id = c.rows[0].id;
    for (const a of data.alerts) {
      await client.query(
        "INSERT INTO case_alerts (case_id, edge_id, rank, src, dst, amount, probability, band, txn_time, pattern, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [id, a.edge_id, a.rank, a.src, a.dst, a.amt_paid, a.p, a.band, a.ts || null, ev[a.edge_id]?.label ?? null, ev[a.edge_id]?.reason ?? null]);
    }
    await client.query("COMMIT");
    await audit(req.user.id, "case_created", "case", String(id), { group, alerts: data.alerts.length });
    res.status(201).json({ id, existing: false });
  } catch (e) {
    await client.query("ROLLBACK");
    if (e.code === "23505") {
      const again = await pool.query("SELECT id FROM cases WHERE dataset = $1 AND group_label = $2", [dataset, group]);
      if (again.rows.length) return res.json({ id: again.rows[0].id, existing: true });
    }
    throw e;
  } finally {
    client.release();
  }
}));

// ---- one case ----
router.get("/:id", wrap(async (req, res) => {
  const data = await loadCase(parseId(req));
  if (!data) throw httpError(404, "case not found");
  res.json({ ...data, actions: allowedActions(req.user, data.case) });
}));

// ---- assign ----
router.post("/:id/assign", wrap(async (req, res) => {
  const id = parseId(req);
  const userId = Number(req.body?.userId);
  const cur = (await pool.query("SELECT * FROM cases WHERE id = $1", [id])).rows[0];
  if (!cur) throw httpError(404, "case not found");
  const allowed = allowedActions(req.user, cur);

  let target;
  if (allowed.includes("assign_any")) {
    target = (await pool.query("SELECT id, name, role, active FROM users WHERE id = $1", [userId])).rows[0];
    if (!target || !target.active || target.role === "data_officer") throw httpError(400, "pick an active investigator or manager");
    await pool.query("UPDATE cases SET assignee_id = $2, updated_at = now() WHERE id = $1", [id, userId]);
  } else if (allowed.includes("assign_self")) {
    if (userId !== req.user.id) throw httpError(403, "you can only assign the case to yourself");
    target = { id: req.user.id, name: req.user.name };
    const r = await pool.query("UPDATE cases SET assignee_id = $2, updated_at = now() WHERE id = $1 AND assignee_id IS NULL", [id, userId]);
    if (!r.rowCount) throw httpError(409, "someone else just took this case");
  } else {
    throw httpError(403, "you can't assign this case");
  }
  await audit(req.user.id, "case_assigned", "case", String(id), { assignee_id: target.id, assignee: target.name });
  res.json({ ok: true });
}));

// ---- status actions ----
router.post("/:id/action", wrap(async (req, res) => {
  const id = parseId(req);
  const { action, note } = req.body || {};
  const client = await pool.connect();
  let detail = null;
  try {
    await client.query("BEGIN");
    const c = (await client.query("SELECT * FROM cases WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!c) throw httpError(404, "case not found");
    if (!allowedActions(req.user, c).includes(action)) throw httpError(403, "that action is not allowed on this case right now");

    if (action === "start") {
      await client.query("UPDATE cases SET status = 'investigating', assignee_id = COALESCE(assignee_id, $2), updated_at = now() WHERE id = $1", [id, req.user.id]);
    } else if (action === "escalate") {
      await client.query("UPDATE cases SET status = 'escalated', updated_at = now() WHERE id = $1", [id]);
    } else if (action === "return") {
      await client.query("UPDATE cases SET status = 'investigating', updated_at = now() WHERE id = $1", [id]);
    } else {
      const verdict = action === "close_confirmed" ? "confirmed" : "false_positive";
      const text = String(note || "").trim();
      if (text.length < 3) throw httpError(400, "write a short closing note");
      await client.query(
        "UPDATE cases SET status = 'closed', verdict = $2, closing_note = $3, closed_at = now(), updated_at = now() WHERE id = $1",
        [id, verdict, text]);
      // Module 12: the verdict becomes a label for every alert in the case.
      await client.query(
        `INSERT INTO feedback_labels (dataset, edge_id, label, case_id, user_id)
         SELECT $2::text, edge_id, $3::smallint, $1::int, $4::int FROM case_alerts WHERE case_id = $1
         ON CONFLICT (dataset, edge_id) DO UPDATE
           SET label = EXCLUDED.label, case_id = EXCLUDED.case_id, user_id = EXCLUDED.user_id, created_at = now()`,
        [id, c.dataset, verdict === "confirmed" ? 1 : 0, req.user.id]);
      detail = { verdict };
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  const logName = {
    start: "case_started", escalate: "case_escalated", return: "case_returned",
    close_false_positive: "case_closed_false_positive", close_confirmed: "case_closed_confirmed",
  }[action];
  await audit(req.user.id, logName, "case", String(id), detail);
  res.json({ ok: true });
}));

// ---- notes ----
router.post("/:id/notes", wrap(async (req, res) => {
  const id = parseId(req);
  const body = String(req.body?.body || "").trim();
  if (!body || body.length > 5000) throw httpError(400, "write a note of up to 5000 characters");
  const c = (await pool.query("SELECT status FROM cases WHERE id = $1", [id])).rows[0];
  if (!c) throw httpError(404, "case not found");
  if (c.status === "closed") throw httpError(409, "the case is closed");
  await pool.query("INSERT INTO case_notes (case_id, user_id, body) VALUES ($1,$2,$3)", [id, req.user.id, body]);
  await pool.query("UPDATE cases SET updated_at = now() WHERE id = $1", [id]);
  await audit(req.user.id, "note_added", "case", String(id));
  res.status(201).json({ ok: true });
}));

// ---- attachments ----
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(UPLOAD_DIR, String(Number(req.params.id) || 0));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, _file, cb) => cb(null, crypto.randomBytes(16).toString("hex")),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    ALLOWED_EXT.has(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(httpError(400, "file type not allowed")),
});

router.post("/:id/attachments", upload.single("file"), wrap(async (req, res) => {
  const id = parseId(req);
  if (!req.file) throw httpError(400, "choose a file");
  const c = (await pool.query("SELECT status FROM cases WHERE id = $1", [id])).rows[0];
  if (!c || c.status === "closed") {
    fs.unlink(req.file.path, () => {});
    throw httpError(c ? 409 : 404, c ? "the case is closed" : "case not found");
  }
  await pool.query(
    "INSERT INTO case_attachments (case_id, uploaded_by, original_name, stored_name, size_bytes) VALUES ($1,$2,$3,$4,$5)",
    [id, req.user.id, path.basename(req.file.originalname), req.file.filename, req.file.size]);
  await audit(req.user.id, "attachment_added", "case", String(id), { name: req.file.originalname });
  res.status(201).json({ ok: true });
}));

router.get("/:id/attachments/:aid", wrap(async (req, res) => {
  const id = parseId(req);
  const f = (await pool.query("SELECT * FROM case_attachments WHERE id = $1 AND case_id = $2", [Number(req.params.aid), id])).rows[0];
  if (!f) throw httpError(404, "file not found");
  await audit(req.user.id, "attachment_downloaded", "case", String(id), { name: f.original_name });
  res.download(path.join(UPLOAD_DIR, String(id), f.stored_name), f.original_name, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "file is missing on the server" });
  });
}));

// ---- SAR draft ----
router.get("/:id/report.pdf", wrap(async (req, res) => {
  const id = parseId(req);
  const data = await loadCase(id);
  if (!data) throw httpError(404, "case not found");
  await audit(req.user.id, "report_generated", "case", String(id));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="case-${id}-SAR-draft.pdf"`);
  buildReport(data, res);
}));

export default router;
