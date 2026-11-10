import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../audit.js";
import { wrap, getSetting } from "../util.js";
import { mlJson } from "../ml.js";

const router = Router();
const enc = encodeURIComponent;

// Which days have an alert queue (counts respect the daily review budget).
router.get("/days", requireAuth, wrap(async (req, res) => {
  const k = await getSetting("review_budget_k", 200);
  res.json(await mlJson(`/days?dataset=${enc(req.query.dataset || "HI-Small")}&k=${k}`));
}));

// Evidence subgraphs (pattern, reason, transactions) for one or more alerts.
router.get(
  "/evidence",
  requireAuth,
  requireRole("investigator", "compliance_manager", "admin"),
  wrap(async (req, res) => {
    const ids = String(req.query.edge_ids || "");
    const q = new URLSearchParams({ dataset: String(req.query.dataset || "HI-Small"), edge_ids: ids });
    if (!ids.includes(",")) await audit(req.user.id, "evidence_viewed", "alert", ids);
    res.json(await mlJson(`/evidence?${q}`));
  })
);

// The ranked queue for one day. The ground-truth label is never forwarded.
router.get(
  "/",
  requireAuth,
  requireRole("investigator", "compliance_manager", "admin"),
  wrap(async (req, res) => {
    const k = await getSetting("review_budget_k", 200);
    const q = new URLSearchParams({ k: String(k) });
    for (const key of ["dataset", "day", "band", "group", "limit"]) {
      if (req.query[key]) q.set(key, String(req.query[key]));
    }
    await audit(req.user.id, "alerts_viewed", "alerts", req.query.day || null, {
      band: req.query.band || null,
    });
    res.json(await mlJson(`/alerts?${q}`));
  })
);

export default router;
