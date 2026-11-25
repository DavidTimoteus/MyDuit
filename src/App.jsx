import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { signOut } from 'firebase/auth'
import { AppLockScreen } from './components/AppLockGate.jsx'
import AuthScreen from './components/AuthScreen.jsx'
import Splash from './components/Splash.jsx'
// BUN-02 (audit 25 Nov 2026) + R-01 Fase 5 re-audit: Shell hanya dipakai
// SETELAH login — lazy. Dulu db.js tetap ada di bundel awal karena efek
// App.jsx (migrasi/pembersih/inisialisasi basis) mengimpornya statis, dan
// firebase.js lama ikut menyeret SDK Firestore (577 kB) ke bundel login.
// Sekarang: db.js + firebase.js dimuat dinamis di dalam efek pasca-login,
// AkunKategoriProvider juga lazy (rantainya membawa firestore + db.js),
// dan jalur login hanya memakai firebaseApp.js (App + Auth saja).
const Shell = lazy(() => import('./components/Shell.jsx'))
const AkunKategoriProvider = lazy(() => import('./lib/AkunKategoriProvider.jsx'))
import ToastHost from './components/ToastHost.jsx'
import { useAuth } from './features/auth/useAuth.js'
import { IDLE_LOCK_MS, LS_APP_LOCK, isAppLockAktif } from './lib/appLock.js'
import { getFirebaseApp, isFirebaseConfigured } from './lib/firebaseApp.js'
import { IS_DEMO_UID } from './lib/mockData.js'
import { initTema } from './lib/theme.js'

const KUNCI_PREF_SESI = ['myduit_gemini_api_key', 'myduit_ocr_engine', 'myduit_ocr_puter_provider', 'myduit_ocr_endpoint', 'myduit_ocr_crop_mode', 'myduit:tx_chip', 'myduit:negara', 'myduit:kurs_basis', LS_APP_LOCK]

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
  const [terkunciPin, setTerkunciPin] = useState(() => isAppLockAktif())
  const hiddenAtRef = useRef(0)

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now()
      } else if (document.visibilityState === 'visible') {
        if (hiddenAtRef.current && Date.now() - hiddenAtRef.current >= IDLE_LOCK_MS && isAppLockAktif()) {
          setTerkunciPin(true)
        }
        hiddenAtRef.current = 0
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

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
        // R-01 Fase 5: Firestore dimuat dinamis — efek ini jalan pasca-login,
        // jadi tidak boleh menarik SDK-nya ke bundel awal.
        ;(async () => {
          try {
            const { getFirebase } = await import('./lib/firebase.js')
            const { terminate, clearIndexedDbPersistence } = await import('firebase/firestore')
            const { db } = getFirebase()
            await terminate(db)
            await clearIndexedDbPersistence(db)
          } catch (e) {
            console.warn('[isolasi-sesi] bersihkan IndexedDB gagal:', e?.message ?? e)
          } finally {
            if (!batal) window.location.reload()
          }
        })()
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

  // Inisialisasi basis mata uang akun & tarik kurs global live saat online
  // R-01 Fase 5: db.js dimuat dinamis — efek ini jalan pasca-login.
  useEffect(() => {
    if (!user?.uid || uidBersih !== user.uid) return
    import('./lib/db.js')
      .then(({ inisialisasiMataUangDasar }) => inisialisasiMataUangDasar(user.uid))
      .catch((e) => console.warn('[basis] ditunda:', e?.message ?? e))
  }, [user?.uid, uidBersih])

  // Migrasi anti-redundansi sekali per user (hanya saat splash sudah lewat
  // supaya tidak memblokir loading utama).
  // R-01 Fase 5: db.js dimuat dinamis — efek ini jalan pasca-login.
  useEffect(() => {
    if (!user?.uid || IS_DEMO_UID(user.uid) || uidBersih !== user.uid) return
    const flag = `myduit-migrasi-norm-${user.uid}`
    try {
      if (localStorage.getItem(flag)) return
      import('./lib/db.js')
        .then(({ migrasiNormalisasi }) => migrasiNormalisasi(user.uid))
        .then(() => localStorage.setItem(flag, '1'))
        .catch((e) => console.warn('[migrasi] ditunda:', e?.message ?? e))
    } catch {
      /* abaikan */
    }
  }, [user?.uid, uidBersih])

  // Bersihkan baris transaksi rusak (jumlah 0 tanpa kategori/akun) sekali per user.
  // R-01 Fase 5: db.js dimuat dinamis — efek ini jalan pasca-login.
  useEffect(() => {
    if (!user?.uid || IS_DEMO_UID(user.uid) || uidBersih !== user.uid) return
    const flag = `myduit-bersih-tx-rusak-${user.uid}`
    try {
      if (localStorage.getItem(flag)) return
      import('./lib/db.js')
        .then(({ bersihkanTransaksiRusak }) => bersihkanTransaksiRusak(user.uid))
        .then((n) => {
          localStorage.setItem(flag, '1')
          if (n > 0) console.info(`[bersih-tx] ${n} transaksi rusak disembunyikan`)
        })
        .catch((e) => console.warn('[bersih-tx] ditunda:', e?.message ?? e))
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
          terkunciPin && isAppLockAktif() ? (
            <AppLockScreen
              onUnlocked={() => setTerkunciPin(false)}
              onForgotSignOut={() => {
                // H-01 re-audit: "Lupa PIN" bukan sekadar keluar — cache lokal
                // (IndexedDB) ikut dihapus supaya data tidak bisa dibaca dari
                // perangkat sesudah sign-out, lalu halaman di-reload.
                // R-01 Fase 5: firebase.js dimuat dinamis (auth dari firebaseApp.js).
                setTerkunciPin(false)
                signOut(getFirebaseApp().auth)
                  .catch(() => {})
                  .finally(async () => {
                    try {
                      const { hapusCacheFirestoreLokal } = await import('./lib/firebase.js')
                      await hapusCacheFirestoreLokal()
                    } catch {
                      // Best-effort: reload tetap jalan supaya sesi bersih.
                    }
                    window.location.reload()
                  })
              }}
            />
          ) : (
            // Satu langganan akun+kategori untuk seluruh modul (lihat
            // useAkunKategori.js). Dibungkus di sini, bukan di dalam Shell, supaya
            // tetap aktif saat tab berganti. Provider-nya lazy (R-01 Fase 5) —
            // Suspense dipindah ke luar supaya chunk-nya bisa dimuat dulu.
            <Suspense fallback={<Splash ready={false} />}>
              <AkunKategoriProvider uid={user.uid}>
                <Shell user={user} />
              </AkunKategoriProvider>
            </Suspense>
          )
        ) : null
      )}
    </>
  )
}
