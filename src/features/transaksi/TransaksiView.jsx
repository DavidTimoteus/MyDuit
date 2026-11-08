import { useEffect, useMemo, useState } from 'react'
import { rangeForFilter } from '../../lib/format.js'
import { enrichTransaksi, hapusPindahSaldo, hapusTransaksi } from '../../lib/db.js'
import FormTransaksiModal from './FormTransaksiModal.jsx'
import ModalPindahSaldo from './ModalPindahSaldo.jsx'
import FilterTransaksiModal from './FilterTransaksiModal.jsx'
import { ChipAkunBaru, TransaksiRow } from './TransaksiRow.jsx'
import { useTransaksi } from './useTransaksi.js'
import { useAkunKategori } from '../../lib/useAkunKategori.js'

const PER_HALAMAN = 10

const JENIS_ICONS = [
  { id: 'semua', icon: 'apps', title: 'Semua Transaksi' },
  { id: 'pemasukan', icon: 'trending_up', title: 'Pemasukan' },
  { id: 'pengeluaran', icon: 'trending_down', title: 'Pengeluaran' },
]

function filterLabel(chip, rentang) {
  switch (chip) {
    case 'hari': return 'Hari Ini'
    case '7hari': return '7 Hari Terakhir'
    case '30hari': return '30 Hari Terakhir'
    case 'tahun': return 'Tahun Ini'
    case 'rentang': return rentang.start ? `${rentang.start} s/d ${rentang.end}` : 'Pilih Periode'
    default: return 'Semua Transaksi'
  }
}

export default function TransaksiView({ user }) {
  const uid = user.uid
  const [chip, setChip] = useState('hari')
  const [jenis, setJenis] = useState('semua')
  const [keyword, setKeyword] = useState('')
  const [rentang, setRentang] = useState({ start: '', end: '' })
  const [filterOpen, setFilterOpen] = useState(false)
  const [modal, setModal] = useState({ open: false, mode: 'add', doc: null })
  const [pindahOpen, setPindahOpen] = useState(false)
  const [hapusTarget, setHapusTarget] = useState(null)
  const [bulkHapusOpen, setBulkHapusOpen] = useState(false)
  const [hapusLoading, setHapusLoading] = useState(false)
  const [bulkMode, setBulkMode] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const [openDeleteId, setOpenDeleteId] = useState(null)
  const [page, setPage] = useState(1)

  const range = useMemo(
    () => rangeForFilter(chip, rentang),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chip, rentang.start, rentang.end],
  )
  const { docs, loading, loadingMore, hasMore, error, muatLagi } = useTransaksi(uid, { jenis, range })
  const { akunList, kategoriList } = useAkunKategori(uid)

  // Resolve nama kategori/akun dari map snapshot (anti redundansi; fallback legacy)
  const akunById = useMemo(() => Object.fromEntries(akunList.map((a) => [a.id, a])), [akunList])
  const katById = useMemo(() => Object.fromEntries(kategoriList.map((k) => [k.id, k.nama])), [kategoriList])
  const docsEnriched = useMemo(() => enrichTransaksi(docs, akunById, katById), [docs, akunById, katById])

  const tampil = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return docsEnriched
    // docsEnriched dipakai (bukan docs) supaya pencarian ikut mencocokkan nama
    // kategori/akun hasil enrich, bukan hanya kolom mentah dokumen.
    return docsEnriched.filter((t) =>
      [t.kategoriNama, t.catatan, t.akunNama, String(t.jumlah)].some((s) =>
        String(s ?? '').toLowerCase().includes(kw),
      ),
    )
  }, [docsEnriched, keyword])

  // Reset ke halaman 1 tiap filter/pencarian berubah
  useEffect(() => setPage(1), [chip, jenis, keyword, rentang.start, rentang.end])

  // Chip Filter di header mobile (Shell) meminta membuka modal filter
  useEffect(() => {
    const buka = () => setFilterOpen(true)
    window.addEventListener('myduit:buka-filter', buka)
    return () => window.removeEventListener('myduit:buka-filter', buka)
  }, [])

  // Label filter aktif dikirim ke header mobile (chip Filter di Shell)
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('myduit:filter-label', { detail: { label: filterLabel(chip, rentang) } }))
  }, [chip, rentang])

  // Aksi Cepat dari panel kanan (event bus — panel terpisah dari state view ini)
  useEffect(() => {
    function onAksi(e) {
      const { type } = e.detail || {}
      if (type === 'pemasukan' || type === 'pengeluaran') bukaForm('add', { preset: type })
      else if (type === 'pindah-saldo') setPindahOpen(true)
    }
    window.addEventListener('myduit:aksi-cepat', onAksi)
    return () => window.removeEventListener('myduit:aksi-cepat', onAksi)
  }, [])

  const totalPages = Math.max(1, Math.ceil(tampil.length / PER_HALAMAN))
  const pageItems = tampil.slice((page - 1) * PER_HALAMAN, page * PER_HALAMAN)

  async function nextPage() {
    if (page < totalPages) return setPage(page + 1)
    if (hasMore && !loadingMore) {
      await muatLagi()
      setPage(page + 1)
    }
  }

  function toggleBulk() {
    setBulkMode((b) => !b)
    setSelected(new Set())
    setOpenDeleteId(null)
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

async function konfirmHapus() {
    if (!hapusTarget) return
    const target = hapusTarget
    // Tutup modal & reset loading state LANGSUNG (sinkron), Firestore commit
    // di background. Tidak pakai microtask/setTimeout agar tidak double-fire
    // saat parent re-render setelah state update.
    setHapusTarget(null)
    setHapusLoading(false)
    try {
      if (target.jenis === 'pindah saldo') await hapusPindahSaldo(uid, target)
      else await hapusTransaksi(uid, target)
    } catch (e2) {
      console.warn('[hapus] gagal:', e2?.message ?? e2)
    }
  }

  async function konfirmHapusMassal() {
    if (selected.size === 0) return
    const ids = Array.from(selected)
    const targets = ids.map((id) => docsEnriched.find((x) => x.id === id)).filter(Boolean)
    setSelected(new Set())
    setBulkMode(false)
    setBulkHapusOpen(false)
    setHapusLoading(false)
    try {
      for (const t of targets) {
        if (t.jenis === 'pindah saldo') await hapusPindahSaldo(uid, t)
        else await hapusTransaksi(uid, t)
      }
    } catch (e2) {
      console.warn('[hapus-massal] gagal:', e2?.message ?? e2)
    }
  }

  function bukaForm(mode, doc = null) {
    setOpenDeleteId(null)
    // Pindah saldo BUKAN pemasukan/pengeluaran: field-nya beda (dariId/keId,
    // tanpa kategori) dan `updateTransaksi` tidak mengenal jenis ini — kalau
    // dibiarkan, mengeditnya akan menulis akunId yang salah dan merusak saldo.
    // Jalur edit/salin hanya untuk pemasukan & pengeluaran; transfer harus
    // dihapus lalu dibuat ulang.
    if (doc && doc.jenis === 'pindah saldo') {
      window.dispatchEvent(
        new CustomEvent('myduit:toast', {
          detail: { type: 'info', msg: 'Pindah saldo tidak bisa diedit. Hapus lalu buat ulang bila perlu diubah.' },
        }),
      )
      return
    }
    setModal({ open: true, mode, doc })
  }

  const adaAkun = akunList.length > 0

  return (
    <section className="mx-auto max-w-3xl px-5 pb-32 md:pb-10">
      <div className="view-section active min-w-0">

        {/* Toolbar: responsif mobile — di layar kecil input search baris 1, filter baris 2 */}
        {/* ─── STICKY TOOLBAR WRAPPER ────────────────────────────────────────────────
            Mobile  (<md): bleed ke tepi layar penuh dengan -mx-5 px-5 agar background
                           mencakup keseluruhan lebar viewport. top-[52px] = header mobile.
            Desktop (md+): bleed ke tepi container scroll dengan md:-mx-6 md:px-6
                           agar saat kartu transaksi di-scroll, bayangannya di sisi
                           kiri-kanan tidak bocor melintasi toolbar.
        ─────────────────────────────────────────────────────────────────────────── */}
        <div className="sticky top-[52px] md:top-0 z-20
                        -mx-5 px-5 md:-mx-6 md:px-6
                        bg-surface
                        pt-2.5 pb-2.5 mb-0
                        relative">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          {/* Kartu pencarian & filter */}
          <div className="clay clay-card clay-key-neutral w-full rounded-[22px] bg-white/90 p-2.5 sm:p-3 shadow-[0_2px_8px_rgba(0,0,0,0.03)] border border-white/60">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 icon-lg text-textSecondary pointer-events-none select-none">search</span>
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="Cari transaksi..."
                  type="text"
                  className="clay-input w-full border-none bg-surface py-2.5 pl-10 pr-10 text-base sm:text-sm outline-none transition-all placeholder:text-textSecondary focus:bg-white focus:ring-1 focus:ring-primary rounded-[16px] touch-manipulation"
                />
                {keyword && (
                  <button
                    type="button"
                    onClick={() => setKeyword('')}
                    aria-label="Hapus pencarian"
                    className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 transition-all active:scale-90 active:bg-slate-200/60 hover:bg-red-100 hover:text-red-500 touch-manipulation"
                    style={{
                      background: '#ffffff',
                      boxShadow: '2px 2px 5px rgba(100,116,139,.25), -2px -2px 5px rgba(255,255,255,.9), inset 1px 1px 2px rgba(255,255,255,.6)',
                    }}
                  >
                    <span className="material-symbols-outlined icon-xs">close</span>
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between sm:justify-start gap-1.5 shrink-0 pt-0.5 sm:pt-0">
                <div className="flex items-center gap-1.5">
                  {JENIS_ICONS.map((j) => (
                    <button
                      key={j.id}
                      onClick={() => setJenis(j.id)}
                      aria-label={j.title}
                      title={j.title}
                      className={`chip-btn clay-chip flex h-10 w-10 sm:h-11 sm:w-11 rounded-full shrink-0 items-center justify-center transition-all active:scale-95 touch-manipulation ${
                        jenis === j.id
                          ? 'clay-key-blue bg-blue-700 text-white shadow-md'
                          : 'clay-key-neutral bg-surface text-textSecondary hover:bg-gray-100 hover:text-slate-800'
                      }`}
                    >
                      <span className="material-symbols-outlined icon-md">{j.icon}</span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={toggleBulk}
                  aria-label="Pilih banyak transaksi"
                  title="Pilih banyak transaksi"
                  className={`chip-btn clay-chip flex h-10 w-10 sm:h-11 sm:w-11 rounded-full shrink-0 items-center justify-center transition-all active:scale-95 touch-manipulation ${
                    bulkMode
                      ? 'clay-key-blue bg-blue-700 text-white shadow-md'
                      : 'clay-key-neutral bg-surface text-textSecondary hover:bg-gray-100 hover:text-slate-800'
                  }`}
                >
                  <span className="material-symbols-outlined icon-md">checklist</span>
                </button>
              </div>
            </div>
          </div>

          {/* Kartu 2: filter tanggal (desktop) — shadow clay blue manual, radius 22px */}
          <button
            onClick={() => setFilterOpen(true)}
            aria-label="Filter Tanggal"
            className="hidden h-14 max-w-[170px] shrink-0 items-center gap-1.5 rounded-[22px] pl-2.5 pr-3 text-xs font-medium text-white transition-colors hover:bg-blue-800 md:flex"
            style={{
              background: '#1d4ed8',
              boxShadow:
                '3px 3px 9px rgba(31,84,200,.25), -3px -3px 9px rgba(255,255,255,.6), inset 1px 1px 3px rgba(255,255,255,.5), inset -2px -2px 4px rgba(31,84,200,.12)',
            }}
          >
            <span className="material-symbols-outlined shrink-0 icon-md">tune</span>
            <span className="truncate">{filterLabel(chip, rentang)}</span>
          </button>

          {/* Tombol Catat Transaksi di mobile & tablet/desktop medium saat panel kanan tersembunyi */}
          <button
            onClick={() => bukaForm('add', { preset: jenis === 'pemasukan' ? 'pemasukan' : 'pengeluaran' })}
            aria-label={jenis === 'pemasukan' ? 'Tambah Pemasukan' : 'Catat Transaksi'}
            className="flex h-11 sm:h-14 shrink-0 items-center gap-1.5 rounded-[18px] sm:rounded-[22px] px-3 sm:px-4 text-xs font-bold text-white transition-all hover:brightness-105 active:scale-95 xl:hidden touch-manipulation"
            style={{
              background: jenis === 'pemasukan' ? '#2d6a4f' : '#1e293b',
              boxShadow:
                '3px 3px 9px rgba(0,0,0,.15), -3px -3px 9px rgba(255,255,255,.6), inset 1px 1px 3px rgba(255,255,255,.4)',
            }}
          >
            <span className="material-symbols-outlined shrink-0 icon-sm sm:icon-md">add_circle</span>
            <span className="truncate">{jenis === 'pemasukan' ? 'Tambah Pemasukan' : 'Catat Transaksi'}</span>
          </button>
        </div>

          {/* Pagination — ikut sticky bersama toolbar sehingga tidak ter-scroll */}
          {totalPages > 1 && (
            <div className="mt-2.5 flex items-center justify-center gap-2">
              <button
                type="button"
                aria-label="Halaman sebelumnya"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="clay-pagination-arrow flex h-9 w-9 items-center justify-center rounded-full bg-surfaceContainerLowest text-slate-600 shadow-sm"
              >
                <span className="material-symbols-outlined icon-md">chevron_left</span>
              </button>
              <span className="text-[11px] font-bold text-slate-700 tracking-tight">Halaman {page}/{totalPages}</span>
              <button
                type="button"
                aria-label="Halaman berikutnya"
                disabled={page >= totalPages && !hasMore}
                onClick={nextPage}
                className="clay-pagination-arrow flex h-9 w-9 items-center justify-center rounded-full bg-surfaceContainerLowest text-slate-600 shadow-sm"
              >
                <span className="material-symbols-outlined icon-md">{loadingMore && page >= totalPages ? 'progress_activity' : 'chevron_right'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Spacer untuk mengimbangi after:h-4 fade strip di bawah sticky toolbar */}
        <div className="h-5 md:h-3" aria-hidden="true" />

        {error && (
          <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-xs font-semibold text-red-600">
            {error.toLowerCase().includes('index')
              ? 'Query butuh index Firestore — buka link di error console browser (F12) untuk membuatnya. Sekali saja.'
              : error}
          </p>
        )}

        {/* Konten utama */}
        {!adaAkun ? (
          <div className="mt-4">
            <ChipAkunBaru uid={uid} />
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-sm text-textSecondary">
            <div className="riwayat-dot-spinner" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="riwayat-dot-spinner__dot"></div>
              ))}
            </div>
            <span>Memuat riwayat kas...</span>
          </div>
        ) : pageItems.length === 0 ? (
          <div className="clay clay-card-soft mx-auto my-6 flex max-w-sm flex-col items-center justify-center rounded-[28px] p-8 text-center bg-surfaceContainerLowest">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-3xl">receipt_long</span>
            </div>
            <p className="text-sm font-bold text-slate-800">Belum Ada Transaksi</p>
            <p className="mt-1 text-xs leading-relaxed text-textSecondary">
              Data transaksi tidak ditemukan. Ketuk tombol <span className="font-bold text-primary">+</span> di navigasi bawah untuk mencatat transaksi baru.
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => bukaForm('add', { preset: 'pemasukan' })}
                className="clay-btn clay-key-primary solid-primary btn-sm flex items-center gap-1 text-white"
              >
                <span className="material-symbols-outlined icon-xs">trending_up</span>
                Catat Pemasukan
              </button>
              <button
                type="button"
                onClick={() => bukaForm('add', { preset: 'pengeluaran' })}
                className="clay-btn clay-key-danger solid-danger btn-sm flex items-center gap-1 text-white"
              >
                <span className="material-symbols-outlined icon-xs">trending_down</span>
                Catat Pengeluaran
              </button>
            </div>
          </div>
        ) : (
          <div className="-mx-4 flex flex-col gap-3 px-4 pb-4 pt-3 hide-scrollbar">
            {pageItems.map((t) => (
              <TransaksiRow
                key={t.id}
                trans={t}
                bulkMode={bulkMode}
                selected={selected}
                onToggleSelect={toggleSelect}
                deleteOpen={!bulkMode && openDeleteId === t.id}
                onToggleDelete={(id) => setOpenDeleteId((prev) => (prev === id ? null : id))}
                onEdit={() => bukaForm('edit', t)}
                onDelete={(tr) => {
                  setOpenDeleteId(null)
                  setHapusTarget(tr)
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* BAR AKSI HAPUS MASSAL — persis GAS #bulkActionBar */}
      {bulkMode && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[9999] px-4 md:bottom-16">
          <div className="clay-sheet clay-key-danger pointer-events-auto mx-auto flex w-full max-w-md items-center gap-3 bg-white p-3 shadow-xl">
            <span className="shrink-0 text-sm font-bold text-slate-800">{selected.size} dipilih</span>
            <div className="flex-1"></div>
            <button
              onClick={toggleBulk}
              className="clay-btn-secondary clay-btn btn-sm bg-surface text-textSecondary transition-colors hover:bg-gray-200"
            >
              Batal
            </button>
            <button
              onClick={() => setBulkHapusOpen(true)}
              disabled={selected.size === 0}
              className="clay-btn clay-key-danger solid-danger btn-sm text-white transition-colors disabled:opacity-60"
            >
              <span className="material-symbols-outlined icon-sm">delete</span>
              Hapus
            </button>
          </div>
        </div>
      )}

{/* Modal form tambah/edit/salin */}
      <FormTransaksiModal
        key={`form-${modal.open ? `${modal.mode}-${modal.doc?.id ?? modal.doc?.preset ?? 'default'}` : 'closed'}`}
        uid={uid}
        open={modal.open}
        mode={modal.mode}
        doc={modal.doc}
        akunList={akunList}
        kategoriList={kategoriList}
        onClose={() => setModal({ open: false, mode: 'add', doc: null })}
        onSalin={(d) => setModal({ open: true, mode: 'salin', doc: d })}
      />

      {/* Modal pindah saldo */}
      <ModalPindahSaldo
        key={`pindah-${pindahOpen ? 'open' : 'closed'}`}
        uid={uid}
        open={pindahOpen}
        onClose={() => setPindahOpen(false)}
        akunList={akunList}
      />

      {/* Modal filter tanggal */}
      <FilterTransaksiModal
        open={filterOpen}
        chip={chip}
        rentang={rentang}
        onClose={() => setFilterOpen(false)}
        onApply={({ chip: c, rentang: r }) => {
          setChip(c)
          if (r) setRentang(r)
        }}
      />

      {/* Modal konfirmasi hapus tunggal — persis GAS #deleteModal */}
      {hapusTarget && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setHapusTarget(null)}>
          <div className="clay-sheet clay-key-danger w-full max-w-sm transform p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <span className="material-symbols-outlined mb-2 icon-hero text-red-500">warning</span>
            <h3 className="mb-2 text-lg font-bold text-slate-800">Hapus Transaksi?</h3>
            <p className="mb-5 text-xs text-slate-500">Tindakan ini tidak bisa dibatalkan.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setHapusTarget(null)}
                className="clay-btn-secondary clay-btn btn-md flex-1 text-textSecondary transition-colors hover:bg-gray-200"
              >
                Batal
              </button>
              <button
                onClick={konfirmHapus}
                disabled={hapusLoading}
                className="clay-btn clay-key-danger solid-danger btn-md flex-1 text-white transition-colors disabled:opacity-60"
              >
                {hapusLoading ? 'Menghapus…' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal konfirmasi hapus massal — persis GAS #bulkDeleteModal */}
      {bulkHapusOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setBulkHapusOpen(false)}>
          <div className="clay-sheet clay-key-danger w-full max-w-sm transform p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <span className="material-symbols-outlined mb-2 icon-hero text-red-500">delete</span>
            <h3 className="mb-2 text-lg font-bold text-slate-800">Hapus {selected.size} Transaksi?</h3>
            <p className="mb-5 text-xs text-slate-500">Semua transaksi yang dipilih akan dihapus. Tindakan ini tidak bisa dibatalkan.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setBulkHapusOpen(false)}
                className="clay-btn-secondary clay-btn btn-md flex-1 text-textSecondary transition-colors hover:bg-gray-200"
              >
                Batal
              </button>
              <button
                onClick={konfirmHapusMassal}
                disabled={hapusLoading}
                className="clay-btn clay-key-danger solid-danger btn-md flex-1 text-white transition-colors disabled:opacity-60"
              >
                {hapusLoading ? 'Menghapus…' : 'Ya, Hapus Semua'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
