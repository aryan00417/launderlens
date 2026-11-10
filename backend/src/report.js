import PDFDocument from "pdfkit";

const money = (x) => Number(x).toLocaleString("en-US", { maximumFractionDigits: 2 });
const pct = (p) => `${(p * 100).toFixed(1)}%`;
const date = (d) => new Date(d).toISOString().slice(0, 16).replace("T", " ");

// Fills a fixed template from the case data. No external service is used.
const EVENT_TEXT = {
  case_created: "opened the case", case_assigned: "assigned the case", case_started: "started the investigation",
  case_escalated: "escalated the case to a manager", case_returned: "returned the case to the investigator",
  case_closed_false_positive: "closed the case as a false positive", case_closed_confirmed: "closed the case as confirmed",
  note_added: "added a note", attachment_added: "attached a file",
};

export function buildReport({ case: c, alerts, notes, events = [], files = [] }, out) {
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  doc.pipe(out);

  let section = 0;
  const heading = (t) => {
    section += 1;
    doc.moveDown(0.8).font("Helvetica-Bold").fontSize(12).fillColor("#1f4e5f").text(`${section}. ${t}`);
    doc.moveDown(0.3).font("Helvetica").fontSize(10).fillColor("#17212b");
  };

  doc.font("Helvetica").fontSize(8).fillColor("#a4262c")
    .text("DRAFT FOR INVESTIGATOR REVIEW. Generated from synthetic data. Not a filed report.", { align: "right" });
  doc.moveDown(0.5).font("Helvetica-Bold").fontSize(18).fillColor("#17212b").text("Suspicious Activity Report (draft)");
  doc.font("Helvetica").fontSize(10).fillColor("#5d6b76").text(`Case #${c.id}: ${c.title}`);

  heading("Case details");
  doc.text(`Dataset: ${c.dataset}`);
  doc.text(`Alert day: ${c.day}`);
  doc.text(`Status: ${c.status}${c.verdict ? ` (${c.verdict.replace("_", " ")})` : ""}`);
  doc.text(`Assigned to: ${c.assignee_name || "unassigned"}`);
  doc.text(`Opened by: ${c.created_by_name} on ${date(c.created_at)}`);

  heading("Accounts involved");
  const accounts = new Map();
  const bump = (id, key) => {
    const a = accounts.get(id) || { sent: 0, received: 0 };
    a[key] += 1;
    accounts.set(id, a);
  };
  for (const a of alerts) {
    bump(a.src, "sent");
    bump(a.dst, "received");
  }
  const top = [...accounts.entries()].sort((x, y) => y[1].sent + y[1].received - (x[1].sent + x[1].received));
  doc.font("Courier").fontSize(8.5);
  for (const [id, v] of top.slice(0, 15)) {
    doc.text(`${id.padEnd(20)} sent ${String(v.sent).padStart(2)}   received ${String(v.received).padStart(2)}`);
  }
  if (top.length > 15) doc.text(`... and ${top.length - 15} more accounts`);
  doc.font("Helvetica").fontSize(10);

  heading("Summary of activity");
  const times = alerts.map((a) => a.txn_time).filter(Boolean).sort();
  const confident = alerts.filter((a) => a.band === "confident alert").length;
  const best = Math.max(...alerts.map((a) => a.probability));
  let summary =
    `On ${c.day}, the monitoring system flagged ${alerts.length} transaction${alerts.length === 1 ? "" : "s"} ` +
    `between ${accounts.size} accounts as potentially linked to money laundering. ` +
    `The highest-ranked alert has a model probability of ${pct(best)}. ` +
    `${confident} of the alerts are in the confident band and ${alerts.length - confident} are uncertain. `;
  if (times.length) summary += `The flagged transactions took place between ${times[0].slice(0, 16)} and ${times[times.length - 1].slice(0, 16)}. `;
  summary += "Amounts are shown in the sender's own currency and have not been converted.";
  doc.text(summary, { align: "left" });

  heading("Why the alerts fired");
  const patterns = new Map();
  for (const a of alerts) {
    if (!a.pattern) continue;
    const cur = patterns.get(a.pattern);
    if (cur) cur.n += 1;
    else patterns.set(a.pattern, { n: 1, reason: a.reason });
  }
  if (!patterns.size) doc.text("No pattern analysis is available for these alerts.");
  for (const [name, v] of patterns) {
    doc.font("Helvetica-Bold").text(`${name} (${v.n} alert${v.n === 1 ? "" : "s"})`);
    doc.font("Helvetica").text(v.reason).moveDown(0.3);
  }

  heading("Flagged transactions");
  doc.font("Courier").fontSize(8);
  doc.text("rank  time              from                 to                           amount    prob");
  for (const a of alerts.slice(0, 40)) {
    doc.text(
      `${String(a.rank).padStart(4)}  ${(a.txn_time || "").slice(0, 16).padEnd(16)}  ${a.src.padEnd(19)}  ${a.dst.padEnd(19)}  ${money(a.amount).padStart(12)}  ${pct(a.probability).padStart(6)}`
    );
  }
  if (alerts.length > 40) doc.text(`... and ${alerts.length - 40} more transactions in the case`);
  doc.font("Helvetica").fontSize(10);

  heading("Investigator notes");
  if (!notes.length) doc.text("No notes recorded.");
  for (const n of notes) {
    doc.font("Helvetica-Bold").text(`${n.user_name}, ${date(n.created_at)}`);
    doc.font("Helvetica").text(n.body).moveDown(0.4);
  }

  heading("Attachments");
  if (!files.length) doc.text("No files attached.");
  for (const f of files) doc.text(`${f.original_name} (${Math.ceil(f.size_bytes / 1024)} KB, added by ${f.uploaded_by_name})`);

  heading("Case history");
  const steps = events.filter((e) => EVENT_TEXT[e.action]);
  doc.font("Courier").fontSize(8);
  for (const e of steps) {
    const who = e.detail?.assignee ? ` (${e.detail.assignee})` : "";
    doc.text(`${date(e.created_at)}  ${e.user_name || "system"} ${EVENT_TEXT[e.action]}${who}`);
  }
  doc.font("Helvetica").fontSize(10);

  heading("Decision");
  if (c.status === "closed") {
    doc.text(`Verdict: ${c.verdict === "confirmed" ? "suspicious activity confirmed" : "false positive"}`);
    doc.text(`Closing note: ${c.closing_note}`);
  } else {
    doc.text("No decision recorded yet. This case is still " + c.status + ".");
  }

  const closer = [...events].reverse().find((e) => e.action.startsWith("case_closed"));
  doc.moveDown(1.5);
  doc.text(`Prepared by: ${c.assignee_name || c.created_by_name}`);
  doc.text(`Reviewed and decided by: ${closer ? closer.user_name : "pending"}`);
  doc.text(`Report generated: ${date(new Date())}`);
  doc.end();
}
