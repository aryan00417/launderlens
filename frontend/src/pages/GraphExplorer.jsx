import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import cytoscape from "cytoscape";
import { api } from "../lib/api.js";
import { money, pct } from "../components/ui.jsx";

const COLORS = { node: "#1f4e5f", alert: "#c2410c", pattern: "#1f4e5f", context: "#b8c0c6" };
const short = (id) => (id.length > 16 ? "…" + id.slice(-15) : id);

export default function GraphExplorer() {
  const [params, setParams] = useSearchParams();
  const edgeId = params.get("edge");
  const [days, setDays] = useState([]);
  const [day, setDay] = useState("");
  const [queue, setQueue] = useState([]);
  const [ev, setEv] = useState(null);
  const [error, setError] = useState("");
  const [showContext, setShowContext] = useState(true);
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState(null);
  const box = useRef(null);
  const cyRef = useRef(null);

  // alert picker
  useEffect(() => {
    api("/alerts/days").then((d) => { setDays(d.days); if (d.days.length) setDay(d.days[0].day); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (day) api(`/alerts?day=${day}&limit=200`).then((d) => setQueue(d.alerts)).catch((e) => setError(e.message));
  }, [day]);

  // evidence for the chosen alert
  useEffect(() => {
    if (!edgeId) { setEv(null); return; }
    setError("");
    api(`/alerts/evidence?edge_ids=${edgeId}`)
      .then((d) => {
        const e = d.evidence[edgeId];
        if (!e) throw new Error("No explanation exists for this alert yet. Run build_evidence in the ML service.");
        setEv(e);
        setStep(new Set(e.edges.map((x) => x.t)).size - 1);
        setSelected(null);
      })
      .catch((e) => { setEv(null); setError(e.message); });
  }, [edgeId]);

  const times = useMemo(() => (ev ? [...new Set(ev.edges.map((e) => e.t))].sort() : []), [ev]);

  // draw the graph
  useEffect(() => {
    if (!ev || !box.current) return undefined;
    const elements = [
      ...ev.nodes.map((id) => ({ data: { id, label: short(id), ends: id === ev.alert_src || id === ev.alert_dst } })),
      ...ev.edges.map((e, i) => ({
        data: { id: `e${i}`, source: e.src, target: e.dst, t: e.t, inPattern: e.in_pattern, alert: e.alert, label: money(e.amount) },
      })),
    ];
    const cy = cytoscape({
      container: box.current,
      elements,
      style: [
        { selector: "node", style: { label: "data(label)", "font-size": 9, "background-color": COLORS.node, color: "#17212b", "text-valign": "bottom", "text-margin-y": 4, width: 22, height: 22, "text-background-color": "#ffffff", "text-background-opacity": 0.9, "text-background-padding": 2, "z-index": 20 } },
        { selector: "node[?ends]", style: { "background-color": COLORS.alert, width: 28, height: 28 } },
        { selector: "node:selected", style: { "border-width": 3, "border-color": "#111" } },
        { selector: "edge", style: { width: 1, "line-color": COLORS.context, "target-arrow-color": COLORS.context, "target-arrow-shape": "triangle", "curve-style": "bezier", "z-index": 1 } },
        { selector: "edge[?inPattern]", style: { width: 2.5, "line-color": COLORS.pattern, "target-arrow-color": COLORS.pattern, label: "data(label)", "font-size": 8, color: "#5d6b76", "text-background-color": "#ffffff", "text-background-opacity": 0.85, "text-background-padding": 1 } },
        { selector: "edge[?alert]", style: { width: 4, "line-color": COLORS.alert, "target-arrow-color": COLORS.alert } },
      ],
      layout: { name: ev.pattern === "cycle" ? "circle" : "cose", animate: false, nodeDimensionsIncludeLabels: true, padding: 30 },
    });
    cy.on("tap", "node", (evt) => setSelected(evt.target.id()));
    cy.on("tap", (evt) => { if (evt.target === cy) setSelected(null); });
    cyRef.current = cy;
    return () => { cy.destroy(); cyRef.current = null; };
  }, [ev]);

  // time slider and context toggle
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !times.length) return;
    const cutoff = times[Math.min(step, times.length - 1)];
    cy.batch(() => {
      cy.edges().forEach((el) => {
        const show = el.data("t") <= cutoff && (showContext || el.data("inPattern"));
        el.style("display", show ? "element" : "none");
      });
      cy.nodes().forEach((n) => {
        const any = n.connectedEdges().some((x) => x.style("display") !== "none");
        n.style("display", any ? "element" : "none");
      });
    });
  }, [ev, step, showContext, times]);

  const cutoff = times[Math.min(step, times.length - 1)];
  const visible = ev ? ev.edges.filter((e) => e.t <= cutoff && (showContext || e.in_pattern)) : [];
  const nodeEdges = selected ? visible.filter((e) => e.src === selected || e.dst === selected) : [];
  const pick = (id) => setParams(id ? { edge: id } : {});

  return (
    <>
      <h2>Graph explorer</h2>
      <p className="muted">Pick an alert to see the smallest set of transactions that explains it.</p>
      <div className="toolbar">
        <label>Day
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => <option key={d.day} value={d.day}>{d.day}</option>)}
          </select>
        </label>
        <label>Alert
          <select value={edgeId || ""} onChange={(e) => pick(e.target.value)}>
            <option value="">Choose an alert</option>
            {queue.map((a) => (
              <option key={a.edge_id} value={a.edge_id}>#{a.rank} {pct(a.p)} {a.pattern || ""}</option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}

      {ev && (
        <div className="explorer">
          <div>
            <div ref={box} className="graph" role="img" aria-label={`Graph of the ${ev.label} pattern with ${ev.nodes.length} accounts`} />
            <div className="toolbar">
              <label className="check"><input type="checkbox" checked={showContext} onChange={(e) => setShowContext(e.target.checked)} /> Show surrounding activity</label>
              <label className="grow">Time: up to {cutoff}
                <input type="range" min="0" max={Math.max(0, times.length - 1)} value={Math.min(step, times.length - 1)} onChange={(e) => setStep(Number(e.target.value))} />
              </label>
            </div>
            <p className="muted small">
              <span className="dot" style={{ background: COLORS.alert }} /> the alert transfer and its accounts{" "}
              <span className="dot" style={{ background: COLORS.pattern }} /> transfers that form the pattern{" "}
              <span className="dot" style={{ background: COLORS.context }} /> other activity of those accounts. Click an account for its transfers.
            </p>
          </div>
          <aside className="panel">
            <span className="badge ok">{ev.label}</span>
            <p>{ev.reason}</p>
            <p className="muted small">{ev.size.edges} transactions between {ev.size.accounts} accounts explain this alert.</p>
            {selected && (
              <>
                <h4>{selected}</h4>
                {nodeEdges.map((e, i) => (
                  <p key={i} className="small mono">{e.t} {e.src === selected ? "sent to" : "received from"} {short(e.src === selected ? e.dst : e.src)} {money(e.amount)}</p>
                ))}
              </>
            )}
          </aside>
        </div>
      )}

      {ev && (
        <details open>
          <summary>Transactions in the pattern (text version of the graph)</summary>
          <div className="table-wrap">
            <table className="alerts">
              <thead><tr><th>Time</th><th>From</th><th>To</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {ev.edges.filter((e) => e.in_pattern).map((e, i) => (
                  <tr key={i} className={e.alert ? "hl" : ""}>
                    <td>{e.t}</td><td className="mono">{e.src}</td><td className="mono">{e.dst}</td>
                    <td className="num">{money(e.amount)} <span className="muted small">{e.currency}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}
