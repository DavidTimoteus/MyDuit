import { useState } from 'react'
import { formatRupiah } from '../../lib/format.js'
import { useKursVersi } from '../../lib/useKurs.js'
import { useBahasa } from '../../lib/i18n.js'
import { hapusBudget } from '../../lib/db.js'
import { portalBody } from '../../lib/portal.js'

// Daftar budget — paritas dengan ViewBudget.html #budgetLimitList.
// Terima props dari BudgetView: budgets (sudah dihitung dengan terpakai/persen),
// modal, setModal, hapusTarget, setHapusTarget, kategoriList.
// Catatan: FormBudgetModal dirender SATU KALI di BudgetView — modal yang sama
// dirender dua kali (di sini + di BudgetView) membuat dua overlay identik
// menumpuk tiap kali modal dibuka.
export default function BudgetPanel({
  uid,
  kategoriList,
  budgets = [],
  setModal,
  hapusTarget,
  setHapusTarget,
}) {
  useKursVersi()
  const { t: tr } = useBahasa()
  const [hapusLoading, setHapusLoading] = useState(false)

  async function konfirmHapus() {
    if (!hapusTarget) return
    const target = hapusTarget
    setHapusTarget(null)
    setHapusLoading(false)
    try {
      await hapusBudget(uid, target.id)
    } catch (e) {
      console.warn('[budget-hapus] gagal:', e?.message ?? e)
    }
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {budgets.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center p-8 text-center neu-card rounded-2xl bg-[#E5E5E5] w-full my-4">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl neu-inset bg-[#E5E5E5] text-info">
              <span className="material-symbols-outlined icon-2xl" style={{ fontVariationSettings: "'FILL' 0" }}>savings</span>
            </div>
            <p className="text-sm font-bold text-slate-800">{tr('belum_ada_budget')}</p>
            <p className="mt-1 text-xs text-slate-500 max-w-sm">{tr('budget_empty_desc')}</p>
            <button
              onClick={() => setModal({ open: true, edit: null })}
              className="neu-btn-primary solid-blue mt-4 h-9 px-4 rounded-xl text-xs font-bold text-white transition-all active:scale-95"
            >
              + {tr('tambah_budget')}
            </button>
          </div>
        ) : (
          budgets.map((b) => {
            const kategoriNama = b.kategoriNama ?? kategoriList.find((k) => k.id === b.kategoriId)?.nama ?? '?'
            const sisa = b.limitNominal - b.terpakai
            // BUG LAMA: lebar batang memakai b.persen apa adanya. Saat lewat
            // anggaran (mis. 118%) batang meluber keluar container. Dibatasi 100%.
            const lebarBar = Math.min(100, Math.max(0, b.persen))
            const status = b.lewat ? 'lewat' : b.persen >= 80 ? 'waspada' : 'aman'
            const ikonStatus = status === 'lewat' ? 'error' : status === 'waspada' ? 'warning' : 'check_circle'
            const labelStatus = status === 'lewat' ? tr('status_lewat') : status === 'waspada' ? tr('status_waspada') : tr('status_aman')
            const badgeCls = status === 'lewat'
              ? 'text-danger bg-red-50'
              : status === 'waspada'
                ? 'text-warning bg-amber-50'
                : 'text-info bg-blue-50'
            const barFill = status === 'lewat' ? 'bg-[#EB5353]' : status === 'waspada' ? 'bg-[#D4AF0D]' : 'bg-[#187498]'
            return (
              <div key={b.id} data-reveal="" className="neu-card rounded-2xl p-4.5 bg-[#E5E5E5] relative">
                <div className="flex min-w-0 items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-extrabold leading-snug text-slate-800" title={kategoriNama}>{kategoriNama}</p>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span className={`neu-chip inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeCls}`}>
                        <span className="material-symbols-outlined icon-2xs">{ikonStatus}</span>
                        {labelStatus}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">{tr('limit_nominal', { nominal: formatRupiah(b.limitNominal) })}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                    <button onClick={() => setModal({ open: true, edit: b })} aria-label={tr('edit_budget_aria', { nama: kategoriNama })} className="neu-btn flex h-7.5 w-7.5 items-center justify-center rounded-xl bg-[#E5E5E5] text-slate-600 transition-all hover:text-slate-900 active:scale-95">
                      <span className="material-symbols-outlined icon-xs">edit</span>
                    </button>
                    <button onClick={() => setHapusTarget(b)} aria-label={tr('hapus_budget_aria', { nama: kategoriNama })} className="neu-btn flex h-7.5 w-7.5 items-center justify-center rounded-xl bg-[#E5E5E5] text-slate-600 transition-all hover:text-danger active:scale-95">
                      <span className="material-symbols-outlined icon-xs">delete</span>
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <p className={`font-mono text-2xl font-black leading-none tracking-tight tabular-nums ${sisa < 0 ? 'text-danger' : 'text-slate-800'}`}>
                    {sisa < 0 ? formatRupiah(-sisa) : formatRupiah(sisa)}
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-slate-500">
                    {sisa < 0 ? tr('melebihi_limit') : tr('sisa_dari_limit')}
                  </p>
                </div>

                <div className="mt-3">
                  <div className="neu-inset h-2 w-full overflow-hidden rounded-full bg-[#E5E5E5]">
                    <div className={`progress-bar-fill h-full rounded-full ${barFill}`} style={{ width: `${lebarBar}%` }} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-semibold text-slate-500">{tr('terpakai_nominal', { nominal: formatRupiah(b.terpakai) })}</span>
                    <span className={`font-mono font-black ${status === 'lewat' ? 'text-danger' : status === 'waspada' ? 'text-warning' : 'text-info'}`}>{b.lewat ? `+${b.persen - 100}%` : `${b.persen}%`}</span>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {hapusTarget && portalBody(
        <div className="modal-backdrop-wrap fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/40 p-5 backdrop-blur-sm" onClick={() => setHapusTarget(null)}>
          <div className="clay-card clay-sheet w-full max-w-xs rounded-[24px] p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <span className="material-symbols-outlined text-4xl text-expenseText">delete</span>
            <p className="mt-2 text-sm font-bold text-slate-800">
              {tr('hapus_budget_konfirm', { nama: kategoriList.find((k) => k.id === hapusTarget.kategoriId)?.nama ?? hapusTarget.kategoriNama ?? '?' })}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => setHapusTarget(null)} className="clay-btn-soft btn-md text-xs font-bold text-slate-600">{tr('batal')}</button>
              <button onClick={konfirmHapus} disabled={hapusLoading} className="clay-btn-danger btn-md text-xs font-bold disabled:opacity-60">
                {hapusLoading ? tr('menghapus') : tr('hapus')}
              </button>
            </div>
          </div>
        </div>,
      )}
    </div>
  )
}
