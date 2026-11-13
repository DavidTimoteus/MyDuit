import { useEffect, useRef, useState } from 'react'
import { formatInputTampil, formatNominal, formatRupiah, isoHariIni, konversiKeBasis, konversiUntukTampil, parseInputTampil, rasioKursTampil, sanitizeKetikNominal, simbolUang } from '../../lib/format.js'
import { bayarUtang, buatTransaksiId, simpanUtang } from '../../lib/db.js'
import { ClayDateInput, ClaySelect } from '../../components/clay-ui.jsx'
import { pesanErrorSimpan } from '../../lib/pesanError.js'
import { portalBody } from '../../lib/portal.js'

function isoTambahHari(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ===== FORM TAMBAH/EDIT UTANG =====
export function FormUtangModal({ open, onClose, uid, edit, mode = 'utang' }) {
  const [namaPihak, setNamaPihak] = useState('')
  const [tipe, setTipe] = useState('Utang')
  const [total, setTotal] = useState('')
  const [cicilan, setCicilan] = useState('')
  const [tgl, setTgl] = useState(isoTambahHari(30))
  const [deskripsi, setDeskripsi] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submittedRef = useRef(false)

  useEffect(() => {
    if (open) submittedRef.current = false
  }, [open, edit?.id, mode])

  // Reset isi form mengikuti kunci pembuka (id edit + mode).
  // kunciLama DIINISIASI null, BUKAN kunci: UtangView memakai `key`, jadi
  // instance modal selalu BARU tiap dibuka — dengan useState(kunci) kunci
  // selalu sama saat mount, reset tak pernah jalan, dan form edit terbuka
  // kosong. Dengan null, reset jalan tepat di render pertama (isi terisi
  // sebelum paint, tanpa kedip) sekaligus tetap menangani pergantian target
  // bila suatu saat `key` dilepas.
  const kunci = open ? `buka|${edit?.id ?? ''}|${mode}` : 'tutup'
  const [kunciLama, setKunciLama] = useState(null)
  if (kunci !== kunciLama) {
    setKunciLama(kunci)
    setNamaPihak(edit?.namaPihak ?? '')
    setTipe(edit?.tipe ?? (mode === 'cicilan' ? 'Cicilan' : 'Utang'))
    setTotal(edit?.total ? formatInputTampil(edit.total) : '')
    setCicilan(edit?.cicilanPerBulan ? formatInputTampil(edit.cicilanPerBulan) : '')
    setTgl(edit?.tglJatuhTempo ?? isoTambahHari(30))
    setDeskripsi(edit?.deskripsi ?? '')
    setError('')
  }

  if (!open) return null

  async function submit(e) {
    e.preventDefault()
    if (submittedRef.current) return
    const n = konversiKeBasis(parseInputTampil(total))
    if (!namaPihak.trim()) return setError('Nama pihak wajib diisi.')
    if (n <= 0) return setError('Total harus lebih dari nol.')
    submittedRef.current = true

    // Snapshot sebelum modal ditutup
    const editSnap = edit
    const namaSnap = namaPihak.trim()
    const deskSnap = deskripsi.trim()
    const tipeSnap = tipe
    const cicilanSnap = konversiKeBasis(parseInputTampil(cicilan))
    const tglSnap = tgl

    // OPTIMISTIC: tutup modal sekarang, commit Firestore di background.
    setError('')
    setSaving(false)
    onClose()

    ;(async () => {
      try {
        await simpanUtang(uid, {
          id: editSnap?.id,
          namaPihak: namaSnap,
          deskripsi: deskSnap,
          total: n,
          tipe: tipeSnap,
          cicilanPerBulan: cicilanSnap,
          tglJatuhTempo: tglSnap,
          sisaLama: editSnap?.sisa,
          totalLama: editSnap?.total,
        })
      } catch (e2) {
        console.warn('[utang-simpan] gagal:', e2?.message ?? e2)
        window.dispatchEvent(new CustomEvent('myduit:toast', { detail: { type: 'error', msg: pesanErrorSimpan('Menyimpan utang', e2) } }))
      }
    })()
  }

  return portalBody(
    <div className="modal-backdrop-wrap fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="neu-card w-full max-w-sm rounded-3xl bg-[#E5E5E5] p-6 shadow-2xl border border-white/50">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-extrabold text-slate-800">
            <span className="material-symbols-outlined text-[#EB5353]">account_balance_wallet</span>
            {edit ? 'Edit Utang' : 'Tambah Utang'}
          </h3>
          <button type="button" onClick={onClose} aria-label="Tutup form utang" className="neu-btn flex h-8 w-8 items-center justify-center rounded-full bg-[#E5E5E5] text-slate-600 hover:text-slate-900 active:scale-95 transition-all">
            <span className="material-symbols-outlined icon-md">close</span>
          </button>
        </div>

        {/* Segmented Toggle Tipe Utang vs Cicilan */}
        <div className="mb-3.5">
          <div className="neu-inset flex items-center p-1 rounded-2xl bg-[#E5E5E5]">
            <button
              type="button"
              onClick={() => setTipe('Utang')}
              className={`flex flex-1 items-center justify-center gap-1.5 py-2 px-3 text-xs font-extrabold rounded-xl transition-all duration-200 touch-manipulation ${
                tipe === 'Utang'
                  ? 'neu-btn bg-[#E5E5E5] text-[#EB5353] shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 bg-transparent'
              }`}
            >
              <span className="material-symbols-outlined icon-sm">receipt_long</span>
              Utang
            </button>
            <button
              type="button"
              onClick={() => setTipe('Cicilan')}
              className={`flex flex-1 items-center justify-center gap-1.5 py-2 px-3 text-xs font-extrabold rounded-xl transition-all duration-200 touch-manipulation ${
                tipe === 'Cicilan'
                  ? 'neu-btn bg-[#E5E5E5] text-[#187498] shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 bg-transparent'
              }`}
            >
              <span className="material-symbols-outlined icon-sm">calendar_month</span>
              Cicilan
            </button>
          </div>
          <span className="sr-only font-medium text-slate-800">{tipe}</span>
        </div>

        {/* Hero Nominal Total Display */}
        <div className="mb-3 flex flex-col gap-1">
          <label className="block text-[11px] font-bold tracking-wide uppercase text-slate-500">
            Total {tipe} ({simbolUang()})
          </label>
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute left-3.5 text-base font-extrabold font-mono text-[#EB5353]">
              {simbolUang()}
            </span>
            <input
              value={total}
              onChange={(e) => setTotal(sanitizeKetikNominal(e.target.value))}
              inputMode="decimal"
              placeholder="0"
              required
              className="clay-input field-lg w-full rounded-2xl pl-11 pr-4 text-xl font-black font-mono tracking-tight tx-nominal-expense !text-[#EB5353]"
            />
          </div>
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Nama pihak</label>
          <input
            value={namaPihak}
            maxLength={150}
            onChange={(e) => setNamaPihak(e.target.value)}
            placeholder="mis. Kredit Motor / Teman"
            className="clay-input field-lg w-full rounded-2xl px-3 text-sm font-semibold"
          />
        </div>

        {tipe === 'Cicilan' && (
          <div className="mb-3 flex flex-col gap-1">
            <label className="block text-[11px] font-bold tracking-wide uppercase text-slate-500">
              Cicilan per bulan ({simbolUang()})
            </label>
            <div className="relative flex items-center">
              <span className="pointer-events-none absolute left-3.5 text-base font-extrabold font-mono text-[#187498]">
                {simbolUang()}
              </span>
              <input
                value={cicilan}
                onChange={(e) => setCicilan(sanitizeKetikNominal(e.target.value))}
                inputMode="decimal"
                placeholder="0"
                className="clay-input field-lg w-full rounded-2xl pl-11 pr-4 text-base font-black font-mono tracking-tight !text-[#187498]"
              />
            </div>
          </div>
        )}

        <label className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
          {tipe === 'Cicilan' ? 'Tanggal Jatuh Tempo Tiap Bulan' : 'Jatuh tempo'}
        </label>
        <div className="mb-3">
          <ClayDateInput value={tgl} onChange={setTgl} />
        </div>

        <label className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Catatan</label>
        <input
          value={deskripsi}
          maxLength={500}
          onChange={(e) => setDeskripsi(e.target.value)}
          placeholder="opsional"
          className="clay-field mb-4 w-full rounded-xl px-3 py-2.5 text-sm font-semibold placeholder:font-normal placeholder:text-slate-500"
        />

        {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{error}</p>}
        <button type="submit" disabled={saving} className="neu-btn-danger solid-danger btn-lg w-full rounded-2xl text-white font-extrabold text-sm active:scale-95 transition-all shadow-md disabled:opacity-60">
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </form>
    </div>,
  )
}

// ===== MODAL BAYAR / LUNASIN =====
export function BayarUtangModal({ open, onClose, uid, utang, akunList, lunasin }) {
  const [jumlah, setJumlah] = useState('')
  const [tanggal, setTanggal] = useState(isoHariIni())
  const [akunId, setAkunId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submittedRef = useRef(false)

  useEffect(() => {
    if (open) submittedRef.current = false
  }, [open, utang?.id, lunasin])

  // Sama seperti FormUtangModal: kunciLama mulai dari null supaya reset
  // berjalan saat mount (pemanggil memakai `key`, instance baru tiap buka).
  const kunci = open ? `bayar|${utang?.id ?? ''}|${lunasin ? 'l' : ''}` : 'tutup'
  const [kunciLama, setKunciLama] = useState(null)
  if (kunci !== kunciLama) {
    setKunciLama(kunci)
    const defaultNominal = utang ? (lunasin ? utang.sisa : utang.cicilanPerBulan || utang.sisa) : 0
    setJumlah(defaultNominal ? formatInputTampil(defaultNominal) : '')
    setTanggal(isoHariIni())
    setAkunId(akunList[0]?.id ?? '')
    setError('')
  }

  if (!open || !utang) return null

  const sisaAsli = Number(utang.sisa) || 0
  const nTampil = parseInputTampil(jumlah)
  const nRawBasis = konversiKeBasis(nTampil)
  const tepatSisa =
    rasioKursTampil() !== 1 &&
    nTampil > 0 &&
    (sanitizeKetikNominal(jumlah) === formatInputTampil(sisaAsli) ||
      (nRawBasis > sisaAsli && nTampil <= konversiUntukTampil(sisaAsli) + 0.005))
  const n = tepatSisa ? sisaAsli : nRawBasis
  const sisaBaru = Math.max(0, sisaAsli - n)
  const akun = akunList.find((a) => a.id === akunId)

  async function submit(e) {
    e.preventDefault()
    if (submittedRef.current) return
    if (n <= 0) return setError('Nominal harus lebih dari nol.')
    if (!akun) return setError('Pilih rekening sumber.')
    if (n > (utang.sisa || 0)) return setError('Nominal melebihi sisa utang.')
    submittedRef.current = true
    const saldoAkun = Number(akun.saldo) || 0
    if (saldoAkun - n < 0) {
      window.dispatchEvent(
        new CustomEvent('myduit:toast', {
          detail: {
            type: 'warning',
            msg: `Perhatian: Saldo ${akun.nama} tidak boleh minus! Sisa saldo saat ini ${formatNominal(saldoAkun)}. Periksa kembali debit & kredit rekening Anda.`,
          },
        })
      )
    }
    // Snapshot sebelum modal ditutup
    const utangSnap = utang
    const nSnap = n
    const tanggalSnap = tanggal
    const akunSnap = akun
    const docId = buatTransaksiId(uid)

    const optTx = {
      id: docId,
      jumlah: nSnap,
      jenis: 'pengeluaran',
      kategoriId: '',
      kategoriNama: 'Pembayaran',
      akunId: akunSnap.id,
      akunNama: akunSnap.nama,
      tanggal: tanggalSnap,
      catatan: `Bayar ${utangSnap.tipe === 'Cicilan' ? 'cicilan' : 'utang'} ${utangSnap.namaPihak}`,
      deleted: false,
      createdAt: new Date().toISOString(),
    }

    // Sebarkan transaksi optimis seketika agar langsung tampil di riwayat transaksi
    window.dispatchEvent(new CustomEvent('myduit:transaksi-added', { detail: { item: optTx } }))

    // OPTIMISTIC: tutup modal sekarang, commit Firestore di background.
    setError('')
    setSaving(false)
    onClose()

    ;(async () => {
      try {
        await bayarUtang(uid, { id: docId, utang: utangSnap, jumlah: nSnap, tanggal: tanggalSnap, akun: akunSnap })
      } catch (e2) {
        console.warn('[utang-bayar] gagal:', e2?.message ?? e2)
        window.dispatchEvent(new CustomEvent('myduit:transaksi-deleted', { detail: { ids: [docId] } }))
        window.dispatchEvent(new CustomEvent('myduit:toast', { detail: { type: 'error', msg: pesanErrorSimpan('Mencatat pembayaran', e2) } }))
      }
    })()
  }

  return portalBody(
    <div className="modal-backdrop-wrap fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="neu-card w-full max-w-sm rounded-3xl bg-[#E5E5E5] p-6 shadow-2xl border border-white/50">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-extrabold text-slate-800 tracking-tight">{lunasin ? 'Lunasin' : 'Bayar'} — {utang.namaPihak}</h3>
          <button type="button" onClick={onClose} aria-label="Tutup pembayaran" className="neu-btn flex h-8 w-8 items-center justify-center rounded-full bg-[#E5E5E5] text-slate-600 hover:text-slate-900 active:scale-95 transition-all">
            <span className="material-symbols-outlined icon-md">close</span>
          </button>
        </div>

        <div className="neu-inset mb-3.5 flex items-center justify-between rounded-xl bg-[#E5E5E5] px-3.5 py-2 text-xs font-semibold text-slate-600">
          <span>Sisa saat ini:</span>
          <strong className="font-mono text-sm font-black text-slate-800 tabular-nums">{formatRupiah(utang.sisa || 0)}</strong>
        </div>

        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Nominal bayar</label>
        <div className="relative mb-3.5 flex items-center">
          <span className="pointer-events-none absolute left-3.5 font-mono text-base font-extrabold text-slate-500">
            {simbolUang()}
          </span>
          <input
            value={jumlah}
            onChange={(e) => setJumlah(sanitizeKetikNominal(e.target.value))}
            inputMode="decimal"
            placeholder="0"
            className="clay-input field-lg w-full rounded-2xl pl-11 pr-4 font-mono text-xl font-black text-slate-900 outline-none tabular-nums placeholder:text-slate-400"
          />
        </div>

        <div className="mb-3.5 grid grid-cols-2 gap-2.5">
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Tanggal</label>
            <ClayDateInput value={tanggal} onChange={setTanggal} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Sumber dana</label>
            <ClaySelect
              value={akunId}
              onChange={setAkunId}
              placeholder="Pilih rekening"
              options={akunList.map((a) => ({ value: a.id, label: a.nama }))}
            />
          </div>
        </div>

        {n > 0 && (
          <div className="neu-inset mb-4 flex items-center justify-between rounded-xl bg-[#E5E5E5] px-3.5 py-2 text-xs font-bold text-[#36AE7C]">
            <span>Sisa setelah bayar: {formatRupiah(sisaBaru)}</span>
            <span>{sisaBaru === 0 ? '— LUNAS ✓' : ''}</span>
          </div>
        )}
        {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{error}</p>}

        <div className="grid grid-cols-2 gap-2.5 pt-1">
          {!lunasin && (
            <button
              type="button"
              onClick={() => setJumlah(formatInputTampil(utang.sisa || 0))}
              className="neu-btn btn-lg rounded-2xl bg-[#E5E5E5] text-slate-700 font-extrabold text-xs transition-all active:scale-95"
            >
              Lunasin ({formatRupiah(utang.sisa || 0)})
            </button>
          )}
          <button
            disabled={saving}
            className={`neu-btn-primary solid-primary btn-lg rounded-2xl text-white font-extrabold text-sm transition-all active:scale-95 shadow-md ${lunasin ? 'col-span-2' : ''}`}
          >
            {saving ? 'Menyimpan…' : lunasin ? 'Lunasin Sekarang' : 'Bayar'}
          </button>
        </div>
      </form>
    </div>,
  )
}
