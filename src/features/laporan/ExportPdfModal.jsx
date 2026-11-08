import { useEffect, useState } from 'react'
import { ambilDataLaporan, unduhLaporanPdf } from './laporan.js'
import { ClaySelect } from '../../components/clay-ui.jsx'

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

export default function ExportPdfModal({ open, onClose, uid, userName }) {
  const now = new Date()
  const [bulan, setBulan] = useState(now.getMonth())
  const [tahun, setTahun] = useState(now.getFullYear())
  const [pakaiAI, setPakaiAI] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  async function proses() {
    setLoading(true)
    setError('')
    try {
      const data = await ambilDataLaporan(uid, Number(bulan), Number(tahun))
      await unduhLaporanPdf(data, pakaiAI, userName)
      onClose()
    } catch (e) {
      setError(e?.message ?? 'Gagal menyiapkan laporan PDF.')
    } finally {
      setLoading(false)
    }
  }

  const tahunSekarang = now.getFullYear()
  const tahunOps = Array.from({ length: 2 }, (_, i) => tahunSekarang - i)

  return (
    <div className="modal-backdrop-wrap fixed inset-0 z-[10000] flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="clay-sheet clay-key-primary flex max-h-[90vh] w-full flex-col overflow-hidden sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 pb-4 pt-5">
          <h3 className="text-lg font-extrabold text-slate-800">Export Laporan PDF</h3>
          <button onClick={onClose} aria-label="Tutup" className="clay-chip clay-key-neutral flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:text-slate-600">
            <span className="material-symbols-outlined icon-lg">close</span>
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-xs font-semibold text-slate-500">Pilih periode laporan yang ingin diexport</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-textSecondary">Bulan</label>
              <ClaySelect value={String(bulan)} onChange={(v) => setBulan(Number(v))} options={BULAN.map((label, value) => ({ value: String(value), label }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-textSecondary">Tahun</label>
              <ClaySelect value={String(tahun)} onChange={(v) => setTahun(Number(v))} options={tahunOps.map((v) => ({ value: String(v), label: String(v) }))} />
            </div>
          </div>
          <div className="neu-inset flex min-h-[84px] items-center justify-between gap-4 rounded-2xl bg-[#E5E5E5] px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-800 tracking-tight">Sertakan Rekomendasi AI</p>
              <p className="mt-0.5 max-w-[250px] text-xs leading-snug text-slate-500">
                {pakaiAI
                  ? 'Pratinjau section AI di bagian akhir laporan.'
                  : 'Analisis & saran keuangan otomatis di bagian akhir laporan.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Sertakan rekomendasi AI"
              aria-checked={pakaiAI}
              onClick={() => setPakaiAI((v) => !v)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                pakaiAI ? '!bg-[#36AE7C]' : '!bg-slate-300'
              }`}
            >
              <span
                className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  pakaiAI ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-expense">{error}</p>}
        </div>
        <div className="flex shrink-0 gap-3 border-t border-slate-100 px-5 py-4">
          <button onClick={onClose} className="clay-btn clay-btn-secondary btn-md flex-1 text-textSecondary">Batal</button>
          <button onClick={proses} disabled={loading} className="clay-btn clay-key-primary solid-primary btn-md flex-1 text-white disabled:opacity-60">
            <span className="material-symbols-outlined icon-md">picture_as_pdf</span>
            {loading ? 'Menyiapkan…' : 'Export PDF'}
          </button>
        </div>
      </div>
    </div>
  )
}
