import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../lib/api.js";
import { StatusBadge, fmtTime } from "../components/ui.jsx";

const ACTION_TEXT = {
  case_created: "opened a case", case_assigned: "assigned a case", case_started: "started an investigation",
  case_escalated: "escalated a case", case_returned: "returned a case", case_closed_false_positive: "closed a case as false positive",
  case_closed_confirmed: "closed a case as confirmed", note_added: "added a note", attachment_added: "attached a file",
  report_generated: "generated a report draft", user_created: "created a user", user_updated: "changed a user",
  setting_changed: "changed a setting", password_reset: "reset a password",
};

function Card({ label, value, to }) {
  const inner = <><div className="card-n">{value}</div><div className="muted small">{label}</div></>;
  return to ? <Link to={to} className="card">{inner}</Link> : <div className="card">{inner}</div>;
}

export default function Dashboard() {
  const [health, setHealth] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/health").then(setHealth).catch(() => setHealth({ api: "down", ml: "down" }));
    api("/overview").then(setData).catch((e) => setError(e.message));
  }, []);

  const c = data?.cases;
  const closed = c ? c.closed : 0;
  const confirmed = data?.feedback.confirmed ?? 0;
  const chart = (data?.alert_days || []).map((d) => ({
    day: d.day.slice(5), "Confident alerts": d.bands["confident alert"] || 0, "Uncertain alerts": d.bands.uncertain || 0,
  }));

  return (
    <>
      <h2>Overview</h2>
      <p className="muted">
        API <b>{health?.api ?? "checking"}</b>, ML service <b>{health?.ml ?? "checking"}</b>
      </p>
      {error && <p className="error">{error}</p>}

      {c && (
        <div className="cards">
          <Card label="Open cases" value={c.open} to="/cases?status=open" />
          <Card label="Investigating" value={c.investigating} to="/cases?status=investigating" />
          <Card label="Escalated" value={c.escalated} to="/cases?status=escalated" />
          <Card label="Closed" value={c.closed} to="/cases?status=closed" />
          <Card label="Assigned to me" value={data.mine} to="/cases" />
        </div>
      )}

      {chart.length > 0 && (
        <>
          <h3>Alerts per day</h3>
          <div className="chart" role="img" aria-label="Stacked bar chart of confident and uncertain alerts per day">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d9dfe3" />
                <XAxis dataKey="day" /><YAxis allowDecimals={false} /><Tooltip /><Legend />
                <Bar dataKey="Confident alerts" stackId="a" fill="#1f4e5f" />
                <Bar dataKey="Uncertain alerts" stackId="a" fill="#d99a2b" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {data && (
        <div className="cols">
          <section>
            <h3>Review outcomes</h3>
            <p>
              {closed === 0 ? "No cases closed yet." : `${confirmed} of the ${data.feedback.confirmed + data.feedback.false_positive} reviewed alerts were confirmed as laundering.`}
            </p>
            <p className="muted small">Investigator verdicts are saved as labels. They will be used to retrain the model.</p>
            {data.recent_cases?.length > 0 && <h3>Recently updated cases</h3>}
            {data.recent_cases?.map((r) => (
              <p key={r.id}><Link to={`/cases/${r.id}`}>{r.title}</Link> <StatusBadge status={r.status} verdict={r.verdict} /></p>
            ))}
          </section>
          <section>
            {data.activity && <h3>Recent activity</h3>}
            <ul className="timeline">
              {data.activity?.map((a, i) => (
                <li key={i}><span className="muted small">{fmtTime(a.created_at)}</span> {a.user_name} {ACTION_TEXT[a.action] || a.action}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
      {data && !c && <p className="muted">Your role has no case access. Data tools will appear here in a later release.</p>}
    </>
  );
}
