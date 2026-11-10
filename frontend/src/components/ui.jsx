export const fmtTime = (iso) => new Date(iso).toLocaleString();
export const money = (x) => Number(x).toLocaleString(undefined, { maximumFractionDigits: 2 });
export const pct = (p) => `${(p * 100).toFixed(1)}%`;

export function StatusBadge({ status, verdict }) {
  const label = status === "closed" && verdict ? `closed: ${verdict.replace("_", " ")}` : status;
  return <span className={`badge st-${status}`}>{label}</span>;
}
