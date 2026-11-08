import { useEffect, useState } from 'react'
import AuthScreen from './components/AuthScreen.jsx'
import Shell from './components/Shell.jsx'
import Splash from './components/Splash.jsx'
import ToastHost from './components/ToastHost.jsx'
import AkunKategoriProvider from './lib/AkunKategoriProvider.jsx'
import { useAuth } from './features/auth/useAuth.js'
import { isFirebaseConfigured } from './lib/firebase.js'
import { migrasiNormalisasi } from './lib/db.js'
import { initTema } from './lib/theme.js'

function LayarSetup(error) {
  return (
    <div className="min-h-full flex items-center justify-center bg-surface p-6">
      <div className="max-w-md rounded-3xl bg-white p-8 text-center shadow">
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

  // Fallback: kalau Firebase tidak terkonfigurasi, splash tampil 1.4s lalu LayarSetup
  // kalau OK, splash tunggu sampai Auth selesai (user loaded OR error)
  useEffect(() => {
    if (!fbReady) {
      const t = setTimeout(() => setSplashReady(true), 1400)
      return () => clearTimeout(t)
    }
    if (status === 'loading') return
    const t = setTimeout(() => setSplashReady(true), 1400)
    return () => clearTimeout(t)
  }, [fbReady, status])

  // Migrasi anti-redundansi sekali per user (hanya saat splash sudah lewat
  // supaya tidak memblokir loading utama).
  useEffect(() => {
    if (!user?.uid) return
    const flag = `myduit-migrasi-norm-${user.uid}`
    if (localStorage.getItem(flag)) return
    migrasiNormalisasi(user.uid)
      .then(() => localStorage.setItem(flag, '1'))
      .catch((e) => console.warn('[migrasi] ditunda:', e?.message ?? e))
  }, [user?.uid])

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
        ) : (
          // Satu langganan akun+kategori untuk seluruh modul (lihat
          // useAkunKategori.js). Dibungkus di sini, bukan di dalam Shell, supaya
          // tetap aktif saat tab berganti.
          <AkunKategoriProvider uid={user.uid}>
            <Shell user={user} />
          </AkunKategoriProvider>
        )
      )}
    </>
  )
}
