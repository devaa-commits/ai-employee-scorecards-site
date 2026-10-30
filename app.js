// AI Workforce Scorecards: overview and per-employee pages, rendered from /api/data.
const TRACKER = "https://claude.ai/artifact/PaozBLWfX7CCum8i8oBqCA";
const app = document.getElementById("app");
let DATA = null, HISTORY = [], STATUS = null;
const ui = { status: "all", group: "all", missedOnly: false };

// ---------- helpers ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v; // only used for text written in our own calculators
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}
const svg = (tag, attrs = {}) => { const el = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

function fmt(v, f) {
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "–";
  if (f === "pct") return `${(v * 100).toFixed(1)}%`;
  if (f === "int") return Math.round(v).toLocaleString();
  if (f === "sec") return `${v < 10 ? v.toFixed(1) : Math.round(v)} s`;
  if (f === "num") return typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v;
  return String(v);
}
const target = (k) => k.target == null ? "none set" : `${k.direction === "max" ? "at most" : "at least"} ${fmt(k.target, k.fmt)}`;
function ago(iso) {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (Math.abs(m) < 1) return "just now";
  if (m < 0) return `in ${-m} min`;
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}
const until = (iso) => { const m = Math.round((new Date(iso) - Date.now()) / 60000); return m <= 0 ? "now" : `in ${m} min`; };
const shortDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "–";

const PILL = {
  "Met": ["good", "✓"], "Missed": ["bad", "✕"], "No data": ["none", "–"], "No target": ["none", "·"],
  "On track": ["good", "✓"], "Needs attention": ["warn", "!"], "Stalled or idle": ["bad", "■"],
};
const pill = (s) => { const [c, i] = PILL[s] ?? ["none", "–"]; return h("span", { class: `pill ${c}` }, h("span", { "aria-hidden": "true" }, i), s); };

// ---------- data ----------
// Hosted (config.js has a Supabase URL): sign in with Google, read the tables the hourly GitHub job writes.
// Local: read the server's /api/*.
const CFG = window.SCORECARDS ?? {};
const HOSTED = !!CFG.supabaseUrl;
let sb = null;

async function hostedClient() {
  if (sb) return sb;
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
  sb = createClient(CFG.supabaseUrl, CFG.supabaseKey);
  return sb;
}
const signIn = async () => (await hostedClient()).auth.signInWithOAuth({
  provider: "google",
  options: { redirectTo: location.origin + location.pathname, queryParams: { hd: "vendasta.com" } },
});
const signOut = async () => { await (await hostedClient()).auth.signOut(); location.reload(); };

function gate(msg, email) {
  app.replaceChildren(h("header", { class: "top" }, h("h1", {}, "AI Workforce Scorecards")),
    h("div", { class: "empty" }, h("p", {}, msg),
      email ? h("button", { onclick: signOut }, "Sign out") : h("button", { class: "primary", onclick: signIn }, "Sign in with Google")));
}

async function loadHosted() {
  const c = await hostedClient();
  const { data: { session } } = await c.auth.getSession();
  if (!session) return gate("Sign in with your Vendasta Google account to see the scorecards.");
  const [latest, hist] = await Promise.all([
    c.from("scorecard_latest").select("data").eq("id", 1).maybeSingle(),
    c.from("scorecard_history").select("at,kpis").order("at", { ascending: false }).limit(48),
  ]);
  if (latest.error) throw latest.error;
  // Row level security returns nothing (not an error) to accounts outside vendasta.com.
  if (!latest.data) return gate(`No data for ${session.user.email}. Only vendasta.com Google accounts can see the scorecards; if you use one, the first refresh may not have run yet.`, session.user.email);
  DATA = latest.data.data;
  HISTORY = (hist.data ?? []).reverse();
  const next = new Date(DATA.generatedAt); next.setUTCHours(next.getUTCHours() + 1, 7, 0, 0);
  STATUS = {
    hosted: true, running: false, everyMinutes: 60, nextRun: next.toISOString(), email: session.user.email,
    lastError: DATA.employees.filter((e) => e.error).map((e) => `${e.name}: ${e.error}`).join("; ") || null,
  };
  render();
}

async function load() {
  if (HOSTED) return loadHosted().catch((e) => gate(`Couldn't load the scorecards: ${e.message}`));
  const [d, hist, st] = await Promise.all(["/api/data", "/api/history", "/api/status"].map((u) => fetch(u).then((r) => r.json())));
  DATA = d; HISTORY = hist; STATUS = st;
  render();
}
async function pollStatus() {
  if (HOSTED) return DATA && load();
  const st = await fetch("/api/status").then((r) => r.json()).catch(() => null);
  if (!st) return;
  const finished = STATUS?.running && !st.running;
  const newer = st.lastRun && st.lastRun !== DATA?.generatedAt;
  STATUS = st;
  if (finished || newer) return load();
  renderStatus();
}
async function refreshNow() {
  await fetch("/api/refresh", { method: "POST" });
  STATUS = { ...STATUS, running: true };
  renderStatus();
}

// ---------- shared pieces ----------
function statusBar() {
  return h("div", { class: "refresh", id: "status" });
}
function renderStatus() {
  const el = document.getElementById("status");
  if (!el || !STATUS) return;
  const busy = STATUS.running;
  el.replaceChildren(...[
    h("span", {}, h("span", { class: `dot ${busy ? "busy" : STATUS.lastError ? "err" : ""}` }),
      busy ? "Refreshing from Vendasta…" : `Updated ${ago(DATA?.generatedAt)}`),
    !busy && STATUS.nextRun ? h("span", {}, `Next refresh ${until(STATUS.nextRun)} (every ${STATUS.everyMinutes} min)`) : null,
    STATUS.lastError && !busy ? h("span", { title: STATUS.lastError, style: "color:var(--bad-ink)" }, "Last refresh had errors") : null,
    STATUS.hosted ? h("button", { onclick: signOut, title: STATUS.email }, "Sign out")
      : h("button", { class: "primary", onclick: refreshNow, disabled: busy }, busy ? "Refreshing…" : "Refresh now"),
  ].filter(Boolean));
}

function spark(series) {
  const pts = series.filter((x) => x != null);
  if (pts.length < 2) return null;
  const lo = Math.min(...pts), hi = Math.max(...pts), w = 80, hgt = 20;
  const d = series.map((v, i) => v == null ? null : `${(i / (series.length - 1)) * w},${hgt - 2 - ((v - lo) / (hi - lo || 1)) * (hgt - 4)}`).filter(Boolean);
  const s = svg("svg", { class: "spark", viewBox: `0 0 ${w} ${hgt}`, role: "img", "aria-label": "Trend over recent refreshes" });
  s.append(svg("path", { d: "M" + d.join("L") }));
  return s;
}
const trend = (id) => HISTORY.slice(-48).map((p) => p.kpis?.[id] ?? null);

function dataTable(cols, rows, { cls } = {}) {
  return h("div", { class: "table-wrap" }, h("table", { class: cls },
    h("thead", {}, h("tr", {}, cols.map(([, label, f]) => h("th", { class: f && f !== "raw" ? "num" : null }, label)))),
    h("tbody", {}, rows.map((r) => h("tr", {}, cols.map(([field, , f]) => h("td", { class: f && f !== "raw" ? "num" : null }, f && f !== "raw" ? fmt(r[field], f) : (r[field] ?? "–"))))))));
}

// Stacked daily bars with a hover tooltip per day.
function dailyChart(daily, series) {
  if (!daily?.length || !series?.length) return null;
  const W = 900, H = 220, m = { t: 12, r: 8, b: 24, l: 40 };
  const totals = daily.map((d) => series.reduce((s, [f]) => s + (d[f] || 0), 0));
  const max = Math.max(1, ...totals);
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const nice = Math.ceil(max / step) * step;
  const iw = W - m.l - m.r, ih = H - m.t - m.b, bw = iw / daily.length;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Daily activity" });
  for (let i = 0; i <= 4; i++) {
    const y = m.t + ih - (ih * i) / 4;
    root.append(svg("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, class: i ? "grid" : "base" }));
    const t = svg("text", { x: m.l - 6, y: y + 4, "text-anchor": "end" }); t.textContent = Math.round((nice * i) / 4).toLocaleString(); root.append(t);
  }
  const box = h("div", { class: "chart" });
  const tip = h("div", { class: "tip", hidden: true });
  daily.forEach((d, i) => {
    let y = m.t + ih;
    const x = m.l + i * bw + Math.max(1, bw * 0.15), w = Math.max(2, bw * 0.7);
    const segs = series.map(([f], si) => ({ v: d[f] || 0, si })).filter((s) => s.v > 0);
    segs.forEach((s, j) => {
      const hh = (s.v / nice) * ih;
      const top = j === segs.length - 1;
      const gap = j > 0 ? 2 : 0;
      y -= hh;
      const r = Math.min(4, w / 2, hh);
      // Rounded top only on the last segment; 2px surface gap between segments.
      const path = top
        ? `M${x},${y + hh - gap}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hh - gap}Z`
        : `M${x},${y + hh - gap}V${y}H${x + w}V${y + hh - gap}Z`;
      root.append(svg("path", { d: path, fill: `var(--s${s.si + 1})` }));
    });
    if (daily.length <= 16 || i % Math.ceil(daily.length / 8) === 0) {
      const t = svg("text", { x: x + w / 2, y: H - 6, "text-anchor": "middle" }); t.textContent = shortDate(d.day + "T12:00:00"); root.append(t);
    }
    const hit = svg("rect", { x: m.l + i * bw, y: m.t, width: bw, height: ih, class: "hit" });
    hit.addEventListener("mousemove", (ev) => {
      tip.replaceChildren(h("b", {}, shortDate(d.day + "T12:00:00")), ...series.map(([f, label], si) => h("div", {}, h("span", { class: "legend" }, h("i", { style: `background:var(--s${si + 1})` })), `${label}: ${fmt(d[f] || 0, "int")}`)), h("div", { class: "muted" }, `Total: ${fmt(totals[i], "int")}`));
      tip.hidden = false;
      const rect = box.getBoundingClientRect();
      const left = ev.clientX - rect.left + 12;
      tip.style.left = `${Math.min(left, rect.width - tip.offsetWidth - 4)}px`;
      tip.style.top = `${ev.clientY - rect.top - 10}px`;
    });
    hit.addEventListener("mouseleave", () => { tip.hidden = true; });
    root.append(hit);
  });
  box.append(root, tip);
  return h("div", { style: "display:grid;gap:8px" },
    series.length > 1 ? h("div", { class: "legend" }, series.map(([, label], si) => h("span", {}, h("i", { style: `background:var(--s${si + 1})` }), label))) : null,
    box,
    h("details", {}, h("summary", {}, "Show as table"), dataTable([["day", "Day", "raw"], ...series.map(([f, l]) => [f, l, "int"])], daily)));
}

// ---------- overview ----------
function overview() {
  const emps = DATA.employees;
  const kpis = emps.flatMap((e) => (e.kpis ?? []).map((k) => ({ ...k, emp: e })));
  const scored = kpis.filter((k) => k.status === "Met" || k.status === "Missed");
  const met = scored.filter((k) => k.status === "Met").length;
  const count = (s) => emps.filter((e) => e.status === s).length;
  const groups = [...new Set(emps.map((e) => e.group))];

  const rows = emps.filter((e) => (ui.status === "all" || e.status === ui.status) && (ui.group === "all" || e.group === ui.group));
  const head = (e) => e.kpis?.find((k) => k.metric === e.headline) ?? e.kpis?.[0];
  const firstMiss = (e) => e.kpis?.find((k) => k.status === "Missed");

  const missedSorted = scored
    .filter((k) => !ui.missedOnly || k.status === "Missed")
    .map((k) => ({ ...k, gap: k.status === "Missed" ? Math.abs(k.value - k.target) / (Math.abs(k.target) || 1) : -1 }))
    .sort((a, b) => b.gap - a.gap);

  return [
    h("header", { class: "top" },
      h("div", {}, h("h1", {}, "AI Workforce Scorecards"),
        h("p", { class: "sub" }, `VMF AI employees, scored against their own rubrics over the last ${DATA.windowDays} days. Refreshes itself from Vendasta.`)),
      statusBar()),
    h("section", { class: "tiles" },
      tile("Employees scored", emps.length, `${count("On track")} on track`),
      tile("Targets met", `${met} of ${scored.length}`, scored.length ? `${((met / scored.length) * 100).toFixed(0)}% of all KPI targets` : ""),
      tile("Needs attention", count("Needs attention"), "Missing at least one target"),
      tile("Stalled or idle", count("Stalled or idle"), "No work in the last 7 days")),
    h("section", { class: "panel" },
      h("div", { class: "panel-h" },
        h("div", {}, h("h2", {}, "Employees"), h("p", { class: "muted small" }, "Click a row for the full scorecard.")),
        h("div", { class: "controls" },
          h("label", {}, "Status", select(["all", "On track", "Needs attention", "Stalled or idle"], ui.status, (v) => { ui.status = v; render(); })),
          h("label", {}, "Stage", select(["all", ...groups], ui.group, (v) => { ui.group = v; render(); })),
          h("span", {}, `${rows.length} of ${emps.length}`))),
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Employee"), h("th", {}, "Status"), h("th", { class: "num" }, "Volume"), h("th", {}, "Headline KPI"), h("th", {}, "Targets met"), h("th", {}, "Biggest gap"), h("th", {}, "Last work"))),
        h("tbody", {}, rows.map((e) => {
          const k = head(e), miss = firstMiss(e);
          return h("tr", { class: "click", onclick: () => { location.hash = `#/e/${e.key}`; } },
            h("td", { class: "name" }, h("a", { href: `#/e/${e.key}` }, e.name), h("div", { class: "muted small" }, `${e.role} · ${e.group}`)),
            h("td", {}, pill(e.status), e.stale ? h("div", { class: "small", style: "color:var(--bad-ink)" }, "Refresh failed, showing last data") : null),
            h("td", { class: "num" }, fmt(e.volume, "int"), h("div", { class: "muted small" }, e.unit)),
            h("td", {}, k ? [h("div", {}, h("b", {}, fmt(k.value, k.fmt)), " ", k.label), h("div", { class: "muted small" }, `Target ${target(k)}`)] : "–"),
            h("td", {}, `${e.met} of ${e.targets}`, h("div", { class: "meter" }, h("span", { style: `width:${e.targets ? (e.met / e.targets) * 100 : 0}%` }))),
            h("td", { class: "small" }, miss ? `${miss.label}: ${fmt(miss.value, miss.fmt)} (${target(miss)})` : h("span", { class: "muted" }, "None"), e.issue ? h("div", { class: "muted" }, e.issue) : null),
            h("td", { class: "small" }, shortDate(e.lastActivity), h("div", { class: "muted" }, ago(e.lastActivity))));
        }))))),
    h("section", { class: "panel" },
      h("div", { class: "panel-h" },
        h("div", {}, h("h2", {}, "Every KPI against its target"), h("p", { class: "muted small" }, "Missed targets first, biggest gap at the top. Trend shows the last 48 hourly refreshes.")),
        h("div", { class: "controls" }, h("label", {}, h("input", { type: "checkbox", checked: ui.missedOnly, onchange: (ev) => { ui.missedOnly = ev.target.checked; render(); } }), "Show only missed"))),
      h("div", { class: "table-wrap" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Employee"), h("th", {}, "KPI"), h("th", { class: "num" }, "Now"), h("th", { class: "num" }, "Target"), h("th", {}, "Status"), h("th", {}, "Trend"))),
        h("tbody", {}, missedSorted.map((k) => h("tr", {},
          h("td", {}, h("a", { href: `#/e/${k.emp.key}` }, k.emp.name)),
          h("td", {}, k.label),
          h("td", { class: "num" }, fmt(k.value, k.fmt)),
          h("td", { class: "num" }, target(k)),
          h("td", {}, pill(k.status)),
          h("td", {}, spark(trend(`${k.emp.key}.${k.metric}`)) ?? h("span", { class: "muted small" }, "Builds up hourly")))))))),
    h("section", { class: "panel" },
      h("h2", {}, "Action owners"),
      h("p", { class: "sub" }, "Owners, due dates and progress for each fix live in the shared Action Tracker, so the team can edit them in one place."),
      h("p", {}, h("a", { href: TRACKER, target: "_blank", rel: "noopener" }, "Open the Action Tracker ↗"))),
    h("p", { class: "muted small" }, `Data from Vendasta automation logs and the Jobs to be done evaluator, partner VMF. Last full refresh took ${DATA.seconds?.toFixed(0) ?? "–"} s.`),
  ];
}
function tile(label, value, foot) { return h("div", { class: "tile" }, h("div", { class: "label" }, label), h("div", { class: "value" }, value), foot ? h("div", { class: "foot" }, foot) : null); }
function select(options, value, on) { return h("select", { onchange: (ev) => on(ev.target.value) }, options.map((o) => h("option", { value: o, selected: o === value }, o === "all" ? "All" : o))); }

// ---------- employee page ----------
function employee(key) {
  const e = DATA.employees.find((x) => x.key === key);
  if (!e) return [h("p", { class: "back" }, h("a", { href: "#/" }, "← All employees")), h("p", { class: "empty" }, "No scorecard for this employee yet.")];
  const a = e.about ?? {};
  return [
    h("p", { class: "back" }, h("a", { href: "#/" }, "← All employees")),
    h("header", { class: "top" },
      h("div", { style: "display:grid;gap:6px" },
        h("h1", {}, e.name, " ", pill(e.status)),
        h("p", { class: "sub" }, `${e.role} · ${e.group} · ${e.source}`),
        h("p", { class: "muted small" }, `${fmt(e.volume, "int")} ${e.unit} · ${shortDate(e.window?.from)} – ${shortDate(e.window?.to)} · last work ${ago(e.lastActivity)}`)),
      statusBar()),
    e.error ? h("div", { class: "banner" }, `The last refresh failed for ${e.name}, so this shows the previous data. Error: ${e.error}`) : null,
    e.issue ? h("p", { class: "sub" }, e.issue) : null,
    h("section", { class: "tiles" }, (e.kpis ?? []).map((k) => h("div", { class: "tile" },
      h("div", { class: "label" }, k.label),
      h("div", { class: "value" }, fmt(k.value, k.fmt)),
      h("div", {}, pill(k.status), " ", h("span", { class: "muted small" }, `Target ${target(k)}`)),
      k.numerator != null && k.denominator != null ? h("div", { class: "foot" }, `${fmt(k.numerator, "int")} of ${fmt(k.denominator, "int")}`) : null,
      spark(trend(`${e.key}.${k.metric}`)),
      k.how ? h("div", { class: "how" }, k.how) : null))),
    e.daily?.length ? h("section", { class: "panel" }, h("h2", {}, "Daily activity"), dailyChart(e.daily, e.dailySeries)) : null,
    e.automations?.length ? h("section", { class: "panel" }, h("h2", {}, `Automations using ${e.name}`),
      dataTable(e.automationCols ?? [["automation", "Automation", "raw"], ["calls", "Calls", "int"]], e.automations)) : null,
    (e.breakdowns ?? []).filter((b) => b.rows?.length).map((b) => h("section", { class: "panel" }, h("h2", {}, b.title), b.note ? h("p", { class: "muted small" }, b.note) : null, dataTable(b.cols, b.rows))),
    h("section", { class: "cols" },
      h("div", { class: "panel" }, h("h2", {}, "What it does"), a.does ? h("div", { class: "sub", html: a.does }) : null,
        a.rubric?.length ? [h("h3", {}, "The rubric it works to"), h("ul", {}, a.rubric.map((r) => h("li", { html: r })))] : null),
      h("div", { class: "panel" }, h("h2", {}, "What to fix"), a.fixes?.length ? h("ol", {}, a.fixes.map((f) => h("li", { html: f }))) : h("p", { class: "muted" }, "Nothing listed."),
        h("p", { class: "small" }, h("a", { href: TRACKER, target: "_blank", rel: "noopener" }, "Track owners in the Action Tracker ↗")))),
    a.method?.length ? h("section", { class: "panel" }, h("h2", {}, "How it's measured"),
      h("ul", {}, a.method.map(([t, d]) => h("li", {}, h("b", {}, t), ". ", h("span", { html: d }))))) : null,
  ];
}

// ---------- router ----------
function render() {
  if (!DATA) return;
  const m = location.hash.match(/^#\/e\/(\w+)/);
  if (!DATA.employees?.length) {
    app.replaceChildren(h("header", { class: "top" }, h("h1", {}, "AI Workforce Scorecards"), statusBar()), h("p", { class: "empty" }, "No data yet. The first refresh runs on startup and takes a few minutes."));
  } else app.replaceChildren(...(m ? employee(m[1]) : overview()).flat().filter(Boolean));
  document.title = m ? `${DATA.employees.find((e) => e.key === m[1])?.name ?? "Employee"} · AI Workforce Scorecards` : "AI Workforce Scorecards";
  renderStatus();
}
addEventListener("hashchange", () => { render(); scrollTo(0, 0); });
load();
// Hosted data changes once an hour, so check every 5 minutes; locally poll the refresh status.
setInterval(pollStatus, HOSTED ? 300000 : 15000);
