import { useEffect, useState } from 'react'
import { formatRupiah } from '../../lib/format.js'

// Panel kanan khusus tab Budget (desktop only). Render di Shell dengan
// `tab === 'budget'`. Subscribe ringkasan via event `myduit:budget-update`
// yang dikirim BudgetView tiap data berubah — menjaga panel ini tidak
// menggandakan query Firestore.
//
// Layout mengikuti GAS #asideGroupBudget (prototipe DesktopPrototype-Budget.html):
//   - Header "Statistik Budget" + tombol Cetak PDF (sejajar)
//   - Sisa Budget (gradient biru, hero card dengan progress bar)
//   - Hari Tersisa + Burn / Hari (2 kartu kecil)
//   - Divider
//   - Perlu Perhatian (warning card list budget yang hampir/melebihi limit)
//   - Aksi Cepat — tombol Tambah Rekening / Budget (tinggi btn-md agar tidak gepeng)
export default function BudgetAsidePanel() {
  const [data, setData] = useState(null)

  useEffect(() => {
    function onUpdate(e) {
      setData(e.detail)
    }
    window.addEventListener('myduit:budget-update', onUpdate)
    return () => window.removeEventListener('myduit:budget-update', onUpdate)
  }, [])

  // Placeholder
  const ringkas = data || {
    totalLimit: 0,
    terpakai: 0,
    sisa: 0,
    persen: 0,
    lewat: false,
    hariTersisa: 0,
    burnPerHari: 0,
    hampirHabis: [],
    akunList: 0,
  }

  function handleCetakPdf() {
    window.dispatchEvent(new CustomEvent('myduit:export-pdf'))
  }

  return (
    <aside className="hidden xl:flex xl:h-full xl:w-[350px] xl:min-w-[350px] xl:max-w-[350px] xl:shrink-0 xl:grow-0 xl:flex-col xl:overflow-hidden xl:p-4 xl:pl-2">
      <div className="clay clay-key-neutral flex h-full flex-col overflow-y-auto hide-scrollbar rounded-[28px] bg-surfaceContainerLowest p-5 w-full min-w-0">
        {/* Header — judul "Statistik Budget" + tombol Cetak PDF di kanan */}
        <div className="flex shrink-0 items-center justify-between px-1 pb-3">
          <h2 className="text-base font-extrabold tracking-tight text-slate-800">Statistik Budget</h2>
          <button
            onClick={handleCetakPdf}
            aria-label="Cetak PDF"
            title="Cetak PDF"
            className="pdf-action-btn clay-key-danger"
          >
            <span className="material-symbols-outlined icon-md">picture_as_pdf</span>
          </button>
        </div>
        <div className="mb-3.5 h-px shrink-0 bg-slate-200/70"></div>

        {/* Sisa Budget — Premier Neutral Clay Card */}
        <div className="clay-card clay-key-neutral shrink-0 rounded-[22px] bg-surfaceContainerLowest p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sisa Budget</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ringkas.lewat ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
              {ringkas.lewat ? 'Terlampaui' : `${ringkas.persen}% Terpakai`}
            </span>
          </div>
          <p className={`font-mono text-2xl font-black mt-1 ${ringkas.lewat ? 'text-expenseText' : 'text-slate-800'}`}>
            {formatRupiah(ringkas.sisa)}
          </p>
          <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-100 border border-slate-200/50">
            <div
              className={`h-full rounded-full transition-all ${ringkas.lewat ? 'bg-red-500' : 'bg-blue-600'}`}
              style={{ width: `${Math.min(100, Math.max(0, ringkas.persen))}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] font-medium text-textSecondary">
            {ringkas.lewat
              ? `Terlampaui ${formatRupiah(Math.abs(ringkas.sisa))}`
              : `Terpakai ${ringkas.persen}% · Sisa ${formatRupiah(ringkas.sisa)}`}
          </p>
        </div>

        {/* Hari tersisa + burn rate (2 kartu kecil simetris) */}
        <div className="mt-3 grid shrink-0 grid-cols-2 gap-2.5">
          <div className="clay-card clay-key-neutral rounded-[18px] bg-surfaceContainerLowest p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Hari Tersisa</p>
            <p className="font-mono text-base font-extrabold text-slate-800 mt-1">{ringkas.hariTersisa} <span className="text-xs font-medium text-slate-500">hari</span></p>
          </div>
          <div className="clay-card clay-key-neutral rounded-[18px] bg-surfaceContainerLowest p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Burn / Hari</p>
            <p className="font-mono text-base font-extrabold text-slate-800 mt-1 truncate" title={formatRupiah(ringkas.burnPerHari)}>{formatRupiah(ringkas.burnPerHari)}</p>
          </div>
        </div>

        {/* Divider + Perlu Perhatian */}
        <div className="mt-3 h-px shrink-0 bg-slate-200/70"></div>
        <p className="mt-3 shrink-0 px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
          <span className="material-symbols-outlined icon-sm text-amber-600">warning</span>
          Perlu Perhatian
        </p>
        <div className="mt-2 space-y-1.5">
          {ringkas.hampirHabis.length === 0 ? (
            <p className="rounded-[14px] bg-surfaceContainerLowest px-3 py-2 text-[11px] text-textSecondary">
              Semua budget masih aman bulan ini.
            </p>
          ) : (
            ringkas.hampirHabis.map((b) => (
              <div
                key={b.kategoriId}
                className="rounded-[14px] bg-red-50 px-3 py-2 text-[11px]"
              >
                <p className="truncate font-bold text-red-700">{b.nama}</p>
                <p className="text-red-600">
                  {formatRupiah(b.terpakai)} / {formatRupiah(b.limit)} ({b.persen}%)
                </p>
              </div>
            ))
          )}
        </div>

        {/* Spacer + Aksi Cepat — tinggi btn-md (40px) konsisten dengan tombol lain */}
        <div className="mt-auto pt-3">
          <div className="h-px bg-slate-200/70"></div>
          <p className="mt-3 px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">Aksi Cepat</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('myduit:budget-add-rekening'))}
              className="clay-btn clay-btn-secondary btn-md flex w-full items-center justify-center gap-1.5 rounded-2xl text-xs font-bold text-slate-700"
            >
              <span className="material-symbols-outlined icon-sm text-[#187498]">account_balance</span>
              Rekening
            </button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('myduit:budget-add-budget'))}
              className="clay-btn clay-key-primary solid-primary btn-md flex w-full items-center justify-center gap-1.5 rounded-2xl text-xs font-bold text-white"
            >
              <span className="material-symbols-outlined icon-sm">savings</span>
              Budget
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
