import { useRef, useState } from 'react'
import { exportData, restoreData } from './backup.js'

export default function BackupModal({ open, onClose, uid }) {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState(null)
  const [preview, setPreview] = useState(null)
  const [progress, setProgress] = useState(null)
  const fileRef = useRef(null)

  if (!open) return null

  function download(json) {
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    a.href = url
    a.download = `myduit-backup-${ts}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function ekspor() {
    setLoading(true)
    setMsg(null)
    try {
      const json = await exportData(uid)
      download(json)
      setMsg({ type: 'ok', text: `Ekspor ${Object.values(json.data).flat().length} dokumen berhasil.` })
    } catch (e) {
      setMsg({ type: 'err', text: e?.message ?? 'Gagal ekspor.' })
    } finally {
      setLoading(false)
    }
  }

  async function parseSpreadsheet(file) {
    setMsg({ type: 'info', text: 'Membaca berkas spreadsheet…' })
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      // Backup GAS memakai skema tabel lama (ID/Nama/KategoriID/...) — dipetakan
      // ke skema Firestore PWA (camelCase + field `deleted`). Tanpa konversi ini
      // dokumen tersimpan tapi TIDAK PERNAH terbaca app (semua query memakai
      // where('deleted','==',false)).
      const { konversiBackupGas } = await import('./importGas.js')
      const { json, ringkasan, catatan } = konversiBackupGas(wb, XLSX, uid)
      const totalDok = Object.values(json.data).reduce((s, arr) => s + arr.length, 0)
      if (totalDok === 0) {
        setPreview(null)
        setMsg({
          type: 'err',
          text: 'Tidak ada sheet yang dikenali. Nama sheet harus: Akun, Kategori, Transaksi, Utang, PembayaranUtang, Budget, MutasiLog.',
        })
        return
      }
      setPreview({ json, ringkasan, catatan })
      setMsg(null)
    } catch (e) {
      setPreview(null)
      setMsg({ type: 'err', text: `Gagal membaca spreadsheet: ${e?.message ?? e}` })
    }
  }

  function pilihFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 15 * 1024 * 1024) {
      setPreview(null)
      setMsg({ type: 'err', text: 'Ukuran berkas backup terlalu besar (maksimal 15 MB).' })
      return
    }
    const ext = file.name.split('.').pop().toLowerCase()
    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      parseSpreadsheet(file)
    } else {
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const json = JSON.parse(reader.result)
          if (json.app !== 'MyDuit' || !json.data) throw new Error('bukan')
          const ringkasan = Object.entries(json.data)
            .filter(([, arr]) => Array.isArray(arr) && arr.length > 0)
            .map(([c, arr]) => `${c}: ${arr.length}`)
            .join(' · ')
          setPreview({ json, ringkasan, catatan: [] })
          setMsg(null)
        } catch {
          setPreview(null)
          setMsg({ type: 'err', text: 'Berkas bukan backup MyDuit yang valid.' })
        }
      }
      reader.readAsText(file)
    }
  }

  async function pulihkan() {
    if (!preview) return
    setLoading(true)
    setMsg(null)
    setProgress({ done: 0, total: 0 })
    try {
      const n = await restoreData(uid, preview.json, (p) => setProgress(p))
      setMsg({ type: 'ok', text: `Pemulihan ${n} dokumen selesai.` })
      setPreview(null)
    } catch (e) {
      setMsg({ type: 'err', text: e?.message ?? 'Gagal memulihkan.' })
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-sm md:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="clay-sheet clay-key-neutral w-full max-w-sm p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-extrabold text-slate-800">Backup & Pulihkan</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">
            <span className="material-symbols-outlined icon-md">close</span>
          </button>
        </div>

        <p className="mb-4 text-xs leading-relaxed text-slate-500">
          Ekspor semua data ke berkas JSON di perangkatmu. Pemulihan akan menimpa dokumen dengan ID sama — aman untuk pindah device.
        </p>

        <button
          onClick={ekspor}
          disabled={loading}
          className="clay-btn clay-key-primary solid-primary btn-lg mb-2 w-full text-white disabled:opacity-60"
        >
          <span className="material-symbols-outlined icon-md">download</span>
          Ekspor Data Sekarang
        </button>

        <div className="my-3 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          <span className="h-px flex-1 bg-slate-200" /> atau <span className="h-px flex-1 bg-slate-200" />
        </div>

        <input ref={fileRef} type="file" accept="application/json,.xlsx,.xls,.csv" onChange={pilihFile} className="hidden" />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="clay-btn clay-btn-secondary btn-lg w-full text-slate-700 disabled:opacity-60"
        >
          <span className="material-symbols-outlined icon-md">upload</span>
          Pilih Berkas Backup
        </button>

        {preview && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] font-semibold text-slate-500">{preview.ringkasan}</p>
            {preview.catatan?.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {preview.catatan.map((c, i) => (
                  <li key={i} className="flex items-start gap-1 text-[10px] leading-snug text-slate-500">
                    <span className="material-symbols-outlined icon-2xs mt-px shrink-0">check</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={pulihkan}
              disabled={loading}
              className="clay-btn clay-key-danger solid-danger btn-md mt-2 w-full text-white hover:brightness-110 disabled:opacity-60"
            >
              {loading
                ? progress?.total
                  ? `Memulihkan… ${progress.done}/${progress.total}`
                  : 'Memulihkan…'
                : 'Pulihkan Data Ini'}
            </button>
            {loading && progress?.total > 0 && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-expense transition-all"
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {msg && (
          <p
            className={`mt-3 rounded-xl px-3 py-2 text-xs font-semibold ${
              msg.type === 'ok'
                ? 'bg-emerald-50 text-income'
                : msg.type === 'info'
                  ? 'bg-blue-50 text-blue-700'
                  : 'bg-red-50 text-expense'
            }`}
          >
            {msg.text}
          </p>
        )}
      </div>
    </div>
  )
}
