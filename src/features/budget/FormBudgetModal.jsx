import { useEffect, useRef, useState } from 'react'
import { formatRibuanInput, parseNominal, simbolUang } from '../../lib/format.js'
import { simpanBudget } from '../../lib/db.js'
import { ClaySelect } from '../../components/clay-ui.jsx'
import { pesanErrorSimpan } from '../../lib/pesanError.js'

// Modal Tambah / Edit Budget — markup persis GAS #modalBudget
// (clay-sheet clay-key-blue max-w-md, ikon savings biru, header dengan title + close,
// form kategori combobox + bulan/tahun + limit nominal, tombol Simpan biru).
export default function FormBudgetModal({ open, onClose, uid, kategoriList, existing, edit, bulan, tahun }) {
  const [kategoriId, setKategoriId] = useState('')
  const [limit, setLimit] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submittedRef = useRef(false)

  useEffect(() => {
    if (open) submittedRef.current = false
  }, [open, edit?.id])

  // Isi ulang tiap kali modal dibuka
  const kunci = open ? open + (edit?.id ?? '') : 'tutup'
  const [kunciLama, setKunciLama] = useState(kunci)
  if (kunci !== kunciLama) {
    setKunciLama(kunci)
    setKategoriId(edit?.kategoriId ?? '')
    setLimit(formatRibuanInput(String(edit?.limitNominal ?? '')))
    setError('')
  }

  if (!open) return null
  const opsi = kategoriList.filter((k) => k.jenis === 'pengeluaran')
  const dipakaiKategori = new Set(existing.filter((b) => b.id !== edit?.id).map((b) => b.kategoriId))

  async function submit(e) {
    e.preventDefault()
    if (submittedRef.current) return
    const kat = opsi.find((k) => k.id === kategoriId)
    const n = parseNominal(limit)
    if (!kat) return setError('Pilih kategori dulu.')
    if (n <= 0) return setError('Limit harus lebih dari nol.')
    submittedRef.current = true

    const idSnap = edit?.id
    const kategoriIdSnap = kat.id
    const kategoriNamaSnap = kat.nama

    // OPTIMISTIC: tutup modal sekarang, commit Firestore di background.
    setError('')
    setSaving(false)
    onClose()

    ;(async () => {
      try {
        await simpanBudget(uid, {
          id: idSnap,
          kategoriId: kategoriIdSnap,
          kategoriNama: kategoriNamaSnap,
          limitNominal: n,
          bulan,
          tahun,
        })
      } catch (e2) {
        console.warn('[budget-simpan] gagal:', e2?.message ?? e2)
        window.dispatchEvent(new CustomEvent('myduit:toast', { detail: { type: 'error', msg: pesanErrorSimpan('Menyimpan budget', e2) } }))
      }
    })()
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="clay-sheet clay-key-blue w-full max-w-sm rounded-[24px] p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-extrabold text-slate-800">
            <span className="material-symbols-outlined text-blue-700">savings</span>
            {edit ? 'Edit Budget' : 'Tambah Budget'}
          </h3>
          <button type="button" onClick={onClose} aria-label="Tutup" className="clay-chip clay-key-neutral flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100">
            <span className="material-symbols-outlined icon-md">close</span>
          </button>
        </div>
        <p className="mb-3 rounded-[10px] bg-blue-50 px-3 py-2 text-[11px] font-bold text-blue-700">
          Periode: {bulan !== undefined ? new Date(2000, bulan).toLocaleString('id-ID', { month: 'long' }) : 'Bulan'} {tahun}
        </p>
        <label className="mb-0.5 block text-[11px] font-semibold text-textSecondary">Kategori pengeluaran</label>
        <ClaySelect
          value={kategoriId}
          onChange={setKategoriId}
          placeholder="Pilih kategori…"
          className="mb-3"
          options={[{ value: '', label: 'Pilih…', disabled: true }, ...opsi.map((k) => ({ value: k.id, label: k.nama + (dipakaiKategori.has(k.id) ? ' (sudah ada)' : ''), disabled: dipakaiKategori.has(k.id) }))]}
        />
        <label className="mb-0.5 block text-[11px] font-semibold text-textSecondary">Limit per bulan</label>
        <div className="relative mb-4 flex items-center">
          <span className="pointer-events-none absolute left-3.5 text-sm font-bold text-slate-500">
            {simbolUang()}
          </span>
          <input
            value={limit}
            onChange={(e) => setLimit(formatRibuanInput(e.target.value))}
            inputMode="numeric"
            placeholder="0"
            className="clay-input field-lg w-full rounded-2xl pl-11 pr-4 text-sm font-semibold outline-none placeholder:text-slate-500"
          />
        </div>
        {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{error}</p>}
        <button disabled={saving} className="clay-btn clay-key-blue solid-blue btn-lg w-full text-sm font-extrabold text-white transition-colors disabled:opacity-60">
          <span className="material-symbols-outlined icon-sm">save</span>
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </form>
    </div>
  )
}
