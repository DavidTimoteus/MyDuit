// Modul Firebase AUTH-ONLY (Fase 5 re-audit R-01): inisialisasi Firebase App
// + Auth + App Check + Google provider, TANPA Firestore.
//
// Alasan pemisahan: firebase.js lama mengimpor 'firebase/firestore' di
// tingkat modul, jadi setiap berkas yang butuh auth (App.jsx, useAuth.js,
// AuthScreen.jsx) ikut menyeret SDK Firestore 577 kB ke bundel awal —
// halaman login membayar setengah megabyte untuk database yang baru
// dibutuhkan SETELAH user ada. Jalur login hanya boleh mengimpor modul ini.
// Kode pasca-login (db.js, Shell, semua fitur) tetap memakai firebase.js
// yang mengembalikan { app, auth, db }.
import { initializeApp } from 'firebase/app'
import { ReCaptchaV3Provider, initializeAppCheck } from 'firebase/app-check'
import { GoogleAuthProvider, getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)
}

let app = null
let auth = null

// Inisialisasi sekali saja (App Check opsional — aktif bila site key
// dikonfigurasi; dilewati di Electron desktop atau saat offline).
export function getFirebaseApp() {
  if (!app) {
    if (!isFirebaseConfigured()) {
      throw new Error(
        'Konfigurasi Firebase belum diisi. Salin .env.example menjadi .env.local lalu isi nilainya.',
      )
    }
    app = initializeApp(firebaseConfig)
    const appCheckKey = import.meta.env?.VITE_FIREBASE_APPCHECK_SITE_KEY
    if (appCheckKey && typeof window !== 'undefined' && !window.myduitDesktop) {
      try {
        initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider(appCheckKey),
          isTokenAutoRefreshEnabled: true,
        })
      } catch {
        // Abaikan bila offline/lingkungan non-web
      }
    }
    auth = getAuth(app)
  }
  return { app, auth }
}

export const googleProvider = new GoogleAuthProvider()
