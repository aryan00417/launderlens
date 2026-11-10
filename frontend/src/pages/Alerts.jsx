import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";
import { money, pct } from "../components/ui.jsx";

const BANDS = [
  { value: "", label: "All bands" },
  { value: "confident alert", label: "Confident alert" },
  { value: "uncertain", label: "Uncertain (senior review)" },
];

export default function Alerts() {
  const nav = useNavigate();
  const [days, setDays] = useState([]);
  const [day, setDay] = useState("");
  const [band, setBand] = useState("");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api("/alerts/days")
      .then((d) => { setDays(d.days); if (d.days.length) setDay(d.days[0].day); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!day) return;
    const qs = new URLSearchParams({ day, limit: "200" });
    if (band) qs.set("band", band);
    setLoading(true);
    setError("");
    api(`/alerts?${qs}`).then((d) => setRows(d.alerts)).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [day, band]);

  async function openCase(group) {
    try {
      const r = await api("/cases", { method: "POST", body: { day, group } });
      nav(`/cases/${r.id}`);
    } catch (e) {
      setError(e.message);
    }
  }

  const summary = days.find((d) => d.day === day);
  return (
    <>
      <h2>Alert queue</h2>
      <p className="muted">
        Highest probability first. Alerts that share an account belong to one group. Open a group to start a case.
      </p>
      <div className="toolbar">
        <label>Day
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => <option key={d.day} value={d.day}>{d.day}</option>)}
          </select>
        </label>
        <label>Band
          <select value={band} onChange={(e) => setBand(e.target.value)}>
            {BANDS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
          </select>
        </label>
        {summary && (
          <span className="muted">
            {summary.alerts} alerts that day: {Object.entries(summary.bands).map(([b, n]) => `${n} ${b}`).join(", ")}
          </span>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading</p>}
      {!loading && rows.length > 0 && (
        <div className="table-wrap">
          <table className="alerts">
            <thead>
              <tr>
                <th>Rank</th><th>From account</th><th>To account</th>
                <th className="num">Amount</th><th className="num">Probability</th><th>Band</th><th>Pattern</th><th>Case group</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.edge_id}>
                  <td>{r.rank}</td>
                  <td className="mono">{r.src}</td>
                  <td className="mono">{r.dst}</td>
                  <td className="num">{money(r.amt_paid)}</td>
                  <td className="num">{pct(r.p)}</td>
                  <td><span className={r.band === "confident alert" ? "badge ok" : "badge warn"}>{r.band}</span></td>
                  <td>{r.pattern ? <Link to={`/graph?edge=${r.edge_id}`}>{r.pattern}</Link> : <Link to={`/graph?edge=${r.edge_id}`}>View</Link>}</td>
                  <td>
                    {r.group && (
                      <button className="small-btn" onClick={() => openCase(r.group)}>
                        {r.group.split("-").pop()} ({r.group_size})
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">Amounts are in the sender's own currency.</p>
    </>
  );
}
