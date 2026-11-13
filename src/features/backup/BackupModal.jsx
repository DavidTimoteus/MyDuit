import { useEffect, useRef, useState } from 'react'
import { exportData, hapusAkunPermanen, hapusSemuaData, restoreData } from './backup.js'
import { portalBody } from '../../lib/portal.js'
import { useBahasa } from '../../lib/i18n.js'

export default function BackupModal({ open, onClose, uid }) {
  const { t } = useBahasa()
  const [loading, setLoading] = useState(false)
  const [aksi, setAksi] = useState(null)
  const [msg, setMsg] = useState(null)
  const [preview, setPreview] = useState(null)
  const [progress, setProgress] = useState(null)
  const [dangerOpen, setDangerOpen] = useState(false)
  const [konfirmTeks, setKonfirmTeks] = useState('')
  const [hapusAkunIkut, setHapusAkunIkut] = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    if (open) {
      setDangerOpen(false)
      setKonfirmTeks('')
      setHapusAkunIkut(false)
      setAksi(null)
      setProgress(null)
    }
  }, [open])

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
    setAksi('ekspor')
    setMsg(null)
    try {
      const json = await exportData(uid)
      download(json)
      setMsg({ type: 'ok', text: `Ekspor ${Object.values(json.data).flat().length} dokumen berhasil.` })
    } catch (e) {
      setMsg({ type: 'err', text: e?.message ?? 'Gagal ekspor.' })
    } finally {
      setLoading(false)
      setAksi(null)
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
    setAksi('pulihkan')
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
      setAksi(null)
      setProgress(null)
    }
  }

  const konfirmCocok = konfirmTeks.trim().toUpperCase() === 'HAPUS SEMUA'
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false

  async function eksekusiHapusTotal() {
    if (!konfirmCocok || loading) return
    setLoading(true)
    setAksi('hapus')
    setMsg(null)
    setProgress({ done: 0, total: 0 })
    try {
      const res = hapusAkunIkut
        ? await hapusAkunPermanen(uid, (p) => setProgress(p))
        : await hapusSemuaData(uid, (p) => setProgress(p))
      setDangerOpen(false)
      setKonfirmTeks('')
      setHapusAkunIkut(false)
      setPreview(null)
      setMsg({
        type: 'ok',
        text: hapusAkunIkut
          ? 'Akun & seluruh data berhasil dihapus permanen.'
          : res.deleted > 0
            ? `Hapus total selesai (${res.deleted} dokumen dihapus permanen).`
            : 'Akun sudah bersih (tidak ada dokumen tersimpan).',
      })
    } catch (e) {
      setMsg({ type: 'err', text: e?.message ?? 'Gagal menghapus seluruh data.' })
    } finally {
      setLoading(false)
      setAksi(null)
      setProgress(null)
    }
  }

  return portalBody(
    <div className="modal-backdrop-wrap fixed inset-0 z-[10000] flex items-end justify-center bg-slate-900/50 backdrop-blur-sm md:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="clay-sheet clay-key-neutral modal-sheet-bottom max-h-[90vh] w-full max-w-sm overflow-y-auto p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-extrabold text-slate-800">{t('backup_restore')}</h3>
          <button onClick={onClose} aria-label={t('tutup')} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">
            <span className="material-symbols-outlined icon-md">close</span>
          </button>
        </div>

        <p className="mb-4 text-xs leading-relaxed text-slate-500">
          {t('backup_desc')}
        </p>

        <button
          onClick={ekspor}
          disabled={loading}
          className="clay-btn clay-key-primary solid-primary btn-lg mb-2 w-full text-white disabled:opacity-60"
        >
          <span className="material-symbols-outlined icon-md">download</span>
          {t('ekspor_sekarang')}
        </button>

        <div className="my-3 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">
          <span className="h-px flex-1 bg-slate-200" /> {t('atau')} <span className="h-px flex-1 bg-slate-200" />
        </div>

        <input ref={fileRef} type="file" accept="application/json,.xlsx,.xls,.csv" onChange={pilihFile} className="hidden" />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          className="clay-btn clay-btn-secondary btn-lg w-full text-slate-700 disabled:opacity-60"
        >
          <span className="material-symbols-outlined icon-md">upload</span>
          {t('pilih_berkas')}
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
                  className="progress-bar-fill h-full rounded-full bg-expense"
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

        {/* Zona Bahaya: Hapus Total Data Permanen */}
        <div className="mt-4 border-t border-slate-200/80 pt-3.5">
          {!dangerOpen ? (
            <button
              type="button"
              onClick={() => {
                setDangerOpen(true)
                setKonfirmTeks('')
                setHapusAkunIkut(false)
                setMsg(null)
              }}
              disabled={loading}
              className="clay-btn clay-btn-secondary btn-md w-full text-xs font-bold text-[#EB5353] hover:bg-red-50 disabled:opacity-60"
            >
              <span className="material-symbols-outlined icon-sm">delete_forever</span>
              {t('hapus_total_btn')}
            </button>
          ) : (
            <div className="neu-inset rounded-2xl bg-red-50/75 p-3.5 border border-red-200/80">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined icon-md mt-0.5 shrink-0 text-[#EB5353]">warning</span>
                <div className="min-w-0">
                  <h4 className="text-xs font-extrabold text-red-700">{t('hapus_permanen_judul')}</h4>
                  <p className="mt-1 text-[11px] leading-relaxed text-red-700/90">
                    {t('hapus_permanen_desc')}
                  </p>
                  {isOffline && (
                    <p className="mt-1 text-[10px] font-bold text-amber-700">
                      {t('offline_hapus_note')}
                    </p>
                  )}
                </div>
              </div>

              <label className="mt-2.5 flex cursor-pointer items-start gap-2 rounded-xl bg-white/75 px-2.5 py-2 text-[11px] font-bold text-red-800">
                <input
                  type="checkbox"
                  checked={hapusAkunIkut}
                  onChange={(e) => setHapusAkunIkut(e.target.checked)}
                  disabled={loading}
                  className="mt-0.5 accent-[#EB5353]"
                />
                <span>{t('hapus_akun_label')}</span>
              </label>

              <button
                type="button"
                onClick={ekspor}
                disabled={loading}
                className="clay-btn clay-btn-secondary btn-sm mt-2.5 w-full text-[11px] font-bold text-slate-700 disabled:opacity-60"
              >
                <span className="material-symbols-outlined icon-xs">download</span>
                {loading && aksi === 'ekspor' ? 'Mengekspor…' : t('ekspor_dulu')}
              </button>

              <label className="mt-2.5 block text-[10px] font-bold uppercase tracking-wide text-red-700">
                {t('konfirm_label', { kata: 'HAPUS SEMUA' })}
              </label>
              <input
                type="text"
                value={konfirmTeks}
                onChange={(e) => setKonfirmTeks(e.target.value)}
                disabled={loading}
                placeholder="HAPUS SEMUA"
                autoComplete="off"
                className="clay-input field-md mt-1 w-full rounded-xl px-3 text-xs font-bold tracking-wider uppercase outline-none placeholder:text-slate-400"
              />

              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDangerOpen(false)
                    setKonfirmTeks('')
                    setHapusAkunIkut(false)
                  }}
                  disabled={loading}
                  className="clay-btn clay-btn-secondary btn-md text-xs font-bold text-slate-600 disabled:opacity-60"
                >
                  {t('batal')}
                </button>
                <button
                  type="button"
                  onClick={eksekusiHapusTotal}
                  disabled={loading || !konfirmCocok}
                  className="clay-btn clay-key-danger solid-danger btn-md text-xs font-extrabold text-white disabled:opacity-50"
                >
                  {loading && aksi === 'hapus'
                    ? progress?.total
                      ? `Menghapus… ${progress.done}/${progress.total}`
                      : 'Menghapus…'
                    : (hapusAkunIkut ? t('hapus_akun_submit') : t('hapus_total_submit'))}
                </button>
              </div>

              {loading && aksi === 'hapus' && progress?.total > 0 && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-red-200/70">
                  <div
                    className="progress-bar-fill h-full rounded-full bg-[#EB5353]"
                    style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
  )
}
