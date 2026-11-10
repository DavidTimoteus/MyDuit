import { useEffect, useMemo, useRef, useState } from 'react'
import { formatNominal, formatRibuanInput, isoHariIni, parseNominal, simbolUang } from '../../lib/format.js'
import { buatTransaksiId, pindahSaldo } from '../../lib/db.js'
import { ClayDateInput, ClaySelect } from '../../components/clay-ui.jsx'
import { pesanErrorSimpan } from '../../lib/pesanError.js'

// Modal Pindah Saldo — markup persis GAS #modalPindahSaldo
// (clay-sheet clay-key-blue max-w-md; Tanggal, Dari*, Ke*, Nominal*, Catatan;
// peringatan bila rekening sama; submit biru "Pindahkan Saldo").
export default function ModalPindahSaldo({ uid, open, onClose, akunList }) {
  const [tanggal, setTanggal] = useState(isoHariIni())
  const [dariId, setDariId] = useState('')
  const [keId, setKeId] = useState('')
  const [jumlah, setJumlah] = useState('')
  const [catatan, setCatatan] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submittedRef = useRef(false)

  useEffect(() => {
    if (!open) return
    submittedRef.current = false
    setTanggal(isoHariIni())
    setDariId(akunList[0]?.id ?? '')
    setKeId(akunList[1]?.id ?? '')
    setJumlah('')
    setCatatan('')
    setSaving(false)
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const sama = useMemo(() => dariId !== '' && dariId === keId, [dariId, keId])

  async function submit(e) {
    e.preventDefault()
    if (submittedRef.current) return
    const n = parseNominal(jumlah)
    if (!dariId || !keId) return setError('Pilih rekening sumber & tujuan dulu.')
    if (sama) return setError('Rekening sumber & tujuan tidak boleh sama.')
    if (n <= 0) return setError('Nominal harus lebih dari nol.')
    submittedRef.current = true
    const dari = akunList.find((a) => a.id === dariId)
    const ke = akunList.find((a) => a.id === keId)

    if (dari) {
      const saldoDari = Number(dari.saldo) || 0
      if (saldoDari - n < 0) {
        window.dispatchEvent(
          new CustomEvent('myduit:toast', {
            detail: {
              type: 'warning',
              msg: `Perhatian: Saldo ${dari.nama} tidak boleh minus! Sisa saldo saat ini ${formatNominal(saldoDari)}. Periksa kembali debit & kredit rekening Anda.`,
            },
          })
        )
      }
    }

    // Snapshot agar konsisten setelah modal ditutup.
    const dariIdSnap = dariId
    const keIdSnap = keId
    const tanggalSnap = tanggal
    const catatanSnap = catatan.trim()

    const docId = buatTransaksiId(uid)
    const optTx = {
      id: docId,
      jumlah: n,
      jenis: 'pindah saldo',
      kategoriId: '',
      kategoriNama: 'Pindah Saldo',
      akunId: dariIdSnap,
      akunNama: `${dari?.nama ?? ''} → ${ke?.nama ?? ''}`,
      dariId: dariIdSnap,
      keId: keIdSnap,
      tanggal: tanggalSnap,
      catatan: catatanSnap,
      deleted: false,
      createdAt: new Date().toISOString(),
    }
    window.dispatchEvent(new CustomEvent('myduit:transaksi-added', { detail: { item: optTx } }))

    // OPTIMISTIC: tutup modal sekarang, commit Firestore di background
    // (writeBatch baru resolve setelah server ack → jangan ditunggu di UI).
    setError('')
    setSaving(false)
    onClose()

    ;(async () => {
      try {
        await pindahSaldo(uid, {
          id: docId,
          dariId: dariIdSnap,
          dariNama: dari?.nama ?? '',
          keId: keIdSnap,
          keNama: ke?.nama ?? '',
          jumlah: n,
          tanggal: tanggalSnap,
          catatan: catatanSnap,
        })
      } catch (e2) {
        console.warn('[pindah-saldo] gagal:', e2?.message ?? e2)
        window.dispatchEvent(new CustomEvent('myduit:transaksi-deleted', { detail: { ids: [docId] } }))
        window.dispatchEvent(new CustomEvent('myduit:toast', { detail: { type: 'error', msg: pesanErrorSimpan('Memindahkan saldo', e2) } }))
      }
    })()
  }

  if (!open) return null

  const opsiAkun = akunList.map((a) => ({ value: a.id, label: a.nama }))

  return (
    <div className="modal-backdrop-wrap fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="clay-sheet clay-key-blue flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 pb-2 pt-4">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-800 sm:text-base">
            <span className="material-symbols-outlined shrink-0 icon-lg text-blue-600">sync_alt</span>
            Pindah Saldo
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="clay-chip clay-key-neutral flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <span className="material-symbols-outlined icon-lg">close</span>
          </button>
        </div>

        <form onSubmit={submit} className="min-h-0 space-y-2 overflow-y-auto px-4 pb-4 pt-2">
          <div className="flex flex-col gap-1">
            <label className="block text-[11px] font-semibold text-slate-600">Tanggal</label>
            <ClayDateInput value={tanggal} onChange={setTanggal} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="block text-[11px] font-semibold text-slate-600">
              Dari Rekening (Sumber) <span className="text-red-500">*</span>
            </label>
            <ClaySelect value={dariId} onChange={setDariId} placeholder="Pilih Rekening Sumber" options={opsiAkun} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="block text-[11px] font-semibold text-slate-600">
              Ke Rekening (Tujuan) <span className="text-red-500">*</span>
            </label>
            <ClaySelect value={keId} onChange={setKeId} placeholder="Pilih Rekening Tujuan" options={opsiAkun} />
            {sama && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-2 text-[11.5px] font-medium leading-snug text-red-600">
                <span className="material-symbols-outlined mt-px shrink-0 icon-xs">error</span>
                <span>Rekening sumber & tujuan tidak boleh sama.</span>
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="block text-[11px] font-semibold text-slate-600">
              Nominal ({simbolUang()}) <span className="text-red-500">*</span>
            </label>
            <div className="relative flex items-center">
              <span className="pointer-events-none absolute left-3.5 text-base font-extrabold font-mono text-[#187498]">
                {simbolUang()}
              </span>
              <input
                type="text"
                value={jumlah}
                onChange={(e) => setJumlah(formatRibuanInput(e.target.value))}
                inputMode="numeric"
                placeholder="0"
                required
                className="clay-input field-lg w-full rounded-2xl pl-11 pr-4 text-base font-black font-mono tracking-tight outline-none transition-colors !text-[#187498]"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="block text-[11px] font-semibold text-slate-600">Catatan</label>
            <input
              type="text"
              maxLength={500}
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="Catatan opsional"
              className="clay-input field-lg w-full text-sm outline-none transition-colors"
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="clay-btn-secondary clay-btn btn-md text-slate-600 transition-colors hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving || sama}
              className="clay-btn clay-key-blue solid-blue btn-md text-white transition-colors disabled:opacity-60"
            >
              <span className="material-symbols-outlined icon-sm">sync_alt</span>
              {saving ? 'Memproses…' : 'Pindahkan Saldo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
