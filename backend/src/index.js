import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import alertRoutes from "./routes/alerts.js";
import caseRoutes from "./routes/cases.js";
import adminRoutes from "./routes/admin.js";
import overviewRoutes from "./routes/overview.js";
import { wrap } from "./util.js";
import { mlJson } from "./ml.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", wrap(async (_req, res) => {
  let ml = "down";
  try {
    await mlJson("/health");
    ml = "ok";
  } catch {}
  res.json({ api: "ok", ml });
}));

app.use("/api/auth", authRoutes);
app.use("/api/alerts", alertRoutes);
app.use("/api/cases", caseRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/overview", overviewRoutes);

// Every error ends up here, so a failed request never crashes the server.
app.use((err, _req, res, _next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "invalid JSON" });
  if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "file is larger than 5 MB" });
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: "server error" });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`backend on ${port}`));
