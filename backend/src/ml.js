import { httpError } from "./util.js";

// Calls the Python ML service and turns its errors into readable ones.
export async function mlJson(path) {
  let r;
  try {
    r = await fetch(`${process.env.ML_SERVICE_URL}${path}`);
  } catch {
    throw httpError(502, "ML service is not reachable");
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(r.status, body.detail || "ML service error");
  return body;
}
