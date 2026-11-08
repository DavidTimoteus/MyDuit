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
    return onSnapshot(q, (snap) => setList(snap.docs.map((d) => ({ id: d.id, ...d.data() }))))
  }, [uid])
  return list
}

function hitungJatuhTempoBulanan(iso, terakhirBayar) {
  if (!iso) return null
  const tglRef = new Date(`${iso}T00:00:00`)
  if (isNaN(tglRef.getTime())) return null
  const hariTgl = tglRef.getDate()
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  
  // Cek apakah bulan ini sudah ada pembayaran cicilan
  let sudahBayarBulanIni = false
  if (terakhirBayar) {
    const tglBayar = new Date(`${terakhirBayar}T00:00:00`)
    if (!isNaN(tglBayar.getTime())) {
      sudahBayarBulanIni = tglBayar.getFullYear() === now.getFullYear() && tglBayar.getMonth() === now.getMonth()
    }
  }

  // Jika sudah bayar bulan ini, target jatuh tempo berikutnya adalah bulan depan
  const targetMonth = sudahBayarBulanIni ? now.getMonth() + 1 : now.getMonth()
  const targetYear = now.getFullYear()
  
  let target = new Date(targetYear, targetMonth, hariTgl)
  if (target.getMonth() !== (targetMonth % 12)) {
    target = new Date(targetYear, targetMonth + 1, 0)
  }
  
  return { target, sudahBayarBulanIni }
}

function selisihHari(iso, tipe, terakhirBayar) {
  if (!iso) return null
  const now = new Date()
  now.setHours(0, 0, 0, 0)

  if (tipe === 'Cicilan') {
    const info = hitungJatuhTempoBulanan(iso, terakhirBayar)
    if (!info?.target) return null
    return Math.round((info.target - now) / 86400000)
  }

  const target = new Date(`${iso}T00:00:00`)
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

export function KartuUtang({ t, onBayar, onLunasin, onEdit, onHapus }) {
  const lunas = t.status === 'Lunas' || (t.sisa || 0) <= 0
  const terbayar = Math.max(0, (t.total || 0) - (t.sisa || 0))
  const persen = t.total > 0 ? Math.round((terbayar / t.total) * 100) : 0
  // BUG LAMA: utang yang sudah LUNAS tetap dihitung telat karena selisihHari
  // dijalankan tanpa memandang status → muncul "Terlambat 61 hari" di kartu lunas.
  // Jatuh tempo hanya relevan untuk utang yang belum lunas.
  const hari = lunas ? null : selisihHari(t.tglJatuhTempo, t.tipe, t.terakhirBayar)
  const terlambat = hari !== null && hari < 0
  const mendekati = hari !== null && hari >= 0 && hari <= 7
  const jatuh = lunas ? { teks: 'Sudah lunas', cls: 'text-slate-500' } : infoJatuhTempo(t.tglJatuhTempo, t.tipe, t.terakhirBayar)
  const clayKey = lunas ? 'clay-key-primary' : terlambat ? 'clay-key-danger' : 'clay-key-neutral'
  // Warna aksen kiri sebagai penanda status utama (satu sinyal kuat, bukan
  // tumpukan badge). Terlambat=merah, mendekati=amber, aktif=netral, lunas=hijau.
  const aksen = lunas ? 'bg-primary' : terlambat ? 'bg-red-500' : mendekati ? 'bg-amber-500' : 'bg-slate-300'
  const labelStatus = lunas ? 'Lunas' : terlambat ? 'Terlambat' : mendekati ? 'Segera' : 'Aktif'
  const warnaStatus = lunas
    ? 'bg-emerald-50 text-emerald-700'
    : terlambat
      ? 'bg-red-50 text-red-700'
      : mendekati
        ? 'bg-amber-50 text-amber-700'
        : 'bg-slate-100 text-slate-600'

  return (
    <div className={`clay-card ${clayKey} relative overflow-hidden p-4 pl-5`}>
      {/* Bar aksen status di tepi kiri — sinyal visual utama kartu. */}
      <span className={`absolute inset-y-0 left-0 w-1.5 ${aksen}`} aria-hidden="true" />

      {/* Baris atas: nama + status + aksi */}
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold leading-snug text-slate-800" title={t.namaPihak}>{t.namaPihak}</p>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${warnaStatus}`}>{labelStatus}</span>
            <p className="truncate text-[11px] font-medium text-slate-500">
              {t.tipe}
              {t.tipe === 'Cicilan' && t.cicilanPerBulan > 0 ? ` · ${formatRupiah(t.cicilanPerBulan)}/bln` : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          <button onClick={onEdit} aria-label="Edit utang" className="clay-chip clay-key-neutral flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-600">
            <span className="material-symbols-outlined icon-xs">edit</span>
          </button>
          <button onClick={onHapus} aria-label="Hapus utang" className="clay-chip clay-key-neutral flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600">
            <span className="material-symbols-outlined icon-xs">delete</span>
          </button>
        </div>
      </div>

      {/* Fokus utama: sisa utang */}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 shrink-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sisa utang</p>
          <p className={`whitespace-nowrap text-2xl font-extrabold leading-none tracking-tight tabular-nums ${lunas ? 'text-incomeText' : 'text-slate-900'}`}>
            {formatRupiah(t.sisa || 0)}
          </p>
          <p className="mt-1 whitespace-nowrap text-[11px] font-medium text-slate-500">dari {formatRupiah(t.total || 0)}</p>
        </div>
        {!lunas && (
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={onLunasin} className="neu-btn btn-sm min-h-10 px-3.5 rounded-xl bg-[#E5E5E5] text-slate-700 font-bold transition-all active:scale-95">Lunasin</button>
            <button onClick={onBayar} className="clay-btn clay-key-primary solid-primary btn-sm min-h-10 px-4 rounded-xl text-white font-bold transition-all active:scale-95">Bayar</button>
          </div>
        )}
      </div>

      {/* Progres + jatuh tempo */}
      <div className="mt-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full transition-all ${lunas ? 'bg-primary' : terlambat ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, persen)}%` }} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px]">
          <span className="whitespace-nowrap font-medium text-slate-500">Terbayar {formatRupiah(terbayar)} ({persen}%)</span>
          <span className={`inline-flex items-center gap-0.5 font-semibold ${jatuh.cls}`}>
            {terlambat && <span className="material-symbols-outlined icon-xs">error</span>}
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
    if (filter === 'aktif') return list.filter((t) => t.status !== 'Lunas' && (t.sisa || 0) > 0)
    if (filter === 'lunas') return list.filter((t) => t.status === 'Lunas' || (t.sisa || 0) <= 0)
    if (filter === 'terlambat') return list.filter((t) => t.status !== 'Lunas' && (t.sisa || 0) > 0 && selisihHari(t.tglJatuhTempo) < 0)
    return list
  }, [list, filter])

  // Urutan tampil: yang PERLU PERHATIAN lebih dulu. Sebelumnya daftar mengikuti
  // urutan createdAt (terbaru dulu) sehingga utang yang sudah terlambat justru
  // berada di paling bawah — user harus scroll untuk melihat hal mendesak.
  // Prioritas: 1) terlambat (paling lama telat dulu), 2) mendekati jatuh tempo,
  // 3) aktif tanpa jatuh tempo, 4) lunas (di akhir, terbaru dulu).
  const terurut = useMemo(() => {
    const bobot = (t) => {
      const lunas = t.status === 'Lunas' || (t.sisa || 0) <= 0
      if (lunas) return 3
      const h = selisihHari(t.tglJatuhTempo)
      if (h === null) return 2
      if (h < 0) return 0
      return 1
    }
    return [...tampil].sort((a, b) => {
      const ba = bobot(a), bb = bobot(b)
      if (ba !== bb) return ba - bb
      // Di grup yang sama: paling mendesak (hari terkecil) dulu.
      const ha = selisihHari(a.tglJatuhTempo)
      const hb = selisihHari(b.tglJatuhTempo)
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
      const l = t.status === 'Lunas' || (t.sisa || 0) <= 0
      totalAwal += t.total || 0
      if (l) {
        lunasCount++
        totalLunasNominal += t.total || 0
      } else {
        totalSisa += t.sisa || 0
        aktif.push(t)
        if (t.tipe === 'Cicilan') {
          cicilanAktif++
          totalCicilanPerBulan += t.cicilanPerBulan || 0
        }
      }
    }
    const terbayar = Math.max(0, totalAwal - totalSisa)
    const persenLunas = totalAwal > 0 ? Math.round((terbayar / totalAwal) * 100) : 0
    const jatuhTempo = aktif
      .filter((t) => t.tglJatuhTempo)
      .map((t) => ({ id: t.id, nama: t.namaPihak, sisa: t.sisa || 0, hari: selisihHari(t.tglJatuhTempo) }))
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
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`clay-chip h-9 px-4 text-xs font-semibold transition-colors ${
              filter === f.id
                ? f.id === 'terlambat'
                  ? 'clay-chip-active-danger'
                  : 'clay-chip solid-primary text-white'
                : 'clay-key-neutral text-textSecondary hover:bg-slate-100 hover:text-slate-800'
            }`}
          >
            {f.label}
          </button>
        ))}
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-5 backdrop-blur-sm" onClick={() => setHapusTarget(null)}>
          <div className="clay-card w-full max-w-xs rounded-[24px] p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <span className="material-symbols-outlined text-4xl text-expenseText">delete</span>
            <p className="mt-2 text-sm font-bold text-slate-800">Hapus “{hapusTarget.namaPihak}”?</p>
            <p className="mt-1 text-xs text-slate-500">Riwayat pembayaran yang sudah tercatat tetap ada.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => setHapusTarget(null)} className="clay-btn-soft btn-md text-xs font-bold text-slate-600">Batal</button>
              <button onClick={konfirmHapus} className="clay-btn-danger btn-md text-xs font-bold">Hapus</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
