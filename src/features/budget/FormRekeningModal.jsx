import { useState } from 'react'
import { formatRibuanInputBertanda, parseNominalBertanda, simbolUang } from '../../lib/format.js'
import { tambahAkun, updateAkun } from '../../lib/db.js'
import { ClaySelect } from '../../components/clay-ui.jsx'
import { pesanErrorSimpan } from '../../lib/pesanError.js'

const TIPE_AKUN = ['Rekening Utama', 'Tabungan', 'E-Wallet', 'Lainnya']

// Modal Tambah / Edit Rekening — markup persis GAS #modalTambahRekening & #modalEditRekening
// (clay-sheet clay-key-blue, ikon account_balance_wallet, tombol close clay-chip clay-key-neutral
// w-8 h-8 rounded-full, input clay-input, tombol Simpan clay-btn clay-key-blue).
export default function FormRekeningModal({ open, onClose, uid, edit }) {
  const [nama, setNama] = useState('')
  const [tipe, setTipe] = useState(TIPE_AKUN[0])
  const [saldo, setSaldo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Isi ulang tiap kali modal dibuka
  const kunci = open ? open + (edit?.id ?? '') : 'tutup'
  const [kunciLama, setKunciLama] = useState(kunci)
  if (kunci !== kunciLama) {
    setKunciLama(kunci)
    setNama(edit?.nama ?? '')
    setTipe(edit?.tipe ?? TIPE_AKUN[0])
    setSaldo(edit?.saldo !== undefined ? formatRibuanInputBertanda(edit.saldo) : '')
    setError('')
  }

  if (!open) return null

  async function submit(e) {
    e.preventDefault()
    if (!nama.trim()) return setError('Nama rekening wajib diisi.')
    const namaSnap = nama.trim()
    const tipeSnap = tipe
    const saldoSnap = parseNominalBertanda(saldo)
    const editSnap = edit

    // OPTIMISTIC: tutup modal sekarang, commit Firestore di background.
    setError('')
    setSaving(false)
    onClose()

    ;(async () => {
      try {
        if (editSnap) {
          await updateAkun(uid, editSnap.id, {
            nama: namaSnap,
            tipe: tipeSnap,
            saldo: saldoSnap,
            saldoLama: editSnap.saldo,
          })
        } else {
          await tambahAkun(uid, { nama: namaSnap, tipe: tipeSnap, saldoAwal: saldoSnap })
        }
      } catch (e2) {
        console.warn('[rekening-simpan] gagal:', e2?.message ?? e2)
        window.dispatchEvent(new CustomEvent('myduit:toast', { detail: { type: 'error', msg: pesanErrorSimpan('Menyimpan rekening', e2) } }))
      }
    })()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="clay-sheet clay-key-blue w-full max-w-sm rounded-[24px] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-extrabold text-slate-800">
            <span className="material-symbols-outlined text-blue-700">account_balance_wallet</span>
            {edit ? 'Edit Rekening' : 'Tambah Rekening'}
          </h3>
          <button type="button" onClick={onClose} aria-label="Tutup" className="clay-chip clay-key-neutral flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100">
            <span className="material-symbols-outlined icon-md">close</span>
          </button>
        </div>
        <label className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Nama</label>
        <input
          value={nama}
          onChange={(e) => setNama(e.target.value)}
          placeholder="mis. Rekening Utama"
          className="clay-field mb-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold"
        />
        <label className="mb-0.5 block text-[11px] font-semibold text-textSecondary">Tipe</label>
        <ClaySelect
          value={tipe}
          onChange={setTipe}
          options={TIPE_AKUN.map((t) => ({ value: t, label: t }))}
          className="mb-3"
        />
        <label className="mb-0.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
          {edit ? 'Koreksi Saldo Rekening' : 'Saldo Awal'}
        </label>
        <div className="clay-field mb-1 flex items-center gap-2 rounded-xl px-3 py-2.5">
          <span className="text-sm font-bold text-slate-500">{simbolUang()}</span>
          <input
            value={saldo}
            onChange={(e) => setSaldo(formatRibuanInputBertanda(e.target.value))}
            inputMode="text"
            placeholder="0"
            className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-slate-500"
          />
        </div>
        {edit && (
          <p className="mb-3 text-[11px] leading-tight text-slate-500">
            Koreksi ini langsung memperbarui saldo buku rekening agar selaras dengan saldo fisik/m-banking. Riwayat transaksi sebelumnya tetap utuh.
          </p>
        )}
        {!edit && <div className="mb-2" />}
        {error && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{error}</p>}
        <button disabled={saving} className="clay-btn clay-key-blue solid-blue btn-lg w-full text-sm font-extrabold text-white transition-colors disabled:opacity-60">
          <span className="material-symbols-outlined icon-sm">save</span>
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </form>
    </div>
  )
}
