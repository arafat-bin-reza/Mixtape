// Read-only admin page (plan.md section 36, phase 2), served by the Worker at /v1/admin/.
// It holds no data: it asks for the admin token, keeps it in sessionStorage for the tab, and reads the
// token-protected JSON routes. Every value is written with textContent because the log is visitor-supplied.
export const ADMIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Mixtape usage log</title>
<style>
:root{--bg:#f4f5f8;--surface:#fff;--text:#12141c;--muted:#5c6275;--accent:#2b50f0;--line:#d5d9e3;--tint:#e8ecfd;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0e1017;--surface:#171a24;--text:#eceef5;--muted:#9299ae;--accent:#8aa0ff;--line:#2a2f3f;--tint:#1f2640}}
*{box-sizing:border-box}
body{margin:0;padding:16px;background:var(--bg);color:var(--text);font:14px/1.45 "Segoe UI",system-ui,sans-serif}
h1{font-size:1.25rem;margin:0 0 12px}
button,input{font:inherit;color:inherit}
input{padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);min-width:0}
button{padding:7px 14px;border:1px solid var(--line);border-radius:8px;background:var(--surface);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--bg);font-weight:600}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.tabs button[aria-selected=true]{background:var(--tint);border-color:var(--accent);color:var(--accent);font-weight:600}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin-bottom:12px}
.filters label{display:grid;gap:2px;font-size:.8rem;color:var(--muted)}
.filters label[hidden]{display:none}
#status{margin:0 0 8px;color:var(--muted);min-height:1.4em}
#status.err{color:#d8362f}
.wrap{overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:10px;max-height:calc(100vh - 230px)}
table{border-collapse:collapse;width:100%}
th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}
th{position:sticky;top:0;background:var(--surface);font-size:.78rem;color:var(--muted)}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td button{border:0;background:none;padding:0;color:var(--accent);text-decoration:underline}
#login{max-width:420px;display:grid;gap:10px}
[hidden]{display:none!important}
</style>
</head>
<body>
<h1>Mixtape usage log</h1>
<form id="login">
  <label for="token">Admin token</label>
  <input id="token" type="password" autocomplete="off" required>
  <button class="primary">Open</button>
  <p id="login-status" role="alert"></p>
</form>
<main id="app" hidden>
  <div class="tabs" role="tablist" id="tabs"></div>
  <form class="filters" id="filters">
    <label data-f="from">From<input name="from" type="date"></label>
    <label data-f="to">To<input name="to" type="date"></label>
    <label data-f="ip">IP address<input name="ip" size="16"></label>
    <label data-f="visitor">Visitor id<input name="visitor" size="24"></label>
    <label data-f="track">Track id<input name="track" size="24"></label>
    <button class="primary">Show</button>
    <button type="button" id="csv">Download CSV</button>
    <button type="button" id="logout">Lock</button>
  </form>
  <p id="status" aria-live="polite"></p>
  <div class="wrap"><table id="table"></table></div>
</main>
<script>
const VIEWS = [
  { id: "report/visitors", label: "Visitors", f: ["from", "to", "ip", "visitor"] },
  { id: "report/activity", label: "Activity of one IP or visitor", f: ["from", "to", "ip", "visitor"], need: ["ip", "visitor"] },
  { id: "report/links", label: "Links added", f: ["from", "to", "ip", "visitor", "track"] },
  { id: "report/top", label: "Most played", f: ["from", "to", "track"] },
  { id: "report/plays", label: "Who played a track", f: ["from", "to", "track", "ip", "visitor"], need: ["track"] },
];
// Clicking one of these cells opens the matching view filtered to that value.
const DRILL = { ip: ["report/activity", "ip"], visitor_id: ["report/activity", "visitor"], first_visitor_id: ["report/activity", "visitor"], track_id: ["report/plays", "track"] };
const HIDE = /_at$/; // the *_utc twin is shown instead
const $ = (id) => document.getElementById(id);
const form = $("filters");
let token = "", current = VIEWS[0];
try { token = sessionStorage.getItem("mixtape-admin") || ""; } catch {}

function status(msg, err) { $("status").textContent = msg; $("status").classList.toggle("err", !!err); }

function params() {
  const p = new URLSearchParams();
  for (const name of current.f) { const v = form.elements[name].value.trim(); if (v) p.set(name, v); }
  return p;
}

async function get(extra) {
  const p = params();
  if (extra) p.set("format", extra);
  const r = await fetch("/v1/admin/" + current.id + "?" + p, { headers: { Authorization: "Bearer " + token } });
  if (r.status === 401) { lock("That token was not accepted."); throw new Error("locked"); }
  if (!r.ok) throw new Error(await r.text() || "Request failed (" + r.status + ")");
  return r;
}

function select(view, values) {
  current = view;
  for (const b of $("tabs").children) b.setAttribute("aria-selected", b.dataset.id === view.id);
  for (const label of form.querySelectorAll("label")) label.hidden = !view.f.includes(label.dataset.f);
  if (values) for (const [k, v] of Object.entries(values)) form.elements[k].value = v;
  load();
}

function render(rows) {
  const table = $("table");
  table.replaceChildren();
  if (!rows.length) return;
  const cols = Object.keys(rows[0]).filter((c) => !HIDE.test(c));
  const head = table.createTHead().insertRow();
  for (const c of cols) { const th = document.createElement("th"); th.textContent = c.replace(/_/g, " "); head.append(th); }
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const c of cols) {
      const td = tr.insertCell(), v = row[c];
      if (v === null || v === undefined) continue;
      if (typeof v === "number") td.className = "num";
      const text = /_utc$/.test(c) ? String(v).replace("T", " ").slice(0, 19) : String(v);
      td.title = text;
      if (DRILL[c]) {
        const b = document.createElement("button");
        b.type = "button"; b.textContent = text;
        b.onclick = () => { form.reset(); select(VIEWS.find((x) => x.id === DRILL[c][0]), { [DRILL[c][1]]: text }); };
        td.append(b);
      } else td.textContent = text;
    }
  }
}

async function load() {
  $("table").replaceChildren();
  if (current.need && !current.need.some((n) => form.elements[n].value.trim())) { status("Enter " + current.need.join(" or ") + " and press Show."); return; }
  status("Loading…");
  try {
    const rows = await (await get()).json();
    render(rows);
    status(rows.length ? rows.length + " row" + (rows.length > 1 ? "s" : "") + (rows.length >= 500 ? " (first 500; narrow the dates for more)" : "") : "Nothing recorded for these filters.");
  } catch (e) { if (e.message !== "locked") status(e.message, true); }
}

function lock(msg) {
  token = "";
  try { sessionStorage.removeItem("mixtape-admin"); } catch {}
  $("table").replaceChildren();
  $("app").hidden = true; $("login").hidden = false;
  $("login-status").textContent = msg || "";
  $("token").value = ""; $("token").focus();
}

function open() {
  $("login").hidden = true; $("app").hidden = false;
  select(current);
}

for (const v of VIEWS) {
  const b = document.createElement("button");
  b.type = "button"; b.role = "tab"; b.dataset.id = v.id; b.textContent = v.label;
  b.onclick = () => select(v);
  $("tabs").append(b);
}
form.onsubmit = (e) => { e.preventDefault(); load(); };
$("logout").onclick = () => lock();
$("csv").onclick = async () => {
  try {
    const blob = await (await get("csv")).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = current.id.replace("/", "-") + ".csv"; a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { if (e.message !== "locked") status(e.message, true); }
};
$("login").onsubmit = (e) => {
  e.preventDefault();
  token = $("token").value.trim();
  try { sessionStorage.setItem("mixtape-admin", token); } catch {}
  $("login-status").textContent = "";
  open();
};
if (token) open();
</script>
</body>
</html>
`;
