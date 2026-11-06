import { useEffect, useRef } from "react";
import cytoscape from "cytoscape";

// Demo: a 5-hop cycle, the sort of evidence subgraph the explainer will return.
const demo = [
  ...["A", "B", "C", "D", "E"].map((id) => ({ data: { id } })),
  { data: { source: "A", target: "B", label: "$9.8k" } },
  { data: { source: "B", target: "C", label: "$9.7k" } },
  { data: { source: "C", target: "D", label: "$9.7k" } },
  { data: { source: "D", target: "E", label: "$9.6k" } },
  { data: { source: "E", target: "A", label: "$9.5k" } },
];

export default function GraphExplorer() {
  const ref = useRef(null);
  useEffect(() => {
    const cy = cytoscape({
      container: ref.current,
      elements: demo,
      layout: { name: "circle" },
      style: [
        { selector: "node", style: { label: "data(id)", "background-color": "#1f4e5f", color: "#fff", "text-valign": "center", width: 34, height: 34 } },
        { selector: "edge", style: { label: "data(label)", "font-size": 9, width: 2, "line-color": "#9aa5ab", "target-arrow-color": "#9aa5ab", "target-arrow-shape": "triangle", "curve-style": "bezier" } },
      ],
    });
    return () => cy.destroy();
  }, []);
  return (
    <>
      <h2>Graph explorer</h2>
      <p className="muted">Placeholder cycle. Real subgraphs come from the explanation engine.</p>
      <div ref={ref} className="graph" />
    </>
  );
}
