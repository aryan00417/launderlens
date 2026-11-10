import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { clearSession, getUser } from "../lib/api.js";

export default function Layout() {
  const nav = useNavigate();
  const user = getUser();
  const staff = ["investigator", "compliance_manager", "admin"].includes(user?.role);
  const manager = ["compliance_manager", "admin"].includes(user?.role);
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">LaunderLens</div>
        <NavLink to="/" end>Overview</NavLink>
        {staff && <NavLink to="/alerts">Alert queue</NavLink>}
        {staff && <NavLink to="/cases">Cases</NavLink>}
        <NavLink to="/graph">Graph explorer</NavLink>
        {manager && <NavLink to="/admin">Admin and audit</NavLink>}
        <div className="spacer" />
        <div className="who">{user?.name}<br /><small>{user?.role?.replace("_", " ")}</small></div>
        <button className="link" onClick={() => { clearSession(); nav("/login"); }}>Sign out</button>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  );
}
