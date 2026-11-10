import { IS_DEMO_UID, MOCK_UTANG } from '../../lib/mockData.js';
import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { formatRupiah, tanggalPendek } from '../../lib/format.js'
import { hapusUtang } from '../../lib/db.js'
import { getFirebase } from '../../lib/firebase.js'
import { useAkunKategori } from '../../lib/useAkunKategori.js'
import { BayarUtangModal, FormUtangModal } from './UtangModals.jsx'
import UtangMobile from './UtangMobile.jsx'

const FILTERS = [
  { id: 'semua', label: 'Semua' },
  { id: 'aktif', label: 'Aktif' },
  { id: 'lunas', label: 'Lunas' },
  { id: 'terlambat', label: 'Terlambat' },
]

function useUtangList(uid) {
  const [list, setList] = useState([])
  useEffect(() => {
    if (!uid) return
    if (IS_DEMO_UID(uid)) {
      setList(MOCK_UTANG);
      return () => {};
    }
    const { db } = getFirebase()
    const q = query(
      collection(db, 'users', uid, 'utang'),
      where('deleted', '==', false),
      orderBy('createdAt', 'desc'),
    )
    return onSnapshot(
      q,
      (snap) => setList(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setList([]),
    )
  }, [uid])
  return list
}

export function hitungJatuhTempoBulanan(iso, terakhirBayar, nowRef = new Date()) {
  if (!iso) return null
  const tglRef = new Date(`${iso}T00:00:00`)
  if (isNaN(tglRef.getTime())) return null
  const hariTgl = tglRef.getDate()
  const now = new Date(nowRef)
  now.setHours(0, 0, 0, 0)

  let sudahBayarBulanIni = false
  let targetYear = now.getFullYear()
  let targetMonth = now.getMonth()

  if (terakhirBayar) {
    const tglBayar = new Date(`${terakhirBayar}T00:00:00`)
    if (!isNaN(tglBayar.getTime())) {
      sudahBayarBulanIni =
        tglBayar.getFullYear() === now.getFullYear() && tglBayar.getMonth() === now.getMonth()
      if (sudahBayarBulanIni) {
        targetMonth = now.getMonth() + 1
      } else {
        // Jatuh tempo berikutnya adalah 1 bulan setelah pembayaran terakhir.
        // Bila bulan setelah pembayaran terakhir sudah lewat dari bulan berjalan,
        // pertahankan bulan tertunggak itu agar tetap terdeteksi Terlambat.
        const nextAfterBayar = tglBayar.getFullYear() * 12 + tglBayar.getMonth() + 1
        const currentYm = now.getFullYear() * 12 + now.getMonth()
        if (nextAfterBayar < currentYm) {
          targetYear = Math.floor(nextAfterBayar / 12)
          targetMonth = nextAfterBayar % 12
        }
      }
    }
  } else {
    // Belum pernah bayar: bila tanggal referensi jatuh tempo berada di bulan yang sudah lewat,
    // jangan direset ke bulan ini supaya tunggakan bulan lalu tetap terdeteksi terlambat.
    const refYm = tglRef.getFullYear() * 12 + tglRef.getMonth()
    const currentYm = now.getFullYear() * 12 + now.getMonth()
    if (refYm < currentYm) {
      targetYear = tglRef.getFullYear()
      targetMonth = tglRef.getMonth()
    }
  }

  const normYear = targetYear + Math.floor(targetMonth / 12)
  const normMonth = ((targetMonth % 12) + 12) % 12
  let target = new Date(normYear, normMonth, hariTgl)
  if (target.getMonth() !== normMonth) {
    target = new Date(normYear, normMonth + 1, 0)
  }

  return { target, sudahBayarBulanIni }
}

export function selisihHari(iso, tipe, terakhirBayar, nowRef = new Date()) {
  if (!iso) return null
  const now = new Date(nowRef)
  now.setHours(0, 0, 0, 0)

  if (tipe === 'Cicilan') {
    const info = hitungJatuhTempoBulanan(iso, terakhirBayar, now)
    if (!info?.target) return null
    return Math.round((info.target - now) / 86400000)
  }

  const target = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  return Math.round((target - now) / 86400000)
}

function infoJatuhTempo(iso, tipe, terakhirBayar) {
  if (!iso) return { teks: 'Tanpa jatuh tempo', cls: 'text-slate-500', hari: null }
  const d = selisihHari(iso, tipe, terakhirBayar)
  const tglRef = new Date(`${iso}T00:00:00`)
  const hariTgl = !isNaN(tglRef.getTime()) ? tglRef.getDate() : ''

  if (tipe === 'Cicilan') {
    const info = hitungJatuhTempoBulanan(iso, terakhirBayar)
    if (info?.sudahBayarBulanIni) {
      return { teks: `Bulan ini lunas • Tempo brikutnya tgl ${hariTgl} (${d} hr lagi)`, cls: 'text-incomeText font-bold', hari: d }
    }
    const awalan = `Tempo bulanan tgl ${hariTgl}`
    if (d < 0) return { teks: `${awalan} (Telat ${-d} hari)`, cls: 'text-expenseText font-bold', hari: d }
    if (d === 0) return { teks: `${awalan} (Hari ini!)`, cls: 'text-expenseText font-bold', hari: d }
    if (d <= 7) return { teks: `${awalan} (H-${d})`, cls: 'text-warning font-bold', hari: d }
    return { teks: `${awalan} (${d} hari lagi)`, cls: 'text-slate-500', hari: d }
  }

  const awalan = `Jatuh tempo ${tanggalPendek(iso)}`
  if (d < 0) return { teks: `${awalan} (Telat ${-d} hari)`, cls: 'text-expenseText font-bold', hari: d }
  if (d === 0) return { teks: `${awalan} (Hari ini!)`, cls: 'text-expenseText font-bold', hari: d }
  if (d <= 7) return { teks: `${awalan} (H-${d})`, cls: 'text-warning font-bold', hari: d }
  return { teks: `${awalan} (${d} hari lagi)`, cls: 'text-slate-500', hari: d }
}

export function cekLunasUtang(t) {
  if (!t) return false
  return String(t.status || '').trim().toLowerCase() === 'lunas' || (Number(t.sisa) || 0) <= 0
}

export function KartuUtang({ t, onBayar, onLunasin, onEdit, onHapus }) {
  const lunas = cekLunasUtang(t)
  const totalUtang = Math.max(0, Number(t.total) || 0)
  const sisaUtang = lunas ? 0 : Math.max(0, Number(t.sisa) || 0)
  const terbayar = Math.max(0, totalUtang - sisaUtang)
  const persen = totalUtang > 0 ? Math.min(100, Math.round((terbayar / totalUtang) * 100)) : 0
  const hari = lunas ? null : selisihHari(t.tglJatuhTempo, t.tipe, t.terakhirBayar)
  const terlambat = hari !== null && hari < 0
  const mendekati = hari !== null && hari >= 0 && hari <= 7
  const jatuh = lunas ? { teks: 'Sudah lunas', cls: 'text-slate-500' } : infoJatuhTempo(t.tglJatuhTempo, t.tipe, t.terakhirBayar)

  const labelStatus = lunas ? 'Lunas' : terlambat ? 'Terlambat' : mendekati ? 'Segera' : 'Aktif'
  const badgeCls = lunas
    ? 'text-[#36AE7C] bg-emerald-500/12 border border-emerald-500/25'
    : terlambat
      ? 'text-[#EB5353] bg-red-50'
      : mendekati
        ? 'text-[#D4AF0D] bg-amber-50'
        : 'text-[#187498] bg-blue-50'

  return (
    <div
      className={`neu-card rounded-2xl p-4.5 relative transition-all bg-[#E5E5E5] ${lunas ? 'is-lunas' : ''}`}
    >

      {/* Baris atas: nama + badge + aksi */}
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-extrabold leading-snug text-slate-800" title={t.namaPihak}>{t.namaPihak}</p>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className={`neu-chip px-2.5 py-0.5 text-[10px] font-extrabold rounded-full inline-flex items-center gap-1 ${badgeCls}`}>
              {lunas && <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>}
              {labelStatus}
            </span>
            <span className="truncate text-[11px] font-semibold text-slate-500">
              {t.tipe}
              {t.tipe === 'Cicilan' && t.cicilanPerBulan > 0 ? ` · ${formatRupiah(t.cicilanPerBulan)}/bln` : ''}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          <button onClick={onEdit} aria-label="Edit utang" className="neu-btn flex h-7.5 w-7.5 items-center justify-center rounded-xl bg-[#E5E5E5] text-slate-600 transition-all hover:text-slate-900 active:scale-95">
            <span className="material-symbols-outlined icon-xs">edit</span>
          </button>
          <button onClick={onHapus} aria-label="Hapus utang" className="neu-btn flex h-7.5 w-7.5 items-center justify-center rounded-xl bg-[#E5E5E5] text-slate-600 transition-all hover:text-[#EB5353] active:scale-95">
            <span className="material-symbols-outlined icon-xs">delete</span>
          </button>
        </div>
      </div>

      {/* Fokus utama: sisa utang */}
      <div className="mt-3.5 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sisa utang</p>
          <p className={`whitespace-nowrap font-mono text-2xl font-black leading-none tracking-tight tabular-nums ${lunas ? 'text-[#36AE7C]' : 'text-slate-800'}`}>
            {formatRupiah(sisaUtang)}
          </p>
          <p className="mt-1 whitespace-nowrap text-[11px] font-semibold text-slate-500">dari {formatRupiah(totalUtang)}</p>
        </div>
        {!lunas && (
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={onLunasin} className="neu-btn h-9 px-3.5 rounded-xl bg-[#E5E5E5] text-slate-700 font-bold text-xs transition-all active:scale-95">Lunasin</button>
            <button onClick={onBayar} className="neu-btn-primary solid-primary h-9 px-4 rounded-xl text-white font-bold text-xs transition-all active:scale-95">Bayar</button>
          </div>
        )}
      </div>

      {/* Progres + jatuh tempo */}

      <div className="mt-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full neu-inset bg-[#E5E5E5]">
          <div className={`h-full rounded-full transition-all ${lunas ? 'bg-[#36AE7C]' : terlambat ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, persen)}%` }} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px]">
          <span className="whitespace-nowrap font-medium text-slate-500">Terbayar {formatRupiah(terbayar)} ({persen}%)</span>
          <span className={`inline-flex items-center gap-0.5 font-bold ${lunas ? 'text-[#36AE7C]' : jatuh.cls}`}>
            {terlambat && <span className="material-symbols-outlined icon-xs">error</span>}
            {lunas && <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>task_alt</span>}
            {lunas ? 'Sudah lunas' : jatuh.teks}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function UtangView({ user }) {
  const uid = user.uid
  const list = useUtangList(uid)
  const { akunList } = useAkunKategori(uid)
  const [filter, setFilter] = useState('semua')
  const [formModal, setFormModal] = useState({ open: false, edit: null, mode: 'utang' })

  // Listen event dari FAB bottom nav (Tambah Utang)
  useEffect(() => {
    const handler = () => setFormModal({ open: true, edit: null, mode: 'utang' })
    window.addEventListener('myduit:buka-tambah-utang', handler)
    return () => window.removeEventListener('myduit:buka-tambah-utang', handler)
  }, [])
  const [bayarModal, setBayarModal] = useState({ open: false, utang: null, lunasin: false })
  const [hapusTarget, setHapusTarget] = useState(null)

  // Event dari panel kanan Aksi Cepat
  useEffect(() => {
    function onAdd(e) {
      setFormModal({ open: true, edit: null, mode: e.detail?.mode ?? 'utang' })
    }
    window.addEventListener('myduit:utang-add', onAdd)
    return () => window.removeEventListener('myduit:utang-add', onAdd)
  }, [])

  const tampil = useMemo(() => {
    if (filter === 'aktif') return list.filter((t) => !cekLunasUtang(t))
    if (filter === 'lunas') return list.filter((t) => cekLunasUtang(t))
    if (filter === 'terlambat') return list.filter((t) => !cekLunasUtang(t) && selisihHari(t.tglJatuhTempo, t.tipe, t.terakhirBayar) < 0)
    return list
  }, [list, filter])

  // Urutan tampil: yang PERLU PERHATIAN lebih dulu. Sebelumnya daftar mengikuti
  // urutan createdAt (terbaru dulu) sehingga utang yang sudah terlambat justru
  // berada di paling bawah — user harus scroll untuk melihat hal mendesak.
  // Prioritas: 1) terlambat (paling lama telat dulu), 2) mendekati jatuh tempo,
  // 3) aktif tanpa jatuh tempo, 4) lunas (di akhir, terbaru dulu).
  const terurut = useMemo(() => {
    const bobot = (t) => {
      const lunas = cekLunasUtang(t)
      if (lunas) return 3
      const h = selisihHari(t.tglJatuhTempo, t.tipe, t.terakhirBayar)
      if (h === null) return 2
      if (h < 0) return 0
      return 1
    }
    return [...tampil].sort((a, b) => {
      const ba = bobot(a), bb = bobot(b)
      if (ba !== bb) return ba - bb
      // Di grup yang sama: paling mendesak (hari terkecil) dulu.
      const ha = selisihHari(a.tglJatuhTempo, a.tipe, a.terakhirBayar)
      const hb = selisihHari(b.tglJatuhTempo, b.tipe, b.terakhirBayar)
      if (ha !== null && hb !== null && ha !== hb) return ha - hb
      if (ha !== null && hb === null) return -1
      if (ha === null && hb !== null) return 1
      // Lunas: nominal terbesar dulu agar tidak terasa acak.
      return (b.sisa || 0) - (a.sisa || 0)
    })
  }, [tampil])

  const ringkasan = useMemo(() => {
    let totalSisa = 0, totalAwal = 0, cicilanAktif = 0, lunasCount = 0, totalLunasNominal = 0, totalCicilanPerBulan = 0
    const aktif = []
    for (const t of list) {
      const l = cekLunasUtang(t)
      const tot = Math.max(0, Number(t.total) || 0)
      const sisa = Math.max(0, Number(t.sisa) || 0)
      totalAwal += tot
      if (l) {
        lunasCount++
        totalLunasNominal += tot
      } else {
        totalSisa += sisa
        aktif.push(t)
        if (t.tipe === 'Cicilan') {
          cicilanAktif++
          totalCicilanPerBulan += Math.max(0, Number(t.cicilanPerBulan) || 0)
        }
      }
    }
    const terbayar = Math.max(0, totalAwal - totalSisa)
    const persenLunas = totalAwal > 0 ? Math.min(100, Math.round((terbayar / totalAwal) * 100)) : 0
    const jatuhTempo = aktif
      .filter((t) => t.tglJatuhTempo)
      .map((t) => ({ id: t.id, nama: t.namaPihak, sisa: Math.max(0, Number(t.sisa) || 0), hari: selisihHari(t.tglJatuhTempo, t.tipe, t.terakhirBayar) }))
      .filter((t) => t.hari !== null)
      .sort((a, b) => a.hari - b.hari)
    return {
      totalSisa, totalAwal, terbayar, persenLunas,
      cicilanAktif, lunasCount, totalLunasNominal,
      aktifCount: aktif.length,
      totalCicilanPerBulan,
      rataPerBulan: aktif.length ? Math.round(totalCicilanPerBulan / Math.max(1, cicilanAktif)) : 0,
      jatuhTempo,
      aktif,
    }
  }, [list])

  // Emit ke sidebar kanan + sidebar kiri
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('myduit:utang-update', { detail: ringkasan }))

    // Perkiraan Bebas Utang (formula GAS): totalSisa / totalCicilanPerBulan
    let bulanEstimasi
    let perkiraan
    if (ringkasan.aktifCount === 0) {
      perkiraan = 'Belum ada utang/cicilan aktif.'
    } else if (ringkasan.totalCicilanPerBulan > 0) {
      bulanEstimasi = Math.max(1, Math.ceil(ringkasan.totalSisa / ringkasan.totalCicilanPerBulan))
      const d = new Date()
      d.setMonth(d.getMonth() + bulanEstimasi)
      perkiraan = `≈ ${d.toLocaleString('id-ID', { month: 'long', year: 'numeric' })}`
    } else {
      perkiraan = 'Perkiraan butuh cicilan per bulan.'
    }
    const terbesar = ringkasan.aktif.slice().sort((a, b) => (b.sisa || 0) - (a.sisa || 0))[0] || null
    window.dispatchEvent(new CustomEvent('myduit:sidebar-utang-update', {
      detail: {
        bulanEstimasi,
        perkiraan,
        terbesar: terbesar ? { nama: terbesar.namaPihak, sisa: terbesar.sisa || 0, jatuh: terbesar.tglJatuhTempo } : null,
      },
    }))
  }, [ringkasan])

  async function konfirmHapus() {
    if (!hapusTarget) return
    const target = hapusTarget
    setHapusTarget(null)
    try {
      await hapusUtang(uid, target.id)
    } catch (e) {
      console.warn('[utang-hapus] gagal:', e?.message ?? e)
      window.dispatchEvent(new CustomEvent('myduit:toast', { detail: { type: 'error', msg: 'Gagal menghapus utang.' } }))
    }
  }

  // Aksi bersama untuk kartu desktop maupun mobile — satu sumber agar
  // perilaku kedua tampilan tidak pernah menyimpang.
  const aksiKartu = {
    onBayar: (t) => setBayarModal({ open: true, utang: t, lunasin: false }),
    onLunasin: (t) => setBayarModal({ open: true, utang: t, lunasin: true }),
    onEdit: (t) => setFormModal({ open: true, edit: t, mode: t.tipe === 'Cicilan' ? 'cicilan' : 'utang' }),
    onHapus: (t) => setHapusTarget(t),
  }

  return (
    <>
      {/* ===== TAMPILAN MOBILE (dipisah, pakai pager 1 kartu/halaman) =====
          Desain berbeda dari desktop dengan sengaja: di mobile layar sempit,
          jadi daftar memakai penggal supaya seluruh layar pas tanpa scroll. */}
      <UtangMobile
        ringkasan={ringkasan}
        terurut={terurut}
        filter={filter}
        setFilter={setFilter}
        onBayar={aksiKartu.onBayar}
        onLunasin={aksiKartu.onLunasin}
        onEdit={aksiKartu.onEdit}
        onHapus={aksiKartu.onHapus}
      />

      {/* ===== TAMPILAN DESKTOP (grid 2 kolom, semua kartu tampil) ===== */}
      <section className="mx-auto hidden max-w-3xl px-5 pb-20 pt-4 md:block">
      {/* Ringkasan 3 kartu (desktop) */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="neu-card rounded-2xl p-4 bg-[#E5E5E5]">
          <div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2"><div className="clay-icon-tile flex h-8 w-8 items-center justify-center rounded-xl bg-[#E5E5E5] text-[#EB5353]"><span className="material-symbols-outlined icon-md" style={{ fontVariationSettings: "'FILL' 1" }}>receipt_long</span></div><p className="text-xs font-bold uppercase tracking-wider text-slate-600">Total Utang</p></div><span className="neu-inset text-[10px] font-bold px-2 py-0.5 rounded-full text-[#EB5353] bg-[#E5E5E5]">{ringkasan.aktifCount} aktif</span></div>
          <p className="font-mono text-xl font-black tracking-tight text-[#EB5353] tabular-nums lg:text-2xl mt-1">{formatRupiah(ringkasan.totalSisa)}</p>

        </div>
        <div className="neu-card rounded-2xl p-4 bg-[#E5E5E5]">
          <div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2"><div className="clay-icon-tile flex h-8 w-8 items-center justify-center rounded-xl bg-[#E5E5E5] text-[#36AE7C]"><span className="material-symbols-outlined icon-md" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span></div><p className="text-xs font-bold uppercase tracking-wider text-slate-600">Lunas</p></div><span className="neu-inset text-[10px] font-bold px-2 py-0.5 rounded-full text-[#36AE7C] bg-[#E5E5E5]">{ringkasan.lunasCount} item lunas</span></div>
          <p className="font-mono text-xl font-black tracking-tight text-[#36AE7C] tabular-nums lg:text-2xl mt-1">{formatRupiah(ringkasan.totalLunasNominal)}</p>

        </div>
        <div className="neu-card rounded-2xl p-4 bg-[#E5E5E5]">
          <div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2"><div className="clay-icon-tile flex h-8 w-8 items-center justify-center rounded-xl bg-[#E5E5E5] text-[#187498]"><span className="material-symbols-outlined icon-md" style={{ fontVariationSettings: "'FILL' 1" }}>schedule</span></div><p className="text-xs font-bold uppercase tracking-wider text-slate-600">Cicilan Aktif</p></div><span className="neu-inset text-[10px] font-bold px-2 py-0.5 rounded-full text-[#187498] bg-[#E5E5E5]">{formatRupiah(ringkasan.totalCicilanPerBulan)}/bln</span></div>
          <p className="font-mono text-xl font-black tracking-tight text-[#187498] tabular-nums lg:text-2xl mt-1">{ringkasan.cicilanAktif}</p>

        </div>
      </div>

      {/* Filter desktop + mobile */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.id
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`h-8.5 px-3.5 text-xs font-bold rounded-xl transition-all ${
                active
                  ? f.id === 'terlambat'
                    ? 'neu-well text-[#EB5353]'
                    : 'neu-well text-[#36AE7C]'
                  : 'neu-btn bg-[#E5E5E5] text-slate-600 hover:text-slate-900 active:scale-95'
              }`}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {/* Daftar utang (desktop): 2 kolom. Tampilan mobile ada di
          UtangMobile.jsx — sengaja dipisah karena di mobile memakai pager
          satu-kartu-per-halaman agar seluruh layar pas tanpa scroll. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {terurut.length === 0 ? (
          <div className="clay-card-soft flex flex-col items-center px-6 py-14 text-center col-span-2">
            <span className="material-symbols-outlined mb-2 text-5xl text-primary/30">payments</span>
            <p className="text-sm font-bold text-slate-700">Belum ada utang/cicilan</p>
            <p className="mt-1 text-xs text-slate-500">Tekan tombol + untuk mencatat yang pertama.</p>
          </div>
        ) : (
          terurut.map((t) => (
            <KartuUtang
              key={t.id}
              t={t}
              onBayar={() => aksiKartu.onBayar(t)}
              onLunasin={() => aksiKartu.onLunasin(t)}
              onEdit={() => aksiKartu.onEdit(t)}
              onHapus={() => aksiKartu.onHapus(t)}
            />
          ))
        )}
      </div>
    </section>

      {/* Modal & dialog dipakai BERSAMA oleh tampilan mobile dan desktop,
          jadi letaknya di luar <section> desktop. */}
      <FormUtangModal
        key={`utang-form-${formModal.open ? formModal.edit?.id ?? formModal.mode : 'closed'}`}
        open={formModal.open}
        edit={formModal.edit}
        mode={formModal.mode}
        uid={uid}
        onClose={() => setFormModal({ open: false, edit: null, mode: 'utang' })}
      />
      <BayarUtangModal
        key={`utang-bayar-${bayarModal.open ? bayarModal.utang?.id ?? 'open' : 'closed'}`}
        open={bayarModal.open}
        utang={bayarModal.utang}
        lunasin={bayarModal.lunasin}
        uid={uid}
        akunList={akunList}
        onClose={() => setBayarModal({ open: false, utang: null, lunasin: false })}
      />

      {hapusTarget && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={() => setHapusTarget(null)}>
          <div className="neu-card w-full max-w-xs rounded-3xl bg-[#E5E5E5] p-5 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl neu-inset text-[#EB5353]">
              <span className="material-symbols-outlined text-3xl">delete</span>
            </div>
            <p className="mt-3 text-sm font-extrabold text-slate-800">Hapus “{hapusTarget.namaPihak}”?</p>
            <p className="mt-1 text-xs text-slate-500">Riwayat pembayaran yang sudah tercatat tetap ada.</p>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <button onClick={() => setHapusTarget(null)} className="neu-btn btn-md text-xs font-bold text-slate-700 bg-[#E5E5E5] rounded-xl active:scale-95">Batal</button>
              <button onClick={konfirmHapus} className="neu-btn-danger btn-md text-xs font-bold rounded-xl active:scale-95">Hapus</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
