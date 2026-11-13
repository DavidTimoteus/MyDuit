# MyDuit Desktop (Windows `.exe`)

Thin Electron wrapper for **MyDuit**, bundling the production Vite PWA build (`dist/`) into an offline-capable Windows Installer (`NSIS`) and Portable `.exe` synchronized in real time with Web & Android via Firebase Auth + Firestore (`myduit001`).

## Build Locally

From the repository root:

```bash
# 1. Build web production bundle
npm run build

# 2. Install desktop dependencies (first time only)
cd desktop
npm install

# 3. Run desktop preview
npm start

# 4. Build Windows Installer (.exe) & Portable (.exe) into desktop/release/
npm run dist

# Or if running on a standard Windows account without Developer Mode symlink privileges:
npm run dist:local
```

## Google Sign-In Architecture (Recommended Loopback Setup)

By default, Firebase Auth works via popup inside the local Electron `localhost` origin. For seamless **system-browser Google Sign-In** (uses your already logged-in Chrome/Edge Gmail profile and avoids Google's embedded WebView checks):

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) for Firebase project `myduit001`.
2. Click **Create Credentials → OAuth client ID → Desktop app** (`MyDuit Windows Desktop`).
3. Set `VITE_GOOGLE_DESKTOP_CLIENT_ID=<your-desktop-client-id>` inside root `.env.local` (for local builds) or as a GitHub Repository Secret (`VITE_GOOGLE_DESKTOP_CLIENT_ID`) for automated `.github/workflows/release-desktop.yml` builds.

