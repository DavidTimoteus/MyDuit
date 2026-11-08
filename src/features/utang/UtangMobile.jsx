import { useEffect, useRef, useState } from 'react'
import { formatRupiah, tanggalPendek } from '../../lib/format.js'

// ============================================================================
// TAMPILAN UTANG — MOBILE (terpisah dari desktop, by design)
// ----------------------------------------------------------------------------
// Alasan dipisah: di mobile ruangnya sempit dan terbatas (dikurangi bottom-nav
// 76px). Menumpuk semua kartu dalam satu kolom memaksa pengguna men-scroll
// panjang. Di sini dipakai PENGGAL (pagination) satu kartu per halaman supaya
// SELURUH layar pas tanpa scroll sama sekali.
//
// Kontrak: tinggi container = 100dvh - 76px (bottom-nav). Isi dibagi menjadi
// bagian shrink-0 (header/hero/filter/pager) dan satu bagian flex-1 (kartu).
// Tidak ada overflow-y di mana pun — kalau konten tidak muat, itu bug.
// ============================================================================

const FILTERS = [
  { id: 'semua', label: 'Semua' },
  { id: 'aktif', label: 'Aktif' },
  { id: 'lunas', label: 'Lunas' },
  { id: 'terlambat', label: 'Telat' },
]

// Tinggi bottom-nav di Shell.jsx. Dipakai untuk menghitung sisa tinggi layar.
const TINGGI_NAV = 76

function hitungJatuhTempoBulanan(iso, terakhirBayar) {
  if (!iso) return null
  const tglRef = new Date(`${iso}T00:00:00`)
  if (isNaN(tglRef.getTime())) return null
  const hariTgl = tglRef.getDate()
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  
  let sudahBayarBulanIni = false
  if (terakhirBayar) {
    const tglBayar = new Date(`${terakhirBayar}T00:00:00`)
    if (!isNaN(tglBayar.getTime())) {
      sudahBayarBulanIni = tglBayar.getFullYear() === now.getFullYear() && tglBayar.getMonth() === now.getMonth()
    }
  }

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

// Status + warna aksen kartu. Satu sinyal kuat (bar tepi), bukan tumpukan badge.
function statusKartu(t) {
  const lunas = t.status === 'Lunas' || (t.sisa || 0) <= 0
  const hari = lunas ? null : selisihHari(t.tglJatuhTempo, t.tipe, t.terakhirBayar)
  const terlambat = hari !== null && hari < 0
  const mendekati = hari !== null && hari >= 0 && hari <= 7
  if (lunas) return { label: 'Lunas', cls: 'bg-emerald-50 text-emerald-700', aksen: 'bg-primary', lunas, terlambat, hari }
  if (terlambat) return { label: 'Terlambat', cls: 'bg-red-50 text-red-700', aksen: 'bg-red-500', lunas, terlambat, hari }
  if (mendekati) return { label: 'Segera', cls: 'bg-amber-50 text-amber-700', aksen: 'bg-amber-500', lunas, terlambat, hari }
  return { label: 'Aktif', cls: 'bg-slate-100 text-slate-600', aksen: 'bg-slate-300', lunas, terlambat, hari }
}

function teksJatuhTempo(t, st) {
  if (st.lunas) return 'Sudah lunas'
  if (!t.tglJatuhTempo) return 'Tanpa jatuh tempo'
  const d = st.hari
  const tglRef = new Date(`${t.tglJatuhTempo}T00:00:00`)
  const hariTgl = !isNaN(tglRef.getTime()) ? tglRef.getDate() : ''

  if (t.tipe === 'Cicilan') {
    const info = hitungJatuhTempoBulanan(t.tglJatuhTempo, t.terakhirBayar)
    if (info?.sudahBayarBulanIni) {
      return `Bulan ini lunas • Tempo brikutnya tgl ${hariTgl} (${d} hr lagi)`
    }
    const awalan = `Tempo bulanan tgl ${hariTgl}`
    if (d < 0) return `${awalan} (Telat ${-d} hari)`
    if (d === 0) return `${awalan} (Hari ini!)`
    if (d <= 7) return `${awalan} (H-${d})`
    return `${awalan} (${d} hari lagi)`
  }

  const awalan = `Jatuh tempo ${tanggalPendek(t.tglJatuhTempo)}`
  if (d < 0) return `${awalan} (Telat ${-d} hari)`
  if (d === 0) return `${awalan} (Hari ini!)`
  if (d <= 7) return `${awalan} (H-${d})`
  return `${awalan} (${d} hari lagi)`
}

// Kartu RINGKAS untuk mobile — sengaja lebih pendek dari versi desktop supaya
// satu kartu + kontrol pager selalu muat dalam satu layar.
function KartuUtangMobile({ t, onBayar, onLunasin, onEdit, onHapus }) {
  const st = statusKartu(t)
  const terbayar = Math.max(0, (t.total || 0) - (t.sisa || 0))
  const persen = t.total > 0 ? Math.round((terbayar / t.total) * 100) : 0

  return (
    <div className="clay-card bg-white rounded-[24px] border border-white/60 relative flex w-full flex-1 flex-col overflow-hidden p-4 pl-5">
      <span className={`absolute inset-y-0 left-0 w-1.5 ${st.aksen}`} aria-hidden="true" />

      <div className="flex min-w-0 shrink-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold leading-snug text-slate-800">{t.namaPihak}</p>
          <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">
            {t.tipe}
            {t.tipe === 'Cicilan' && t.cicilanPerBulan > 0 ? ` · ${formatRupiah(t.cicilanPerBulan)}/bln` : ''}
          </p>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
      </div>

      {/* BODY — konten mengalir natural (gap tetap). Kartu TIDAK dipaksa
          setinggi layar; tingginya mengikuti isi lalu dipusatkan di area,
          jadi tidak ada rongga kosong besar di layar tinggi. */}
      <div className="utang-m-body flex min-h-0 flex-1 flex-col justify-around gap-3 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sisa utang</p>
          <p className={`utang-m-sisa font-mono text-[32px] font-extrabold leading-tight tracking-tight tabular-nums ${st.lunas ? 'text-incomeText' : 'text-slate-900'}`}>
            {formatRupiah(t.sisa || 0)}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-500">dari {formatRupiah(t.total || 0)}</p>
        </div>

        <div>
          {/* Progress: track MadeClear (bukan transparan) + fill minimal 3px
              supaya tetap terbaca sebagai data, bukan garis pemisah. */}
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full min-w-[3px] rounded-full transition-all ${st.lunas ? 'bg-primary' : st.terlambat ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${Math.max(persen > 0 ? 3 : 0, Math.min(100, persen))}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
            <span className="font-semibold text-slate-600">Terbayar {persen}%</span>
            <span className={`inline-flex items-center gap-0.5 truncate font-semibold ${st.terlambat ? 'text-expenseText' : st.lunas ? 'text-slate-500' : 'text-slate-600'}`}>
              {st.terlambat && <span className="material-symbols-outlined icon-xs">error</span>}
              {teksJatuhTempo(t, st)}
            </span>
          </div>
        </div>

        {/* Detail pembayaran — mengisi ruang di layar tinggi dengan informasi
            yang benar-benar berguna, bukan rongga kosong. */}
        <div className="utang-m-tiles grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-slate-50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Sudah dibayar</p>
            <p className="mt-0.5 truncate font-mono text-[13px] font-bold text-incomeText">{formatRupiah(terbayar)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t.tipe === 'Cicilan' ? 'Cicilan / bulan' : 'Jenis'}
            </p>
            <p className="mt-0.5 truncate font-mono text-[13px] font-bold text-slate-700">
              {t.tipe === 'Cicilan' && t.cicilanPerBulan > 0 ? formatRupiah(t.cicilanPerBulan) : t.tipe}
            </p>
          </div>
        </div>

        {/* Ringkasan tempo — memakai field yang BENAR-BENAR ada di model
            (tglJatuhTempo / tglMulai). Mengisi ruang dengan data nyata,
            bukan padding kosong. */}
        {t.tglJatuhTempo && (
          <div className="utang-m-extra flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px]">
            <span className="font-medium text-slate-500">Jatuh tempo</span>
            <span className="whitespace-nowrap font-bold text-slate-700">{tanggalPendek(t.tglJatuhTempo)}</span>
          </div>
        )}
      </div>

      {/* Aksi di kaki kartu: selalu terlihat, tinggi tetap 44px (touch target). */}
      <div className="flex shrink-0 items-center gap-2 border-t border-slate-100 pt-3">
        <button onClick={onEdit} aria-label={`Edit utang ${t.namaPihak}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 active:scale-95">
          <span className="material-symbols-outlined icon-md">edit</span>
        </button>
        <button onClick={onHapus} aria-label={`Hapus utang ${t.namaPihak}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 active:scale-95">
          <span className="material-symbols-outlined icon-md">delete</span>
        </button>
        {!st.lunas && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button onClick={onLunasin} className="clay-btn-soft btn-md min-h-11 px-3.5 text-slate-600">Lunasin</button>
            <button onClick={onBayar} className="clay-btn-primary btn-md min-h-11 px-4">Bayar</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function UtangMobile({
  ringkasan,
  terurut,
  filter,
  setFilter,
  onBayar,
  onLunasin,
  onEdit,
  onHapus,
}) {
  const [halaman, setHalaman] = useState(0)
  const areaRef = useRef(null)
  const touchStartX = useRef(null)
  const touchStartY = useRef(null)

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

    if (Math.abs(diffX) > 32 && Math.abs(diffX) > Math.abs(diffY) * 1.2) {
        if (diffX < 0) {
          pindah(idx + 1)
        } else {
          pindah(idx - 1)
        }
      }
    }

    const total = terurut.length
  const jumlahHalaman = Math.max(1, total)
  // Jaga indeks tetap valid saat filter berubah atau data menyusut.
  const idx = Math.min(halaman, jumlahHalaman - 1)

  useEffect(() => {
    setHalaman(0)
    if (areaRef.current) areaRef.current.scrollTop = 0
  }, [filter, total])

  // Titik halaman dibatasi maksimal 7 agar tidak meluber di layar sempit.
  // Bila lebih, jendela bergeser mengikuti halaman aktif.
  const MAKS_TITIK = 7
  let titikTampil
  if (jumlahHalaman <= MAKS_TITIK) {
    titikTampil = Array.from({ length: jumlahHalaman }, (_, i) => ({ i, aktif: i === idx }))
  } else {
    const setengah = Math.floor(MAKS_TITIK / 2)
    let mulai = Math.max(0, idx - setengah)
    mulai = Math.min(mulai, jumlahHalaman - MAKS_TITIK)
    titikTampil = Array.from({ length: MAKS_TITIK }, (_, k) => {
      const i = mulai + k
      return { i, aktif: i === idx }
    })
  }

  function pindah(n) {
    setHalaman(Math.max(0, Math.min(jumlahHalaman - 1, n)))
  }

  return (
    <div
      className="flex flex-col overflow-hidden md:hidden"
style={{ height: `calc(100dvh - ${TINGGI_NAV}px)`, touchAction: 'pan-y' }}    >
      {/* Header ringkas */}
      <header className="utang-m-header flex shrink-0 items-center gap-2 px-5 pt-3 pb-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-red-600 text-white">
          <span className="material-symbols-outlined icon-md" style={{ fontVariationSettings: "'FILL' 1" }}>handshake</span>
        </div>
        <h2 className="text-xl font-extrabold leading-tight tracking-tight">Utang &amp; Cicilan</h2>
        <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700">
          {ringkasan.aktifCount} aktif
        </span>
      </header>

      {/* Hero ringkas — dua baris saja (label + nominal). Jumlah aktif sudah
          ada di badge header, dan jatuh tempo terdekat ada di kartu, jadi
          tidak diulang di sini: menghemat tinggi agar kartu tetap utuh. */}
      <div className="rounded-xl bg-white/80 border border-white/20 shadow-md p-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total Sisa Utang Aktif</p>
        <p className="utang-m-hero-nilai mt-1 font-mono text-[28px] font-extrabold leading-none tracking-tight text-slate-900 tabular-nums">
          {formatRupiah(ringkasan.totalSisa)}
        </p>
        {/* Sub-info mengisi ruang hero agar tidak gepeng/kosong: jumlah aktif
            dan total cicilan per bulan. Disembunyikan di layar sangat pendek. */}
        <div className="utang-m-hero-sub mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="material-symbols-outlined icon-2xs text-danger" style={{ fontVariationSettings: "'FILL' 1" }}>receipt_long</span>
            {ringkasan.aktifCount} aktif
          </span>
          {ringkasan.totalCicilanPerBulan > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="material-symbols-outlined icon-2xs text-info">calendar_month</span>
              {formatRupiah(ringkasan.totalCicilanPerBulan)}/bln
            </span>
          )}
        </div>
      </div>

      {/* Filter — satu baris, tidak membungkus */}
      <div className="flex items-center gap-2 px-3 py-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={`clay-chip h-9 shrink-0 px-3.5 text-xs font-semibold transition-colors ${
              filter === f.id
                ? f.id === 'terlambat'
                  ? 'clay-chip-active-danger'
                  : 'clay-chip solid-primary text-white'
                : 'clay-key-neutral text-textSecondary'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Area kartu — satu kartu per halaman, kartu dipusatkan & tingginya
          mengikuti isi (tidak melar penuh). min-h-0 wajib agar flex-1 boleh
          menyusut; min-height di CSS menjaga kartu tetap utuh di layar pendek. */}
      <div ref={areaRef} className="utang-m-area hide-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-1">
        {total === 0 ? (
          <div className="clay-card-soft flex h-full flex-col items-center justify-center px-6 text-center">
            <span className="material-symbols-outlined mb-2 text-4xl text-primary/30">payments</span>
            <p className="text-sm font-bold text-slate-700">Belum ada utang/cicilan</p>
            <p className="mt-1 text-xs text-slate-500">Tekan tombol + untuk mencatat yang pertama.</p>
          </div>
        ) : (
          <div
            className="flex min-h-full w-full flex-col overflow-hidden"
            role="group"
            aria-label={`Utang halaman ${idx + 1} dari ${jumlahHalaman}`}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            style={{ touchAction: 'pan-y' }}
          >
            <div
              className="flex w-full"
              style={{
                transform: `translateX(-${idx * 100}%)`,
                willChange: 'transform',
                transition: 'transform 400ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              {terurut.map((t) => (
                <div key={t.id} className="w-full shrink-0">
                  <KartuUtangMobile
                    t={t}
                    onBayar={() => onBayar(t)}
                    onLunasin={() => onLunasin(t)}
                    onEdit={() => onEdit(t)}
                    onHapus={() => onHapus(t)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Pager — hanya muncul bila ada lebih dari satu kartu.
          Satu bar terpadu (prev · dot · next) dengan label halaman di
          tengahnya, sehingga tidak ada jarak menggantung & dot terbaca
          jelas mana yang aktif. */}
      {total > 1 && (
        <div className="utang-m-pager flex shrink-0 items-center justify-center gap-3 px-5 pb-3 pt-1">
          <button
            type="button"
            onClick={() => pindah(idx - 1)}
            disabled={idx === 0}
            aria-label="Halaman sebelumnya"
            className="clay-chip utang-m-pager-btn flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 disabled:opacity-35"
          >
            <span className="material-symbols-outlined icon-md">chevron_left</span>
          </button>

          <div className="utang-m-titik flex min-w-0 flex-1 items-center justify-center gap-1.5" role="tablist" aria-label="Pilih halaman utang">
            {titikTampil.map(({ i, aktif }) => (
              <button
                key={i}
                type="button"
                onClick={() => pindah(i)}
                aria-label={`Ke halaman ${i + 1}`}
                aria-current={aktif ? 'page' : undefined}
                className={`utang-m-dot ${aktif ? 'utang-m-dot--aktif' : ''}`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => pindah(idx + 1)}
            disabled={idx === jumlahHalaman - 1}
            aria-label="Halaman berikutnya"
            className="clay-chip utang-m-pager-btn flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 disabled:opacity-35"
          >
            <span className="material-symbols-outlined icon-md">chevron_right</span>
          </button>
        </div>
      )}
    </div>
  )
}
