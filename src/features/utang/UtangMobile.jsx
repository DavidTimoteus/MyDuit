import { useEffect, useRef, useState } from 'react'
import { formatRupiah, tanggalPendek } from '../../lib/format.js'
import { cekLunasUtang, hitungJatuhTempoBulanan, selisihHari } from './UtangView.jsx'

// ============================================================================
// TAMPILAN UTANG & CICILAN — MOBILE
// ----------------------------------------------------------------------------
// Paginated card view (1 kartu per halaman) dengan dukungan gestur swipe
// horizontal dan kontrol pager Neumorphism taktil (#E5E5E5).
// ============================================================================

const FILTERS = [
  { id: 'semua', label: 'Semua' },
  { id: 'aktif', label: 'Aktif' },
  { id: 'lunas', label: 'Lunas' },
  { id: 'terlambat', label: 'Telat' },
]

function statusKartu(t) {
  const lunas = cekLunasUtang(t)
  const hari = lunas ? null : selisihHari(t.tglJatuhTempo, t.tipe, t.terakhirBayar)
  const terlambat = hari !== null && hari < 0
  const mendekati = hari !== null && hari >= 0 && hari <= 7
  if (lunas)
    return {
      label: 'Lunas',
      cls: 'text-[#36AE7C] bg-emerald-500/12 border border-emerald-500/25',
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
  if (d === null || Number.isNaN(d)) return 'Tanpa jatuh tempo'
  const tglRef = new Date(`${t.tglJatuhTempo}T00:00:00`)
  const hariTgl = !isNaN(tglRef.getTime()) ? tglRef.getDate() : ''

  if (t.tipe === 'Cicilan') {
    const info = hitungJatuhTempoBulanan(t.tglJatuhTempo, t.terakhirBayar)
    if (info?.sudahBayarBulanIni) {
      return `Bulan ini lunas • Tempo berikutnya tgl ${hariTgl} (${d} hr lagi)`
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
    <div
      className={`neu-card rounded-2xl relative overflow-hidden p-4 transition-all bg-[#E5E5E5] ${st.lunas ? 'is-lunas' : ''}`}
    >

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
          <span className={`neu-inset rounded-full px-2.5 py-0.5 text-[10px] font-extrabold inline-flex items-center gap-1 ${st.cls}`}>
            {st.lunas && <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>}
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
            {formatRupiah(Math.max(0, Number(t.sisa) || 0))}
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
            className={`progress-bar-fill h-full rounded-full ${st.lunas ? 'bg-[#36AE7C]' : st.terlambat ? 'bg-[#EB5353]' : 'bg-[#187498]'}`}
            style={{ width: `${Math.max(persen > 0 ? 3 : 0, Math.min(100, persen))}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
          <span className="font-semibold text-slate-500">Terbayar {persen}%</span>
          <span className={`inline-flex items-center gap-0.5 font-bold ${st.terlambat ? 'text-[#EB5353]' : st.lunas ? 'text-[#36AE7C]' : 'text-slate-700'}`}>
            {st.terlambat && <span className="material-symbols-outlined icon-xs">error</span>}
            {st.lunas && <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>task_alt</span>}
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
  const [halaman, setHalaman] = useState(0)
  const [slideDir, setSlideDir] = useState(null)
  const [dragOffset, setDragOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  // Reset ke halaman 0 bila filter berubah
  useEffect(() => {
    setHalaman(0)
    setSlideDir(null)
    setDragOffset(0)
  }, [filter])

  const total = terurut.length
  const idx = Math.min(Math.max(0, halaman), Math.max(0, total - 1))
  const kartuAktif = terurut[idx]

  function pindah(baru) {
    if (baru < 0 || baru >= total || baru === idx) return
    setSlideDir(baru > idx ? 'next' : 'prev')
    setHalaman(baru)
  }

  const touchStartX = useRef(null)
  const touchStartY = useRef(null)
  const isHorizontalSwipe = useRef(false)

  function handleTouchStart(e) {
    if (!e.touches || e.touches.length !== 1) return
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    isHorizontalSwipe.current = false
    setIsDragging(true)
  }

  function handleTouchMove(e) {
    if (touchStartX.current === null || touchStartY.current === null) return
    const currentX = e.touches[0].clientX
    const currentY = e.touches[0].clientY
    const diffX = currentX - touchStartX.current
    const diffY = currentY - touchStartY.current

    if (!isHorizontalSwipe.current) {
      if (Math.abs(diffX) > 10 && Math.abs(diffX) > Math.abs(diffY) * 1.2) {
        isHorizontalSwipe.current = true
      } else if (Math.abs(diffY) > 10) {
        touchStartX.current = null
        touchStartY.current = null
        setDragOffset(0)
        setIsDragging(false)
        return
      }
    }

    if (isHorizontalSwipe.current) {
      setDragOffset(diffX * 0.4)
    }
  }

  function handleTouchEnd(e) {
    if (touchStartX.current === null || touchStartY.current === null) {
      setDragOffset(0)
      setIsDragging(false)
      return
    }
    const touch = e.changedTouches[0]
    const diffX = touch.clientX - touchStartX.current
    const diffY = touch.clientY - touchStartY.current
    touchStartX.current = null
    touchStartY.current = null
    setDragOffset(0)
    setIsDragging(false)

    if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY) * 1.2) {
      if (diffX < 0) {
        pindah(idx + 1)
      } else {
        pindah(idx - 1)
      }
    }
  }

  return (
    <div className="view-panel-enter flex flex-col pb-28 pt-2 md:hidden">
      {/* Header mobile (md:hidden) — logo handshake + judul embossed */}
      <header className="pb-2.5">
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="clay-icon-tile clay-key-danger solid-danger flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white">
              <span className="material-symbols-outlined icon-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                handshake
              </span>
            </div>
            <h2 className="brand-title-embossed font-display text-2xl font-extrabold leading-tight">Utang &amp; Cicilan</h2>
          </div>
          <span className="neu-inset rounded-full px-3 py-1 text-xs font-bold text-[#EB5353] bg-[#E5E5E5]">
            {ringkasan.aktifCount} aktif
          </span>
        </div>
      </header>

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

      {/* Card Display with Pagination */}
      {total === 0 ? (
        <div className="pt-2">
          <div className="neu-card rounded-2xl bg-[#E5E5E5] flex flex-col items-center justify-center p-8 text-center mt-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl neu-inset text-slate-400 mb-2">
              <span className="material-symbols-outlined text-3xl">payments</span>
            </div>
            <p className="text-sm font-extrabold text-slate-800">Belum ada utang/cicilan</p>
            <p className="mt-1 text-xs text-slate-500">Tekan tombol + untuk mencatat utang atau cicilan baru.</p>
          </div>
        </div>
      ) : (
        <div className="pt-1 flex flex-col gap-3">
          <div
            key={`utang-card-${kartuAktif?.id || idx}`}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            style={{
              touchAction: 'pan-y',
              transform: dragOffset !== 0 ? `translate3d(${dragOffset}px, 0, 0)` : undefined,
              transition: isDragging ? 'none' : 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            className={`w-full ${
              slideDir === 'next'
                ? 'page-transition-next'
                : slideDir === 'prev'
                  ? 'page-transition-prev'
                  : ''
            }`}
          >
            <KartuUtangMobile
              key={kartuAktif.id}
              t={kartuAktif}
              onBayar={() => onBayar(kartuAktif)}
              onLunasin={() => onLunasin(kartuAktif)}
              onEdit={() => onEdit(kartuAktif)}
              onHapus={() => onHapus(kartuAktif)}
            />
          </div>

          {/* Pager Bar Neumorphic */}
          {total > 1 && (
            <div className="flex items-center justify-between gap-3 pt-1 px-1">
              <button
                type="button"
                onClick={() => pindah(idx - 1)}
                disabled={idx === 0}
                aria-label="Kartu sebelumnya"
                className="neu-btn flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-2xl bg-[#E5E5E5] text-slate-700 transition-all active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
              >
                <span className="material-symbols-outlined icon-md">chevron_left</span>
              </button>

              <div className="flex flex-col items-center gap-1.5">
                <span className="neu-inset rounded-full px-3.5 py-1 font-mono text-xs font-bold text-slate-700 bg-[#E5E5E5] tabular-nums">
                  {idx + 1} dari {total}
                </span>
                {total <= 6 && (
                  <div className="flex items-center gap-1.5" role="tablist" aria-label="Pilih kartu">
                    {terurut.map((item, i) => (
                      <button
                        key={item.id || i}
                        type="button"
                        onClick={() => pindah(i)}
                        aria-label={`Ke kartu ${i + 1}`}
                        aria-current={i === idx ? 'page' : undefined}
                        className={`transition-all duration-200 ${
                          i === idx
                            ? 'h-1.5 w-5 rounded-full bg-[#EB5353] shadow-sm'
                            : 'h-1.5 w-1.5 rounded-full bg-slate-400/40'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => pindah(idx + 1)}
                disabled={idx === total - 1}
                aria-label="Kartu berikutnya"
                className="neu-btn flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-2xl bg-[#E5E5E5] text-slate-700 transition-all active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
              >
                <span className="material-symbols-outlined icon-md">chevron_right</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
