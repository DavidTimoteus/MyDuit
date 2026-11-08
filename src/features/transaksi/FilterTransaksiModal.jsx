import { useEffect, useState } from 'react'
import { isoHariIni } from '../../lib/format.js'
import { ClayDateInput } from '../../components/clay-ui.jsx'

const fmt = (iso) =>
  iso ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(new Date(`${iso}T00:00:00`)) : ''

function rentangNHari(n) {
  const d = new Date()
  d.setDate(d.getDate() - (n - 1))
  return `${fmt(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)} - ${fmt(isoHariIni())}`
}

// Modal Filter Transaksi — markup persis GAS #filterModal:
// radio .clay-radio dgn subtitle rentang, "Pilih periode" memunculkan 1 field
// flatpickr mode range (maks hari ini), footer Batal/Terapkan.
export default function FilterTransaksiModal({ open, chip, rentang, onClose, onApply }) {
  const [tipe, setTipe] = useState('hari')
  const [range, setRange] = useState({ start: '', end: '' })

  useEffect(() => {
    if (!open) return
    setTipe(['hari', 'semua', '7hari', '30hari', 'rentang'].includes(chip) ? chip : 'semua')
    setRange({ start: rentang.start ?? '', end: rentang.end ?? '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  function terapkan() {
    if (tipe === 'rentang') {
      if (!range.start || !range.end) return
      onApply({ chip: 'rentang', rentang: range })
    } else {
      onApply({ chip: tipe })
    }
    onClose()
  }

  const Opsi = ({ id, label, subtitle = null, primary = false }) => (
    <label className={`flex cursor-pointer items-center justify-between py-3 ${id === 'rentang' ? '' : 'border-b border-gray-100'}`}>
      <div>
        <span className={`block text-sm font-medium ${primary ? 'text-primary' : 'text-slate-800'}`}>{label}</span>
        {subtitle !== null && <span className="text-xs text-slate-500">{subtitle}</span>}
      </div>
      <input type="radio" name="filterTipeModal" checked={tipe === id} onChange={() => setTipe(id)} className="clay-radio" />
    </label>
  )

  return (
    <div
      className="modal-backdrop-wrap fixed inset-0 z-[10000] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div className="clay-sheet clay-key-primary flex max-h-[90vh] w-full flex-col overflow-hidden sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 pb-4 pt-5">
          <h3 className="text-lg font-bold text-slate-800">Filter Transaksi</h3>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="clay-chip clay-key-neutral flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <span className="material-symbols-outlined icon-lg">close</span>
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <p className="mb-1 text-xs font-semibold text-slate-500">Tanggal</p>

          <div className="flex flex-col">
            <Opsi id="hari" label="Hari ini" subtitle={new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())} />
            <Opsi id="semua" label="Semua Transaksi" />
            <Opsi id="7hari" label="7 hari terakhir" subtitle={rentangNHari(7)} />
            <Opsi id="30hari" label="30 hari terakhir" subtitle={rentangNHari(30)} />
            <Opsi id="rentang" label="Pilih periode" primary />
          </div>

          {tipe === 'rentang' && (
            <div className="mt-2">
              <ClayDateInput range accent value={range} onChange={setRange} placeholder="Pilih periode" />
            </div>
          )}
        </div>

        <div className="flex shrink-0 gap-3 border-t border-gray-100 px-5 py-4">
          <button
            onClick={onClose}
            className="clay-btn-secondary clay-btn btn-md flex-1 text-textSecondary transition-colors"
          >
            Batal
          </button>
          <button
            onClick={terapkan}
            className="clay-btn clay-key-primary solid-primary btn-md flex-1 text-white transition-colors"
          >
            Terapkan
          </button>
        </div>
      </div>
    </div>
  )
}
