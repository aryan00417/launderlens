import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, download } from "../lib/api.js";
import { StatusBadge, fmtTime, money, pct } from "../components/ui.jsx";

const EVENT_TEXT = {
  case_created: "opened the case",
  case_assigned: "assigned the case",
  case_started: "started the investigation",
  case_escalated: "escalated the case to a manager",
  case_returned: "returned the case to the investigator",
  case_closed_false_positive: "closed the case as a false positive",
  case_closed_confirmed: "closed the case as confirmed laundering",
  note_added: "added a note",
  attachment_added: "attached a file",
  attachment_downloaded: "downloaded an attachment",
  report_generated: "generated the report draft",
};

const BUTTONS = [
  ["start", "Start investigation"],
  ["escalate", "Escalate to manager"],
  ["return", "Return to investigator"],
  ["close_false_positive", "Close as false positive"],
  ["close_confirmed", "Close as confirmed laundering"],
];

export default function CaseDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [closing, setClosing] = useState(null);
  const [closeNote, setCloseNote] = useState("");
  const [people, setPeople] = useState([]);
  const [pick, setPick] = useState("");

  const load = useCallback(() => api(`/cases/${id}`).then(setData).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const assignAny = data?.actions.includes("assign_any");
  useEffect(() => {
    if (assignAny) api("/admin/assignable").then((d) => setPeople(d.users)).catch(() => {});
  }, [assignAny]);

  async function run(fn) {
    setError("");
    try { await fn(); await load(); } catch (e) { setError(e.message); }
  }
  // A note that was typed but not saved is saved before any other action, so it is never lost.
  const savePending = async () => {
    if (!note.trim()) return;
    await api(`/cases/${id}/notes`, { method: "POST", body: { body: note } });
    setNote("");
  };
  const act = (action, text) => run(async () => {
    await savePending();
    await api(`/cases/${id}/action`, { method: "POST", body: { action, note: text } });
    setClosing(null);
    setCloseNote("");
  });
  const assign = (userId) => run(async () => {
    await savePending();
    await api(`/cases/${id}/assign`, { method: "POST", body: { userId: Number(userId) } });
  });
  const addNote = () => run(async () => {
    await api(`/cases/${id}/notes`, { method: "POST", body: { body: note } });
    setNote("");
  });
  const upload = (file) => run(async () => {
    const fd = new FormData();
    fd.append("file", file);
    await api(`/cases/${id}/attachments`, { method: "POST", body: fd });
  });
  const getFile = (f) => run(() => download(`/cases/${id}/attachments/${f.id}`, f.original_name));
  const getReport = () => run(async () => {
    await savePending();
    await download(`/cases/${id}/report.pdf`, `case-${id}-SAR-draft.pdf`);
  });

  if (!data) return error ? <p className="error">{error}</p> : <p className="muted">Loading</p>;
  const { case: c, alerts, notes, events, files, actions } = data;
  const open = c.status !== "closed";
  const why = [...alerts.reduce((m, a) => {
    if (!a.pattern) return m;
    const cur = m.get(a.pattern);
    return m.set(a.pattern, cur ? { ...cur, n: cur.n + 1 } : { pattern: a.pattern, n: 1, reason: a.reason });
  }, new Map()).values()];

  return (
    <>
      <p className="muted small"><Link to="/cases">Cases</Link> / #{c.id}</p>
      <h2>{c.title}</h2>
      <p>
        <StatusBadge status={c.status} verdict={c.verdict} />{" "}
        <span className="muted">Day {c.day}. Assigned to {c.assignee_name || "nobody"}. Opened by {c.created_by_name}.</span>
      </p>
      {error && <p className="error">{error}</p>}

      <div className="panel">
        <div className="actions">
          {actions.includes("assign_self") && <button onClick={() => assign(JSON.parse(localStorage.getItem("ll_user")).id)}>Assign to me</button>}
          {assignAny && (
            <>
              <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Assign to">
                <option value="">Assign to</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role.replace("_", " ")})</option>)}
              </select>
              <button disabled={!pick} onClick={() => assign(pick)}>Assign</button>
            </>
          )}
          {BUTTONS.filter(([a]) => actions.includes(a)).map(([a, label]) =>
            a.startsWith("close_")
              ? <button key={a} className="secondary" onClick={() => { setClosing(a); setCloseNote(""); }}>{label}</button>
              : <button key={a} onClick={() => act(a)}>{label}</button>)}
          <button className="secondary" onClick={getReport}>Download report draft (PDF)</button>
        </div>
        {closing && (
          <div className="closing">
            <label>Closing note (required)
              <textarea value={closeNote} onChange={(e) => setCloseNote(e.target.value)} rows={3} />
            </label>
            <button onClick={() => act(closing, closeNote)}>Confirm: {closing === "close_confirmed" ? "confirmed laundering" : "false positive"}</button>
            <button className="link" onClick={() => setClosing(null)}>Cancel</button>
          </div>
        )}
        {c.status === "closed" && <p><b>Closing note:</b> {c.closing_note}</p>}
      </div>

      {why.length > 0 && (
        <div className="panel">
          <h3>Why these alerts fired</h3>
          {why.map((w) => (
            <p key={w.pattern}><b>{w.pattern}</b> ({w.n}): {w.reason}</p>
          ))}
        </div>
      )}

      <h3>Flagged transactions ({alerts.length})</h3>
      <div className="table-wrap">
        <table className="alerts">
          <thead><tr><th>Rank</th><th>Time</th><th>From</th><th>To</th><th className="num">Amount</th><th className="num">Probability</th><th>Band</th><th>Pattern</th></tr></thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.edge_id}>
                <td>{a.rank}</td><td>{a.txn_time?.slice(0, 16)}</td>
                <td className="mono">{a.src}</td><td className="mono">{a.dst}</td>
                <td className="num">{money(a.amount)}</td><td className="num">{pct(a.probability)}</td>
                <td><span className={a.band === "confident alert" ? "badge ok" : "badge warn"}>{a.band}</span></td>
                <td><Link to={`/graph?edge=${a.edge_id}`}>{a.pattern || "View"}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cols">
        <section>
          <h3>Notes</h3>
          {notes.length === 0 && <p className="muted">No notes yet.</p>}
          {notes.map((n) => (
            <div key={n.id} className="note"><b>{n.user_name}</b> <span className="muted small">{fmtTime(n.created_at)}</span><p>{n.body}</p></div>
          ))}
          {open && (
            <>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Write a note" aria-label="New note" />
              {note.trim() && <p className="warn-text">This note is not saved yet. Click Add note (it is also saved when you use any button above).</p>}
              <button disabled={!note.trim()} onClick={addNote}>Add note</button>
            </>
          )}
        </section>
        <section>
          <h3>Attachments</h3>
          {files.length === 0 && <p className="muted">No files yet.</p>}
          {files.map((f) => (
            <p key={f.id}><button className="link" onClick={() => getFile(f)}>{f.original_name}</button>{" "}
              <span className="muted small">{Math.ceil(f.size_bytes / 1024)} KB, {f.uploaded_by_name}</span></p>
          ))}
          {open && (
            <label className="muted small">Add a file (pdf, image, txt, csv, docx, xlsx, up to 5 MB)
              <input type="file" onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
            </label>
          )}
        </section>
      </div>

      <h3>Timeline</h3>
      <ul className="timeline">
        {events.map((e) => (
          <li key={e.id}>
            <span className="muted small">{fmtTime(e.created_at)}</span> {e.user_name} {EVENT_TEXT[e.action] || e.action}
            {e.detail?.assignee && ` (${e.detail.assignee})`}
          </li>
        ))}
      </ul>
    </>
  );
}
