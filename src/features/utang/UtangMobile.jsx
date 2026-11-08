import { formatRupiah, tanggalPendek } from '../../lib/format.js'

// ============================================================================
// TAMPILAN UTANG & CICILAN — MOBILE
// ----------------------------------------------------------------------------
// Vertikal scrollable card list murni mengikuti standar Neumorphism #E5E5E5
// dan konsisten dengan seluruh tab mobile lainnya (Transaksi, Rekening, Budget).
// ============================================================================

const FILTERS = [
  { id: 'semua', label: 'Semua' },
  { id: 'aktif', label: 'Aktif' },
  { id: 'lunas', label: 'Lunas' },
  { id: 'terlambat', label: 'Telat' },
]

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
      sudahBayarBulanIni =
        tglBayar.getFullYear() === now.getFullYear() &&
        tglBayar.getMonth() === now.getMonth()
    }
  }

  const targetMonth = sudahBayarBulanIni ? now.getMonth() + 1 : now.getMonth()
  const targetYear = now.getFullYear()

  let target = new Date(targetYear, targetMonth, hariTgl)
  if (target.getMonth() !== targetMonth % 12) {
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

function statusKartu(t) {
  const lunas = t.status === 'Lunas' || (t.sisa || 0) <= 0
  const hari = lunas ? null : selisihHari(t.tglJatuhTempo, t.tipe, t.terakhirBayar)
  const terlambat = hari !== null && hari < 0
  const mendekati = hari !== null && hari >= 0 && hari <= 7
  if (lunas)
    return {
      label: 'Lunas',
      cls: 'text-[#36AE7C]',
      aksen: 'bg-[#36AE7C]',
      lunas,
      terlambat,
      hari,
    }
  if (terlambat)
    return {
      label: 'Terlambat',
      cls: 'text-[#EB5353]',
      aksen: 'bg-[#EB5353]',
      lunas,
      terlambat,
      hari,
    }
  if (mendekati)
    return {
      label: 'Segera',
      cls: 'text-[#D4AF0D]',
      aksen: 'bg-[#D4AF0D]',
      lunas,
      terlambat,
      hari,
    }
  return {
    label: 'Aktif',
    cls: 'text-slate-600',
    aksen: 'bg-slate-300',
    lunas,
    terlambat,
    hari,
  }
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

function KartuUtangMobile({ t, onBayar, onLunasin, onEdit, onHapus }) {
  const st = statusKartu(t)
  const terbayar = Math.max(0, (t.total || 0) - (t.sisa || 0))
  const persen = t.total > 0 ? Math.round((terbayar / t.total) * 100) : 0

  return (
    <div className="neu-card rounded-2xl bg-[#E5E5E5] relative overflow-hidden p-4 transition-all">
      <span className={`absolute inset-y-0 left-0 w-1.5 ${st.aksen}`} aria-hidden="true" />

      {/* Header Kartu */}
      <div className="flex items-start justify-between gap-2 pl-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-black text-slate-800 leading-snug">{t.namaPihak}</p>
          <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">
            {t.tipe}
            {t.tipe === 'Cicilan' && t.cicilanPerBulan > 0 ? ` · ${formatRupiah(t.cicilanPerBulan)}/bln` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={`neu-inset rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${st.cls}`}>
            {st.label}
          </span>
          <button
            onClick={onEdit}
            aria-label={`Edit ${t.namaPihak}`}
            className="neu-btn flex h-7.5 w-7.5 items-center justify-center rounded-xl bg-[#E5E5E5] text-slate-600 transition-all active:scale-95"
          >
            <span className="material-symbols-outlined icon-xs">edit</span>
          </button>
          <button
            onClick={onHapus}
            aria-label={`Hapus ${t.namaPihak}`}
            className="neu-btn flex h-7.5 w-7.5 items-center justify-center rounded-xl bg-[#E5E5E5] text-slate-600 transition-all hover:text-[#EB5353] active:scale-95"
          >
            <span className="material-symbols-outlined icon-xs">delete</span>
          </button>
        </div>
      </div>

      {/* Sisa Utang */}
      <div className="mt-3 pl-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sisa utang</p>
        <div className="flex items-baseline justify-between gap-2 mt-0.5">
          <p className={`font-mono text-2xl font-black leading-tight tracking-tight tabular-nums ${st.lunas ? 'text-[#36AE7C]' : 'text-slate-800'}`}>
            {formatRupiah(t.sisa || 0)}
          </p>
          <p className="text-xs font-semibold text-slate-500 tabular-nums">
            dari {formatRupiah(t.total || 0)}
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-2.5 pl-1.5">
        <div className="h-2 w-full overflow-hidden rounded-full neu-inset p-0.5 bg-[#E5E5E5]">
          <div
            className={`h-full rounded-full transition-all ${st.lunas ? 'bg-[#36AE7C]' : st.terlambat ? 'bg-[#EB5353]' : 'bg-[#187498]'}`}
            style={{ width: `${Math.max(persen > 0 ? 3 : 0, Math.min(100, persen))}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
          <span className="font-semibold text-slate-500">Terbayar {persen}%</span>
          <span className={`inline-flex items-center gap-0.5 font-bold ${st.terlambat ? 'text-[#EB5353]' : st.lunas ? 'text-slate-500' : 'text-slate-700'}`}>
            {st.terlambat && <span className="material-symbols-outlined icon-xs">error</span>}
            {teksJatuhTempo(t, st)}
          </span>
        </div>
      </div>

      {/* Detail Kotak (Sudah dibayar & Cicilan/bln atau Keterangan) */}
      <div className="mt-2.5 grid grid-cols-2 gap-2 pl-1.5">
        <div className="rounded-xl neu-inset bg-[#E5E5E5] px-3 py-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Sudah dibayar</p>
          <p className="mt-0.5 truncate font-mono text-xs font-black text-[#36AE7C]">{formatRupiah(terbayar)}</p>
        </div>
        <div className="rounded-xl neu-inset bg-[#E5E5E5] px-3 py-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
            {t.tipe === 'Cicilan' ? 'Cicilan / bln' : 'Jatuh Tempo'}
          </p>
          <p className="mt-0.5 truncate font-mono text-xs font-black text-slate-700">
            {t.tipe === 'Cicilan' && t.cicilanPerBulan > 0 ? formatRupiah(t.cicilanPerBulan) : (t.tglJatuhTempo ? tanggalPendek(t.tglJatuhTempo) : '—')}
          </p>
        </div>
      </div>

      {/* Aksi Bayar / Lunasin */}
      {!st.lunas && (
        <div className="mt-3.5 flex items-center justify-end gap-2 border-t border-slate-300/40 pt-2.5 pl-1.5">
          <button
            onClick={onLunasin}
            className="neu-btn h-8.5 px-3.5 rounded-xl bg-[#E5E5E5] text-slate-700 font-bold text-xs transition-all active:scale-95"
          >
            Lunasin
          </button>
          <button
            onClick={onBayar}
            className="neu-btn-primary solid-primary h-8.5 px-4 rounded-xl text-white font-bold text-xs transition-all active:scale-95"
          >
            Bayar
          </button>
        </div>
      )}
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
  return (
    <div className="flex flex-col pb-28 pt-2 md:hidden">
      {/* Header */}
      <div className="flex items-center justify-between pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl neu-well text-[#EB5353] bg-[#E5E5E5]">
            <span className="material-symbols-outlined icon-md" style={{ fontVariationSettings: "'FILL' 1" }}>handshake</span>
          </div>
          <div>
            <h2 className="text-lg font-black tracking-tight text-slate-800">Utang &amp; Cicilan</h2>
            <p className="text-[11px] font-bold text-slate-500">Kelola pinjaman &amp; tagihan</p>
          </div>
        </div>
        <span className="neu-inset rounded-full px-3 py-1 text-xs font-bold text-[#EB5353] bg-[#E5E5E5]">
          {ringkasan.aktifCount} aktif
        </span>
      </div>

      {/* 3 Metric Cards */}
      <div className="grid grid-cols-3 gap-2 my-1">
        <div className="neu-card rounded-2xl bg-[#E5E5E5] p-2.5 flex flex-col justify-between">
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <span className="material-symbols-outlined icon-xs text-[#EB5353]" style={{ fontVariationSettings: "'FILL' 1" }}>receipt_long</span>
            <span>Total</span>
          </div>
          <p className="font-mono text-[13px] sm:text-sm font-black text-[#EB5353] tabular-nums mt-1 truncate">
            {formatRupiah(ringkasan.totalSisa)}
          </p>
          <p className="text-[10px] font-semibold text-slate-500 mt-0.5 truncate">{ringkasan.aktifCount} aktif</p>
        </div>

        <div className="neu-card rounded-2xl bg-[#E5E5E5] p-2.5 flex flex-col justify-between">
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <span className="material-symbols-outlined icon-xs text-[#36AE7C]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            <span>Lunas</span>
          </div>
          <p className="font-mono text-[13px] sm:text-sm font-black text-[#36AE7C] tabular-nums mt-1 truncate">
            {formatRupiah(ringkasan.totalLunasNominal)}
          </p>
          <p className="text-[10px] font-semibold text-slate-500 mt-0.5 truncate">{ringkasan.lunasCount} item</p>
        </div>

        <div className="neu-card rounded-2xl bg-[#E5E5E5] p-2.5 flex flex-col justify-between">
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <span className="material-symbols-outlined icon-xs text-[#187498]">schedule</span>
            <span>Cicilan</span>
          </div>
          <p className="font-mono text-[13px] sm:text-sm font-black text-[#187498] tabular-nums mt-1 truncate">
            {ringkasan.cicilanAktif}
          </p>
          <p className="text-[10px] font-semibold text-slate-500 mt-0.5 truncate">
            {formatRupiah(ringkasan.totalCicilanPerBulan)}/bln
          </p>
        </div>
      </div>

      {/* Filter Chips */}
      <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar py-2 my-1">
        {FILTERS.map((f) => {
          const active = filter === f.id
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={active}
              className={`h-8.5 shrink-0 px-3.5 text-xs font-bold rounded-xl transition-all ${
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

      {/* Card List */}
      <div className="space-y-3 pt-1">
        {terurut.length === 0 ? (
          <div className="neu-card rounded-2xl bg-[#E5E5E5] flex flex-col items-center justify-center p-8 text-center mt-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl neu-inset text-slate-400 mb-2">
              <span className="material-symbols-outlined text-3xl">payments</span>
            </div>
            <p className="text-sm font-extrabold text-slate-800">Belum ada utang/cicilan</p>
            <p className="mt-1 text-xs text-slate-500">Tekan tombol + untuk mencatat utang atau cicilan baru.</p>
          </div>
        ) : (
          terurut.map((t) => (
            <KartuUtangMobile
              key={t.id}
              t={t}
              onBayar={() => onBayar(t)}
              onLunasin={() => onLunasin(t)}
              onEdit={() => onEdit(t)}
              onHapus={() => onHapus(t)}
            />
          ))
        )}
      </div>
    </div>
  )
}
