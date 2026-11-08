import { useState } from 'react'
import { parseNominal, isoHariIni, formatRibuanInput, formatNominal, simbolUang } from '../../lib/format.js'
import { tambahAkun } from '../../lib/db.js'

// Form mini "buat rekening pertama" — modul rekening lengkap di Fase 3.
export function ChipAkunBaru({ uid }) {
  const [nama, setNama] = useState('')
  const [saldo, setSaldo] = useState('')
  const [saving, setSaving] = useState(false)
  const [selesai, setSelesai] = useState(false)

  async function buat(e) {
    e.preventDefault()
    if (!nama.trim()) return
    setSaving(true)
    try {
      await tambahAkun(uid, { nama: nama.trim(), saldoAwal: parseNominal(saldo) })
      setSelesai(true)
    } finally {
      setSaving(false)
    }
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
    <div className="clay-card p-6">
      <h3 className="text-base font-extrabold text-slate-800">Buat rekening pertama</h3>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        Rekening adalah sumber dana transaksi (mis. Rekening Utama, E-Wallet, Tabungan).
      </p>
      <form onSubmit={buat} className="mt-4 space-y-2">
        <input
          value={nama}
          onChange={(e) => setNama(e.target.value)}
          placeholder="Nama rekening"
          className="clay-field w-full rounded-xl px-3 py-2.5 text-sm font-semibold"
        />
        <div className="clay-field flex items-center gap-2 rounded-xl px-3 py-2.5">
          <span className="text-sm font-bold text-slate-500">{simbolUang()}</span>
          <input
            value={saldo}
            onChange={(e) => setSaldo(formatRibuanInput(e.target.value))}
            inputMode="numeric"
            placeholder="Saldo awal (opsional)"
            className="w-full bg-transparent text-sm font-semibold outline-none placeholder:font-normal placeholder:text-slate-500"
          />
        </div>
        <button
          disabled={saving || !nama.trim()}
          className="clay-btn-primary btn-lg w-full disabled:opacity-60"
        >
          {saving ? 'Membuat…' : 'Buat Rekening'}
        </button>
      </form>
    </div>
  )
}

// Tanggal relatif ringkas: Hari Ini / Kemarin / "12/08" (persis feel GAS formatTanggalRelatif).
function tanggalRelatif(iso) {
  const hari = isoHariIni()
  if (iso === hari) return 'Hari Ini'
  const y = new Date()
  y.setDate(y.getDate() - 1)
  const kemarin = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`
  if (iso === kemarin) return 'Kemarin'
  const d = new Date(`${iso}T00:00:00`)
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(d)
}

// Satu kartu riwayat — markup & interaksi persis GAS renderRiwayatUI():
// klik = toggle tombol hapus, dblclick = edit; hue shadow ikut jenis
// (hijau Pemasukan / merah Pengeluaran / biru Pindah Saldo).
export function TransaksiRow({ trans, bulkMode, selected, onToggleSelect, deleteOpen, onToggleDelete, onEdit, onDelete }) {
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
  const dipilih = !!selected?.has(trans.id)

  function handleClick() {
    if (bulkMode) onToggleSelect?.(trans.id)
    else onToggleDelete?.(trans.id)
  }

  return (
    <div
      onClick={handleClick}
      onDoubleClick={bulkMode ? undefined : onEdit}
      className={`tx-card-item clay clay-card ${clayKey} relative p-4 flex items-center justify-between gap-3 transition-all cursor-pointer select-none ${
        bulkMode ? `bulk-selectable ${dipilih ? 'bulk-selected' : ''}` : ''
      } ${!bulkMode && deleteOpen ? tintRevealed : ''}`}
    >
      {bulkMode && (
        <span className="bulk-check w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all">
          <span className="material-symbols-outlined icon-xs text-white">check</span>
        </span>
      )}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={`clay-icon-tile ${clayKey} w-10 h-10 rounded-full ${bg} flex items-center justify-center shrink-0`}>
          <span className={`material-symbols-outlined ${color} icon-lg`}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-800 text-[15px] truncate mb-0.5">
            {trans.catatan || trans.kategoriNama || 'Tanpa Keterangan'}
          </h3>
          <div className="flex min-w-0 items-center gap-2 text-xs text-slate-500">
            <span className="font-medium whitespace-nowrap shrink-0">{tanggalRelatif(trans.tanggal)}</span>
            <span className="w-1 h-1 rounded-full bg-slate-300 shrink-0"></span>
            <span className="truncate">{trans.kategoriNama || '-'}</span>
          </div>
        </div>
      </div>
      <div className="text-right shrink-0 flex flex-col items-end">
        <p className={`font-bold ${color} text-[15px] mb-0.5`}>
          {sign}{simbolUang()} {formatNominal(trans.jumlah || 0)}
        </p>
        <p className="text-[10px] text-slate-500">{isPindahSaldo ? trans.akunNama : trans.akunNama || 'Tunai'}</p>
      </div>
      {!bulkMode && (
        <button
          type="button"
          aria-label="Hapus transaksi"
          onClick={(e) => {
            e.stopPropagation()
            onDelete?.(trans)
          }}
          className={`delete-btn-action neu-btn shrink-0 ml-2 h-9 w-9 rounded-full bg-[#E5E5E5] text-[#EB5353] hover:text-red-700 active:scale-90 items-center justify-center transition-all touch-manipulation ${
            deleteOpen ? 'flex' : 'hidden'
          }`}
        >
          <span className="material-symbols-outlined icon-md" style={{ fontVariationSettings: "'FILL' 1" }}>delete</span>
        </button>
      )}
    </div>
  )
}
