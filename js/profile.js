// ============================================================
// PICKTAPE — Community & Profile Page
// ============================================================

import { db } from "./firebase-config.js";
import {
  collection, getDocs, query, where, orderBy, limit, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── SECURITY UTILITIES ────────────────────────────────────────
function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function sanitizeUsername(raw) {
  return String(raw || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
}

// ── SERIES CONFIG ─────────────────────────────────────────────
const SERIES_CONFIG = {
  "ML Picks":          { cls: "ml",   label: "ML Picks" },
  "Practical Parlay":  { cls: "pp",   label: "Practical Parlay" },
  "Long Shot Parlay":  { cls: "sp",   label: "Long Shot Parlay" },
  "Method of Victory": { cls: "mov",  label: "Method of Victory" },
  "Prop Picks":        { cls: "prop", label: "Prop Picks" },
};

// ── DOM ───────────────────────────────────────────────────────
const searchInput    = document.getElementById("search-input");
const searchBtn      = document.getElementById("search-btn");
const directoryView  = document.getElementById("directory-view");
const profileView    = document.getElementById("profile-view");
const backBtn        = document.getElementById("back-to-directory");
const dirGrid        = document.getElementById("directory-grid");
const dirLoading     = document.getElementById("directory-loading");
const dirEmpty       = document.getElementById("directory-empty");

// ── STATE ─────────────────────────────────────────────────────
let allPicks = []; // picks for currently viewed profile

// ── INIT ──────────────────────────────────────────────────────
searchBtn.addEventListener("click", doSearch);
searchInput.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
backBtn.addEventListener("click", showDirectory);

// Check URL param on load
const urlParams = new URLSearchParams(window.location.search);
const urlUser   = sanitizeUsername(urlParams.get("user") || "");

if (urlUser) {
  searchInput.value = urlUser;
  doSearch();
} else {
  loadDirectory();
}

// ── DIRECTORY ─────────────────────────────────────────────────
async function loadDirectory() {
  showDirectoryState("loading");
  try {
    const snap    = await getDocs(collection(db, "public_profiles"));
    const users   = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
                            .filter(u => u.username);

    if (users.length === 0) { showDirectoryState("empty"); return; }

    // Load pick stats for each user concurrently
    const usersWithStats = await Promise.all(users.map(async user => {
      try {
        const picksSnap = await getDocs(
          query(collection(db, "users", user.uid, "picks"), limit(200))
        );
        const picks = picksSnap.docs.map(d => d.data());
        return { ...user, picks };
      } catch {
        return { ...user, picks: [] };
      }
    }));

    // Sort by hit rate descending
    usersWithStats.sort((a, b) => {
      const hrA = calcHitRate(a.picks);
      const hrB = calcHitRate(b.picks);
      return (hrB ?? -1) - (hrA ?? -1);
    });

    renderDirectory(usersWithStats);
    showDirectoryState("grid");
  } catch (err) {
    console.error("Directory load error:", err);
    showDirectoryState("empty");
  }
}

function calcHitRate(picks) {
  const settled = picks.filter(p => p.result !== "pending");
  if (!settled.length) return null;
  const won = picks.filter(p => p.result === "won").length;
  return Math.round((won / settled.length) * 100);
}

function calcROI(picks) {
  const settled = picks.filter(p => p.result !== "pending");
  if (!settled.length) return null;
  let profit = 0;
  settled.forEach(p => {
    const n = parseInt(p.odds);
    const dec = n > 0 ? (n / 100) + 1 : (100 / Math.abs(n)) + 1;
    profit += p.result === "won" ? (dec - 1) : -1;
  });
  return parseFloat(((profit / settled.length) * 100).toFixed(1));
}

function renderDirectory(users) {
  dirGrid.innerHTML = "";
  users.forEach(user => {
    const picks   = user.picks || [];
    const settled = picks.filter(p => p.result !== "pending");
    const won     = picks.filter(p => p.result === "won").length;
    const lost    = picks.filter(p => p.result === "lost").length;
    const hr      = calcHitRate(picks);
    const roi     = calcROI(picks);

    const card = document.createElement("div");
    card.className = "dir-card";
    card.innerHTML = `
      <div class="dir-card-top">
        <img class="dir-avatar" src="${esc(user.photoURL || "")}" alt=""
             onerror="this.style.display='none'" />
        <div class="dir-identity">
          <div class="dir-username">@${esc(user.username)}</div>
          ${user.displayName && user.displayName !== user.username
            ? `<div class="dir-displayname">${esc(user.displayName)}</div>` : ""}
        </div>
      </div>
      <div class="dir-stats">
        <div class="dir-stat">
          <div class="dir-stat-val ${hr !== null ? (hr >= 55 ? "green" : hr >= 45 ? "amber" : "red") : ""}">
            ${hr !== null ? hr + "%" : "—"}
          </div>
          <div class="dir-stat-label">Hit Rate</div>
        </div>
        <div class="dir-stat">
          <div class="dir-stat-val">${won}–${lost}</div>
          <div class="dir-stat-label">Record</div>
        </div>
        <div class="dir-stat">
          <div class="dir-stat-val ${roi !== null ? (roi >= 0 ? "green" : "red") : ""}">
            ${roi !== null ? (roi >= 0 ? "+" : "") + roi + "%" : "—"}
          </div>
          <div class="dir-stat-label">ROI</div>
        </div>
        <div class="dir-stat">
          <div class="dir-stat-val">${picks.length}</div>
          <div class="dir-stat-label">Picks</div>
        </div>
      </div>
      <button class="dir-view-btn" data-username="${esc(user.username)}">View Profile →</button>
    `;

    card.querySelector(".dir-view-btn").addEventListener("click", () => {
      searchInput.value = user.username;
      loadProfile(user, user.picks);
    });

    dirGrid.appendChild(card);
  });
}

function showDirectoryState(state) {
  dirLoading.classList.toggle("hidden", state !== "loading");
  dirGrid.classList.toggle("hidden",    state !== "grid");
  dirEmpty.classList.toggle("hidden",   state !== "empty");
}

function showDirectory() {
  profileView.classList.add("hidden");
  directoryView.classList.remove("hidden");
  window.history.replaceState({}, "", window.location.pathname);
  searchInput.value = "";
}

// ── SEARCH ────────────────────────────────────────────────────
async function doSearch() {
  const handle = sanitizeUsername(searchInput.value);
  if (handle.length < 3) return;

  dirLoading.classList.remove("hidden");
  dirGrid.classList.add("hidden");
  dirEmpty.classList.add("hidden");

  try {
    const q    = query(collection(db, "public_profiles"), where("username", "==", handle));
    const snap = await getDocs(q);

    if (snap.empty) {
      dirLoading.classList.add("hidden");
      dirEmpty.classList.remove("hidden");
      document.getElementById("directory-empty").querySelector("div:last-child").textContent =
        `No user found with username "${handle}".`;
      return;
    }

    const profileDoc  = snap.docs[0];
    const profileData = { uid: profileDoc.id, ...profileDoc.data() };

    const picksSnap = await getDocs(
      query(collection(db, "users", profileDoc.id, "picks"), orderBy("createdAt", "desc"), limit(200))
    );
    const picks = picksSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    dirLoading.classList.add("hidden");
    loadProfile(profileData, picks);
  } catch (err) {
    console.error("Search error:", err);
    dirLoading.classList.add("hidden");
    dirEmpty.classList.remove("hidden");
  }
}

// ── PROFILE VIEW ──────────────────────────────────────────────
let pChartDonut = null, pChartLine = null, pChartSeries = null, pChartEvents = null;

function loadProfile(profile, picks) {
  allPicks = picks;
  directoryView.classList.add("hidden");
  profileView.classList.remove("hidden");
  window.history.replaceState({}, "", `?user=${profile.username}`);

  // Header
  const avatarEl = document.getElementById("profile-avatar");
  avatarEl.src   = profile.photoURL || "";
  avatarEl.onerror = () => { avatarEl.style.display = "none"; };
  document.getElementById("profile-name").textContent   = profile.displayName || profile.username;
  document.getElementById("profile-handle").textContent = "@" + profile.username;
  document.getElementById("profile-joined").textContent = profile.joinedAt
    ? "Member since " + new Date(profile.joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "";

  // Headline stats
  const settled = picks.filter(p => p.result !== "pending");
  const won     = picks.filter(p => p.result === "won").length;
  const lost    = picks.filter(p => p.result === "lost").length;
  const hr      = calcHitRate(picks);
  const roi     = calcROI(picks);

  document.getElementById("ph-total").textContent  = picks.length;
  document.getElementById("ph-record").textContent = `${won}–${lost}`;

  const hrEl = document.getElementById("ph-hitrate");
  hrEl.textContent = hr !== null ? hr + "%" : "—";
  hrEl.className   = "phs-val " + (hr >= 55 ? "green" : hr !== null ? "red" : "green");

  const roiEl = document.getElementById("ph-roi");
  if (roi !== null) {
    roiEl.textContent = (roi >= 0 ? "+" : "") + roi + "%";
    roiEl.className   = "phs-val " + (roi >= 0 ? "green" : "red");
  } else {
    roiEl.textContent = "—";
    roiEl.className   = "phs-val amber";
  }

  renderSeriesBreakdown(picks);
  populateEventFilter(picks);
  renderPicksList();
  renderProfileCharts(picks);

  // Reset to history tab
  document.querySelectorAll(".profile-tab").forEach(t => t.classList.remove("active"));
  document.querySelector("[data-ptab='history']").classList.add("active");
  document.getElementById("ptab-history").classList.remove("hidden");
  document.getElementById("ptab-stats").classList.add("hidden");
}

// ── SERIES BREAKDOWN ──────────────────────────────────────────
function renderSeriesBreakdown(picks) {
  const container = document.getElementById("series-breakdown");
  container.innerHTML = "";
  Object.entries(SERIES_CONFIG).forEach(([series, config]) => {
    const sp      = picks.filter(p => (p.series || "ML Picks") === series);
    if (!sp.length) return;
    const settled = sp.filter(p => p.result !== "pending");
    const won     = sp.filter(p => p.result === "won").length;
    const hr      = settled.length ? Math.round((won / settled.length) * 100) : null;
    const card    = document.createElement("div");
    card.className = `sb-card ${config.cls}`;
    card.innerHTML = `
      <div class="sb-series">${config.label}</div>
      <div class="sb-stats">
        <div>
          <div class="sb-stat-val ${hr !== null ? (hr >= 50 ? "green" : "red") : ""}">
            ${hr !== null ? hr + "%" : "—"}
          </div>
          <div class="sb-stat-label">Hit Rate</div>
        </div>
        <div>
          <div class="sb-stat-val">${won}–${settled.length - won}</div>
          <div class="sb-stat-label">Record</div>
        </div>
        <div>
          <div class="sb-stat-val">${sp.length}</div>
          <div class="sb-stat-label">Total</div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// ── PICK HISTORY ──────────────────────────────────────────────
function renderPicksList() {
  const rf   = document.getElementById("pf-result").value;
  const sf   = document.getElementById("pf-series").value;
  const ef   = document.getElementById("pf-event").value;
  const list  = document.getElementById("profile-picks-list");
  const empty = document.getElementById("profile-picks-empty");
  list.innerHTML = "";

  const filtered = allPicks.filter(p =>
    (rf === "all" || p.result === rf) &&
    (sf === "all" || (p.series || "ML Picks") === sf) &&
    (ef === "all" || p.event === ef)
  );

  if (!filtered.length) { empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  // Group by event
  const groups = {};
  filtered.forEach(p => {
    const key = p.event || "No Event";
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });

  Object.entries(groups).forEach(([eventName, eventPicks]) => {
    const won     = eventPicks.filter(p => p.result === "won").length;
    const lost    = eventPicks.filter(p => p.result === "lost").length;
    const pending = eventPicks.filter(p => p.result === "pending").length;

    const header = document.createElement("div");
    header.className = "event-group-header";
    header.innerHTML = `
      <span class="event-group-name">${esc(eventName)}</span>
      <span class="event-group-record">
        ${won     > 0 ? `<span class="rec-w">${won}W</span>`          : ""}
        ${lost    > 0 ? `<span class="rec-l">${lost}L</span>`         : ""}
        ${pending > 0 ? `<span class="rec-p">${pending} pending</span>` : ""}
      </span>
    `;
    list.appendChild(header);

    const group = document.createElement("div");
    group.className = "event-group-picks";
    eventPicks.forEach(pick => {
      const n    = parseInt(pick.odds);
      const odds = { text: (n > 0 ? "+" : "") + n, positive: n > 0 };
      const series  = pick.series || "ML Picks";
      const cfg     = SERIES_CONFIG[series] || { cls: "ml" };
      const card    = document.createElement("div");
      card.className = `pick-card ${pick.result}`;
      const propHTML = pick.propLabel ? `<div class="pick-notes prop-label">📌 ${esc(pick.propLabel)}</div>` : "";
      const legCount = pick.legs?.length > 1 ? `<span class="pick-type-badge">${parseInt(pick.legs.length)}-leg</span>` : "";
      card.innerHTML = `
        <div class="pick-info">
          <div class="pick-fighter">${esc(pick.fighter)}</div>
          <div class="pick-meta">
            <span>${esc(new Date(pick.date).toLocaleDateString("en-US", {month:"short",day:"numeric",year:"numeric"}))}</span>
            <span class="series-badge series-${esc(cfg.cls)}">${esc(series)}</span>
            ${legCount}
          </div>
          ${propHTML}
        </div>
        <div class="odds-badge ${odds.positive ? "positive" : ""}">${esc(odds.text)}</div>
        <div class="status-badge ${pick.result}">
          ${pick.result === "won" ? "WIN" : pick.result === "lost" ? "LOSS" : "PENDING"}
        </div>
      `;
      group.appendChild(card);
    });
    list.appendChild(group);
  });
}

function populateEventFilter(picks) {
  const events = [...new Set(picks.map(p => p.event).filter(Boolean))];
  const ef = document.getElementById("pf-event");
  ef.innerHTML = '<option value="all">All Events</option>';
  events.forEach(e => {
    const opt = document.createElement("option");
    opt.value = e; opt.textContent = e;
    ef.appendChild(opt);
  });
}

// Filters
["pf-result","pf-series","pf-event"].forEach(id => {
  document.getElementById(id).addEventListener("change", renderPicksList);
});

// Profile tabs
document.querySelectorAll(".profile-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".profile-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.ptab;
    document.getElementById("ptab-history").classList.toggle("hidden", target !== "history");
    document.getElementById("ptab-stats").classList.toggle("hidden",   target !== "stats");
  });
});

// ── PROFILE CHARTS ────────────────────────────────────────────
Chart.defaults.color      = "#888890";
Chart.defaults.font.family = "'Barlow', sans-serif";

function renderProfileCharts(picks) {
  renderPDonut(picks);
  renderPLine(picks);
  renderPSeriesROI(picks);
  renderPEventRecord(picks);
}

function renderPDonut(picks) {
  const won     = picks.filter(p => p.result === "won").length;
  const lost    = picks.filter(p => p.result === "lost").length;
  const pending = picks.filter(p => p.result === "pending").length;
  const settled = won + lost;
  const hr      = settled ? Math.round((won / settled) * 100) : 0;

  document.getElementById("p-donut-center").innerHTML = `
    <div class="donut-center-pct">${settled ? hr + "%" : "—"}</div>
    <div class="donut-center-label">Hit Rate</div>
  `;
  if (pChartDonut) pChartDonut.destroy();
  pChartDonut = new Chart(document.getElementById("p-chart-donut"), {
    type: "doughnut",
    data: {
      labels: ["Wins","Losses","Pending"],
      datasets: [{ data: [won, lost, pending],
        backgroundColor: ["rgba(78,203,113,0.85)","rgba(232,64,64,0.85)","rgba(42,42,52,0.9)"],
        borderColor: ["#4ecb71","#e84040","#2a2a34"], borderWidth: 1, hoverOffset: 6 }]
    },
    options: { cutout:"68%", responsive:true, maintainAspectRatio:false,
      plugins: { legend: { position:"bottom", labels:{padding:16,boxWidth:12} } } }
  });
}

function renderPLine(picks) {
  const settled = picks.filter(p => p.result !== "pending")
    .sort((a,b) => new Date(a.date) - new Date(b.date));
  if (settled.length < 2) return;
  const labels = [], rates = [];
  settled.forEach((p,i) => {
    const slice = settled.slice(0, i+1);
    rates.push(Math.round((slice.filter(s=>s.result==="won").length / slice.length)*100));
    labels.push(`#${i+1}`);
  });
  if (pChartLine) pChartLine.destroy();
  pChartLine = new Chart(document.getElementById("p-chart-line"), {
    type:"line",
    data:{ labels, datasets:[{ label:"Hit Rate %", data:rates,
      borderColor:"#e84040", backgroundColor:"rgba(232,64,64,0.08)",
      borderWidth:2, pointRadius:3, fill:true, tension:0.3 }] },
    options:{ responsive:true, maintainAspectRatio:false,
      scales:{ y:{min:0,max:100,ticks:{callback:v=>v+"%"},grid:{color:"#1e1e24"}},
               x:{grid:{color:"#1e1e24"}} },
      plugins:{ legend:{display:false} } }
  });
}

function renderPSeriesROI(picks) {
  const series  = Object.keys(SERIES_CONFIG);
  const roiVals = series.map(s => {
    const sp = picks.filter(p => (p.series||"ML Picks") === s && p.result !== "pending");
    if (!sp.length) return 0;
    let profit = 0;
    sp.forEach(p => { const n=parseInt(p.odds); const dec=n>0?(n/100)+1:(100/Math.abs(n))+1; profit += p.result==="won"?(dec-1):-1; });
    return parseFloat(((profit/sp.length)*100).toFixed(1));
  });
  const colors  = roiVals.map(v => v >= 0 ? "rgba(78,203,113,0.8)" : "rgba(232,64,64,0.8)");
  const borders = roiVals.map(v => v >= 0 ? "#4ecb71" : "#e84040");
  if (pChartSeries) pChartSeries.destroy();
  pChartSeries = new Chart(document.getElementById("p-chart-series"), {
    type:"bar",
    data:{ labels: series.map(s => s.replace(" Parlay","").replace(" of Victory","")),
      datasets:[{ label:"ROI %", data:roiVals,
        backgroundColor:colors, borderColor:borders, borderWidth:1, borderRadius:4 }] },
    options:{ responsive:true, maintainAspectRatio:false,
      scales:{ y:{ticks:{callback:v=>v+"%"},grid:{color:"#1e1e24"}}, x:{grid:{display:false}} },
      plugins:{ legend:{display:false} } }
  });
}

function renderPEventRecord(picks) {
  const byEvent = {};
  picks.filter(p => p.event && p.result !== "pending").forEach(p => {
    if (!byEvent[p.event]) byEvent[p.event] = {won:0,lost:0};
    byEvent[p.event][p.result]++;
  });
  const events  = Object.keys(byEvent).slice(-8);
  const short   = events.map(e => e.replace("UFC Fight Night: ","FN: ").replace("Ultimate Fighting Championship ","UFC "));
  if (pChartEvents) pChartEvents.destroy();
  pChartEvents = new Chart(document.getElementById("p-chart-events"), {
    type:"bar",
    data:{ labels:short, datasets:[
      { label:"Wins",   data:events.map(e=>byEvent[e].won),  backgroundColor:"rgba(78,203,113,0.8)", borderColor:"#4ecb71", borderWidth:1, borderRadius:4 },
      { label:"Losses", data:events.map(e=>byEvent[e].lost), backgroundColor:"rgba(232,64,64,0.8)",  borderColor:"#e84040", borderWidth:1, borderRadius:4 }
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      scales:{ y:{ticks:{stepSize:1},grid:{color:"#1e1e24"}}, x:{grid:{display:false},ticks:{maxRotation:30}} },
      plugins:{ legend:{position:"bottom",labels:{padding:14,boxWidth:12}} } }
  });
}