import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

export default function Dashboard() {
  const [health, setHealth] = useState(null);
  useEffect(() => { api("/health").then(setHealth).catch(() => setHealth({ api: "down", ml: "down" })); }, []);
  return (
    <>
      <h2>Overview</h2>
      <p className="muted">Alert queue, Recall@K and model monitoring will appear here.</p>
      <table>
        <tbody>
          <tr><td>API</td><td>{health?.api ?? "checking"}</td></tr>
          <tr><td>ML service</td><td>{health?.ml ?? "checking"}</td></tr>
        </tbody>
      </table>
    </>
  );
}
