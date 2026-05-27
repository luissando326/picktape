// ============================================================
// PICKTAPE — Public Profile Page (Security Hardened)
// ============================================================

import { db } from "./firebase-config.js";
import {
  collection, getDocs, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── SECURITY: XSS escape utility ─────────────────────────────
// FIX #1: All Firestore data escaped before innerHTML insertion
function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// FIX #7: Sanitize URL parameters — only allow valid username chars
function sanitizeUsername(raw) {
  return String(raw || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
}

// ── DOM ───────────────────────────────────────────────────────
const searchInput    = document.getElementById("search-input");
const searchBtn      = document.getElementById("search-btn");
const profileContent = document.getElementById("profile-content");
const profileDefault = document.getElementById("profile-default");
const profileLoading = document.getElementById("profile-loading");
const profileNotFound= document.getElementById("profile-not-found");

// ── SEARCH ────────────────────────────────────────────────────
searchBtn.addEventListener("click", doSearch);
searchInput.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });

// Check URL param on load — FIX #7: sanitize before use
const urlParams = new URLSearchParams(window.location.search);
const urlUser   = sanitizeUsername(urlParams.get("user") || "");
if (urlUser) {
  searchInput.value = urlUser;
  doSearch();
}

async function doSearch() {
  // FIX #7: Sanitize search input before querying Firestore
  const handle = sanitizeUsername(searchInput.value);
  if (handle.length < 3) return;

  showState("loading");

  try {
    // Look up user by handle in the public_profiles collection
    const profilesRef = collection(db, "public_profiles");
    const q           = query(profilesRef, where("username", "==", handle));
    const snap        = await getDocs(q);

    if (snap.empty) { showState("not-found"); return; }

    const profileDoc  = snap.docs[0];
    const profileData = profileDoc.data();
    const uid         = profileDoc.id;

    // Load their public picks
    const picksRef  = collection(db, "users", uid, "picks");
    const picksSnap = await getDocs(query(picksRef, orderBy("createdAt", "desc"), limit(50)));
    const picks     = picksSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderProfile(profileData, picks);
    showState("content");

    // Update URL for shareability
    window.history.replaceState({}, "", `?user=${handle}`);
  } catch (err) {
    console.error("Profile load error:", err);
    showState("not-found");
  }
}

function showState(state) {
  profileDefault.classList.add("hidden");
  profileLoading.classList.add("hidden");
  profileNotFound.classList.add("hidden");
  profileContent.classList.add("hidden");

  if (state === "loading")   profileLoading.classList.remove("hidden");
  if (state === "not-found") profileNotFound.classList.remove("hidden");
  if (state === "content")   profileContent.classList.remove("hidden");
  if (state === "default")   profileDefault.classList.remove("hidden");
}

// ── RENDER PROFILE ────────────────────────────────────────────
function renderProfile(profile, picks) {
  // FIX #1: Use textContent for user data — never innerHTML for untrusted strings
  document.getElementById("profile-avatar").src  = esc(profile.photoURL || "");
  document.getElementById("profile-name").textContent   = profile.displayName || profile.username;
  document.getElementById("profile-handle").textContent = "@" + profile.username;
  document.getElementById("profile-joined").textContent = profile.joinedAt
    ? "Member since " + new Date(profile.joinedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "";

  // Headline stats
  const settled = picks.filter(p => p.result !== "pending");
  const won     = picks.filter(p => p.result === "won").length;
  const lost    = picks.filter(p => p.result === "lost").length;
  const hitRate = settled.length ? Math.round((won / settled.length) * 100) : null;
  let roi = null;
  if (settled.length) {
    let profit = 0;
    settled.forEach(p => {
      const dec = oddsToDecimal(p.odds);
      profit += p.result === "won" ? (dec - 1) : -1;
    });
    roi = ((profit / settled.length) * 100).toFixed(1);
  }

  document.getElementById("ph-total").textContent  = picks.length;
  document.getElementById("ph-record").textContent = `${won}–${lost}`;

  const hrEl = document.getElementById("ph-hitrate");
  hrEl.textContent = hitRate !== null ? hitRate + "%" : "—";
  hrEl.className   = "phs-val " + (hitRate >= 55 ? "green" : hitRate !== null ? "red" : "green");

  const roiEl = document.getElementById("ph-roi");
  if (roi !== null) {
    roiEl.textContent = (parseFloat(roi) >= 0 ? "+" : "") + roi + "%";
    roiEl.className   = "phs-val " + (parseFloat(roi) >= 0 ? "green" : "red");
  } else {
    roiEl.textContent = "—";
    roiEl.className   = "phs-val amber";
  }

  // Series breakdown
  renderSeriesBreakdown(picks);

  // Recent picks
  renderPicksList(picks);
}

const SERIES_CONFIG = {
  "ML Picks":          { cls: "ml",   label: "ML Picks" },
  "Practical Parlay":  { cls: "pp",   label: "Practical Parlay" },
  "Long Shot Parlay":       { cls: "sp",   label: "Long Shot Parlay" },
  "Method of Victory": { cls: "mov",  label: "Method of Victory" },
  "Prop Picks":        { cls: "prop", label: "Prop Picks" },
};

function renderSeriesBreakdown(picks) {
  const container = document.getElementById("series-breakdown");
  container.innerHTML = "";

  Object.entries(SERIES_CONFIG).forEach(([series, config]) => {
    const sp      = picks.filter(p => (p.series || "ML Picks") === series);
    if (sp.length === 0) return;
    const settled = sp.filter(p => p.result !== "pending");
    const won     = sp.filter(p => p.result === "won").length;
    const hr      = settled.length ? Math.round((won / settled.length) * 100) : null;

    // FIX #1: config.label comes from local SERIES_CONFIG constant — safe
    // won/hr are computed numbers — safe. No user data in this card.
    const card = document.createElement("div");
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

function renderPicksList(picks) {
  const list  = document.getElementById("profile-picks-list");
  const empty = document.getElementById("profile-picks-empty");
  list.innerHTML = "";

  const recent = picks.slice(0, 20);
  if (recent.length === 0) { empty.classList.remove("hidden"); return; }
  empty.classList.add("hidden");

  recent.forEach(pick => {
    const odds    = formatOdds(pick.odds);
    const series  = pick.series || "ML Picks";
    const cfg     = SERIES_CONFIG[series] || { cls: "ml" };
    const card    = document.createElement("div");
    card.className = `pick-card ${pick.result}`;

    // FIX #1: All pick data escaped before innerHTML insertion
    const propHTML = pick.propLabel
      ? `<div class="pick-notes">"${esc(pick.propLabel)}"</div>` : "";
    const legCount = pick.legs?.length > 1
      ? `<span class="pick-type-badge">${parseInt(pick.legs.length)}-leg parlay</span>` : "";

    card.innerHTML = `
      <div class="pick-info">
        <div class="pick-fighter">${esc(pick.fighter)}</div>
        <div class="pick-meta">
          <span>${esc(pick.event || "Event TBD")}</span>
          <span>·</span>
          <span>${esc(formatDate(pick.date))}</span>
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
    list.appendChild(card);
  });
}

// ── HELPERS ───────────────────────────────────────────────────
function oddsToDecimal(odds) {
  const n = parseInt(odds);
  return n > 0 ? (n / 100) + 1 : (100 / Math.abs(n)) + 1;
}

function formatOdds(odds) {
  const n = parseInt(odds);
  return { text: (n > 0 ? "+" : "") + n, positive: n > 0 };
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}