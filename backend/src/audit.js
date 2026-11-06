import { pool } from "./db/pool.js";

export async function audit(userId, action, entity = null, entityId = null, detail = null) {
  await pool.query(
    "INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES ($1,$2,$3,$4,$5)",
    [userId, action, entity, entityId, detail]
  );
}
