import { useEffect, useMemo, useRef, useState } from 'react'
import { formatRupiah } from '../../lib/format.js'
import { hapusAkun } from '../../lib/db.js'
import { useAkunKategori } from '../../lib/useAkunKategori.js'
import { useTransaksi } from '../transaksi/useTransaksi.js'
import FormRekeningModal from './FormRekeningModal.jsx'
import RiwayatMutasiModal from './RiwayatMutasiModal.jsx'

// Sub-tab Rekening: hero Total Saldo + pagination card-stack + daftar rekening.
// Paritas dengan GAS ViewBudget.html #budgetRekeningPanel + #rekeningPaginationControls.

function rangeBulanIni() {
  const d = new Date()
  const awal = new Date(d.getFullYear(), d.getMonth(), 1)
  const akhir = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const f = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  return { start: f(awal), end: f(akhir) }
}

// dd/MM/yyyy HH:mm (persis GAS). Firestore Timestamp punya .toDate(); serverTimestamp offline = null → skip.
function tanggalJam(at) {
  const d = at?.toDate ? at.toDate() : (at ? new Date(at) : null)
  if (!d || isNaN(d)) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// { teks, warna } untuk box "Perubahan Terakhir" (mengikuti getLogWarna_ GAS).
function logMutasi(m) {
  const delta = Number(m?.delta) || 0
  const ket = m?.keterangan || 'Perubahan'
  const tanda = delta >= 0 ? '+' : '-'
  const tglJam = tanggalJam(m?.at)
  const teks = `${tglJam ? tglJam + ' — ' : ''}${ket}: ${tanda}${formatRupiah(Math.abs(delta))}`
  let warna = 'text-slate-600'
  if (/pindah/i.test(ket)) warna = 'text-[#187498] font-bold'
  else if (delta < 0) warna = 'text-[#EB5353] font-bold'
  else if (delta > 0) warna = 'text-[#36AE7C] font-bold'
  return { teks, warna }
}

function getAkunVisual(tipe) {
  const t = (tipe || '').toLowerCase()
  if (t.includes('dompet') || t.includes('tunai') || t.includes('cash')) {
    return { icon: 'payments', bgCls: 'text-[#D4AF0D]' }
  }
  if (t.includes('ewallet') || t.includes('e-wallet') || t.includes('gopay') || t.includes('ovo') || t.includes('dana') || t.includes('shopee')) {
    return { icon: 'smartphone', bgCls: 'text-[#36AE7C]' }
  }
  if (t.includes('investasi') || t.includes('saham') || t.includes('kripto') || t.includes('reksadana')) {
    return { icon: 'trending_up', bgCls: 'text-[#187498]' }
  }
  return { icon: 'account_balance', bgCls: 'text-[#187498]' }
}

export default function RekeningPanel({ uid, transBulan: propTransBulan }) {
  const { akunList, kategoriList } = useAkunKategori(uid)
  const katById = useMemo(() => Object.fromEntries(kategoriList.map((k) => [k.id, k.nama])), [kategoriList])
  const rangeBulan = useMemo(rangeBulanIni, [])

  // Arus kas bulan berjalan — pakai propTransBulan dari BudgetView jika ada agar sinkron penuh dengan Statistik
  // dan tidak membuka listener useTransaksi tambahan yang mubazir.
  const { docs: fallbackTrans } = useTransaksi(propTransBulan ? null : uid, { range: rangeBulan, jenis: 'semua' })
  const transBulan = propTransBulan || fallbackTrans
  const arusBulan = useMemo(() => {
    let masuk = 0, keluar = 0
    for (const t of transBulan) {
      const jml = Number(t.jumlah) || 0
      if (t.jenis === 'pemasukan') masuk += jml
      else if (t.jenis === 'pengeluaran') keluar += jml
    }
    return { masuk, keluar }
  }, [transBulan])

  const [modal, setModal] = useState({ open: false, edit: null })

  // Listen event buka tambah rekening dari FAB bottom nav
  useEffect(() => {
    const handler = () => setModal({ open: true, edit: null })
    window.addEventListener('myduit:buka-tambah-rekening', handler)
    return () => window.removeEventListener('myduit:buka-tambah-rekening', handler)
  }, [])
  const [hapusTarget, setHapusTarget] = useState(null)
  // Detail perubahan (riwayat mutasi) per rekening — simpan id saja, akun
  // di-resolve ulang dari akunList supaya saldo yang dipakai selalu terkini.
  const [riwayatId, setRiwayatId] = useState(null)
  const akunRiwayat = useMemo(
    () => (riwayatId ? akunList.find((a) => a.id === riwayatId) ?? null : null),
    [riwayatId, akunList],
  )
  const [halaman, setHalaman] = useState(1)

  // Listen event global
  useEffect(() => {
    function onAdd() {
      setModal({ open: true, edit: null })
    }
    window.addEventListener('myduit:rekening-add', onAdd)
    return () => window.removeEventListener('myduit:rekening-add', onAdd)
  }, [])

  const total = akunList.reduce((s, a) => s + (Number(a.saldo) || 0), 0)
  const totalCards = akunList.length
  const activeIdx = halaman - 1

  // Gesture Touch / Swipe untuk card-stack mobile (persis GAS handleRekeningTouch)
  const touchStartY = useRef(null)
  const touchStartX = useRef(null)

  const handleTouchStart = (e) => {
    touchStartY.current = e.touches[0].clientY
    touchStartX.current = e.touches[0].clientX
  }

  const handleTouchEnd = (e) => {
    if (touchStartX.current === null || touchStartY.current === null) return
    const diffY = e.changedTouches[0].clientY - touchStartY.current
    const diffX = e.changedTouches[0].clientX - touchStartX.current
    touchStartY.current = null
    touchStartX.current = null

    // Hanya ganti kartu bila gesture benar-benar horizontal yang disengaja.
    // Jika pergerakan vertikal lebih dominan, biarkan layar scroll bebas (tidak intercept).
    if (Math.abs(diffX) > 32 && Math.abs(diffX) > Math.abs(diffY) * 1.2) {
      if (diffX < 0) {
        setHalaman((h) => (h < totalCards ? h + 1 : 1))
      } else {
        setHalaman((h) => (h > 1 ? h - 1 : totalCards))
      }
    }
  }

  async function konfirmHapus() {
    if (!hapusTarget) return
    const target = hapusTarget
    setHapusTarget(null)
    try {
      await hapusAkun(uid, target.id)
    } catch (e) {
      console.warn('[rekening-hapus] gagal:', e?.message ?? e)
      window.dispatchEvent(new CustomEvent('myduit:toast', { detail: { type: 'error', msg: 'Gagal menghapus rekening.' } }))
    }
  }

  return (
    <div>
      {/* Total Semua Saldo — kartu CLAY (bukan gradient biru).
          `bg-blue-600 text-white` dulu menimpa .clay dan merusak claymorphism
          (menjadi blok rata tanpa inset) serta berisiko white-on-white bila
          utility lain ikut menimpa. Sekarang identitas warna dibawa hero-blue
          (strip aksen) sementara teks tetap gelap di atas putih. */}
      <div className="neu-card mt-1 rounded-2xl p-4 md:p-5 md:flex md:items-center md:justify-between md:gap-6 min-h-[90px] md:min-h-[160px] bg-[#E5E5E5]">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <span
              className="material-symbols-outlined icon-md text-[#187498]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              account_balance_wallet
            </span>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-600 sm:text-sm">
              Total Semua Saldo
            </p>
          </div>
          <p className="font-mono mb-3 text-2xl font-black tracking-tight text-slate-900 tabular-nums md:text-3xl lg:text-4xl brand-title-embossed">
            {formatRupiah(total)}
          </p>
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
            <span className="material-symbols-outlined icon-xs text-slate-500">schedule</span>
            <span>
              Terakhir diperbarui:{' '}
              {new Date().toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'numeric',
                year: 'numeric',
              })}{' '}
              {new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
        {/* Arus kas bulan berjalan — Pemasukan/Pengeluaran */}
        <div className="mt-2.5 grid shrink-0 grid-cols-2 gap-2 md:mt-0 md:text-right md:grid-cols-1">
          <div className="neu-inset rounded-xl p-2 min-w-0">
            <p className="text-[11px] font-medium text-slate-500">Pemasukan bulan ini</p>
            <p className="font-mono text-sm font-black text-[#36AE7C] tabular-nums mt-0.5">
              {formatRupiah(arusBulan.masuk)}
            </p>
          </div>
          <div className="neu-inset rounded-xl p-2 min-w-0">
            <p className="text-[11px] font-medium text-slate-500">Pengeluaran bulan ini</p>
            <p className="font-mono text-sm font-black text-[#EB5353] tabular-nums mt-0.5">
              {formatRupiah(arusBulan.keluar)}
            </p>
          </div>
        </div>
      </div>

      {/* Pager horizontal — MOBILE ONLY.
          Di web rekening dirender sebagai grid penuh (lihat blok `rekeningList`
          di bawah: `hidden md:grid`), jadi pengguna sudah melihat SEMUA kartu
          tanpa perlu berpindah halaman. Pager "Halaman 1/7" di desktop hanya
          ruang kosong yang membingungkan — tombol panah dipakai tapi tidak ada
          "halaman" berikutnya karena semuanya sudah tampil. Swipe/gesture juga
          tidak ada di desktop (hanya touch), jadi paginator jadi
          one-way trap.
          Di mobile card-stack 1-kartu-per-layar, swipe adalah cara navigasi
          utama — pager menjadi penanda posisi yang berguna.
          Breakpoint: `md` (768px), sama dengan grid rekening. */}
      {totalCards > 1 && (
        <div className="mt-2 mb-1.5 flex items-center justify-center gap-2 md:hidden">
          <button
            type="button"
            onClick={() => setHalaman((h) => (h > 1 ? h - 1 : totalCards))}
            aria-label="Halaman sebelumnya"
            className="clay-pagination-arrow flex h-8 w-8 items-center justify-center rounded-full shrink-0 aspect-square bg-surfaceContainerLowest text-blue-700 shadow-sm transition-all active:scale-95"
          >
            <span className="material-symbols-outlined icon-md">chevron_left</span>
          </button>
          <span className="min-w-[84px] text-center text-[11px] font-semibold text-slate-600">Halaman {halaman}/{totalCards}</span>
          <button
            type="button"
            onClick={() => setHalaman((h) => (h < totalCards ? h + 1 : 1))}
            aria-label="Halaman berikutnya"
            className="clay-pagination-arrow flex h-8 w-8 items-center justify-center rounded-full shrink-0 aspect-square bg-surfaceContainerLowest text-blue-700 shadow-sm transition-all active:scale-95"
          >
            <span className="material-symbols-outlined icon-md">chevron_right</span>
          </button>
        </div>
      )}

      {/* ===== MOBILE ONLY: CARD-STACK SLIDER (Persis ViewBudget.html GAS #rekeningList) ===== */}
      {/* Wrapper card-stack: tinggi OTOMATIS mengikuti kartu TERDALAM
          (paling depan di stack), bukan angka tetap. Fixed 225px memotong
          kartu saat isi kartu tumbuh (nama panjang / saldo besar / log
          mutasi banyak baris) —card terdalam translateY(24px) sehingga butuh
          height = tinggiKartu + offsetStack. min-height tetap dipakai sebagai
          lantai supaya area tidak kolaps saat data kosong. */}
      <div
        id="rekeningList"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="rekening-stack-wrap relative mt-1 min-h-[210px] md:hidden"
        style={{ touchAction: 'pan-y' }}
      >
        {akunList.length === 0 ? (
          <div className="clay-card-soft flex flex-col items-center px-6 py-12 text-center">
            <span className="material-symbols-outlined mb-2 text-5xl text-primary/30">account_balance_wallet</span>
            <p className="text-sm font-bold text-slate-700">Belum ada rekening</p>
            <p className="mt-1 text-xs text-slate-500">Tekan tombol + untuk menambah.</p>
          </div>
        ) : (
          akunList.map((a, i) => {
            let delta = i - activeIdx
            if (totalCards > 2) {
              if (delta > totalCards / 2) delta -= totalCards
              if (delta < -totalCards / 2) delta += totalCards
            }

            // Semua cabang di bawah menetapkan transform/opacity/zIndex, jadi
            // nilai awalnya tidak pernah terbaca — cukup deklarasikan tanpa
            // inisialisasi. pointerEvents TIDAK selalu ditetapkan (cabang
            // delta<0 memakai default), jadi ia tetap butuh nilai awal.
            let transform
            let opacity
            let zIndex
            let pointerEvents = 'none'

            if (delta < 0) {
                      transform = 'translateX(-110%) rotate(-3deg) scale(0.95)'
                      opacity = 0
                      zIndex = 10
                    } else if (delta === 0) {
                      transform = 'translateX(0px) translateY(0px) rotate(0deg) scale(1)'
                      opacity = 1
                      zIndex = 30
                      pointerEvents = 'auto'
                    } else if (delta <= 3) {
                      transform = `translateY(${delta * 12}px) scale(${1 - delta * 0.035})`
                      opacity = 1
                      zIndex = 30 - delta
                    } else {
                      transform = `translateY(${3 * 12}px) scale(${1 - 3 * 0.035})`
                      opacity = 0
                      zIndex = 1
                    }

            const negatif = (Number(a.saldo) || 0) < 0
            const log = a.mutasiTerakhir ? logMutasi(a.mutasiTerakhir) : null

            return (
              <div
                key={a.id}
                className={`rekening-stack-card clay clay-card ${
                  negatif ? 'clay-key-danger' : 'clay-key-blue'
                } ${delta === 0 ? 'relative' : 'absolute'} inset-x-1.5 top-1.5 rounded-[22px] bg-[#E5E5E5] p-3.5 select-none min-h-[195px]`}
                style={{
                  transform,
                  opacity,
                  zIndex,
                  pointerEvents,
                  willChange: 'transform, opacity',
                  transition: 'transform 380ms cubic-bezier(0.22, 1, 0.36, 1), opacity 300ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 300ms ease',
                  boxShadow:
                    delta === 0
                      ? '-6px -6px 14px rgba(255, 255, 255, 0.85), 6px 6px 16px rgba(0, 0, 0, 0.15)'
                      : '-3px -3px 8px rgba(255, 255, 255, 0.70), 3px 3px 8px rgba(0, 0, 0, 0.10)',
                }}
              >
                {delta === 0 ? (
                  <>
                    {/* Header Kartu — Ikon bank kecil bulat biru + nama + badge tipe + aksi */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="clay-icon-tile flex h-8 w-8 items-center justify-center rounded-xl bg-[#E5E5E5] shrink-0">
                          <span className={`material-symbols-outlined icon-xs ${getAkunVisual(a.tipe).bgCls}`} style={{ fontVariationSettings: "'FILL' 1" }}>
                            {getAkunVisual(a.tipe).icon}
                          </span>
                        </div>
                        <span className="font-bold text-base text-slate-800 truncate">{a.nama}</span>
                      </div>
                      {a.tipe && (
                        <span className="neu-inset text-[10px] px-2.5 py-0.5 rounded-full font-bold text-[#187498] shrink-0 whitespace-nowrap ml-auto bg-[#E5E5E5]">
                          {a.tipe}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setRiwayatId(a.id) }}
                        title="Detail perubahan rekening"
                        aria-label={`Detail perubahan ${a.nama}`}
                        className="neu-btn w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 hover:text-[#187498] bg-[#E5E5E5] transition-all shrink-0 active:scale-95"
                      >
                        <span className="material-symbols-outlined icon-xs">history</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setModal({ open: true, edit: a }) }}
                        title="Edit rekening"
                        aria-label="Edit rekening"
                        className="neu-btn w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-800 bg-[#E5E5E5] transition-all shrink-0 active:scale-95"
                      >
                        <span className="material-symbols-outlined icon-xs">edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setHapusTarget(a) }}
                        title="Hapus rekening"
                        aria-label="Hapus rekening"
                        className="neu-btn w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 hover:text-[#EB5353] bg-[#E5E5E5] transition-all shrink-0 active:scale-95"
                      >
                        <span className="material-symbols-outlined icon-xs">delete</span>
                      </button>
                    </div>

                    {/* Saldo Akhir */}
                    <div className="mb-2">
                      <p className="text-xs text-slate-500">Saldo Akhir</p>
                      <p className={`font-mono text-xl font-black ${negatif ? 'text-[#EB5353]' : 'text-slate-900'}`}>
                        {formatRupiah(a.saldo)}
                      </p>
                    </div>

                    {/* Perubahan Terakhir (full width box persis GAS rek-last-change-box).
                        Kotak ini sekaligus tombol -> buka detail riwayat mutasi rekening. */}
                    <button
                      type="button"
                      onClick={() => setRiwayatId(a.id)}
                      aria-label={`Lihat detail perubahan ${a.nama}`}
                      className="neu-well block w-full rounded-xl bg-[#E5E5E5] p-2.5 text-left transition-all active:scale-[0.99] focus:outline-none"
                    >
                      <span className="block text-xs font-semibold text-slate-500 mb-1">Perubahan Terakhir</span>
                      {log ? (
                        <>
                          <span className={`block text-xs ${log.warna} font-mono truncate`}>{log.teks}</span>
                          <div className="mt-1.5 flex items-center justify-between gap-1 text-[10px] text-[#187498]/90 font-medium">
                            <span className="flex items-center gap-0.5 truncate"><span className="material-symbols-outlined icon-2xs">touch_app</span>Ketuk riwayat</span>
                            <span className="flex items-center gap-0.5 shrink-0 text-slate-400"><span className="material-symbols-outlined icon-2xs">swipe</span>Geser kartu</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="block text-[10px] text-slate-500">Belum ada riwayat</span>
                          <div className="mt-1.5 flex items-center justify-between gap-1 text-[10px] text-[#187498]/90 font-medium">
                            <span className="flex items-center gap-0.5 truncate"><span className="material-symbols-outlined icon-2xs">history</span>Ketuk utk lihat detail rekening</span>
                            <span className="flex items-center gap-0.5 shrink-0 text-slate-400"><span className="material-symbols-outlined icon-2xs">swipe</span>Geser kartu</span>
                          </div>
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <div className="h-full min-h-[160px] w-full select-none" aria-hidden="true" />
                )}
              </div>
            )
          })
        )}
      </div>

      {/* ===== DESKTOP ONLY: REFINED NEUMORPHIC GRID LIST ===== */}
      <div className="hidden md:grid gap-3.5 mt-4 lg:grid-cols-2">
        {akunList.map((a) => {
          const negatif = (Number(a.saldo) || 0) < 0
          const log = a.mutasiTerakhir ? logMutasi(a.mutasiTerakhir) : null
          const visual = getAkunVisual(a.tipe)
          return (
            <div
              key={a.id}
              className="neu-card rounded-2xl p-4 bg-[#E5E5E5] transition-all duration-200 hover:shadow-[-6px_-6px_14px_rgba(255,255,255,0.9),6px_6px_16px_rgba(0,0,0,0.14)]"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="clay-icon-tile flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E5E5E5]">
                    <span className={`material-symbols-outlined icon-md ${visual.bgCls}`} style={{ fontVariationSettings: "'FILL' 1" }}>
                      {visual.icon}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-base text-slate-800 truncate" title={a.nama}>{a.nama}</p>
                    {a.tipe && (
                      <span className="neu-inset text-[10px] px-2.5 py-0.5 rounded-full bg-[#E5E5E5] font-bold text-slate-600 inline-block mt-0.5">
                        {a.tipe}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setRiwayatId(a.id)}
                    aria-label={`Detail perubahan ${a.nama}`}
                    title="Detail mutasi"
                    className="neu-btn flex h-8 w-8 items-center justify-center rounded-xl bg-[#E5E5E5] text-slate-500 hover:text-slate-800 active:scale-95 transition-all"
                  >
                    <span className="material-symbols-outlined icon-xs">history</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setModal({ open: true, edit: a })}
                    aria-label="Edit rekening"
                    title="Edit rekening"
                    className="neu-btn flex h-8 w-8 items-center justify-center rounded-xl bg-[#E5E5E5] text-slate-500 hover:text-slate-800 active:scale-95 transition-all"
                  >
                    <span className="material-symbols-outlined icon-xs">edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setHapusTarget(a)}
                    aria-label="Hapus rekening"
                    title="Hapus rekening"
                    className="neu-btn flex h-8 w-8 items-center justify-center rounded-xl bg-[#E5E5E5] text-slate-500 hover:text-[#EB5353] active:scale-95 transition-all"
                  >
                    <span className="material-symbols-outlined icon-xs">delete</span>
                  </button>
                </div>
              </div>
              <div className="mb-2.5">
                <p className="text-xs font-semibold text-slate-500">Saldo Akhir</p>
                <p className={`font-mono text-xl font-extrabold tracking-tight ${negatif ? 'text-[#EB5353]' : 'text-slate-800'}`}>
                  {formatRupiah(a.saldo)}
                </p>
              </div>
              {/* Kotak "Perubahan Terakhir" sekaligus tombol detail riwayat mutasi */}
              <button
                type="button"
                onClick={() => setRiwayatId(a.id)}
                aria-label={`Lihat detail perubahan ${a.nama}`}
                className="neu-well block w-full rounded-xl bg-[#E5E5E5] p-2.5 text-left transition-all active:scale-[0.99] focus:outline-none"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Perubahan Terakhir</span>
                  <span className="material-symbols-outlined icon-2xs text-slate-400">history</span>
                </div>
                <div className={`text-xs font-mono font-bold truncate ${log ? log.warna : 'text-slate-400'}`}>
                  {log ? log.teks : 'Belum ada riwayat'}
                </div>
              </button>
            </div>
          )
        })}
      </div>

      <FormRekeningModal
        open={modal.open}
        edit={modal.edit}
        uid={uid}
        onClose={() => setModal({ open: false, edit: null })}
      />

      {/* Detail perubahan rekening — mount hanya saat terbuka (state filter
          segar tiap kali dibuka, tanpa jebakan key+useState). */}
      {akunRiwayat && (
        <RiwayatMutasiModal
          uid={uid}
          akun={akunRiwayat}
          kategoriById={katById}
          onClose={() => setRiwayatId(null)}
        />
      )}

      {hapusTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-5 backdrop-blur-sm" onClick={() => setHapusTarget(null)}>
          <div className="clay-card w-full max-w-xs rounded-[24px] p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <span className="material-symbols-outlined text-4xl text-expenseText">delete</span>
            <p className="mt-2 text-sm font-bold text-slate-800">Hapus rekening “{hapusTarget.nama}”?</p>
            <p className="mt-1 text-xs text-slate-500">Riwayat transaksi lama tetap tersimpan.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => setHapusTarget(null)} className="clay-btn-soft btn-md text-xs font-bold text-slate-600">Batal</button>
              <button onClick={konfirmHapus} className="clay-btn-danger btn-md text-xs font-bold">Hapus</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
