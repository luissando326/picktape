# PICKTAPE — Setup & Deployment Guide
## From zero to live in ~30 minutes

---

## OVERVIEW

You have 3 steps:
1. Set up Firebase (your database + login)
2. Paste your config into the app
3. Deploy to Vercel (free hosting, live URL)

---

## STEP 1 — Set up Firebase

### 1A. Create a Firebase Project

1. Go to https://console.firebase.google.com
2. Click **"Add project"**
3. Name it `picktape` (or anything you want)
4. Disable Google Analytics (you don't need it) → click **Create project**
5. Wait ~30 seconds for it to provision

---

### 1B. Enable Google Sign-In

1. In your Firebase project, click **"Authentication"** in the left sidebar
2. Click **"Get started"**
3. Click **"Google"** under Sign-in providers
4. Toggle it **ON**
5. Set your project's public-facing name (e.g. "PICKTAPE")
6. Pick your support email from the dropdown
7. Click **Save**

---

### 1C. Create the Firestore Database

1. Click **"Firestore Database"** in the left sidebar
2. Click **"Create database"**
3. Select **"Start in production mode"** → click Next
4. Pick any location (us-central1 is fine) → click **Enable**
5. Once created, click the **"Rules"** tab at the top
6. Replace the existing rules with this:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/picks/{pickId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

7. Click **Publish**

This rule means: users can only read/write their OWN picks. Nobody else can touch your data.

---

### 1D. Get Your Config Keys

1. Click the **gear icon** (⚙) next to "Project Overview" → **Project settings**
2. Scroll down to **"Your apps"**
3. Click the **</>** (web) icon to register a web app
4. Name it `picktape-web` → click **Register app**
5. You'll see a block of code that looks like this:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "picktape-xxxxx.firebaseapp.com",
  projectId: "picktape-xxxxx",
  storageBucket: "picktape-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

6. **Copy all of this** — you need it in Step 2

---

## STEP 2 — Paste Your Config Into the App

1. Open the file: `js/firebase-config.js`
2. Find the `firebaseConfig` object (it has placeholder values like `"PASTE_YOUR_API_KEY_HERE"`)
3. Replace EACH placeholder value with the real values from Step 1D
4. Save the file

Example of what it should look like after:
```js
const firebaseConfig = {
  apiKey:            "AIzaSyAbc123...",
  authDomain:        "picktape-12345.firebaseapp.com",
  projectId:         "picktape-12345",
  storageBucket:     "picktape-12345.appspot.com",
  messagingSenderId: "987654321",
  appId:             "1:987654321:web:def456"
};
```

---

## STEP 3 — Deploy to Vercel

### 3A. Push to GitHub

1. Go to https://github.com and create a new repository
   - Name: `picktape`
   - Set to **Public** (required for free Vercel deploy)
   - Don't add a README (you already have files)
2. Open your terminal / command prompt in your project folder and run:

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/picktape.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

---

### 3B. Deploy on Vercel

1. Go to https://vercel.com and sign in with your GitHub account
2. Click **"Add New Project"**
3. Find and import your `picktape` repo
4. Leave all settings as default — Vercel detects it's a static site automatically
5. Click **Deploy**
6. In ~60 seconds you get a live URL like: `picktape.vercel.app`

---

### 3C. Add Your Live URL to Firebase (Required for Login to Work)

1. Go back to Firebase Console → **Authentication** → **Settings** tab
2. Scroll to **"Authorized domains"**
3. Click **"Add domain"**
4. Paste your Vercel URL (e.g. `picktape.vercel.app`) → click **Add**

Without this step, Google Sign-In will be blocked on your live site.

---

## YOU'RE LIVE

Open your Vercel URL, sign in with Google, and start logging picks.

Any time you make changes to the code:
```bash
git add .
git commit -m "describe your change"
git push
```
Vercel auto-redeploys in ~30 seconds.

---

## PROJECT STRUCTURE

```
picktape/
├── index.html          ← main app page
├── css/
│   └── style.css       ← all styles
├── js/
│   ├── firebase-config.js  ← YOUR FIREBASE KEYS GO HERE
│   └── app.js          ← all app logic
└── SETUP.md            ← this file
```

---

## WHAT'S ON YOUR RESUME

**Project: PICKTAPE — MMA Fight Pick Tracker**
- Built a full-stack web application for tracking MMA fight predictions and betting ROI
- Implemented Google OAuth authentication via Firebase Authentication
- Designed and queried a NoSQL real-time database (Cloud Firestore) with user-scoped security rules
- Deployed to production via Vercel with CI/CD — changes push live automatically on git push
- Tech stack: Vanilla JS (ES Modules), Firebase (Auth + Firestore), Vercel

---

## TROUBLESHOOTING

**"Firebase: Error (auth/unauthorized-domain)"**
→ You forgot Step 3C. Add your Vercel URL to Firebase's authorized domains.

**"Missing or insufficient permissions"**
→ Your Firestore security rules didn't save. Go back to Step 1C and re-publish.

**Blank white screen after login**
→ Open browser DevTools (F12) → Console tab. There will be a red error — Google that error message.

**Sign-in popup is blocked**
→ Your browser is blocking popups. Allow popups for your site in browser settings.
