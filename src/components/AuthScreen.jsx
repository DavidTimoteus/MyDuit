import { GoogleAuthProvider, signInWithCredential, signInWithPopup } from 'firebase/auth'
import { useState } from 'react'
import { getFirebase, googleProvider } from '../lib/firebase.js'

const PESAN_ERROR = {
  'auth/popup-closed-by-user': 'Jendela login ditutup sebelum selesai.',
  'auth/cancelled-popup-request': 'Jendela login ditutup sebelum selesai.',
  'auth/popup-blocked': 'Popup diblokir browser — izinkan popup lalu coba lagi.',
  'auth/network-request-failed': 'Koneksi internet bermasalah. Coba lagi.',
  'auth/configuration-not-found':
    'Metode login Google belum diaktifkan di Firebase Console (Authentication → Sign-in method).',
  'auth/operation-not-allowed':
    'Metode login Google belum diaktifkan di Firebase Console (Authentication → Sign-in method).',
  'auth/unauthorized-domain':
    'Domain ini belum diizinkan. Tambahkan di Firebase Console → Authentication → Settings → Authorized domains.',
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  )
}

export default function AuthScreen() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function masuk() {
    if (!navigator.onLine) {
      setError('Login pertama butuh koneksi internet. Nanti setelah masuk, app jalan offline.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const { auth } = getFirebase()
      const desktop = typeof window !== 'undefined' ? window.myduitDesktop : null
      if (desktop?.hasLoopbackClient && typeof desktop.loginGoogleLoopback === 'function') {
        const res = await desktop.loginGoogleLoopback()
        if (!res?.idToken) throw new Error(res?.error || 'Login Google melalui browser batal.')
        const cred = GoogleAuthProvider.credential(res.idToken)
        await signInWithCredential(auth, cred)
      } else {
        await signInWithPopup(auth, googleProvider)
      }
      // onAuthStateChanged di App akan mengambil alih.
    } catch (e) {
      setError(PESAN_ERROR[e?.code] ?? e?.message ?? 'Gagal masuk. Coba lagi.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-6 bg-surface">
      <div className="clay-card w-full max-w-sm rounded-[32px] p-8 text-center">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl clay-hero text-4xl font-extrabold text-white">
          M
        </div>
        <h1 className="brand-title-embossed text-4xl sm:text-5xl font-black tracking-tight">MyDuit</h1>
        <p className="mt-1 text-sm font-semibold text-slate-500">Catat. Pantau. Kendalikan.</p>
        <p className="mt-4 text-sm leading-relaxed text-slate-500">
          Keuanganmu tersimpan aman di akunmu sendiri dan tetap bisa dibuka tanpa internet.
        </p>

        <button
          onClick={masuk}
          disabled={loading}
          className="clay-btn btn-lg mt-6 flex w-full items-center justify-center gap-3 text-sm font-bold text-slate-700 transition-all active:scale-[0.98] disabled:opacity-60"
        >
          {loading ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
          ) : (
            <GoogleIcon />
          )}
          {loading ? 'Membuka login…' : 'Masuk dengan Google'}
        </button>

        {error && (
          <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
            {error}
          </p>
        )}
      </div>
      <p className="mt-6 text-xs font-semibold text-textSecondary">
        Data hanya bisa diakses oleh akunmu — dijaga Firebase Security Rules.
      </p>
    </div>
  )
}
