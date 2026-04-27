// ============================================================
// PICKTAPE — Main App Logic
// ============================================================

import {
  auth, db, provider,
  signInWithPopup, signOut, onAuthStateChanged
} from "./firebase-config.js";

import {
  collection, addDoc, getDocs, doc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── DOM REFS ──────────────────────────────────────────────────
const authScreen     = document.getElementById("auth-screen");
const appEl          = document.getElementById("app");
const loadingEl      = document.getElementById("loading");
const googleSigninBtn= document.getElementById("google-signin-btn");
const signoutBtn     = document.getElementById("signout-btn");
const userAvatar     = document.getElementById("user-avatar");
const userNameEl     = document.getElementById("user-name");

const inpFighter     = document.getElementById("inp-fighter");
const inpOdds        = document.getElementById("inp-odds");
const inpEvent       = document.getElementById("inp-event");
const inpType        = document.getElementById("inp-type");
const inpNotes       = document.getElementById("inp-notes");
const addPickBtn     = document.getElementById("add-pick-btn");
const formError      = document.getElementById("form-error");

const pendingList    = document.getElementById("pending-list");
const pendingEmpty   = document.getElementById("pending-empty");
const historyList    = document.getElementById("history-list");
const historyEmpty   = document.getElementById("history-empty");

const filterResult   = document.getElementById("filter-result");
const filterType     = document.getElementById("filter-type");

const statTotal      = document.getElementById("stat-total");
const statHitrate    = document.getElementById("stat-hitrate");
const statRoi        = document.getElementById("stat-roi");
const statRecord     = document.getElementById("stat-record");
const statPending    = document.getElementById("stat-pending");

// ── STATE ─────────────────────────────────────────────────────
let currentUser = null;
let picks       = [];    // all picks for current user

// ── AUTH ──────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    userAvatar.src  = user.photoURL || "";
    userNameEl.textContent = user.displayName || user.email;
    authScreen.classList.add("hidden");
    appEl.classList.remove("hidden");
    await loadPicks();
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

// ── FIRESTORE HELPERS ─────────────────────────────────────────
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
  const docRef = await addDoc(picksRef(), {
    ...data,
    createdAt: serverTimestamp()
  });
  return docRef.id;
}

async function updatePick(id, data) {
  await updateDoc(doc(db, "users", currentUser.uid, "picks", id), data);
}

async function deletePick(id) {
  await deleteDoc(doc(db, "users", currentUser.uid, "picks", id));
}

// ── ADD PICK ──────────────────────────────────────────────────
addPickBtn.addEventListener("click", async () => {
  const fighter = inpFighter.value.trim();
  const oddsRaw = inpOdds.value.trim();
  const event   = inpEvent.value.trim();
  const type    = inpType.value;
  const notes   = inpNotes.value.trim();
  const odds    = parseInt(oddsRaw);

  if (!fighter || isNaN(odds)) {
    formError.classList.remove("hidden");
    return;
  }
  formError.classList.add("hidden");
  addPickBtn.disabled = true;
  addPickBtn.textContent = "Saving...";

  try {
    const data = {
      fighter, odds, event, type, notes,
      result: "pending",
      date: new Date().toISOString()
    };
    const id = await savePick(data);
    picks.unshift({ id, ...data });
    renderAll();
    inpFighter.value = "";
    inpOdds.value    = "";
    inpEvent.value   = "";
    inpNotes.value   = "";
  } catch (err) {
    console.error("Error saving pick:", err);
    alert("Error saving pick. Check your internet connection.");
  }

  addPickBtn.disabled = false;
  addPickBtn.textContent = "+ Add Pick";
});

// Allow Enter key in fighter input to submit
inpFighter.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addPickBtn.click();
});

// ── SET RESULT ────────────────────────────────────────────────
async function setResult(id, result) {
  try {
    await updatePick(id, { result });
    const pick = picks.find(p => p.id === id);
    if (pick) pick.result = result;
    renderAll();
  } catch (err) {
    console.error("Error updating pick:", err);
    alert("Error updating result. Try again.");
  }
}

// ── DELETE PICK ───────────────────────────────────────────────
async function removePickFromUI(id) {
  if (!confirm("Delete this pick? This cannot be undone.")) return;
  try {
    await deletePick(id);
    picks = picks.filter(p => p.id !== id);
    renderAll();
  } catch (err) {
    console.error("Error deleting pick:", err);
    alert("Error deleting pick. Try again.");
  }
}

// ── STATS ─────────────────────────────────────────────────────
function calcStats() {
  const settled = picks.filter(p => p.result !== "pending");
  const won     = picks.filter(p => p.result === "won").length;
  const lost    = picks.filter(p => p.result === "lost").length;
  const pending = picks.filter(p => p.result === "pending").length;
  const hitRate = settled.length ? Math.round((won / settled.length) * 100) : null;

  let roi = null;
  if (settled.length) {
    let profit = 0;
    settled.forEach(p => {
      const dec = oddsToDecimal(p.odds);
      if (p.result === "won") profit += (dec - 1);
      else profit -= 1;
    });
    roi = ((profit / settled.length) * 100).toFixed(1);
  }

  return { total: picks.length, won, lost, pending, hitRate, roi };
}

function updateStats() {
  const { total, won, lost, pending, hitRate, roi } = calcStats();

  statTotal.textContent  = total;
  statPending.textContent = pending;
  statRecord.textContent = `${won} — ${lost}`;

  if (hitRate !== null) {
    statHitrate.textContent = hitRate + "%";
    statHitrate.className   = "stat-val " + (hitRate >= 55 ? "accent" : "red");
  } else {
    statHitrate.textContent = "—";
    statHitrate.className   = "stat-val accent";
  }

  if (roi !== null) {
    statRoi.textContent = (parseFloat(roi) >= 0 ? "+" : "") + roi + "%";
    statRoi.className   = "stat-val " + (parseFloat(roi) >= 0 ? "accent" : "red");
  } else {
    statRoi.textContent = "—";
    statRoi.className   = "stat-val amber";
  }
}

// ── RENDER PICK CARD ──────────────────────────────────────────
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

function buildPickCard(pick, showResultBtns) {
  const odds = formatOdds(pick.odds);
  const card = document.createElement("div");
  card.className = "pick-card " + (showResultBtns ? "pending" : pick.result);
  card.dataset.id = pick.id;

  const notesHTML = pick.notes
    ? `<div class="pick-notes">"${pick.notes}"</div>`
    : "";

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
      <div class="pick-fighter">${pick.fighter}</div>
      <div class="pick-meta">
        <span>${pick.event || "Event TBD"}</span>
        <span>·</span>
        <span>${formatDate(pick.date)}</span>
        <span class="pick-type-badge">${pick.type || "Single"}</span>
      </div>
      ${notesHTML}
    </div>
    <div class="odds-badge ${odds.positive ? "positive" : ""}">${odds.text}</div>
    ${actionsHTML}
  `;

  // Event delegation on card
  card.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id     = btn.dataset.id;
    if (action === "win")  setResult(id, "won");
    if (action === "loss") setResult(id, "lost");
    if (action === "del")  removePickFromUI(id);
  });

  return card;
}

// ── RENDER ALL ────────────────────────────────────────────────
function renderAll() {
  updateStats();
  renderPending();
  renderHistory();
}

function renderPending() {
  const pending = picks.filter(p => p.result === "pending");
  pendingList.innerHTML = "";
  if (pending.length === 0) {
    pendingEmpty.classList.remove("hidden");
  } else {
    pendingEmpty.classList.add("hidden");
    pending.forEach(p => pendingList.appendChild(buildPickCard(p, true)));
  }
}

function renderHistory() {
  const resultFilter = filterResult.value;
  const typeFilter   = filterType.value;

  const filtered = picks.filter(p => {
    const matchResult = resultFilter === "all" || p.result === resultFilter;
    const matchType   = typeFilter   === "all" || p.type   === typeFilter;
    return matchResult && matchType;
  });

  historyList.innerHTML = "";
  if (filtered.length === 0) {
    historyEmpty.classList.remove("hidden");
  } else {
    historyEmpty.classList.add("hidden");
    filtered.forEach(p => historyList.appendChild(buildPickCard(p, false)));
  }
}

// ── TABS ──────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-section").forEach(s => s.classList.add("hidden"));
    tab.classList.add("active");
    document.getElementById("tab-" + target).classList.remove("hidden");
    if (target === "pending") renderPending();
    if (target === "history") renderHistory();
  });
});

// ── FILTERS ───────────────────────────────────────────────────
filterResult.addEventListener("change", renderHistory);
filterType.addEventListener("change",   renderHistory);
