import { pool } from "./db/pool.js";

// Express 4 does not catch errors thrown in async handlers. This does.
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export async function getSetting(key, fallback) {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key = $1", [key]);
  return rows.length ? rows[0].value : fallback;
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
