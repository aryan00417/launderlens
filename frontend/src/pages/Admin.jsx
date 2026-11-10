import { useCallback, useEffect, useState } from "react";
import { api, getUser } from "../lib/api.js";
import { fmtTime } from "../components/ui.jsx";

const ROLES = ["investigator", "compliance_manager", "admin", "data_officer"];

function Users() {
  const me = getUser();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "investigator" });

  const load = useCallback(() => api("/admin/users").then((d) => setUsers(d.users)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function run(fn) {
    setError("");
    try { await fn(); await load(); } catch (e) { setError(e.message); }
  }
  const patch = (id, body) => run(() => api(`/admin/users/${id}`, { method: "PATCH", body }));
  const reset = (u) => {
    const password = window.prompt(`New password for ${u.name} (at least 8 characters)`);
    if (password) run(() => api(`/admin/users/${u.id}/password`, { method: "POST", body: { password } }));
  };
  const create = (e) => {
    e.preventDefault();
    run(async () => {
      await api("/auth/users", { method: "POST", body: form });
      setForm({ name: "", email: "", password: "", role: "investigator" });
    });
  };

  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table className="alerts">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td><td>{u.email}</td>
                <td>
                  <select value={u.role} disabled={u.id === me.id} onChange={(e) => patch(u.id, { role: e.target.value })} aria-label={`Role of ${u.name}`}>
                    {ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
                  </select>
                </td>
                <td><input type="checkbox" checked={u.active} disabled={u.id === me.id} onChange={(e) => patch(u.id, { active: e.target.checked })} aria-label={`${u.name} is active`} /></td>
                <td><button className="small-btn" onClick={() => reset(u)}>Reset password</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Add a user</h3>
      <form className="toolbar" onSubmit={create}>
        <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        <label>Password<input type="password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
        <label>Role
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
          </select>
        </label>
        <button type="submit">Create user</button>
      </form>
    </>
  );
}

function Audit() {
  const [data, setData] = useState({ rows: [], total: 0, actions: [] });
  const [action, setAction] = useState("");
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const limit = 50;

  useEffect(() => {
    const qs = new URLSearchParams({ limit, offset });
    if (action) qs.set("action", action);
    api(`/admin/audit?${qs}`).then(setData).catch((e) => setError(e.message));
  }, [action, offset]);

  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="toolbar">
        <label>Action
          <select value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }}>
            <option value="">All</option>
            {data.actions.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <span className="muted">{data.total} entries. The log is append-only and cannot be edited.</span>
      </div>
      <div className="table-wrap">
        <table className="alerts">
          <thead><tr><th>Time</th><th>User</th><th>Action</th><th>On</th><th>Detail</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtTime(r.created_at)}</td>
                <td>{r.user_name || <span className="muted">anonymous</span>}</td>
                <td>{r.action}</td>
                <td>{r.entity ? `${r.entity} ${r.entity_id ?? ""}` : ""}</td>
                <td className="mono small">{r.detail ? JSON.stringify(r.detail) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="toolbar">
        <button className="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Newer</button>
        <button className="secondary" disabled={offset + limit >= data.total} onClick={() => setOffset(offset + limit)}>Older</button>
      </div>
    </>
  );
}

function Settings() {
  const admin = getUser()?.role === "admin";
  const [k, setK] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => { api("/admin/settings").then((d) => setK(String(d.settings.review_budget_k))).catch((e) => setMsg(e.message)); }, []);
  async function save(e) {
    e.preventDefault();
    try {
      await api("/admin/settings/review_budget_k", { method: "PUT", body: { value: Number(k) } });
      setMsg("Saved. The alert queue now shows this many alerts per day.");
    } catch (err) { setMsg(err.message); }
  }
  return (
    <form onSubmit={save}>
      <label>Daily review budget (alerts per day, 1 to 200)
        <input type="number" min="1" max="200" value={k} onChange={(e) => setK(e.target.value)} disabled={!admin} />
      </label>
      {admin ? <button type="submit">Save</button> : <p className="muted">Only an admin can change this.</p>}
      {msg && <p className="muted">{msg}</p>}
    </form>
  );
}

export default function Admin() {
  const admin = getUser()?.role === "admin";
  const tabs = [...(admin ? [["users", "Users"]] : []), ["audit", "Audit log"], ["settings", "Settings"]];
  const [tab, setTab] = useState(tabs[0][0]);
  return (
    <>
      <h2>Admin and audit</h2>
      <div className="tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "tab on" : "tab"} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {tab === "users" && <Users />}
      {tab === "audit" && <Audit />}
      {tab === "settings" && <Settings />}
    </>
  );
}
