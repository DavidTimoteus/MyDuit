import { useEffect, useMemo, useRef, useState } from 'react'
import { formatRupiah, isoHariIni, jamSekarang, jamValid, konversiKeBasis, parseInputTampil, sanitizeKetikNominal, simbolUang } from '../../lib/format.js'
import { buatTransaksiId, pindahSaldo } from '../../lib/db.js'
import { bacaBasisMataUang, buatSnapshotKurs } from '../../lib/kurs.js'
import { ClayDateInput, ClaySelect } from '../../components/clay-ui.jsx'
import ClayTimeInput from '../../components/ClayTimeInput.jsx'
import InfoLensaKurs from '../../components/InfoLensaKurs.jsx'
import { portalBody } from '../../lib/portal.js'
import { pesanErrorSimpan } from '../../lib/pesanError.js'
import { useBahasa } from '../../lib/i18n.js'

// Modal Pindah Saldo — markup persis GAS #modalPindahSaldo
// (clay-sheet clay-key-blue max-w-md; Tanggal, Dari*, Ke*, Nominal*, Catatan;
// peringatan bila rekening sama; submit biru "Pindahkan Saldo").
export default function ModalPindahSaldo({ uid, open, onClose, akunList }) {
  const { t: tr } = useBahasa()
  const [tanggal, setTanggal] = useState(isoHariIni())
  const [jam, setJam] = useState('')
  const [dariId, setDariId] = useState('')
  const [keId, setKeId] = useState('')
  const [jumlah, setJumlah] = useState('')
  const [catatan, setCatatan] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submittedRef = useRef(false)
  // R01 (re-review 25 Nov 2026): ID dokumen dibuat sekali per sesi form dan
  // dipakai ulang bila submit diulang — retry memakai ID yang sama sehingga
  // pindahSaldo mengenalinya sebagai retry (dokumen sudah ada = no-op).
  const docIdRef = useRef(null)

  useEffect(() => {
    if (!open) return
    submittedRef.current = false
    docIdRef.current = null
    setTanggal(isoHariIni())
    setJam('')
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
    const n = konversiKeBasis(parseInputTampil(jumlah))
    if (!dariId || !keId) return setError(tr('pilih_rekening_dulu'))
    if (sama) return setError(tr('rekening_sama'))
    if (n <= 0) return setError(tr('nominal_harus_positif'))
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
              msg: `Perhatian: Saldo ${dari.nama} tidak boleh minus! Sisa saldo saat ini ${formatRupiah(saldoDari)}. Periksa kembali debit & kredit rekening Anda.`,
            },
          })
        )
      }
    }

    // Snapshot agar konsisten setelah modal ditutup.
    const dariIdSnap = dariId
    const keIdSnap = keId
    const tanggalSnap = tanggal
    const jamSnap = jamValid(jam) || jamSekarang()
    const catatanSnap = catatan.trim()

    // ID sekali per sesi form (lihat docIdRef di atas) — retry pakai ID sama.
    const docId = (docIdRef.current ??= buatTransaksiId(uid))
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
      jam: jamSnap,
      catatan: catatanSnap,
      kursSnapshot: buatSnapshotKurs(bacaBasisMataUang() || 'IDR', tanggalSnap),
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
          jam: jamSnap,
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

  return portalBody(
    <div className="modal-backdrop-wrap fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="clay-sheet clay-key-blue flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 pb-2 pt-4">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-800 sm:text-base">
            <span className="material-symbols-outlined shrink-0 icon-lg text-blue-600">sync_alt</span>
            {tr('pindah_saldo')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr('tutup')}
            className="clay-chip clay-key-neutral flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-600"
          >
            <span className="material-symbols-outlined icon-lg">close</span>
          </button>
        </div>

        <form onSubmit={submit} className="min-h-0 space-y-2 overflow-y-auto px-4 pb-4 pt-2">
          <div className="flex flex-col gap-1">
            <label className="block text-[11px] font-semibold text-slate-600">{tr('tanggal')}</label>
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <ClayDateInput value={tanggal} onChange={setTanggal} />
              </div>
              <div className="flex w-[104px] shrink-0 flex-col gap-1">
                <label htmlFor="tx-jam" className="block text-[10px] font-semibold text-slate-600">{tr('jam')}</label>
                <ClayTimeInput id="tx-jam" value={jam} onChange={setJam} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="block text-[11px] font-semibold text-slate-600">
              {tr('dari_rekening')} <span className="text-red-500">*</span>
            </label>
            <ClaySelect value={dariId} onChange={setDariId} placeholder={tr('pilih_rekening_sumber')} options={opsiAkun} />
          </div>

          <div className="flex flex-col gap-1">
            <label className="block text-[11px] font-semibold text-slate-600">
              {tr('ke_rekening')} <span className="text-red-500">*</span>
            </label>
            <ClaySelect value={keId} onChange={setKeId} placeholder={tr('pilih_rekening_tujuan')} options={opsiAkun} />
            {sama && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-2 text-[11.5px] font-medium leading-snug text-red-600">
                <span className="material-symbols-outlined mt-px shrink-0 icon-xs">error</span>
                <span>{tr('rekening_sama')}</span>
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="block text-[11px] font-semibold text-slate-600">
              {tr('nominal')} ({simbolUang()}) <span className="text-red-500">*</span>
            </label>
            <div className="relative flex items-center">
              <span className="pointer-events-none absolute left-3.5 text-base font-extrabold font-mono text-info">
                {simbolUang()}
              </span>
              <input
                type="text"
                value={jumlah}
                onChange={(e) => setJumlah(sanitizeKetikNominal(e.target.value))}
                inputMode="decimal"
                placeholder="0"
                required
                className="clay-input field-lg w-full rounded-2xl pl-11 pr-4 text-base font-black font-mono tracking-tight outline-none !text-info"
              />
            </div>
            <InfoLensaKurs nilaiBasis={konversiKeBasis(parseInputTampil(jumlah))} className="mt-1" />
          </div>

          <div className="flex flex-col gap-1">
            <label className="block text-[11px] font-semibold text-slate-600">{tr('catatan')}</label>
            <input
              type="text"
              maxLength={500}
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder={tr('catatan_opsional')}
              className="clay-input field-lg w-full text-sm outline-none"
            />
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="clay-btn-secondary clay-btn btn-md text-slate-600 hover:bg-slate-50"
            >
              {tr('batal')}
            </button>
            <button
              type="submit"
              disabled={saving || sama}
              className="clay-btn clay-key-blue solid-blue btn-md text-white disabled:opacity-60"
            >
              <span className="material-symbols-outlined icon-sm">sync_alt</span>
              {tr(saving ? 'memproses' : 'pindahkan_saldo')}
            </button>
          </div>
        </form>
      </div>
    </div>,
  )
}
