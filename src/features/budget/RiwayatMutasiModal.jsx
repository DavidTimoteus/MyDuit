import { useMemo, useState } from 'react'
import { formatRupiah, rangeForFilter, tanggalLabel } from '../../lib/format.js'
import { useTransaksi } from '../transaksi/useTransaksi.js'
import { ClayDateInput } from '../../components/clay-ui.jsx'
import { bangunMutasi, ringkasMutasi } from './riwayatSaldo.js'

// Filter rentang: Hari Ini / 7 Hari / 30 Hari (wajib) + Kustom + Semua.
const OPSI_FILTER = [
  { id: 'hari', label: 'Hari Ini' },
  { id: '7hari', label: '7 Hari Terakhir' },
  { id: '30hari', label: '30 Hari Terakhir' },
  { id: 'rentang', label: 'Kustom' },
  { id: 'semua', label: 'Semua' },
]

// Jam dari createdAt (serverTimestamp). Offline = null -> '' (tanpa jam).
function jamDari(at) {
  const d = at?.toDate ? at.toDate() : at ? new Date(at) : null
  if (!d || isNaN(d)) return ''
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
}

// Modal detail "Perubahan Terakhir" per rekening: hero saldo + pill filter
// clay + feed mutasi. Data dari useTransaksi (langganan live, jaringan query
// yang sama dengan tab Transaksi — tanpa index baru); penyaringan per-akun +
// perhitungan saldo sesudah ada di riwayatSaldo.js (murni, teruji Node).
export default function RiwayatMutasiModal({ uid, akun, kategoriById = {}, onClose }) {
  const [chip, setChip] = useState('7hari')
  const [rentang, setRentang] = useState({ start: '', end: '' })

  const range = useMemo(
    () => rangeForFilter(chip, rentang),
    // Sengaja memakai rentang.start/end (string), BUKAN objek `rentang` —
    // objek baru tiap render akan mengeksekusi ulang tanpa perubahan berarti.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chip, rentang.start, rentang.end],
  )
  // Query ke Firestore hanya memotong batas bawah (`start`), TANPA memotong batas atas (`end`),
  // supaya mutasi dari `end` hingga hari ini tetap terbaca oleh `bangunMutasi` saat menghitung
  // mundur `saldoSesudah` dari `akun.saldo` terkini. Pemotongan `end` dilakukan di `bangunMutasi`.
  const queryRange = useMemo(
    () => (range?.start ? { start: range.start, end: '9999-12-31' } : null),
    [range?.start],
  )
  const { docs, loading, loadingMore, hasMore, error, muatLagi } = useTransaksi(uid, {
    jenis: 'semua',
    range: queryRange,
    // Rentang berbatas butuh semua transaksi dari range.start s/d kini tanpa potong 50 global.
    pageSize: queryRange ? 0 : 200,
  })

  const baris = useMemo(
    () =>
      bangunMutasi(docs, {
        akunId: akun?.id,
        saldoSekarang: akun?.saldo,
        kategoriById,
        range,
      }),
    [docs, akun?.id, akun?.saldo, kategoriById, range],
  )
  const ringkas = useMemo(() => ringkasMutasi(baris), [baris])

  if (!akun) return null

  const labelRentang = OPSI_FILTER.find((o) => o.id === chip)?.label ?? ''

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Riwayat perubahan ${akun.nama}`}
    >
      <div
        className="clay-sheet clay-key-primary mutasi-sheet flex max-h-[90vh] w-full flex-col overflow-hidden sm:max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: identitas rekening + hero saldo total terkini */}
        <header className="shrink-0 px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="mutasi-identitas" aria-hidden="true">
                <span className="material-symbols-outlined icon-xl">account_balance</span>
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-base font-extrabold tracking-tight text-slate-800">
                  Perubahan Rekening
                </h3>
                <p className="truncate text-xs font-semibold text-textSecondary">{akun.nama}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Tutup"
              className="clay-chip clay-key-neutral flex h-9 w-9 shrink-0 items-center justify-center p-0 text-slate-500 transition-colors hover:text-slate-700"
            >
              <span className="material-symbols-outlined icon-md">close</span>
            </button>
          </div>

          {/* Hero saldo — bidang solid brand (teks putih di atasnya >= 5.2:1) */}
          <div className="mutasi-hero mt-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="mutasi-hero__label">saldo saat ini</span>
              <span className="mutasi-hero__tipe">{akun.tipe || 'Rekening'}</span>
            </div>
            <p className="mutasi-hero__saldo font-mono">{formatRupiah(akun.saldo)}</p>
          </div>
        </header>

        {/* Filter rentang waktu — pill clay: rest / hover / aktif berbeda nyata */}
        <section className="shrink-0 px-5 pb-3 pt-1" aria-label="Filter rentang waktu">
          <p className="mutasi-eyebrow">Rentang waktu</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {OPSI_FILTER.map((o) => {
              const aktif = chip === o.id
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setChip(o.id)}
                  aria-pressed={aktif}
                  className={`mutasi-tab${aktif ? ' is-aktif' : ''}`}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
          {chip === 'rentang' && (
            <div className="mt-2">
              <ClayDateInput range accent value={rentang} onChange={setRentang} placeholder="Pilih periode" />
              {(!rentang.start || !rentang.end) && (
                <p className="mt-1 text-[11px] font-medium text-warning">
                  Lengkapi tanggal awal & akhir — selama itu seluruh riwayat ditampilkan.
                </p>
              )}
            </div>
          )}

          {/* Ringkasan hasil filter */}
          <p className="mutasi-ringkas" aria-live="polite">
            {loading
              ? 'Memuat riwayat...'
              : `${ringkas.jumlah} mutasi · masuk ${formatRupiah(ringkas.masuk)} · keluar ${formatRupiah(ringkas.keluar)}`}
          </p>
        </section>

        {/* Feed mutasi */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {error ? (
            <p className="rounded-[16px] bg-danger-light px-3 py-2 text-xs font-semibold text-danger">
              Gagal memuat riwayat: {error}
            </p>
          ) : loading && baris.length === 0 ? (
            <div className="riwayat-dot-spinner flex items-center justify-center gap-1.5 py-8" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} className="riwayat-dot-spinner__dot" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          ) : baris.length === 0 ? (
            <div className="mutasi-kosong">
              <span className="mutasi-kosong__ikon" aria-hidden="true">
                <span className="material-symbols-outlined icon-hero">history</span>
              </span>
              <p className="mutasi-kosong__judul">Belum ada perubahan</p>
              <p className="mutasi-kosong__teks">Tidak ada mutasi rekening pada rentang waktu ini.</p>
              <span className="mutasi-kosong__chip">{labelRentang}</span>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {baris.map((b) => {
                const jam = jamDari(b.createdAt)
                const naik = b.delta > 0
                const datar = b.delta === 0
                const transfer = b.jenis === 'pindah saldo'
                const nadaBadge = transfer ? ' is-transfer' : naik ? ' is-masuk' : datar ? '' : ' is-keluar'
                const nadaNominal = datar ? ' is-datar' : naik ? ' is-masuk' : ' is-keluar'
                return (
                  <li key={b.id} className="mutasi-item">
                    <span className={`mutasi-item__ikon${b.kelas ? ` ${b.kelas}` : ''}`} aria-hidden="true">
                      <span className="material-symbols-outlined icon-sm">{b.ikon}</span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="mutasi-item__judul">{b.kategoriNama}</p>
                        <p className={`mutasi-item__nominal${nadaNominal}`}>
                          {formatRupiah(b.delta, { tanda: true })}
                        </p>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={`mutasi-badge${nadaBadge}`}>{b.label}</span>
                        <span className="mutasi-item__tanggal">
                          {tanggalLabel(b.tanggal)}
                          {jam ? ` · ${jam}` : ''}
                        </span>
                      </div>
                      {b.catatan && <p className="mutasi-item__catatan">{b.catatan}</p>}
                      <p className="mutasi-item__saldo flex items-center justify-end gap-1.5 font-mono text-[11px] font-semibold">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Saldo sesudah:</span>
                        <span className="font-extrabold text-[#187498] tabular-nums">{formatRupiah(b.saldoSesudah)}</span>
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {hasMore && !error && (
            <button
              type="button"
              onClick={muatLagi}
              disabled={loadingMore}
              className="clay-btn clay-key-neutral btn-md mt-3 w-full text-xs font-bold text-textSecondary disabled:opacity-60"
            >
              {loadingMore ? 'Memuat...' : 'Muat lagi'}
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-slate-200/70 px-5 py-3">
          <button
            onClick={onClose}
            className="clay-btn clay-key-neutral btn-md w-full text-xs font-bold text-textSecondary"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  )
}
