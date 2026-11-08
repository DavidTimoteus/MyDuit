import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * ToastHost — menampilkan notifikasi singkat (sukses / error / info).
 *
 * Mengapa ini krusial, bukan sekadar hiasan
 * -----------------------------------------
 * Aplikasi memakai pola Optimistic UI: modal ditutup SEGERA, lalu penulisan ke
 * Firestore berjalan di latar. Kalau penulisan gagal (offline, permission,
 * kuota), modal sudah tertutup dan user sudah mengira datanya tersimpan.
 *
 * Sebelum komponen ini ada, enam tempat mengirim event `myduit:toast` untuk
 * kegagalan simpan — transaksi, budget, rekening, pindah saldo, utang, dan
 * pembayaran utang — tetapi TIDAK ADA satu pun yang mendengarkan. Artinya
 * kegagalan apa pun lewat tanpa jejak: user melihat daftar tetap seperti semula
 * dan menyimpulkan "sudah tersimpan". Untuk aplikasi pencatatan keuangan itu
 * kehilangan data yang senyap.
 *
 * Aksesibilitas: setiap toast masuk ke satu live region ber-`role="status"`
 * (sukses/info) atau `role="alert"` (error) supaya pembaca layar
 * mengumumkannya tanpa merebut fokus.
 */

const DURASI = { error: 8000, success: 3500, info: 4500 }

const GAYA = {
  error: {
    wrap: 'clay-card clay-key-danger',
    tile: 'clay-icon-tile clay-key-danger',
    icon: 'error',
    judul: 'Gagal',
  },
  success: {
    wrap: 'clay-card clay-key-primary',
    tile: 'clay-icon-tile clay-key-primary',
    icon: 'check_circle',
    judul: 'Berhasil',
  },
  info: {
    wrap: 'clay-card clay-key-blue',
    tile: 'clay-icon-tile clay-key-blue',
    icon: 'info',
    judul: 'Info',
  },
}

export default function ToastHost() {
  const [items, setItems] = useState([])
  const timers = useRef(new Map())
  const idRef = useRef(0)

  const tutup = useCallback((id) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const buka = useCallback((detail) => {
    const type = ['error', 'success', 'info'].includes(detail?.type) ? detail.type : 'info'
    const msg = String(detail?.msg ?? '').trim()
    if (!msg) return

    const id = ++idRef.current
    // Maksimal 3 toast supaya layar mobile tidak tertutup tumpukan notifikasi.
    setItems((prev) => [...prev.slice(-2), { id, type, msg }])

    const timer = setTimeout(() => tutup(id), DURASI[type] ?? 4000)
    timers.current.set(id, timer)
  }, [tutup])

  useEffect(() => {
    const onToast = (e) => buka(e.detail)
    window.addEventListener('myduit:toast', onToast)
    // Salin ref ke variabel lokal: cleanup boleh jalan setelah render lain
    // mengganti `timers.current`, dan membaca `.current` langsung di cleanup
    // berarti membersihkan map yang salah (timer bocor).
    const peta = timers.current
    return () => {
      window.removeEventListener('myduit:toast', onToast)
      for (const t of peta.values()) clearTimeout(t)
      peta.clear()
    }
  }, [buka])

  // Live region harus SUDAH ada di DOM sebelum pesan masuk, kalau tidak
  // sebagian pembaca layar melewatkan pengumumannya.
  const error = items.find((t) => t.type === 'error')
  const lain = items.filter((t) => t.type !== 'error')

  return (
    <>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
        {error ? `${GAYA.error.judul}: ${error.msg}` : ''}
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {lain.map((t) => t.msg).join('. ')}
      </div>

      <div
        className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3 md:left-1/2 md:right-auto md:w-[420px] md:-translate-x-1/2"
        aria-hidden="true"
      >
        {items.map((t) => {
          const g = GAYA[t.type]
          return (
            <div
              key={t.id}
              className={`${g.wrap} pointer-events-auto flex w-full items-start gap-3 px-3.5 py-3`}
            >
              <span className={`${g.tile} flex h-9 w-9 shrink-0 items-center justify-center`}>
                <span className="material-symbols-outlined icon-md">{g.icon}</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">{g.judul}</p>
                <p className="mt-0.5 break-words text-[13px] font-semibold leading-snug text-slate-800">{t.msg}</p>
              </div>
              <button
                type="button"
                onClick={() => tutup(t.id)}
                aria-label="Tutup notifikasi"
                className="clay-chip flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
              >
                <span className="material-symbols-outlined icon-sm">close</span>
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
