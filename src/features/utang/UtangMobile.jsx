import { memo, useEffect, useRef, useState } from 'react'
import { formatRupiah, tanggalPendek } from '../../lib/format.js'
import { useKursVersi } from '../../lib/useKurs.js'
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
  const lunas = t._lunas !== undefined ? t._lunas : cekLunasUtang(t)
  const hari = lunas ? null : (t._hari !== undefined ? t._hari : selisihHari(t.tglJatuhTempo, t.tipe, t.terakhirBayar))
  const terlambat = hari !== null && hari < 0
  const mendekati = hari !== null && hari >= 0 && hari <= 7
  if (lunas)
    return {
      label: 'Lunas',
      cls: 'solid-primary text-white',
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
  if (t._jatuh?.teks) return t._jatuh.teks
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

const KartuUtangMobile = memo(function KartuUtangMobile({ t, currencyTag: _currencyTag, onBayar, onLunasin, onEdit, onHapus }) {
  const st = statusKartu(t)
  const terbayar = Math.max(0, (t.total || 0) - (t.sisa || 0))
  const persen = t.total > 0 ? Math.round((terbayar / t.total) * 100) : 0

  return (
    <div
      className={`neu-card rounded-2xl relative overflow-hidden p-4 transition-[background-color,box-shadow] duration-150 bg-[#E5E5E5] ${st.lunas ? 'is-lunas' : ''}`}
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
          <span className={`${st.lunas ? 'neu-chip' : 'neu-inset'} rounded-full px-2.5 py-0.5 text-[10px] font-extrabold inline-flex items-center gap-1 ${st.cls}`}>
            {st.lunas && <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>}
            {st.label}
          </span>
          <button
            onClick={() => onEdit?.(t)}
            aria-label={`Edit ${t.namaPihak}`}
            className="neu-btn flex h-7.5 w-7.5 items-center justify-center rounded-xl bg-[#E5E5E5] text-slate-600 transition-[color,transform,box-shadow] duration-150 active:scale-95"
          >
            <span className="material-symbols-outlined icon-xs">edit</span>
          </button>
          <button
            onClick={() => onHapus?.(t)}
            aria-label={`Hapus ${t.namaPihak}`}
            className="neu-btn flex h-7.5 w-7.5 items-center justify-center rounded-xl bg-[#E5E5E5] text-slate-600 transition-[color,transform,box-shadow] duration-150 hover:text-[#EB5353] active:scale-95"
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
            className={`progress-bar-fill h-full w-full rounded-full ${st.lunas ? 'bg-[#36AE7C]' : st.terlambat ? 'bg-[#EB5353]' : 'bg-[#187498]'}`}
            style={{ transform: `scaleX(${Math.max(persen > 0 ? 0.03 : 0, Math.min(1, persen / 100))})` }}
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
            onClick={() => onLunasin?.(t)}
            className="neu-btn h-8.5 px-3.5 rounded-xl bg-[#E5E5E5] text-slate-700 font-bold text-xs transition-[color,transform,box-shadow] duration-150 active:scale-95"
          >
            Lunasin
          </button>
          <button
            onClick={() => onBayar?.(t)}
            className="neu-btn-primary solid-primary h-8.5 px-4 rounded-xl text-white font-bold text-xs transition-[transform,box-shadow,filter] duration-150 active:scale-95"
          >
            Bayar
          </button>
        </div>
      )}
    </div>
  )
})

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
  const cardWrapRef = useRef(null)
  const dragXRef = useRef(0)
  const dragRafRef = useRef(0)

  useEffect(() => () => {
    if (dragRafRef.current) cancelAnimationFrame(dragRafRef.current)
  }, [])

  const total = terurut.length
  const idx = Math.min(Math.max(0, halaman), Math.max(0, total - 1))
  const kartuAktif = terurut[idx]
  const currencyTag = useKursVersi()

  function playCardSlide(dir) {
    const el = cardWrapRef.current
    if (!el || typeof el.animate !== 'function') return
    try {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
      const fromX = dir === 'next' ? 14 : -14
      el.animate(
        [
          { opacity: 0.3, transform: `translate3d(${fromX}px, 0, 0)` },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        ],
        { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      )
    } catch {
      // abaikan bila WAAPI tidak didukung
    }
  }

  function resetDragStyles() {
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = 0
    }
    const prevX = dragXRef.current
    dragXRef.current = 0
    const el = cardWrapRef.current
    if (!el) return 0
    el.style.willChange = ''
    el.style.transform = ''
    return prevX
  }

  function snapBackCardDrag() {
    const prevX = resetDragStyles()
    const el = cardWrapRef.current
    if (!el || !prevX || typeof el.animate !== 'function') return
    try {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
      el.animate(
        [{ transform: `translate3d(${prevX}px, 0, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
        { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      )
    } catch {
      // abaikan
    }
  }

  function pilihFilter(id) {
    setHalaman(0)
    setFilter(id)
  }

  function pindah(baru) {
    if (baru < 0 || baru >= total || baru === idx) return
    const dir = baru > idx ? 'next' : 'prev'
    setHalaman(baru)
    playCardSlide(dir)
  }

  const touchStartX = useRef(null)
  const touchStartY = useRef(null)
  const isHorizontalSwipe = useRef(false)

  function handleTouchStart(e) {
    if (!e.touches || e.touches.length !== 1) return
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    isHorizontalSwipe.current = false
    dragXRef.current = 0
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
        if (cardWrapRef.current) cardWrapRef.current.style.willChange = 'transform'
      } else if (Math.abs(diffY) > 10) {
        touchStartX.current = null
        touchStartY.current = null
        resetDragStyles()
        return
      }
    }

    if (isHorizontalSwipe.current) {
      dragXRef.current = diffX * 0.4
      if (!dragRafRef.current) {
        dragRafRef.current = window.requestAnimationFrame(() => {
          dragRafRef.current = 0
          if (cardWrapRef.current && isHorizontalSwipe.current) {
            cardWrapRef.current.style.transform = `translate3d(${dragXRef.current}px, 0, 0)`
          }
        })
      }
    }
  }

  function handleTouchEnd(e) {
    if (touchStartX.current === null || touchStartY.current === null) {
      snapBackCardDrag()
      return
    }
    const touch = e.changedTouches[0]
    const diffX = touch.clientX - touchStartX.current
    const diffY = touch.clientY - touchStartY.current
    touchStartX.current = null
    touchStartY.current = null
    const wasSwipe = isHorizontalSwipe.current
    isHorizontalSwipe.current = false

    if (wasSwipe && Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY) * 1.2) {
      const targetIdx = diffX < 0 ? idx + 1 : idx - 1
      if (targetIdx >= 0 && targetIdx < total) {
        resetDragStyles()
        pindah(targetIdx)
        return
      }
    }
    snapBackCardDrag()
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
              onClick={() => pilihFilter(f.id)}
              aria-pressed={active}
              className={`h-8.5 shrink-0 px-3.5 text-xs font-bold rounded-xl transition-[color,transform,box-shadow] duration-150 ${
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
            ref={cardWrapRef}
            data-utang-swipe=""
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={snapBackCardDrag}
            style={{ touchAction: 'pan-y', contain: 'layout style' }}
            className="w-full min-h-[282px]"
          >
            <KartuUtangMobile
              t={kartuAktif}
              currencyTag={currencyTag}
              onBayar={onBayar}
              onLunasin={onLunasin}
              onEdit={onEdit}
              onHapus={onHapus}
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
                className="neu-btn flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-2xl bg-[#E5E5E5] text-slate-700 transition-[color,transform,box-shadow,opacity] duration-150 active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
              >
                <span className="material-symbols-outlined icon-md">chevron_left</span>
              </button>

              <div className="flex flex-col items-center gap-1.5">
                <span className="neu-inset min-w-[68px] text-center rounded-full px-3.5 py-1 font-mono text-xs font-bold text-slate-700 bg-[#E5E5E5] tabular-nums">
                  {idx + 1} dari {total}
                </span>
                {total <= 6 && (
                  <div className="flex items-center gap-2.5" role="tablist" aria-label="Pilih kartu">
                    {terurut.map((item, i) => (
                      <button
                        key={item.id || i}
                        type="button"
                        onClick={() => pindah(i)}
                        aria-label={`Ke kartu ${i + 1}`}
                        aria-current={i === idx ? 'page' : undefined}
                        className={`h-1.5 w-2 rounded-full transition-[transform,background-color] duration-200 ${
                          i === idx
                            ? 'scale-x-[2.2] bg-[#EB5353] shadow-sm'
                            : 'scale-x-75 bg-slate-400/45'
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
                className="neu-btn flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-2xl bg-[#E5E5E5] text-slate-700 transition-[color,transform,box-shadow,opacity] duration-150 active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
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
