// ============================================================
// PICKTAPE — Main App Logic
// ESPN UFC API Integration + Firebase
// ============================================================

import {
  auth, db, provider,
  signInWithPopup, signOut, onAuthStateChanged
} from "./firebase-config.js";

import {
  collection, addDoc, getDocs, doc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── DOM REFS ──────────────────────────────────────────────────
const authScreen      = document.getElementById("auth-screen");
const appEl           = document.getElementById("app");
const loadingEl       = document.getElementById("loading");
const googleSigninBtn = document.getElementById("google-signin-btn");
const signoutBtn      = document.getElementById("signout-btn");
const userAvatar      = document.getElementById("user-avatar");
const userNameEl      = document.getElementById("user-name");

const eventSelect     = document.getElementById("inp-event-select");
const eventLoading    = document.getElementById("event-loading");
const fightSelect     = document.getElementById("inp-fight-select");
const fightSection    = document.getElementById("fight-section");
const fighterSelect   = document.getElementById("inp-fighter-select");
const inpOdds         = document.getElementById("inp-odds");
const inpType         = document.getElementById("inp-type");
const inpNotes        = document.getElementById("inp-notes");
const addPickBtn      = document.getElementById("add-pick-btn");
const formError       = document.getElementById("form-error");

const pendingList     = document.getElementById("pending-list");
const pendingEmpty    = document.getElementById("pending-empty");
const historyList     = document.getElementById("history-list");
const historyEmpty    = document.getElementById("history-empty");
const filterResult    = document.getElementById("filter-result");
const filterType      = document.getElementById("filter-type");
const filterEvent     = document.getElementById("filter-event");

const statTotal       = document.getElementById("stat-total");
const statHitrate     = document.getElementById("stat-hitrate");
const statRoi         = document.getElementById("stat-roi");
const statRecord      = document.getElementById("stat-record");
const statPending     = document.getElementById("stat-pending");
const seriesPills     = document.querySelectorAll(".series-pill");

// ── STATE ─────────────────────────────────────────────────────
let currentUser   = null;
let picks         = [];
let ufcEvents     = [];
let selectedFight = null;
let activeSeries  = "all"; // "all" | "General" | "Practical Parlay" | "Sped Parlay"

// ── AUTH ──────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    userAvatar.src = user.photoURL || "";
    userNameEl.textContent = user.displayName || user.email;
    authScreen.classList.add("hidden");
    appEl.classList.remove("hidden");

    // Save/update public profile doc so others can look them up
    const handle = (user.email || "").split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
    await setDoc(doc(db, "public_profiles", user.uid), {
      handle,
      displayName: user.displayName || handle,
      photoURL:    user.photoURL || "",
      joinedAt:    user.metadata.creationTime || new Date().toISOString(),
    }, { merge: true });

    document.getElementById("profile-link").href = `profile.html?user=${handle}`;
    await Promise.all([loadPicks(), loadUFCEvents()]);
  } else {
    currentUser = null;
    picks = [];
    authScreen.classList.remove("hidden");
    appEl.classList.add("hidden");
  }
  loadingEl.classList.add("hidden");
});

googleSigninBtn.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error("Sign in error:", err);
    alert("Sign in failed. Check your Firebase config and try again.");
  }
});

signoutBtn.addEventListener("click", () => signOut(auth));

// ── SERIES FILTER ─────────────────────────────────────────────
seriesPills.forEach(pill => {
  pill.addEventListener("click", () => {
    activeSeries = pill.dataset.series;
    seriesPills.forEach(p => p.classList.remove("active"));
    pill.classList.add("active");
    renderAll();
    // Re-render dashboard if it's visible
    const dashTab = document.getElementById("tab-dashboard");
    if (dashTab && !dashTab.classList.contains("hidden")) renderDashboard();
  });
});

function getFilteredPicks() {
  if (activeSeries === "all") return picks;
  return picks.filter(p => (p.series || "General") === activeSeries);
}
async function loadUFCEvents() {
  try {
    eventLoading.classList.remove("hidden");
    eventSelect.disabled = true;

    const res  = await fetch("https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard");
    const data = await res.json();
    const events = data.events || [];

    // Prefer upcoming, fall back to all
    ufcEvents = events.filter(e => e.status?.type?.name !== "STATUS_FINAL");
    if (ufcEvents.length === 0) ufcEvents = events;

    populateEventDropdown();
  } catch (err) {
    console.error("ESPN API error:", err);
    showManualFallback();
  } finally {
    eventLoading.classList.add("hidden");
    eventSelect.disabled = false;
  }
}

function populateEventDropdown() {
  eventSelect.innerHTML = '<option value="">— Select an upcoming event —</option>';
  if (ufcEvents.length === 0) { showManualFallback(); return; }

  ufcEvents.forEach((event, idx) => {
    const name = event.name || event.shortName || `UFC Event ${idx + 1}`;
    const date = event.date
      ? new Date(event.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "";
    const opt = document.createElement("option");
    opt.value = idx;
    opt.textContent = `${name}${date ? "  ·  " + date : ""}`;
    eventSelect.appendChild(opt);
  });

  // Always add manual option at bottom
  const manual = document.createElement("option");
  manual.value = "manual";
  manual.textContent = "✏ Enter event manually";
  eventSelect.appendChild(manual);
}

function showManualFallback() {
  eventSelect.innerHTML = '<option value="manual">✏ Enter event manually</option>';
  document.getElementById("manual-fallback").classList.remove("hidden");
}

// ── LEGS STATE ────────────────────────────────────────────────
let legs = []; // [{ fighter, opponent, odds, movType }]

function isMoV()  { return document.getElementById("inp-series").value === "Method of Victory"; }
function isProp() { return document.getElementById("inp-series").value === "Prop Picks"; }

function updateParlayOdds() {
  const display = document.getElementById("parlay-odds-display");
  const valEl   = document.getElementById("parlay-odds-val");
  if (legs.length === 0) { display.style.display = "none"; return; }
  display.style.display = "flex";

  // Convert all legs to decimal, multiply, convert back to American
  const combined = legs.reduce((acc, leg) => {
    const n = parseInt(leg.odds);
    const dec = n > 0 ? (n / 100) + 1 : (100 / Math.abs(n)) + 1;
    return acc * dec;
  }, 1);

  let american;
  if (combined >= 2) {
    american = Math.round((combined - 1) * 100);
    valEl.textContent = `+${american}`;
    valEl.className   = "parlay-odds-num positive";
  } else {
    american = Math.round(-100 / (combined - 1));
    valEl.textContent = `${american}`;
    valEl.className   = "parlay-odds-num";
  }
}

function renderLegs() {
  const list = document.getElementById("legs-list");
  list.innerHTML = "";
  legs.forEach((leg, i) => {
    const row = document.createElement("div");
    row.className = "leg-item";
    const movLabel = leg.movType ? ` · <span class="mov-tag">${leg.movType}</span>` : "";
    row.innerHTML = `
      <div class="leg-item-info">
        <span class="leg-num">${i + 1}</span>
        <span class="leg-fighter">${leg.fighter}</span>
        ${leg.opponent ? `<span class="leg-vs">vs ${leg.opponent}</span>` : ""}
        ${movLabel}
      </div>
      <div class="leg-odds ${parseInt(leg.odds) > 0 ? "positive" : ""}">${parseInt(leg.odds) > 0 ? "+" : ""}${leg.odds}</div>
      <button class="leg-remove" data-idx="${i}">✕</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll(".leg-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      legs.splice(parseInt(btn.dataset.idx), 1);
      renderLegs();
      updateParlayOdds();
    });
  });

  updateParlayOdds();
}

// Event selected → populate fights
eventSelect.addEventListener("change", () => {
  const idx = eventSelect.value;
  fightSection.classList.add("hidden");
  fighterSelect.innerHTML = '<option value="">— Select a fighter —</option>';
  fightSelect.innerHTML   = '<option value="">— Select a fight —</option>';
  legs = [];
  renderLegs();
  selectedFight = null;

  const manualFallback = document.getElementById("manual-fallback");

  if (idx === "manual") {
    manualFallback.classList.remove("hidden");
    fightSection.classList.remove("hidden");
    return;
  }

  manualFallback.classList.add("hidden");
  if (idx === "") return;

  const event        = ufcEvents[parseInt(idx)];
  const competitions = event?.competitions || [];

  if (competitions.length === 0) {
    fightSelect.innerHTML = '<option value="">No fights listed yet for this event</option>';
    fightSection.classList.remove("hidden");
    return;
  }

  competitions.forEach((comp, cidx) => {
    const competitors = comp.competitors || [];
    if (competitors.length < 2) return;
    const f1  = competitors[0]?.athlete?.displayName || competitors[0]?.team?.displayName || "Fighter 1";
    const f2  = competitors[1]?.athlete?.displayName || competitors[1]?.team?.displayName || "Fighter 2";
    const opt = document.createElement("option");
    opt.value       = cidx;
    opt.textContent = `${f1}  vs  ${f2}`;
    opt.dataset.f1  = f1;
    opt.dataset.f2  = f2;
    fightSelect.appendChild(opt);
  });

  fightSection.classList.remove("hidden");
});

// Fight selected → populate fighter picker
fightSelect.addEventListener("change", () => {
  fighterSelect.innerHTML = '<option value="">— Pick your fighter —</option>';
  selectedFight = null;
  const cidx = fightSelect.value;
  if (cidx === "") return;

  const opt = fightSelect.options[fightSelect.selectedIndex];
  const f1  = opt.dataset.f1;
  const f2  = opt.dataset.f2;
  selectedFight = { fighter1: f1, fighter2: f2 };

  [f1, f2].forEach(f => {
    const o = document.createElement("option");
    o.value = f; o.textContent = f;
    fighterSelect.appendChild(o);
  });
});

// Series change → toggle MoV method field + Prop label field
document.getElementById("inp-series").addEventListener("change", () => {
  const movField  = document.getElementById("mov-type-field");
  const propField = document.getElementById("prop-label-field");
  movField.style.display  = isMoV()  ? "flex" : "none";
  propField.classList.toggle("hidden", !isProp());
  legs = [];
  renderLegs();
});

// Add Leg button
document.getElementById("add-leg-btn").addEventListener("click", () => {
  const fighter  = fighterSelect.value || document.getElementById("inp-event-manual")?.value?.trim();
  const oddsRaw  = document.getElementById("inp-leg-odds").value.trim();
  const odds     = parseInt(oddsRaw);

  if (!fighter || isNaN(odds)) {
    document.getElementById("form-error").classList.remove("hidden");
    return;
  }
  document.getElementById("form-error").classList.add("hidden");

  const movType  = isMoV() ? document.getElementById("inp-mov-type").value : null;
  const opponent = selectedFight
    ? (selectedFight.fighter1 === fighter ? selectedFight.fighter2 : selectedFight.fighter1)
    : "";

  legs.push({ fighter, opponent, odds: odds.toString(), movType });
  renderLegs();

  // Reset leg row
  fighterSelect.innerHTML = '<option value="">— Select a fighter —</option>';
  fightSelect.value = "";
  document.getElementById("inp-leg-odds").value = "";
  selectedFight = null;
});

// ── FIRESTORE ─────────────────────────────────────────────────
function picksRef() {
  return collection(db, "users", currentUser.uid, "picks");
}

async function loadPicks() {
  try {
    const q    = query(picksRef(), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    picks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  } catch (err) {
    console.error("Error loading picks:", err);
  }
}

async function savePick(data) {
  const ref = await addDoc(picksRef(), { ...data, createdAt: serverTimestamp() });
  return ref.id;
}

async function updatePick(id, data) {
  await updateDoc(doc(db, "users", currentUser.uid, "picks", id), data);
}

async function deletePick(id) {
  await deleteDoc(doc(db, "users", currentUser.uid, "picks", id));
}

// ── ADD PICK ──────────────────────────────────────────────────
addPickBtn.addEventListener("click", async () => {
  const notes    = document.getElementById("inp-notes").value.trim();
  const series   = document.getElementById("inp-series").value;
  const errorEl  = document.getElementById("form-error");

  // Need at least one leg
  if (legs.length === 0) {
    errorEl.classList.remove("hidden");
    return;
  }
  errorEl.classList.add("hidden");

  // Get event name
  const eventIdx = eventSelect.value;
  let eventName  = document.getElementById("inp-event-manual")?.value?.trim() || "";
  if (eventIdx !== "" && eventIdx !== "manual" && ufcEvents[parseInt(eventIdx)]) {
    const e = ufcEvents[parseInt(eventIdx)];
    eventName = e.shortName || e.name || eventName;
  }

  // Determine type and combined odds
  const isParlay  = legs.length > 1;
  const isMoVSeries = series === "Method of Victory";
  let type, oddsVal;

  if (isMoVSeries) {
    type = legs[0]?.movType || "KO";
  } else {
    type = isParlay ? "Parlay" : "Single";
  }

  if (isParlay) {
    // Calculate combined parlay odds
    const combined = legs.reduce((acc, leg) => {
      const n = parseInt(leg.odds);
      const dec = n > 0 ? (n / 100) + 1 : (100 / Math.abs(n)) + 1;
      return acc * dec;
    }, 1);
    oddsVal = combined >= 2
      ? Math.round((combined - 1) * 100)
      : -Math.round(100 / (combined - 1));
  } else {
    oddsVal = parseInt(legs[0].odds);
  }

  // Build fighter label
  const fighter = legs.map(l => {
    if (isMoVSeries && l.movType) return `${l.fighter} by ${l.movType}`;
    return l.fighter;
  }).join(" + ");

  const opponent = legs.length === 1 ? legs[0].opponent : "";

  addPickBtn.disabled    = true;
  addPickBtn.textContent = "Saving...";

  try {
    const propLabel = series === "Prop Picks"
      ? (document.getElementById("inp-prop-label")?.value?.trim() || "")
      : "";

    const data = {
      fighter, odds: oddsVal, event: eventName, type, notes,
      series, result: "pending", date: new Date().toISOString(),
      opponent, legs: [...legs], propLabel
    };
    const id = await savePick(data);
    picks.unshift({ id, ...data });
    renderAll();

    // Reset form
    eventSelect.value = "";
    fightSelect.innerHTML   = '<option value="">— Select a fight —</option>';
    fighterSelect.innerHTML = '<option value="">— Select a fighter —</option>';
    fightSection.classList.add("hidden");
    document.getElementById("manual-fallback").classList.add("hidden");
    document.getElementById("prop-label-field").classList.add("hidden");
    if (document.getElementById("inp-event-manual")) document.getElementById("inp-event-manual").value = "";
    if (document.getElementById("inp-prop-label"))   document.getElementById("inp-prop-label").value   = "";
    document.getElementById("inp-leg-odds").value = "";
    document.getElementById("inp-notes").value    = "";
    document.getElementById("inp-series").value   = "ML Picks";
    document.getElementById("mov-type-field").style.display = "none";
    document.getElementById("parlay-odds-display").style.display = "none";
    legs          = [];
    selectedFight = null;
    renderLegs();
  } catch (err) {
    console.error("Error saving:", err);
    alert("Error saving pick. Check your connection.");
  }

  addPickBtn.disabled    = false;
  addPickBtn.textContent = "+ Log Pick";
});

// ── SET RESULT ────────────────────────────────────────────────
async function setResult(id, result) {
  try {
    await updatePick(id, { result });
    const pick = picks.find(p => p.id === id);
    if (pick) pick.result = result;
    renderAll();
  } catch (err) {
    console.error("Error updating:", err);
  }
}

// ── DELETE ────────────────────────────────────────────────────
async function removePickFromUI(id) {
  if (!confirm("Delete this pick?")) return;
  try {
    await deletePick(id);
    picks = picks.filter(p => p.id !== id);
    renderAll();
  } catch (err) {
    console.error("Error deleting:", err);
  }
}

// ── STATS ─────────────────────────────────────────────────────
function oddsToDecimal(odds) {
  const n = parseInt(odds);
  return n > 0 ? (n / 100) + 1 : (100 / Math.abs(n)) + 1;
}

function calcStats() {
  const fp      = getFilteredPicks();
  const settled = fp.filter(p => p.result !== "pending");
  const won     = fp.filter(p => p.result === "won").length;
  const lost    = fp.filter(p => p.result === "lost").length;
  const pending = fp.filter(p => p.result === "pending").length;
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
  return { total: fp.length, won, lost, pending, hitRate, roi };
}

function updateStats() {
  const { total, won, lost, pending, hitRate, roi } = calcStats();
  statTotal.textContent   = total;
  statPending.textContent = pending;
  statRecord.textContent  = `${won} — ${lost}`;
  if (hitRate !== null) {
    statHitrate.textContent = hitRate + "%";
    statHitrate.className   = "stat-val " + (hitRate >= 55 ? "accent" : "red");
  } else { statHitrate.textContent = "—"; statHitrate.className = "stat-val accent"; }
  if (roi !== null) {
    statRoi.textContent = (parseFloat(roi) >= 0 ? "+" : "") + roi + "%";
    statRoi.className   = "stat-val " + (parseFloat(roi) >= 0 ? "accent" : "red");
  } else { statRoi.textContent = "—"; statRoi.className = "stat-val amber"; }
}

// ── RENDER ────────────────────────────────────────────────────
function formatOdds(odds) {
  const n = parseInt(odds);
  return { text: (n > 0 ? "+" : "") + n, positive: n > 0 };
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function buildPickCard(pick, showResultBtns) {
  const odds = formatOdds(pick.odds);
  const card = document.createElement("div");
  card.className = "pick-card " + (showResultBtns ? "pending" : pick.result);

  const opponentHTML = pick.opponent   ? `<span class="vs-tag">vs ${pick.opponent}</span>` : "";
  const notesHTML    = pick.notes      ? `<div class="pick-notes">"${pick.notes}"</div>`    : "";
  const propHTML     = pick.propLabel  ? `<div class="pick-notes prop-label">📌 ${pick.propLabel}</div>` : "";
  const series       = pick.series || "General";
  const seriesClass  = series === "Practical Parlay" ? "series-pp"
                     : series === "Sped Parlay"       ? "series-sp"
                     : series === "Method of Victory" ? "series-mov"
                     : "series-gen";
  const seriesHTML   = `<span class="series-badge ${seriesClass}">${series}</span>`;

  const actionsHTML = showResultBtns
    ? `<div class="pick-actions">
        <button class="btn-sm win"  data-action="win"  data-id="${pick.id}">WIN</button>
        <button class="btn-sm loss" data-action="loss" data-id="${pick.id}">LOSS</button>
        <button class="btn-sm del"  data-action="del"  data-id="${pick.id}">✕</button>
       </div>`
    : `<div class="pick-actions">
        <div class="status-badge ${pick.result}">
          ${pick.result === "won" ? "WIN" : pick.result === "lost" ? "LOSS" : "PENDING"}
        </div>
        <button class="btn-sm del" data-action="del" data-id="${pick.id}">✕</button>
       </div>`;

  card.innerHTML = `
    <div class="pick-info">
      <div class="pick-fighter">${pick.fighter} ${opponentHTML}</div>
      <div class="pick-meta">
        <span>${pick.event || "Event TBD"}</span>
        <span>·</span>
        <span>${formatDate(pick.date)}</span>
        <span class="pick-type-badge">${pick.type || "Single"}</span>
        ${seriesHTML}
      </div>
      ${notesHTML}
      ${propHTML}
    </div>
    <div class="odds-badge ${odds.positive ? "positive" : ""}">${odds.text}</div>
    ${actionsHTML}
  `;

  card.addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "win")  setResult(id, "won");
    if (action === "loss") setResult(id, "lost");
    if (action === "del")  removePickFromUI(id);
  });

  return card;
}

function groupByEvent(arr) {
  const groups = {};
  arr.forEach(p => {
    const key = p.event || "No Event";
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });
  return groups;
}

function renderAll() {
  updateStats();
  renderPending();
  renderHistory();
  populateEventFilter();
}

function renderPending() {
  const fp      = getFilteredPicks();
  const pending = fp.filter(p => p.result === "pending");
  pendingList.innerHTML = "";
  pendingEmpty.classList.toggle("hidden", pending.length > 0);
  pending.forEach(p => pendingList.appendChild(buildPickCard(p, true)));
}

function renderHistory() {
  const rf = filterResult.value;
  const tf = filterType.value;
  const ef = filterEvent.value;

  const filtered = getFilteredPicks().filter(p =>
    (rf === "all" || p.result === rf) &&
    (tf === "all" || p.type   === tf) &&
    (ef === "all" || p.event  === ef)
  );

  historyList.innerHTML = "";

  if (filtered.length === 0) {
    historyEmpty.classList.remove("hidden");
    return;
  }

  historyEmpty.classList.add("hidden");
  const groups = groupByEvent(filtered);

  Object.entries(groups).forEach(([eventName, eventPicks]) => {
    const won     = eventPicks.filter(p => p.result === "won").length;
    const lost    = eventPicks.filter(p => p.result === "lost").length;
    const pending = eventPicks.filter(p => p.result === "pending").length;

    const header = document.createElement("div");
    header.className = "event-group-header";
    header.innerHTML = `
      <span class="event-group-name">${eventName}</span>
      <span class="event-group-record">
        ${won     > 0 ? `<span class="rec-w">${won}W</span>`         : ""}
        ${lost    > 0 ? `<span class="rec-l">${lost}L</span>`        : ""}
        ${pending > 0 ? `<span class="rec-p">${pending} pending</span>` : ""}
      </span>
    `;
    historyList.appendChild(header);

    const group = document.createElement("div");
    group.className = "event-group-picks";
    eventPicks.forEach(p => group.appendChild(buildPickCard(p, false)));
    historyList.appendChild(group);
  });
}

function populateEventFilter() {
  const current = filterEvent.value;
  const events  = [...new Set(getFilteredPicks().map(p => p.event).filter(Boolean))];
  filterEvent.innerHTML = '<option value="all">All Events</option>';
  events.forEach(e => {
    const opt = document.createElement("option");
    opt.value = e;
    opt.textContent = e;
    if (e === current) opt.selected = true;
    filterEvent.appendChild(opt);
  });
}

// ── TABS ──────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-section").forEach(s => s.classList.add("hidden"));
    tab.classList.add("active");
    document.getElementById("tab-" + target).classList.remove("hidden");
    if (target === "pending")    renderPending();
    if (target === "history")    renderHistory();
    if (target === "dashboard")  renderDashboard();
    if (target === "fightnight") renderFightNight();
  });
});

filterResult.addEventListener("change", renderHistory);
filterType.addEventListener("change",   renderHistory);
filterEvent.addEventListener("change",  renderHistory);

// ── FIGHT NIGHT MODE ──────────────────────────────────────────
function renderFightNight() {
  const fnFilter  = document.getElementById("fn-event-filter");
  const fnList    = document.getElementById("fn-picks-list");
  const fnEmpty   = document.getElementById("fn-empty");
  const fnDone    = document.getElementById("fn-done");

  // Populate event dropdown from pending picks
  const pendingEvents = [...new Set(picks.filter(p => p.result === "pending" && p.event).map(p => p.event))];
  const current = fnFilter.value;
  fnFilter.innerHTML = '<option value="">— Select tonight\'s event —</option>';
  pendingEvents.forEach(e => {
    const opt = document.createElement("option");
    opt.value = e; opt.textContent = e;
    if (e === current) opt.selected = true;
    fnFilter.appendChild(opt);
  });

  // Auto-select first event if only one
  if (pendingEvents.length === 1 && !current) fnFilter.value = pendingEvents[0];

  const selectedEvent = fnFilter.value;
  fnList.innerHTML = "";

  if (!selectedEvent) {
    fnEmpty.classList.remove("hidden");
    fnDone.classList.add("hidden");
    return;
  }

  const eventPicks = picks.filter(p => p.event === selectedEvent);
  const pending    = eventPicks.filter(p => p.result === "pending");

  if (pending.length === 0) {
    fnEmpty.classList.add("hidden");
    fnDone.classList.remove("hidden");
    return;
  }

  fnEmpty.classList.add("hidden");
  fnDone.classList.add("hidden");

  pending.forEach(pick => {
    const odds   = formatOdds(pick.odds);
    const series = pick.series || "ML Picks";
    const seriesClass = series === "Practical Parlay" ? "series-pp"
                      : series === "Sped Parlay"       ? "series-sp"
                      : series === "Method of Victory" ? "series-mov"
                      : series === "Prop Picks"        ? "series-prop"
                      : "series-ml";

    const card = document.createElement("div");
    card.className = "fn-pick-card";

    const legCount = pick.legs?.length > 1
      ? `<span class="pick-type-badge">${pick.legs.length}-leg parlay</span>` : "";
    const propHTML = pick.propLabel
      ? `<div class="pick-notes prop-label">📌 ${pick.propLabel}</div>` : "";

    card.innerHTML = `
      <div class="fn-pick-info">
        <div class="fn-pick-fighter">${pick.fighter}</div>
        <div class="pick-meta" style="margin-top:4px;">
          <span class="series-badge ${seriesClass}">${series}</span>
          ${legCount}
          <span class="odds-badge ${odds.positive ? "positive" : ""}" style="display:inline-block;">${odds.text}</span>
        </div>
        ${propHTML}
      </div>
      <div class="fn-buttons">
        <button class="fn-btn fn-win"  data-action="win"  data-id="${pick.id}">✓ WIN</button>
        <button class="fn-btn fn-loss" data-action="loss" data-id="${pick.id}">✕ LOSS</button>
      </div>
    `;

    card.addEventListener("click", async e => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      btn.closest(".fn-pick-card").style.opacity = "0.4";
      btn.closest(".fn-pick-card").style.pointerEvents = "none";
      await setResult(btn.dataset.id, btn.dataset.action === "win" ? "won" : "lost");
      renderFightNight();
    });

    fnList.appendChild(card);
  });
}

// Re-render fight night when event filter changes
document.getElementById("fn-event-filter").addEventListener("change", renderFightNight);

// ── DASHBOARD ─────────────────────────────────────────────────
let chartDonut    = null;
let chartLine     = null;
let chartRoiType  = null;
let chartEvents   = null;

const CHART_DEFAULTS = {
  color: "#e8e4dc",
  font: { family: "'Barlow', sans-serif", size: 12 },
};

Chart.defaults.color      = CHART_DEFAULTS.color;
Chart.defaults.font.family = CHART_DEFAULTS.font.family;
Chart.defaults.font.size   = CHART_DEFAULTS.font.size;

function renderDashboard() {
  const fp      = getFilteredPicks();
  const settled = fp.filter(p => p.result !== "pending");
  const dashEmpty = document.getElementById("dash-empty");

  if (fp.length === 0) {
    dashEmpty.classList.remove("hidden");
    document.querySelector(".dash-summary").style.display = "none";
    document.querySelector(".charts-grid").style.display  = "none";
    return;
  }

  dashEmpty.classList.add("hidden");
  document.querySelector(".dash-summary").style.display = "";
  document.querySelector(".charts-grid").style.display  = "";

  renderSummaryCards(fp);
  renderDonutChart(fp);
  renderLineChart(fp);
  renderRoiByTypeChart(fp);
  renderEventRecordChart(fp);
}

function renderSummaryCards(fp) {
  const won    = fp.filter(p => p.result === "won");
  const settled = fp.filter(p => p.result !== "pending");

  // Best bet type by hit rate
  const types = ["Single", "Parlay", "Prop"];
  let bestType = "—", bestTypeHR = 0, bestTypeSub = "";
  types.forEach(t => {
    const s = settled.filter(p => p.type === t);
    if (!s.length) return;
    const w = s.filter(p => p.result === "won").length;
    const hr = Math.round((w / s.length) * 100);
    if (hr > bestTypeHR) { bestTypeHR = hr; bestType = t; bestTypeSub = `${hr}% hit rate (${s.length} settled)`; }
  });
  document.getElementById("dash-best-type").textContent     = bestType;
  document.getElementById("dash-best-type-sub").textContent = bestTypeSub;

  // Biggest win by odds
  if (won.length) {
    const big = won.reduce((a, b) => parseInt(a.odds) > parseInt(b.odds) ? a : b);
    const bigOdds = formatOdds(big.odds);
    document.getElementById("dash-biggest-win").textContent     = bigOdds.text;
    document.getElementById("dash-biggest-win-sub").textContent = big.fighter + (big.event ? ` · ${big.event}` : "");
  }

  // Current streak
  const streakPicks = [...picks].filter(p => p.result !== "pending").reverse();
  let streak = 0, streakType = "";
  if (streakPicks.length) {
    streakType = streakPicks[0].result;
    for (const p of streakPicks) {
      if (p.result === streakType) streak++;
      else break;
    }
  }
  const streakEl = document.getElementById("dash-streak");
  streakEl.textContent = streak ? `${streak} ${streakType === "won" ? "W" : "L"}` : "—";
  streakEl.className   = "dash-card-val " + (streakType === "won" ? "green" : streakType === "lost" ? "red" : "");
  document.getElementById("dash-streak-sub").textContent = streak ? `current ${streakType === "won" ? "win" : "loss"} streak` : "";

  // Avg odds on wins
  if (won.length) {
    const avgOdds = Math.round(won.reduce((sum, p) => sum + parseInt(p.odds), 0) / won.length);
    document.getElementById("dash-avg-odds").textContent = (avgOdds > 0 ? "+" : "") + avgOdds;
  }
}

function renderDonutChart(fp) {
  const won     = fp.filter(p => p.result === "won").length;
  const lost    = fp.filter(p => p.result === "lost").length;
  const pending = fp.filter(p => p.result === "pending").length;
  const settled = won + lost;
  const hitRate = settled ? Math.round((won / settled) * 100) : 0;

  document.getElementById("donut-center-text").innerHTML = `
    <div class="donut-center-pct">${settled ? hitRate + "%" : "—"}</div>
    <div class="donut-center-label">Hit Rate</div>
  `;

  const data = {
    labels: ["Wins", "Losses", "Pending"],
    datasets: [{
      data: [won, lost, pending],
      backgroundColor: ["rgba(78,203,113,0.85)", "rgba(232,64,64,0.85)", "rgba(42,42,52,0.9)"],
      borderColor:     ["#4ecb71", "#e84040", "#2a2a34"],
      borderWidth: 1,
      hoverOffset: 6,
    }]
  };

  if (chartDonut) chartDonut.destroy();
  chartDonut = new Chart(document.getElementById("chart-donut"), {
    type: "doughnut",
    data,
    options: {
      cutout: "68%",
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { padding: 16, boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}` } }
      }
    }
  });
}

function renderLineChart(fp) {
  const settled = fp.filter(p => p.result !== "pending")
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (settled.length < 2) {
    const canvas = document.getElementById("chart-line");
    const ctx    = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#44444e";
    ctx.font      = "13px Barlow";
    ctx.textAlign = "center";
    ctx.fillText("Need at least 2 settled picks", canvas.width / 2, 100);
    return;
  }

  // Rolling hit rate after each pick
  const labels  = [];
  const hitRates = [];
  settled.forEach((p, i) => {
    const slice = settled.slice(0, i + 1);
    const w     = slice.filter(s => s.result === "won").length;
    hitRates.push(Math.round((w / slice.length) * 100));
    labels.push(`#${i + 1}`);
  });

  if (chartLine) chartLine.destroy();
  chartLine = new Chart(document.getElementById("chart-line"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Hit Rate %",
        data: hitRates,
        borderColor: "#e84040",
        backgroundColor: "rgba(232,64,64,0.08)",
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: "#e84040",
        fill: true,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: {
          min: 0, max: 100,
          ticks: { callback: v => v + "%" },
          grid: { color: "#1e1e24" },
        },
        x: { grid: { color: "#1e1e24" } }
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` Hit Rate: ${ctx.raw}%` } }
      }
    }
  });
}

function renderRoiByTypeChart(fp) {
  const types   = ["Single", "Parlay", "Prop"];
  const roiVals = types.map(t => {
    const s = fp.filter(p => p.type === t && p.result !== "pending");
    if (!s.length) return 0;
    let profit = 0;
    s.forEach(p => {
      const dec = oddsToDecimal(p.odds);
      profit += p.result === "won" ? (dec - 1) : -1;
    });
    return parseFloat(((profit / s.length) * 100).toFixed(1));
  });

  const colors = roiVals.map(v => v >= 0 ? "rgba(78,203,113,0.8)" : "rgba(232,64,64,0.8)");
  const borders = roiVals.map(v => v >= 0 ? "#4ecb71" : "#e84040");

  if (chartRoiType) chartRoiType.destroy();
  chartRoiType = new Chart(document.getElementById("chart-roi-type"), {
    type: "bar",
    data: {
      labels: types,
      datasets: [{
        label: "ROI %",
        data: roiVals,
        backgroundColor: colors,
        borderColor: borders,
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: {
          ticks: { callback: v => v + "%" },
          grid: { color: "#1e1e24" },
        },
        x: { grid: { display: false } }
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ROI: ${ctx.raw >= 0 ? "+" : ""}${ctx.raw}%` } }
      }
    }
  });
}

function renderEventRecordChart(fp) {
  const byEvent = {};
  fp.filter(p => p.event && p.result !== "pending").forEach(p => {
    if (!byEvent[p.event]) byEvent[p.event] = { won: 0, lost: 0 };
    byEvent[p.event][p.result]++;
  });

  const events  = Object.keys(byEvent).slice(-8); // last 8 events max
  const wons    = events.map(e => byEvent[e].won);
  const losses  = events.map(e => byEvent[e].lost);

  // Shorten long event names
  const shortLabels = events.map(e => e.replace("UFC Fight Night: ", "FN: ").replace("Ultimate Fighting Championship ", "UFC "));

  if (chartEvents) chartEvents.destroy();
  chartEvents = new Chart(document.getElementById("chart-events"), {
    type: "bar",
    data: {
      labels: shortLabels,
      datasets: [
        { label: "Wins",   data: wons,   backgroundColor: "rgba(78,203,113,0.8)", borderColor: "#4ecb71", borderWidth: 1, borderRadius: 4 },
        { label: "Losses", data: losses, backgroundColor: "rgba(232,64,64,0.8)",  borderColor: "#e84040", borderWidth: 1, borderRadius: 4 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { ticks: { stepSize: 1 }, grid: { color: "#1e1e24" } },
        x: { grid: { display: false }, ticks: { maxRotation: 30 } }
      },
      plugins: {
        legend: { position: "bottom", labels: { padding: 14, boxWidth: 12 } },
      }
    }
  });
}