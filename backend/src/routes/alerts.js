import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../audit.js";

const router = Router();

async function fromMl(path, res) {
  try {
    const r = await fetch(`${process.env.ML_SERVICE_URL}${path}`);
    const body = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: body.detail || "ML service error" });
    res.json(body);
  } catch {
    res.status(502).json({ error: "ML service is not reachable" });
  }
}

// Which days have an alert queue.
router.get("/days", requireAuth, (req, res) =>
  fromMl(`/days?dataset=${encodeURIComponent(req.query.dataset || "HI-Small")}`, res)
);

// The ranked queue for one day. The ground-truth label is never forwarded.
router.get(
  "/",
  requireAuth,
  requireRole("investigator", "compliance_manager", "admin"),
  async (req, res) => {
    const q = new URLSearchParams();
    for (const k of ["dataset", "day", "band", "limit"]) {
      if (req.query[k]) q.set(k, String(req.query[k]));
    }
    try {
      await audit(req.user.id, "alerts_viewed", "alerts", req.query.day || null, {
        band: req.query.band || null,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: "audit log unavailable" });
    }
    return fromMl(`/alerts?${q}`, res);
  }
);

export default router;