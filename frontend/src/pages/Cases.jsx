import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { StatusBadge, fmtTime, pct } from "../components/ui.jsx";

export default function Cases() {
  const [sp] = useSearchParams();
  const [status, setStatus] = useState(sp.get("status") || "");
  const [mine, setMine] = useState(false);
  const [cases, setCases] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (mine) qs.set("mine", "1");
    api(`/cases?${qs}`).then((d) => setCases(d.cases)).catch((e) => setError(e.message));
  }, [status, mine]);

  return (
    <>
      <h2>Cases</h2>
      <p className="muted">Escalated cases first, then open, investigating and closed.</p>
      <div className="toolbar">
        <label>Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {["open", "investigating", "escalated", "closed"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Assigned to me</label>
      </div>
      {error && <p className="error">{error}</p>}
      {cases.length === 0 ? <p className="muted">No cases yet. Open one from the alert queue.</p> : (
        <div className="table-wrap">
          <table className="alerts">
            <thead>
              <tr><th>#</th><th>Case</th><th>Status</th><th className="num">Alerts</th><th className="num">Top probability</th><th>Assigned to</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td><Link to={`/cases/${c.id}`}>{c.title}</Link><div className="muted small">{c.day}</div></td>
                  <td><StatusBadge status={c.status} verdict={c.verdict} /></td>
                  <td className="num">{c.alert_count}</td>
                  <td className="num">{pct(c.max_probability)}</td>
                  <td>{c.assignee_name || <span className="muted">unassigned</span>}</td>
                  <td>{fmtTime(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
