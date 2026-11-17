import { memo, useState } from 'react'
import { formatNominal, konversiKeBasis, parseInputTampil, sanitizeKetikNominal, simbolUang, tanggalRelatifLabel } from '../../lib/format.js'
import { tambahAkun } from '../../lib/db.js'
import PenawaranMataUangAwal from '../../components/PenawaranMataUangAwal.jsx'
import { useBahasa } from '../../lib/i18n.js'

// Form mini "buat rekening pertama" — modul rekening lengkap di Fase 3.
export function ChipAkunBaru({ uid }) {
  const [nama, setNama] = useState('')
  const [saldo, setSaldo] = useState('')
  const [selesai, setSelesai] = useState(false)

  function buat(e) {
    e.preventDefault()
    const namaBersih = nama.trim().slice(0, 120)
    if (!namaBersih) return
    const saldoAwal = konversiKeBasis(parseInputTampil(saldo))
    setSelesai(true)
    ;(async () => {
      try {
        await tambahAkun(uid, { nama: namaBersih, saldoAwal })
      } catch (err) {
        console.warn('[rekening-pertama] gagal:', err?.message ?? err)
        window.dispatchEvent(
          new CustomEvent('myduit:toast', {
            detail: { type: 'error', msg: 'Gagal membuat rekening. Periksa koneksi atau coba lagi.' },
          }),
        )
      }
    })()
  }

  if (selesai) {
    return (
      <div className="clay-card p-6 text-center">
        <span className="material-symbols-outlined text-4xl text-incomeText">check_circle</span>
        <p className="mt-2 text-sm font-bold text-slate-700">Rekening dibuat! Lanjut catat transaksi.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PenawaranMataUangAwal uid={uid} />
      <div className="clay-card p-6">
      <h3 className="text-base font-extrabold text-slate-800">Buat rekening pertama</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        Rekening adalah sumber dana transaksi (mis. Rekening Utama, E-Wallet, Tabungan).
      </p>
      <form onSubmit={buat} className="mt-4 space-y-2">
        <input
          value={nama}
          maxLength={120}
          onChange={(e) => setNama(e.target.value)}
          placeholder="Nama rekening"
          className="clay-field w-full rounded-xl px-3 py-2.5 text-sm font-semibold"
        />
        <div className="clay-field flex items-center gap-2 rounded-xl px-3 py-2.5">
          <span className="text-sm font-bold text-slate-500">{simbolUang()}</span>
          <input
            value={saldo}
            onChange={(e) => setSaldo(sanitizeKetikNominal(e.target.value))}
            inputMode="decimal"
            placeholder="Saldo awal (opsional)"
            className="w-full bg-transparent text-sm font-semibold outline-none placeholder:font-normal placeholder:text-slate-500"
          />
        </div>
        <button
          disabled={!nama.trim()}
          className="clay-btn-primary btn-lg w-full disabled:opacity-60"
        >
          Buat Rekening
        </button>
      </form>
      </div>
    </div>
  )
}

// Satu kartu riwayat — markup & interaksi persis GAS renderRiwayatUI():
// klik = toggle tombol hapus, dblclick = edit; hue shadow ikut jenis
// (hijau Pemasukan / merah Pengeluaran / biru Pindah Saldo).
export const TransaksiRow = memo(function TransaksiRow({
  trans,
  bulkMode,
  selected,
  justAdded = false,
  currencySymbol,
  kursVer: _kursVer,
  onToggleSelect,
  deleteOpen,
  onToggleDelete,
  onEdit,
  onDelete,
  onSalin,
}) {
  const { t: tr } = useBahasa()
  const isPemasukan = trans.jenis === 'pemasukan'
  const isPindahSaldo = trans.jenis === 'pindah saldo'
  const sign = isPindahSaldo ? '' : isPemasukan ? '+' : '-'
  const color = isPindahSaldo ? 'text-blue-600' : isPemasukan ? 'text-incomeText' : 'text-expenseText'
  const bg = isPindahSaldo ? 'bg-blue-50' : isPemasukan ? 'bg-emerald-100' : 'bg-red-50'
  const icon = isPindahSaldo ? 'sync_alt' : isPemasukan ? 'trending_up' : 'trending_down'
  const clayKey = isPindahSaldo ? 'clay-key-blue' : isPemasukan ? 'clay-key-primary' : 'clay-key-danger'
  // State "revealed" (klik kartu) — pendaran taktil clay per jenis tanpa garis border kasar
  const tintRevealed = isPindahSaldo
    ? 'tx-card-revealed !bg-blue-50/70'
    : isPemasukan
      ? 'tx-card-revealed !bg-emerald-50/70'
      : 'tx-card-revealed !bg-red-50/70'
  const dipilih = typeof selected === 'boolean' ? selected : !!selected?.has(trans.id)
  const simbol = currencySymbol || simbolUang()

  function handleClick() {
    if (bulkMode) onToggleSelect?.(trans.id)
    else onToggleDelete?.(trans.id)
  }

  return (
    <div
      data-reveal=""
      onClick={handleClick}
      onDoubleClick={bulkMode ? undefined : () => onEdit?.(trans)}
      className={`tx-card-item clay clay-card ${clayKey} relative p-4 flex items-center justify-between gap-3 cursor-pointer select-none ${
        bulkMode ? `bulk-selectable ${dipilih ? 'bulk-selected' : ''}` : ''
      } ${!bulkMode && deleteOpen ? tintRevealed : ''} ${justAdded ? 'tx-card-just-added' : ''}`}
    >
      {bulkMode && (
        <span className="bulk-check w-6 h-6 rounded-full flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined icon-xs text-white">check</span>
        </span>
      )}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={`clay-icon-tile ${clayKey} w-10 h-10 rounded-full ${bg} flex items-center justify-center shrink-0`}>
          <span className={`material-symbols-outlined ${color} icon-lg`}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-800 text-[15px] truncate mb-0.5">
            {trans.catatan || trans.kategoriNama || tr('tanpa_keterangan')}
          </h3>
          <div className="flex min-w-0 items-center gap-2 text-xs text-slate-500">
            <span className="font-medium whitespace-nowrap shrink-0">
              {tanggalRelatifLabel(trans.tanggal)}{trans.jam ? ` · ${trans.jam}` : ''}
            </span>
            <span className="w-1 h-1 rounded-full bg-slate-300 shrink-0"></span>
            <span className="truncate">{trans.kategoriNama || '-'}</span>
          </div>
        </div>
      </div>
      <div className="text-right shrink-0 flex flex-col items-end">
        <p className={`font-bold ${color} text-[15px] mb-0.5`}>
          {sign}{simbol} {formatNominal(trans.jumlah || 0, { kursSnapshot: trans.kursSnapshot })}
        </p>
        <p className="text-[10px] text-slate-500 max-w-[130px] sm:max-w-[200px] truncate">{isPindahSaldo ? trans.akunNama : trans.akunNama || 'Tunai'}</p>
      </div>
      {!bulkMode && (
        <div className={deleteOpen ? 'flex items-center gap-1.5 ml-2 shrink-0' : 'hidden'}>
          {!isPindahSaldo && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onSalin?.(trans)
              }}
              aria-label={tr('salin_transaksi')}
              title={tr('salin_transaksi')}
              className="tx-action-pop salin-btn-action neu-btn h-9 w-9 rounded-full bg-[#E5E5E5] text-[#36AE7C] hover:text-emerald-700 active:scale-90 flex items-center justify-center touch-manipulation"
            >
              <span className="material-symbols-outlined icon-md">content_copy</span>
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete?.(trans)
            }}
            aria-label={tr('hapus_transaksi')}
            title={tr('hapus_transaksi')}
            style={{ '--pop-delay': !isPindahSaldo ? '35ms' : '0ms' }}
            className="tx-action-pop delete-btn-action neu-btn h-9 w-9 rounded-full bg-[#E5E5E5] text-[#EB5353] hover:text-red-700 active:scale-90 flex items-center justify-center touch-manipulation"
          >
            <span className="material-symbols-outlined icon-md" style={{ fontVariationSettings: "'FILL' 1" }}>delete</span>
          </button>
        </div>
      )}
    </div>
  )
})
