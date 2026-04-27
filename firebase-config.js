// ============================================================
// PICKTAPE — Firebase Configuration
// ============================================================
// STEP: Paste your Firebase project config here.
// You get this from: Firebase Console → Project Settings → Your Apps → SDK setup
//
// It looks like this — replace ALL the placeholder values below:

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyA2knqHZVzXRJsz_7YMi7A9Jp-fI1mPhl0",
  authDomain:        "picktape-e5c64.firebaseapp.com",
  projectId:         "picktape-e5c64",
  storageBucket:     "picktape-e5c64.firebasestorage.app",
  messagingSenderId: "536453830200",
  appId:             "1:536453830200:web:c84422febb8a2c4d4978cd"
};

// Initialize Firebase
const app       = initializeApp(firebaseConfig);
const auth      = getAuth(app);
const db        = getFirestore(app);
const provider  = new GoogleAuthProvider();

export { auth, db, provider, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged };
