// Applies the SQL files in src/db in order, once each. Run: npm run migrate
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db/pool.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "db");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
files.sort((a, b) => (a === "schema.sql" ? -1 : b === "schema.sql" ? 1 : a.localeCompare(b)));

await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");

// The first schema was applied by hand before this script existed.
const users = await pool.query("SELECT to_regclass('public.users') AS t");
if (users.rows[0].t) {
  await pool.query("INSERT INTO schema_migrations (name) VALUES ('schema.sql') ON CONFLICT DO NOTHING");
}

for (const f of files) {
  const done = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [f]);
  if (done.rows.length) {
    console.log("already applied:", f);
    continue;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
    await client.query("COMMIT");
    console.log("applied:", f);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(`failed on ${f}:`, e.message);
    process.exitCode = 1;
    break;
  } finally {
    client.release();
  }
}
await pool.end();
