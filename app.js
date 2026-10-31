// AI Workforce Scorecards: an app shell (top bar, sidebar, overview and per-employee pages)
// rendered from /api/data locally, or from Supabase when hosted.
const TRACKER = "https://claude.ai/artifact/PaozBLWfX7CCum8i8oBqCA";
const app = document.getElementById("app");
let DATA = null, HISTORY = [], STATUS = null;
const ui = { status: "all", group: "all", q: "", missedOnly: true, nav: false };

// Each partner has its own tab: VMF (Vendasta) and PRBS (Broadly by Vendasta).
const PARTNERS = [["VMF", "Vendasta", "VMF"], ["PRBS", "Broadly", "PRBS"]];
const partnerOfEmp = (e) => e?.partner ?? "VMF";
const partnerName = (p) => (PARTNERS.find(([id]) => id === p) ?? [p, p])[1];
const partnerHref = (p) => (p === "VMF" ? "#/" : `#/p/${p}`);
const empsOf = (p) => (DATA?.employees ?? []).filter((e) => partnerOfEmp(e) === p);
// The partner being viewed: from the URL, or the open employee's partner.
function currentPartner() {
  const p = location.hash.match(/^#\/p\/(\w+)/)?.[1];
  if (p) return p;
  const k = location.hash.match(/^#\/e\/([\w-]+)/)?.[1];
  return partnerOfEmp(DATA?.employees?.find((e) => e.key === k));
}

// ---------- helpers ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v; // only used for text written in our own calculators, and our own icons
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
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
// Targets we proposed (not yet agreed with the employee's owner) are marked, so nobody mistakes them for agreed ones.
const targetNote = (k) => k.target != null && k.targetSource === "proposed" ? h("span", { class: "proposed", title: "Proposed target, not yet agreed with the employee's owner" }, "proposed") : null;
function ago(iso) {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (Math.abs(m) < 1) return "just now";
  if (m < 0) return `in ${-m} min`;
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}
const until = (iso) => { const m = Math.round((new Date(iso) - Date.now()) / 60000); return m <= 0 ? "any minute" : `in ${m} min`; };
const shortDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "–";
const longTime = (iso) => iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "–";

const PILL = {
  "Met": ["good", "✓"], "Missed": ["bad", "✕"], "No data": ["none", "–"], "No target": ["none", "·"],
  "Too few": ["none", "~"], "Historical": ["none", "◷"],
  "On track": ["good", "✓"], "Needs attention": ["warn", "!"], "Stalled or idle": ["bad", "■"],
};
const pill = (s) => { const [c, i] = PILL[s] ?? ["none", "–"]; return h("span", { class: `pill ${c}` }, h("span", { "aria-hidden": "true" }, i), s); };
const tone = (s) => (PILL[s] ?? ["none"])[0];

// Relative gap to target, so the worst misses sort first.
const gapOf = (k) => k.status === "Missed" ? Math.abs(k.value - k.target) / (Math.abs(k.target) || 1) : -1;

const ICON = {
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  prev: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
};
const icon = (name) => h("span", { class: "ico", "aria-hidden": "true", html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>` });
function btn(label, name, onclick, { primary, title, disabled, hideLabel } = {}) {
  return h("button", { class: `btn${primary ? " primary" : ""}${hideLabel ? " icon-only" : ""}`, onclick, title: title ?? label, "aria-label": label, disabled },
    name ? icon(name) : null, h("span", { class: "btn-label" }, label));
}

// The Vendasta wordmark (from vendasta.com); the letters take the text colour so it works in both themes.
const LOGO = '<svg role="img" aria-label="Vendasta" viewBox="0 0 134 21" xmlns="http://www.w3.org/2000/svg"><path d="M16.7206 9.74285e-06H16.1182V0.799063C16.1019 5.98878 15.8888 13.0696 18.7018 18.4867C18.8289 18.7346 18.96 18.9805 19.1116 19.2202C19.7982 18.5692 20.1871 17.6647 20.1872 16.7186V3.45642C20.1867 2.53811 19.821 1.65772 19.1707 1.00934C18.5204 0.360964 17.6389 -0.00216845 16.7206 9.74285e-06ZM15.2413 19.38C11.3342 17.28 6.94968 15.0938 0.796997 14.6472C0.532692 14.6267 0.272491 14.6021 0 14.5919V16.7186C0 18.6278 1.54714 20.1759 3.4564 20.177H16.7206L15.2413 19.38ZM3.4564 9.74285e-06C1.54795 0.00114271 0.00112915 1.54796 0 3.45642V12.2275C0.256104 12.1394 0.522453 12.037 0.796997 11.9243C4.01982 10.6089 8.60719 7.60532 14.0387 0.799063C14.2463 0.538176 14.4553 0.271822 14.6656 9.74285e-06H3.4564Z" fill="#3F9B63"/><path d="M23.2422 2.32749H25.6741L30.2349 14.9566H30.28L35.0148 2.32749H37.3096L31.1917 17.8516H29.2187L23.2422 2.32749ZM38.7437 2.32749H48.7646V4.30052H40.8479V8.92681H48.2237V10.8998H40.8479V15.8785H49.158V17.8516H38.7437V2.32749ZM51.2622 2.32749H54.0261L62.5779 15.0877H62.621V2.32749H64.7272V17.8516H62.0514L53.4114 5.08932H53.3684V17.8516H51.2622V2.32749ZM67.489 2.32749H72.9041C73.8787 2.3105 74.8506 2.43613 75.7889 2.70038C76.5519 2.92083 77.2762 3.2581 77.9361 3.70021C78.5159 4.09216 79.0274 4.57668 79.4502 5.1344C79.8364 5.64743 80.1565 6.20707 80.4029 6.80011C80.6308 7.35117 80.8003 7.92455 80.9089 8.51089C81.005 9.03138 81.0557 9.55923 81.0606 10.0885C81.0621 11.0753 80.8764 12.0535 80.5135 12.9712C80.1479 13.8999 79.5956 14.7436 78.8908 15.4503C78.1286 16.2039 77.2229 16.7968 76.2273 17.1939C75.0564 17.652 73.8068 17.8754 72.5496 17.8516H67.489V2.32749ZM69.5932 15.8785H72.2464C73.1038 15.8836 73.9573 15.7614 74.7788 15.5159C75.5403 15.2925 76.2514 14.9238 76.8727 14.43C77.4808 13.9426 77.9711 13.3242 78.3069 12.6209C78.6729 11.8278 78.853 10.9617 78.8335 10.0885C78.8204 9.49993 78.7393 8.91485 78.5917 8.34493C78.4171 7.65725 78.104 7.01237 77.6718 6.44976C77.1787 5.81134 76.5485 5.29181 75.8278 4.92952C75.0383 4.51155 74.0139 4.30667 72.7545 4.31487H69.5932V15.8785ZM89.7886 2.48524L89.7087 2.29266H87.8647L87.7807 2.48116L81.2572 17.4377L81.0647 17.8762H83.2036L83.2856 17.6856L84.8939 13.9055H92.3948L93.9416 17.6815L94.0215 17.8762H96.2753L96.0929 17.4418L89.7886 2.48524ZM85.7094 12.0062L88.715 4.92952L91.6285 11.998L85.7094 12.0062ZM105.331 10.0352C104.719 9.72141 104.075 9.47612 103.409 9.30379C102.79 9.14286 102.182 8.94234 101.588 8.70348C101.091 8.5097 100.642 8.21053 100.273 7.82658C99.9509 7.48852 99.787 6.98246 99.787 6.32273C99.7773 5.94116 99.8602 5.56292 100.029 5.22045C100.183 4.91865 100.402 4.65483 100.67 4.44804C100.959 4.23182 101.286 4.0707 101.633 3.97271C102.023 3.86061 102.428 3.80473 102.834 3.80675C103.365 3.79324 103.891 3.90778 104.368 4.14071C104.817 4.38576 105.202 4.73237 105.493 5.15285L105.675 5.40895L105.929 5.22455L107.134 4.35994L107.38 4.17144L107.185 3.9174C106.694 3.23529 106.025 2.70043 105.251 2.37051C104.496 2.06219 103.688 1.90621 102.873 1.91157C102.226 1.90957 101.584 2.00347 100.965 2.19022C100.372 2.36517 99.8166 2.64785 99.326 3.02409C98.8456 3.39726 98.455 3.87332 98.1827 4.41731C97.8922 5.00981 97.7468 5.66294 97.7586 6.32273C97.7403 6.97516 97.8611 7.62402 98.1131 8.2261C98.334 8.724 98.6604 9.16792 99.0699 9.52711C99.4645 9.866 99.9088 10.1424 100.387 10.3467C100.848 10.5515 101.336 10.7277 101.821 10.8855C102.307 11.0433 102.791 11.1969 103.231 11.3465C103.64 11.4832 104.034 11.6617 104.407 11.8792C104.718 12.0615 104.982 12.3132 105.18 12.6147C105.378 12.9529 105.475 13.3414 105.458 13.7334C105.464 14.1051 105.384 14.4731 105.225 14.809C105.072 15.124 104.855 15.4033 104.587 15.6286C104.301 15.8656 103.973 16.0476 103.62 16.1654C103.231 16.2965 102.822 16.3615 102.412 16.358C101.771 16.3691 101.138 16.222 100.568 15.9298C100.02 15.6314 99.5687 15.1819 99.2686 14.6349L99.1006 14.348L98.822 14.5324L97.4923 15.4196L97.2218 15.5999L97.4124 15.8621C97.9802 16.6768 98.7653 17.3157 99.6784 17.7061C100.583 18.0726 101.552 18.2565 102.528 18.247C103.154 18.2479 103.777 18.1504 104.372 17.9581C104.954 17.7729 105.495 17.4772 105.964 17.0874C106.43 16.6971 106.808 16.2116 107.071 15.6634C107.352 15.0596 107.492 14.3995 107.48 13.7334C107.48 12.7397 107.275 11.9427 106.849 11.3649C106.455 10.8081 105.935 10.3525 105.331 10.0352Z" fill="currentColor"/><path d="M120.474 4.18567V2.29254H108.232V4.18567H113.344V17.8699H115.365V4.18567H120.474Z" fill="currentColor"/><path d="M133.628 17.4275L127.334 2.47091L127.254 2.27832H125.41L125.33 2.46682L118.802 17.4234L118.612 17.8618H120.755L120.837 17.6713L122.445 13.8912H129.946L131.491 17.6672L131.573 17.8618H133.827L133.628 17.4275ZM123.255 11.998L126.26 4.92952L129.174 11.998H123.255Z" fill="currentColor"/></svg>';

// ---------- theme (per-viewer preference; storage may be unavailable) ----------
const THEMES = ["auto", "light", "dark"];
let theme = "auto";
try { theme = localStorage.getItem("scorecards-theme") || "auto"; } catch {}
function applyTheme() {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
function cycleTheme() {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  try { localStorage.setItem("scorecards-theme", theme); } catch {}
  applyTheme(); render();
}
applyTheme();

// ---------- toasts ----------
function toast(msg) {
  const t = h("div", { class: "toast", role: "status" }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add("out"), 2200);
  setTimeout(() => t.remove(), 2600);
}
async function copyLink() {
  try { await navigator.clipboard.writeText(location.href); toast("Link copied"); }
  catch { toast("Couldn't copy. Use the address bar instead."); }
}

// ---------- CSV export ----------
function downloadCsv(name, cols, rows) {
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = [cols.map(([, l]) => esc(l)).join(","), ...rows.map((r) => cols.map(([f]) => esc(typeof f === "function" ? f(r) : r[f])).join(","))].join("\n");
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: "text/csv" })), download: `${name}-${(DATA.generatedAt ?? "").slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const KPI_CSV = [["emp", "Employee"], ["label", "KPI"], ["value", "Value"], [(k) => k.target ?? "", "Target"], ["direction", "Direction"], ["status", "Status"], [(k) => k.numerator ?? "", "Numerator"], [(k) => k.denominator ?? "", "Denominator"]];
function exportOverview() {
  const p = currentPartner();
  downloadCsv(`ai-employee-kpis-${p.toLowerCase()}`, KPI_CSV, empsOf(p).flatMap((e) => (e.kpis ?? []).map((k) => ({ ...k, emp: e.name }))));
}
function exportEmployee(e) {
  downloadCsv(`${e.key}-kpis`, KPI_CSV, (e.kpis ?? []).map((k) => ({ ...k, emp: e.name })));
}

// ---------- data ----------
// Hosted (config.js has a Supabase URL): read the tables the hourly GitHub job writes. No sign-in;
// the tables are readable with the publishable key. Local: read the server's /api/*.
const CFG = window.SCORECARDS ?? {};
const HOSTED = !!CFG.supabaseUrl;
let sb = null, loadError = null;

async function hostedClient() {
  if (sb) return sb;
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
  sb = createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: false } });
  return sb;
}

async function loadHosted() {
  const c = await hostedClient();
  const [latest, hist] = await Promise.all([
    c.from("scorecard_latest").select("data").eq("id", 1).maybeSingle(),
    c.from("scorecard_history").select("at,kpis").order("at", { ascending: false }).limit(48),
  ]);
  if (latest.error) throw latest.error;
  DATA = latest.data?.data ?? { employees: [] };
  HISTORY = (hist.data ?? []).reverse();
  // GitHub runs the refresh at 7 past each hour (UTC); show the next of those.
  const next = new Date(); next.setUTCMinutes(7, 0, 0); if (next <= Date.now()) next.setUTCHours(next.getUTCHours() + 1);
  STATUS = {
    hosted: true, running: false, everyMinutes: 60, nextRun: next.toISOString(),
    lastError: DATA.employees.filter((e) => e.error).map((e) => `${e.name}: ${e.error}`).join("; ") || null,
  };
}

async function load({ announce } = {}) {
  try {
    if (HOSTED) await loadHosted();
    else {
      const [d, hist, st] = await Promise.all(["/api/data", "/api/history", "/api/status"].map((u) => fetch(u).then((r) => r.json())));
      DATA = d; HISTORY = hist; STATUS = st;
    }
    loadError = null;
    if (announce) toast("Data reloaded");
  } catch (e) { loadError = e.message ?? String(e); }
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
  if (HOSTED) return load({ announce: true });
  await fetch("/api/refresh", { method: "POST" });
  STATUS = { ...STATUS, running: true };
  renderStatus();
}

// ---------- shell ----------
function topbar() {
  const themeIcon = theme === "light" ? "sun" : theme === "dark" ? "moon" : "auto";
  return h("header", { class: "topbar" },
    h("button", { class: "btn icon-only menu", "aria-label": "Open navigation", onclick: () => { ui.nav = true; render(); } }, icon("menu")),
    h("a", { class: "brand", href: "#/", "aria-label": "AI Workforce Scorecards home" },
      h("span", { class: "logo", html: LOGO }),
      h("span", { class: "brand-div", "aria-hidden": "true" }),
      h("span", { class: "brand-name" }, "AI Workforce Scorecards")),
    h("nav", { class: "partner-tabs", "aria-label": "Partner" }, PARTNERS.map(([id, name, tag]) =>
      h("a", { href: partnerHref(id), class: currentPartner() === id ? "on" : "", "aria-current": currentPartner() === id ? "page" : null }, name, h("span", { class: "tag" }, tag)))),
    h("div", { class: "status", id: "status" }),
    h("div", { class: "actions" },
      btn(theme === "auto" ? "Theme: system" : `Theme: ${theme}`, themeIcon, cycleTheme, { hideLabel: true })));
}

function sidebar(currentKey) {
  const partner = currentPartner();
  const emps = empsOf(partner);
  const groups = [...new Set(emps.map((e) => e.group))];
  const close = () => { ui.nav = false; render(); };
  return [
    h("div", { class: `scrim${ui.nav ? " show" : ""}`, onclick: close }),
    h("nav", { class: `sidebar${ui.nav ? " open" : ""}`, "aria-label": "Scorecards" },
      h("div", { class: "side-head" }, h("span", { class: "logo", html: LOGO }),
        h("button", { class: "btn icon-only", "aria-label": "Close navigation", onclick: close }, icon("close"))),
      h("a", { class: `nav-item${currentKey ? "" : " active"}`, href: partnerHref(partner), onclick: () => { ui.nav = false; } }, icon("grid"), `${partnerName(partner)} overview`),
      groups.map((g) => h("div", { class: "nav-group" },
        h("div", { class: "nav-label" }, g),
        emps.filter((e) => e.group === g).map((e) =>
          h("a", { class: `nav-item${e.key === currentKey ? " active" : ""}`, href: `#/e/${e.key}`, onclick: () => { ui.nav = false; }, title: e.status },
            h("span", { class: `dot ${tone(e.status)}`, "aria-hidden": "true" }), h("span", { class: "nav-name" }, e.name),
            h("span", { class: "nav-count" }, e.targets ? `${e.met}/${e.targets}` : ""))))),
      h("div", { class: "nav-group" },
        h("div", { class: "nav-label" }, "Team"),
        h("a", { class: "nav-item", href: TRACKER, target: "_blank", rel: "noopener" }, icon("ext"), "Action Tracker")),
      h("p", { class: "side-foot" }, `Partner ${partner} · ${DATA.windowDays ?? 30}-day window`, h("br"), `Last refresh took ${DATA.seconds?.toFixed(0) ?? "–"} s`)),
  ];
}

function renderStatus() {
  const el = document.getElementById("status");
  if (!el || !STATUS) return;
  const busy = STATUS.running;
  el.replaceChildren(...[
    h("span", { class: "st", title: DATA?.generatedAt ? `Data as of ${longTime(DATA.generatedAt)}` : null },
      h("span", { class: `dot ${busy ? "busy" : STATUS.lastError ? "bad" : "good"}`, "aria-hidden": "true" }),
      busy ? "Refreshing from Vendasta…" : `Updated ${ago(DATA?.generatedAt)}`),
    !busy && STATUS.nextRun ? h("span", { class: "st next" }, `Next ${until(STATUS.nextRun)}`) : null,
    STATUS.lastError && !busy ? h("span", { class: "st err", title: STATUS.lastError }, "Some employees failed") : null,
    btn(HOSTED ? "Reload" : busy ? "Refreshing…" : "Refresh now", "refresh", refreshNow,
      { primary: !HOSTED, disabled: busy, title: HOSTED ? "Reload the latest data (the server refreshes hourly)" : "Refresh from Vendasta now" }),
  ].filter(Boolean));
}

function pageHead({ crumbs, title, sub, meta, actions }) {
  return h("div", { class: "page-head" },
    crumbs ? h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, crumbs.map((c, i) => [i ? h("span", { "aria-hidden": "true" }, "/") : null, c.href ? h("a", { href: c.href }, c.label) : h("span", {}, c.label)])) : null,
    h("div", { class: "page-title" },
      h("div", { class: "page-title-text" }, h("h1", {}, title), sub ? h("p", { class: "sub" }, sub) : null, meta ? h("p", { class: "muted small" }, meta) : null),
      actions ? h("div", { class: "page-actions" }, actions) : null));
}

// ---------- charts ----------
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
const hasTrend = () => HISTORY.length >= 2;

function dataTable(cols, rows, { cls } = {}) {
  return h("div", { class: "table-wrap" }, h("table", { class: cls },
    h("thead", {}, h("tr", {}, cols.map(([, label, f]) => h("th", { class: f && f !== "raw" ? "num" : null }, label)))),
    h("tbody", {}, rows.map((r) => h("tr", {}, cols.map(([field, , f]) => h("td", { class: f && f !== "raw" ? "num" : null }, f && f !== "raw" ? fmt(r[field], f) : (r[field] ?? "–"))))))));
}

// Stacked daily bars with a hover tooltip per day. Drawn at the panel's width so labels stay legible on phones.
function dailyChart(daily, series) {
  if (!daily?.length || !series?.length) return null;
  // Width the panel will have once drawn: viewport minus sidebar (desktop), page and panel padding.
  const wide = innerWidth > 960;
  const W = Math.round(Math.max(300, Math.min(1180, innerWidth - (wide ? 248 + 56 : 32) - 34)));
  const H = W < 600 ? 200 : 220, m = { t: 12, r: 8, b: 24, l: 40 };
  const totals = daily.map((d) => series.reduce((s, [f]) => s + (d[f] || 0), 0));
  const max = Math.max(1, ...totals);
  // Round whole-number tick step (1, 2 or 5 × 10^k) giving at most 5 gridlines; the series are counts.
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(max / 5))));
  const tick = [1, 2, 5, 10].map((f) => f * mag).find((s) => max / s <= 5);
  const ticks = Math.ceil(max / tick), nice = ticks * tick;
  const iw = W - m.l - m.r, ih = H - m.t - m.b, bw = iw / daily.length;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Daily activity" });
  for (let i = 0; i <= ticks; i++) {
    const y = m.t + ih - (ih * i) / ticks;
    root.append(svg("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, class: i ? "grid" : "base" }));
    const t = svg("text", { x: m.l - 6, y: y + 4, "text-anchor": "end" }); t.textContent = (tick * i).toLocaleString(); root.append(t);
  }
  const box = h("div", { class: "chart" });
  const tip = h("div", { class: "tip", hidden: true });
  const labelEvery = Math.ceil(daily.length / Math.max(3, Math.floor(iw / 70)));
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
    if (i % labelEvery === 0) {
      const t = svg("text", { x: x + w / 2, y: H - 6, "text-anchor": "middle" }); t.textContent = shortDate(d.day + "T12:00:00"); root.append(t);
    }
    const hit = svg("rect", { x: m.l + i * bw, y: m.t, width: bw, height: ih, class: "hit" });
    hit.addEventListener("mousemove", (ev) => {
      tip.replaceChildren(h("b", {}, shortDate(d.day + "T12:00:00")), ...series.map(([f, label], si) => h("div", {}, h("span", { class: "legend" }, h("i", { style: `background:var(--s${si + 1})` })), `${label}: ${fmt(d[f] || 0, "int")}`)), h("div", { class: "muted" }, `Total: ${fmt(totals[i], "int")}`));
      tip.hidden = false;
      const rect = box.getBoundingClientRect();
      const left = ev.clientX - rect.left + 12;
      tip.style.left = `${Math.max(0, Math.min(left, rect.width - tip.offsetWidth - 4))}px`;
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
  const partner = currentPartner();
  const emps = empsOf(partner);
  if (!emps.length) return [pageHead({ title: `${partnerName(partner)} overview` }), h("div", { class: "state" }, h("h2", {}, "No scorecards yet"), h("p", { class: "muted" }, `No ${partnerName(partner)} (${partner}) AI employees have been scored yet. They appear here after the next refresh.`))];
  const kpis = emps.flatMap((e) => (e.kpis ?? []).map((k) => ({ ...k, emp: e })));
  const scored = kpis.filter((k) => k.status === "Met" || k.status === "Missed");
  const met = scored.filter((k) => k.status === "Met").length;
  const count = (s) => emps.filter((e) => e.status === s).length;
  const groups = [...new Set(emps.map((e) => e.group))];
  const q = ui.q.trim().toLowerCase();
  const rows = emps.filter((e) => (ui.status === "all" || e.status === ui.status) && (ui.group === "all" || e.group === ui.group)
    && (!q || `${e.name} ${e.role} ${e.group}`.toLowerCase().includes(q)));
  const head = (e) => e.kpis?.find((k) => k.metric === e.headline) ?? e.kpis?.[0];
  const worst = (e) => (e.kpis ?? []).filter((k) => k.status === "Missed").sort((a, b) => gapOf(b) - gapOf(a))[0];
  const setStatus = (s) => () => { ui.status = ui.status === s ? "all" : s; render(); };

  return [
    pageHead({
      title: `${partnerName(partner)} overview`,
      sub: `${partnerName(partner)} (${partner}) AI employees, scored against their own rubrics over the last ${DATA.windowDays} days.`,
      meta: `Data as of ${longTime(DATA.generatedAt)} · refreshes itself every hour`,
      actions: [btn("Export CSV", "download", exportOverview), btn("Copy link", "link", copyLink, { hideLabel: true }), btn("Print", "print", () => print(), { hideLabel: true })],
    }),
    h("section", { class: "tiles four" },
      tile("Employees scored", emps.length, `${count("On track")} on track`, { onclick: setStatus("all"), active: ui.status === "all" }),
      tile("Targets met", `${met} of ${scored.length}`, scored.length ? `${((met / scored.length) * 100).toFixed(0)}% of all KPI targets` : "", { meter: scored.length ? met / scored.length : 0 }),
      tile("Needs attention", count("Needs attention"), "Missing at least one target", { tone: "warn", onclick: setStatus("Needs attention"), active: ui.status === "Needs attention" }),
      tile("Stalled or idle", count("Stalled or idle"), "No work in the last 7 days", { tone: "bad", onclick: setStatus("Stalled or idle"), active: ui.status === "Stalled or idle" })),
    h("section", { class: "panel" },
      h("div", { class: "panel-h" },
        h("div", {}, h("h2", {}, "Employees"), h("p", { class: "muted small" }, "Select an employee for the full scorecard.")),
        h("div", { class: "controls" },
          h("label", { class: "search" }, icon("search"),
            h("input", { type: "search", placeholder: "Search", value: ui.q, "aria-label": "Search employees", id: "q",
              oninput: (ev) => { ui.q = ev.target.value; render(); requestAnimationFrame(() => { const i = document.getElementById("q"); i?.focus(); i?.setSelectionRange(ui.q.length, ui.q.length); }); } })),
          h("label", {}, h("span", { class: "sr" }, "Status"), select([["all", "All statuses"], "On track", "Needs attention", "Stalled or idle"], ui.status, (v) => { ui.status = v; render(); })),
          h("label", {}, h("span", { class: "sr" }, "Stage"), select([["all", "All stages"], ...groups], ui.group, (v) => { ui.group = v; render(); })),
          h("span", { class: "count" }, `${rows.length} of ${emps.length}`))),
      rows.length ? h("div", { class: "table-wrap" }, h("table", { class: "emps" },
        h("thead", {}, h("tr", {}, h("th", {}, "Employee"), h("th", {}, "Status"), h("th", {}, "Headline KPI"), h("th", {}, "Targets met"), h("th", {}, "Biggest gap"), h("th", { class: "num" }, "Volume"), h("th", { class: "num" }, "Last work"))),
        h("tbody", {}, rows.map((e) => {
          const k = head(e), miss = worst(e);
          const gap = miss ? `${miss.label}: ${fmt(miss.value, miss.fmt)}, target ${target(miss)}` : null;
          return h("tr", { class: "click", onclick: (ev) => { if (!ev.target.closest("a")) location.hash = `#/e/${e.key}`; } },
            h("td", { class: "c-name" }, h("a", { href: `#/e/${e.key}` }, e.name), h("div", { class: "muted small" }, `${e.role} · ${e.group}`),
              e.stale ? h("div", { class: "small err-ink" }, "Refresh failed, showing last data") : null),
            h("td", { class: "c-status" }, pill(e.status)),
            h("td", { class: "c-head" }, k ? [h("div", { class: "kv" }, h("b", {}, fmt(k.value, k.fmt)), h("span", {}, k.label)), h("div", { class: "muted small" }, `Target ${target(k)} `, targetNote(k))] : "–"),
            h("td", { class: "c-met" }, h("div", { class: "metrow" }, h("div", { class: "meter" }, h("span", { style: `width:${e.targets ? (e.met / e.targets) * 100 : 0}%` })), h("span", { class: "small" }, `${e.met}/${e.targets}`))),
            h("td", { class: "c-gap small" }, gap ? h("div", { class: "clamp", title: e.issue ? `${gap}. ${e.issue}` : gap }, gap) : h("span", { class: "muted" }, "No missed targets")),
            h("td", { class: "num c-vol" }, fmt(e.volume, "int"), h("div", { class: "muted small" }, e.unit)),
            h("td", { class: "num c-last small" }, ago(e.lastActivity), h("div", { class: "muted" }, shortDate(e.lastActivity))));
        })))) : h("p", { class: "empty" }, "No employees match these filters. ", h("button", { class: "linkish", onclick: () => { ui.status = "all"; ui.group = "all"; ui.q = ""; render(); } }, "Clear filters"))),
    kpiPanel(scored),
  ];
}

function kpiPanel(scored) {
  const shown = scored.filter((k) => !ui.missedOnly || k.status === "Missed");
  const byEmp = empsOf(currentPartner()).map((e) => ({ e, ks: shown.filter((k) => k.emp.key === e.key).sort((a, b) => gapOf(b) - gapOf(a)) }))
    .filter((g) => g.ks.length)
    .sort((a, b) => b.ks.filter((k) => k.status === "Missed").length - a.ks.filter((k) => k.status === "Missed").length);
  const missed = scored.filter((k) => k.status === "Missed").length;
  const showTrend = hasTrend();
  return h("section", { class: "panel" },
    h("div", { class: "panel-h" },
      h("div", {}, h("h2", {}, "KPIs against target"),
        h("p", { class: "muted small" }, `${missed} of ${scored.length} targets missed. Grouped by employee, biggest gap first.${showTrend ? " Trend covers the last 48 hourly refreshes." : ""}`)),
      h("div", { class: "seg", role: "group", "aria-label": "Which KPIs" },
        h("button", { class: ui.missedOnly ? "on" : "", "aria-pressed": String(ui.missedOnly), onclick: () => { ui.missedOnly = true; render(); } }, `Missed (${missed})`),
        h("button", { class: ui.missedOnly ? "" : "on", "aria-pressed": String(!ui.missedOnly), onclick: () => { ui.missedOnly = false; render(); } }, `All (${scored.length})`))),
    byEmp.length ? h("div", { class: "kpi-groups" }, byEmp.map(({ e, ks }) =>
      h("details", { class: "kgroup", open: true },
        h("summary", {}, h("span", { class: `dot ${tone(e.status)}`, "aria-hidden": "true" }), h("b", {}, e.name), h("span", { class: "muted small" }, `${ks.length} KPI${ks.length > 1 ? "s" : ""}`),
          h("a", { class: "small open", href: `#/e/${e.key}` }, "Open scorecard")),
        h("div", { class: "table-wrap" }, h("table", { class: "kpis" },
          h("thead", {}, h("tr", {}, h("th", {}, "KPI"), h("th", { class: "num" }, "Now"), h("th", { class: "num" }, "Target"), h("th", {}, "Status"), showTrend ? h("th", {}, "Trend") : null)),
          h("tbody", {}, ks.map((k) => h("tr", {},
            h("td", {}, k.label),
            h("td", { class: "num" }, h("b", {}, fmt(k.value, k.fmt))),
            h("td", { class: "num muted" }, target(k), targetNote(k) ? [" ", targetNote(k)] : null),
            h("td", {}, pill(k.status)),
            showTrend ? h("td", {}, spark(trend(`${k.emp.key}.${k.metric}`)) ?? h("span", { class: "muted small" }, "–")) : null)))))))) :
      h("p", { class: "empty" }, "Every target is met."));
}

function tile(label, value, foot, { tone: t, onclick, active, meter } = {}) {
  const tag = onclick ? "button" : "div";
  return h(tag, { class: `tile${t ? ` t-${t}` : ""}${onclick ? " clickable" : ""}${active ? " active" : ""}`, onclick, "aria-pressed": onclick ? String(!!active) : null },
    h("div", { class: "label" }, label), h("div", { class: "value" }, value),
    meter != null ? h("div", { class: "meter" }, h("span", { style: `width:${meter * 100}%` })) : null,
    foot ? h("div", { class: "foot" }, foot) : null);
}
function select(options, value, on) {
  return h("select", { onchange: (ev) => on(ev.target.value) }, options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return h("option", { value: v, selected: v === value }, l);
  }));
}

// ---------- employee page ----------
function employee(key) {
  const emps = empsOf(partnerOfEmp(DATA.employees.find((x) => x.key === key)));
  const i = emps.findIndex((x) => x.key === key);
  const e = emps[i];
  if (!e) return [pageHead({ crumbs: [{ label: "Overview", href: "#/" }], title: "Not found" }), h("p", { class: "empty" }, "No scorecard for this employee. ", h("a", { href: "#/" }, "Back to the overview"))];
  const a = e.about ?? {};
  const prev = emps[(i - 1 + emps.length) % emps.length], next = emps[(i + 1) % emps.length];
  const kpis = e.kpis ?? [];
  const missed = kpis.filter((k) => k.status === "Missed").length, scored = kpis.filter((k) => k.status === "Met" || k.status === "Missed").length;
  const sections = [
    ["kpis", "KPIs"], e.daily?.length ? ["activity", "Activity"] : null, e.automations?.length ? ["automations", "Automations"] : null,
    (e.breakdowns ?? []).some((b) => b.rows?.length) ? ["details", "Breakdowns"] : null, ["about", "About & fixes"],
  ].filter(Boolean);
  const jump = (id) => () => document.getElementById(`s-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return [
    pageHead({
      crumbs: [{ label: `${partnerName(partnerOfEmp(e))} overview`, href: partnerHref(partnerOfEmp(e)) }, { label: e.group }, { label: e.name }],
      title: [e.name, " ", pill(e.status)],
      sub: `${e.role} · ${e.source}`,
      meta: `${fmt(e.volume, "int")} ${e.unit} · ${shortDate(e.window?.from)} – ${shortDate(e.window?.to)} · last work ${ago(e.lastActivity)}`,
      actions: [
        h("a", { class: "btn icon-only", href: `#/e/${prev.key}`, title: `Previous: ${prev.name}`, "aria-label": `Previous: ${prev.name}` }, icon("prev")),
        h("a", { class: "btn icon-only", href: `#/e/${next.key}`, title: `Next: ${next.name}`, "aria-label": `Next: ${next.name}` }, icon("next")),
        btn("Export CSV", "download", () => exportEmployee(e)),
        btn("Copy link", "link", copyLink, { hideLabel: true }),
        btn("Print", "print", () => print(), { hideLabel: true }),
      ],
    }),
    e.error ? h("div", { class: "banner" }, `The last refresh failed for ${e.name}, so this shows the previous data. Error: ${e.error}`) : null,
    h("div", { class: "summary" },
      h("div", { class: "summary-score" }, h("b", {}, `${e.met} of ${e.targets}`), h("span", { class: "muted small" }, "targets met"),
        h("div", { class: "meter" }, h("span", { style: `width:${e.targets ? (e.met / e.targets) * 100 : 0}%` }))),
      e.issue ? h("p", { class: "summary-text" }, e.issue) : null),
    h("nav", { class: "subnav", "aria-label": "Sections" }, sections.map(([id, label]) => h("button", { onclick: jump(id) }, label))),
    h("section", { id: "s-kpis", class: "anchor" },
      h("div", { class: "section-h" }, h("h2", {}, "KPIs"), h("span", { class: "muted small" }, scored ? `${missed} missed, ${scored - missed} met${kpis.length > scored ? `, ${kpis.length - scored} not judged (no target, too few cases or historical)` : ""}` : "")),
      h("div", { class: "tiles kpi-tiles" }, kpis.map((k) => h("div", { class: `tile kpi t-${tone(k.status)}` },
        h("div", { class: "label" }, k.label),
        h("div", { class: "value" }, fmt(k.value, k.fmt)),
        h("div", { class: "kpi-status" }, pill(k.status), h("span", { class: "muted small" }, `Target ${target(k)}`), targetNote(k)),
        k.numerator != null && k.denominator != null ? h("div", { class: "foot" }, `${fmt(k.numerator, "int")} of ${fmt(k.denominator, "int")}`) : null,
        spark(trend(`${e.key}.${k.metric}`)),
        k.how ? h("div", { class: "how" }, k.how) : null)))),
    e.daily?.length ? h("section", { id: "s-activity", class: "panel anchor" }, h("h2", {}, "Daily activity"), dailyChart(e.daily, e.dailySeries)) : null,
    e.automations?.length ? h("section", { id: "s-automations", class: "panel anchor" }, h("h2", {}, `Automations using ${e.name}`),
      dataTable(e.automationCols ?? [["automation", "Automation", "raw"], ["calls", "Calls", "int"]], e.automations)) : null,
    (e.breakdowns ?? []).filter((b) => b.rows?.length).map((b, bi) => h("section", { id: bi === 0 ? "s-details" : null, class: "panel anchor" }, h("h2", {}, b.title), b.note ? h("p", { class: "muted small" }, b.note) : null, dataTable(b.cols, b.rows))),
    h("section", { id: "s-about", class: "cols anchor" },
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
  const m = location.hash.match(/^#\/e\/([\w-]+)/);
  const key = m?.[1] ?? null;
  document.body.classList.toggle("nav-open", ui.nav);
  if (!DATA) {
    app.replaceChildren(topbar(), h("div", { class: "layout" }, h("main", { class: "content" },
      loadError ? h("div", { class: "state" }, h("h2", {}, "Couldn't load the scorecards"), h("p", { class: "muted" }, loadError), btn("Try again", "refresh", () => load(), { primary: true }))
        : h("div", { class: "skeleton" }, h("div", { class: "sk sk-title" }), h("div", { class: "tiles four" }, [1, 2, 3, 4].map(() => h("div", { class: "sk sk-tile" }))), h("div", { class: "sk sk-panel" })))));
    return;
  }
  const content = !DATA.employees?.length
    ? [h("div", { class: "state" }, h("h2", {}, "No data yet"), h("p", { class: "muted" }, HOSTED ? "The first hourly refresh hasn't run." : "The first refresh runs on startup and takes a few minutes."))]
    : (key ? employee(key) : overview()).flat().filter(Boolean);
  const main = h("main", { class: "content", id: "main" }, loadError ? h("div", { class: "banner" }, `Couldn't reload: ${loadError}. Showing the last data.`) : null, content);
  app.replaceChildren(h("a", { class: "skip", href: "#main", onclick: (ev) => { ev.preventDefault(); document.getElementById("main")?.focus(); } }, "Skip to content"),
    topbar(), h("div", { class: "layout" }, DATA.employees?.length ? sidebar(key) : null, main));
  main.setAttribute("tabindex", "-1");
  const name = key && DATA.employees.find((e) => e.key === key)?.name;
  document.title = name ? `${name} · AI Workforce Scorecards` : "AI Workforce Scorecards";
  renderStatus();
}
addEventListener("hashchange", () => { ui.nav = false; render(); scrollTo(0, 0); });
addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && ui.nav) { ui.nav = false; render(); }
  if (ev.key === "/" && !/input|select|textarea/i.test(document.activeElement?.tagName ?? "") && !location.hash.startsWith("#/e/")) {
    ev.preventDefault(); document.getElementById("q")?.focus();
  }
});
// Redraw charts at the new width after a resize settles.
let resizeT; addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (location.hash.startsWith("#/e/")) render(); }, 200); });
render();
load();
// Hosted data changes once an hour, so check every 5 minutes; locally poll the refresh status.
setInterval(pollStatus, HOSTED ? 300000 : 15000);
