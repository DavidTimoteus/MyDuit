import { useEffect, useState } from 'react'
import { formatRupiah } from '../../lib/format.js'

// Panel kanan khusus tab Utang (desktop only). Render di Shell dengan `tab === 'utang'`.
// Subscribe ringkasan via event `myduit:utang-update` dari UtangView.
//
// Layout mengikuti GAS #asideGroupUtang:
//   - Header "Ringkasan Utang" + tombol Cetak PDF
//   - SIGNATURE: Progres Pelunasan (ring SVG, % terlunasi, gradient emerald)
//   - Jatuh Tempo Terdekat (max 3, dot urgensi + countdown chip)
//   - Statistik Cepat (total cicilan aktif, rata-rata per bulan, utang aktif)
//   - Aksi Cepat (Utang / Cicilan)
export default function UtangAsidePanel() {
  const [data, setData] = useState(null)

  useEffect(() => {
    function onUpdate(e) {
      setData(e.detail)
    }
    window.addEventListener('myduit:utang-update', onUpdate)
    return () => window.removeEventListener('myduit:utang-update', onUpdate)
  }, [])

  const r = data || {
    totalSisa: 0,
    totalAwal: 0,
    persenLunas: 0,
    aktifCount: 0,
    cicilanAktif: 0,
    rataPerBulan: 0,
    jatuhTempo: [],
  }

  // Ring SVG: r=27 → C = 2πr ≈ 169.65
  const C = 169.65
  const offset = C - (Math.min(100, Math.max(0, r.persenLunas)) / 100) * C

  function handleCetakPdf() {
    window.dispatchEvent(new CustomEvent('myduit:export-pdf'))
  }

  return (
    <aside className="hidden xl:flex xl:h-full xl:w-[350px] xl:min-w-[350px] xl:max-w-[350px] xl:shrink-0 xl:grow-0 xl:flex-col xl:overflow-hidden xl:p-4 xl:pl-2">
      <div className="clay clay-key-danger flex h-full flex-col overflow-y-auto hide-scrollbar rounded-[28px] bg-surfaceContainerLowest p-5 w-full min-w-0">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-1 pb-3">
          <h2 className="text-base font-extrabold tracking-tight text-slate-800">Ringkasan Utang</h2>
          <button
            onClick={handleCetakPdf}
            aria-label="Cetak PDF"
            title="Cetak PDF"
            className="pdf-action-btn clay-key-danger"
          >
            <span className="material-symbols-outlined icon-md">picture_as_pdf</span>
          </button>
        </div>
        <div className="mb-3 h-px shrink-0 bg-slate-200/70"></div>

        {/* SIGNATURE: Progres Pelunasan (ring SVG) */}
        <div className="clay-card clay-key-primary solid-primary flex shrink-0 items-center gap-3.5 rounded-[18px] p-3.5 text-white">
          <div className="relative shrink-0" style={{ width: 64, height: 64 }}>
            <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
              <circle cx="32" cy="32" r="27" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="7" />
              <circle
                cx="32"
                cy="32"
                r="27"
                fill="none"
                stroke="#ffffff"
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={offset}
                style={{ transition: 'stroke-dashoffset .6s ease' }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-mono text-sm font-extrabold">{r.persenLunas}%</span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-90">Progres Pelunasan</p>
            <p className="font-mono mt-0.5 truncate text-sm font-bold">{formatRupiah(r.totalSisa)}</p>
            <p className="mt-0.5 text-[10px] font-medium leading-snug opacity-85">
              dari {formatRupiah(r.totalAwal)} · {r.aktifCount} item aktif
            </p>
          </div>
        </div>

        {/* Jatuh Tempo Terdekat */}
        <div className="clay-card clay-key-danger mt-2.5 shrink-0 rounded-[18px] bg-surfaceContainerLowest p-3.5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Jatuh Tempo Terdekat</p>
          <div className="space-y-2.5">
            {r.jatuhTempo.length === 0 ? (
              <p className="text-[11px] text-textSecondary">Tidak ada jatuh tempo terdekat.</p>
            ) : (
              r.jatuhTempo.slice(0, 3).map((j) => {
                const warna = j.hari < 0 ? 'bg-red-500' : j.hari <= 7 ? 'bg-amber-500' : 'bg-emerald-500'
                const chipCls = j.hari < 0 ? 'bg-red-100 text-red-700' : j.hari <= 7 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                const label = j.hari < 0 ? `Terlambat ${-j.hari}h` : j.hari === 0 ? 'Hari ini' : `${j.hari}h`
                return (
                  <div key={j.id} className="flex min-w-0 items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${warna}`}></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-bold text-slate-700">{j.nama}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${chipCls}`}>{label}</span>
                    <span className="shrink-0 font-mono text-[10px] font-bold text-slate-600">{formatRupiah(j.sisa)}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Statistik Cepat */}
        <div className="clay-card clay-key-primary mt-2.5 shrink-0 rounded-[18px] bg-surfaceContainerLowest p-3.5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Statistik Cepat</p>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-textSecondary">
                <span className="material-symbols-outlined icon-sm text-blue-600">payments</span>Total cicilan aktif
              </span>
              <span className="shrink-0 font-mono text-xs font-semibold">{r.cicilanAktif}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-textSecondary">
                <span className="material-symbols-outlined icon-sm text-amber-600">trending_up</span>Rata-rata per bulan
              </span>
              <span className="shrink-0 font-mono text-xs font-semibold">{formatRupiah(r.rataPerBulan)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-textSecondary">
                <span className="material-symbols-outlined icon-sm text-red-600">handshake</span>Utang aktif
              </span>
              <span className="shrink-0 font-mono text-xs font-semibold">{r.aktifCount}</span>
            </div>
          </div>
        </div>

        {/* Aksi Cepat */}
        <div className="mt-auto pt-2">
          <div className="h-px bg-slate-200/70"></div>
          <p className="mt-3 px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">Aksi Cepat</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('myduit:utang-add', { detail: { mode: 'utang' } }))}
              className="clay-btn clay-key-primary solid-primary btn-md flex w-full items-center justify-center gap-1.5 rounded-2xl text-xs font-bold text-white"
            >
              <span className="material-symbols-outlined icon-sm" style={{ fontVariationSettings: "'FILL' 1" }}>handshake</span>
              + Utang
            </button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('myduit:utang-add', { detail: { mode: 'cicilan' } }))}
              className="clay-btn clay-btn-secondary btn-md flex w-full items-center justify-center gap-1.5 rounded-2xl text-xs font-bold text-slate-700"
            >
              <span className="material-symbols-outlined icon-sm text-expenseText" style={{ fontVariationSettings: "'FILL' 1" }}>payments</span>
              + Cicilan
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
