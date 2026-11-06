import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", async (_req, res) => {
  let ml = "down";
  try {
    const r = await fetch(`${process.env.ML_SERVICE_URL}/health`);
    ml = r.ok ? "ok" : "down";
  } catch {}
  res.json({ api: "ok", ml });
});

app.use("/api/auth", authRoutes);
// Later: /api/alerts, /api/cases, /api/graph, /api/reports

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`backend on ${port}`));
