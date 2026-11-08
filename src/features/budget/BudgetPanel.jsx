import { useState } from 'react'
import { formatRupiah } from '../../lib/format.js'
import { hapusBudget } from '../../lib/db.js'

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
          <div className="clay-card-soft col-span-full flex flex-col items-center px-6 py-12 text-center rounded-2xl bg-[#E5E5E5]">
            <span className="material-symbols-outlined mb-3 text-5xl text-blue-400/50" style={{ fontVariationSettings: "'FILL' 0" }}>savings</span>
            <p className="text-sm font-bold text-slate-700">Belum ada budget untuk periode ini</p>
            <p className="mt-1 text-xs text-slate-500">Tekan tombol + di bawah untuk membatasi pengeluaran.</p>
            <button
              onClick={() => setModal({ open: true, edit: null })}
              className="clay-btn clay-key-blue solid-blue mt-4 px-4 py-2.5 text-xs font-semibold text-white"
            >
              + Tambah Budget
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
            const warnaBar = status === 'lewat' ? 'bg-red-500' : status === 'waspada' ? 'bg-amber-500' : 'bg-blue-500'
            const warnaTeks = status === 'lewat' ? 'text-red-600' : status === 'waspada' ? 'text-amber-600' : 'text-blue-700'
            const ikonStatus = status === 'lewat' ? 'error' : status === 'waspada' ? 'warning' : 'check_circle'
            const labelStatus = status === 'lewat' ? 'Lewat' : status === 'waspada' ? 'Waspada' : 'Aman'
            return (
              <div key={b.id} className="clay-card rounded-[24px] relative overflow-hidden p-4 pl-5">
                <span className={`absolute inset-y-0 left-0 w-1.5 ${warnaBar}`} aria-hidden="true" />
                <div className="flex min-w-0 items-start justify-between gap-2 mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold leading-snug text-slate-800" title={kategoriNama}>{kategoriNama}</p>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${warnaTeks} ${status === 'lewat' ? 'bg-red-50' : status === 'waspada' ? 'bg-amber-50' : 'bg-blue-50'}`}>
                        <span className="material-symbols-outlined icon-2xs">{ikonStatus}</span>
                        {labelStatus}
                      </span>
                      <span className="text-[11px] font-medium text-slate-500 whitespace-nowrap">Limit {formatRupiah(b.limitNominal)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 pt-0.5">
                    <button onClick={() => setModal({ open: true, edit: b })} aria-label={`Edit budget ${kategoriNama}`} className="clay-chip clay-key-neutral flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-600">
                      <span className="material-symbols-outlined icon-xs">edit</span>
                    </button>
                    <button onClick={() => setHapusTarget(b)} aria-label={`Hapus budget ${kategoriNama}`} className="clay-chip clay-key-neutral flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600">
                      <span className="material-symbols-outlined icon-xs">delete</span>
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <p className={`text-[26px] font-extrabold leading-none tracking-tight ${sisa < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                    {sisa < 0 ? formatRupiah(-sisa) : formatRupiah(sisa)}
                  </p>
                  <p className="mt-1 text-[11px] font-medium text-slate-500">
                    {sisa < 0 ? 'melebihi limit' : 'sisa dari limit'}
                  </p>
                </div>

                <div className="mt-3">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full transition-all ${warnaBar}`} style={{ width: `${lebarBar}%` }} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-medium text-slate-500">Terpakai {formatRupiah(b.terpakai)}</span>
                    <span className={`font-extrabold ${warnaTeks}`}>{b.lewat ? `+${b.persen - 100}%` : `${b.persen}%`}</span>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {hapusTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-5 backdrop-blur-sm" onClick={() => setHapusTarget(null)}>
          <div className="clay-card w-full max-w-xs rounded-[24px] p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <span className="material-symbols-outlined text-4xl text-expenseText">delete</span>
            <p className="mt-2 text-sm font-bold text-slate-800">
              Hapus budget "{kategoriList.find((k) => k.id === hapusTarget.kategoriId)?.nama ?? hapusTarget.kategoriNama ?? '?'}"?
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => setHapusTarget(null)} className="clay-btn-soft btn-md text-xs font-bold text-slate-600">Batal</button>
              <button onClick={konfirmHapus} disabled={hapusLoading} className="clay-btn-danger btn-md text-xs font-bold disabled:opacity-60">
                {hapusLoading ? 'Menghapus…' : 'Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
