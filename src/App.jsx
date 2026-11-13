import { useEffect, useState } from 'react'
import { clearIndexedDbPersistence, terminate } from 'firebase/firestore'
import AuthScreen from './components/AuthScreen.jsx'
import Shell from './components/Shell.jsx'
import Splash from './components/Splash.jsx'
import ToastHost from './components/ToastHost.jsx'
import AkunKategoriProvider from './lib/AkunKategoriProvider.jsx'
import { useAuth } from './features/auth/useAuth.js'
import { getFirebase, isFirebaseConfigured } from './lib/firebase.js'
import { migrasiNormalisasi } from './lib/db.js'
import { IS_DEMO_UID } from './lib/mockData.js'
import { initTema } from './lib/theme.js'

const KUNCI_PREF_SESI = ['myduit_gemini_api_key', 'myduit_ocr_engine', 'myduit_ocr_endpoint', 'myduit_ocr_crop_mode', 'myduit:tx_chip', 'myduit:negara']

function LayarSetup({ error }) {
  return (
    <div className="min-h-full flex items-center justify-center bg-surface p-6">
      <div className="clay-card max-w-md rounded-3xl p-8 text-center">
        <h1 className="text-lg font-extrabold text-slate-800">Konfigurasi belum lengkap</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">{error}</p>
      </div>
    </div>
  )
}

export default function App() {
  useEffect(() => {
    initTema()
  }, [])
  // Selesai = Firebase siap dimuat (selain status 'loading' Auth)
  const fbReady = isFirebaseConfigured()
  const { status, user, error } = useAuth()
  const [splashReady, setSplashReady] = useState(false)
  const [uidBersih, setUidBersih] = useState('')

  // Begitu auth selesai ditentukan (user login / unauth / error),
  // splash langsung ditandai siap agar Shell/AuthScreen dapat dimount.
  // Splash.jsx mengontrol durasi minimum agar tidak flicker.
  useEffect(() => {
    if (!fbReady) {
      setSplashReady(true)
      return
    }
    if (status === 'loading') return
    setSplashReady(true)
  }, [fbReady, status])

  // Isolasi antar-akun di perangkat bersama: bila UID yang login berbeda dengan
  // pemilik cache IndexedDB terakhir, bersihkan cache lokal + preferensi sebelum
  // Shell membuka langganan agar tidak ada sisa data pengguna sebelumnya.
  useEffect(() => {
    const uid = user?.uid
    if (!uid) {
      setUidBersih('')
      return
    }
    if (IS_DEMO_UID(uid)) {
      setUidBersih(uid)
      return
    }
    let batal = false
    try {
      const lastUid = localStorage.getItem('myduit:last_uid')
      const cleaned = sessionStorage.getItem('myduit-uid-clean') === uid
      if (lastUid && lastUid !== uid && !cleaned) {
        sessionStorage.setItem('myduit-uid-clean', uid)
        KUNCI_PREF_SESI.forEach((k) => localStorage.removeItem(k))
        localStorage.setItem('myduit:last_uid', uid)
        const { db } = getFirebase()
        terminate(db)
          .then(() => clearIndexedDbPersistence(db))
          .catch((e) => console.warn('[isolasi-sesi] bersihkan IndexedDB gagal:', e?.message ?? e))
          .finally(() => {
            if (!batal) window.location.reload()
          })
        return () => {
          batal = true
        }
      }
      localStorage.setItem('myduit:last_uid', uid)
    } catch {
      // Storage diblokir — tetap lanjutkan render
    }
    setUidBersih(uid)
    return () => {
      batal = true
    }
  }, [user?.uid])

  // Migrasi anti-redundansi sekali per user (hanya saat splash sudah lewat
  // supaya tidak memblokir loading utama).
  useEffect(() => {
    if (!user?.uid || IS_DEMO_UID(user.uid) || uidBersih !== user.uid) return
    const flag = `myduit-migrasi-norm-${user.uid}`
    try {
      if (localStorage.getItem(flag)) return
      migrasiNormalisasi(user.uid)
        .then(() => localStorage.setItem(flag, '1'))
        .catch((e) => console.warn('[migrasi] ditunda:', e?.message ?? e))
    } catch {
      /* abaikan */
    }
  }, [user?.uid, uidBersih])

  return (
    <>
      <Splash ready={splashReady} />
      {/* Dipasang di root, bukan di Shell: toast juga harus hidup saat splash,
          halaman login, dan layar setup — justru di situ error konfigurasi dan
          kegagalan login paling mungkin terjadi. */}
      <ToastHost />
      {splashReady && (
        !fbReady ? (
          <LayarSetup error="Salin .env.example menjadi .env.local lalu isi nilai Firebase, kemudian jalankan ulang dev server." />
        ) : status === 'error' ? (
          <LayarSetup error={error} />
        ) : !user ? (
          <AuthScreen />
        ) : uidBersih === user.uid ? (
          // Satu langganan akun+kategori untuk seluruh modul (lihat
          // useAkunKategori.js). Dibungkus di sini, bukan di dalam Shell, supaya
          // tetap aktif saat tab berganti.
          <AkunKategoriProvider uid={user.uid}>
            <Shell user={user} />
          </AkunKategoriProvider>
        ) : null
      )}
    </>
  )
}
