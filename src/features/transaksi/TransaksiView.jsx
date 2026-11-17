import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isoHariIni, rangeForFilter, simbolUang } from '../../lib/format.js'
import { bacaBasisMataUang, buatSnapshotKurs } from '../../lib/kurs.js'
import { buatTransaksiId, enrichTransaksi, hapusPindahSaldo, hapusTransaksi, hapusTransaksiMassal, simpanTransaksi } from '../../lib/db.js'
import { pesanErrorSimpan } from '../../lib/pesanError.js'
import FormTransaksiModal from './FormTransaksiModal.jsx'
import ModalPindahSaldo from './ModalPindahSaldo.jsx'
import FilterTransaksiModal from './FilterTransaksiModal.jsx'
import { ChipAkunBaru, TransaksiRow } from './TransaksiRow.jsx'
import { useTransaksi } from './useTransaksi.js'
import { useAkunKategori } from '../../lib/useAkunKategori.js'
import { useKursVersi } from '../../lib/useKurs.js'
import { useScrollReveal } from '../../lib/useScrollEffects.js'
import { portalBody } from '../../lib/portal.js'
import { evaluasiPenambahanTransaksi } from './transaksiFilter.js'

const PER_HALAMAN = 20
const LS_CHIP = 'myduit:tx_chip'

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
  const [chip, setChip] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_CHIP) || 'semua'
      return saved === 'rentang' ? 'semua' : saved
    } catch {
      return 'semua'
    }
  })

  const ubahChip = useCallback((c) => {
    setChip(c)
    setPage(1)
    try {
      if (c === 'rentang') localStorage.removeItem(LS_CHIP)
      else localStorage.setItem(LS_CHIP, c)
    } catch {
      // storage diblokir
    }
  }, [])
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
  const [justAddedId, setJustAddedId] = useState(null)
  const justAddedTimerRef = useRef(0)
  const [page, setPage] = useState(1)

  const ubahJenis = useCallback((j) => {
    setJenis(j)
    setPage(1)
  }, [])

  function ubahKeyword(val) {
    setKeyword(val)
    setPage(1)
  }

  const range = useMemo(
    () => rangeForFilter(chip, rentang),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chip, rentang.start, rentang.end],
  )
  const { docs, loading, loadingMore, hasMore, error, muatLagi, hapusLokal } = useTransaksi(uid, { jenis, range })
  const { akunList, kategoriList } = useAkunKategori(uid)

  // Delayed loading spinner (140ms) agar hit cache/IndexedDB lokal <140ms tidak membongkar DOM daftar transaksi
  const [delayedLoading, setDelayedLoading] = useState(false)
  useEffect(() => {
    if (!loading) {
      setDelayedLoading(false)
      return undefined
    }
    const timer = window.setTimeout(() => setDelayedLoading(true), 140)
    return () => window.clearTimeout(timer)
  }, [loading])

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

  const bukaForm = useCallback((mode, doc = null) => {
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
    if (doc && doc.utangId && mode === 'edit') {
      window.dispatchEvent(
        new CustomEvent('myduit:toast', {
          detail: { type: 'info', msg: 'Transaksi pembayaran utang tidak bisa diedit. Hapus lalu catat ulang pembayaran.' },
        }),
      )
      return
    }
    setModal({ open: true, mode, doc })
  }, [])

  // Aksi Cepat dari panel kanan (event bus — panel terpisah dari state view ini)
  useEffect(() => {
    function onAksi(e) {
      const { type } = e.detail || {}
      if (type === 'pemasukan' || type === 'pengeluaran') bukaForm('add', { preset: type })
      else if (type === 'pindah-saldo') setPindahOpen(true)
    }
    window.addEventListener('myduit:aksi-cepat', onAksi)
    return () => window.removeEventListener('myduit:aksi-cepat', onAksi)
  }, [bukaForm])

  const docsEnrichedRef = useRef(docsEnriched)
  docsEnrichedRef.current = docsEnriched
  const pageRef = useRef(page)
  pageRef.current = page
  const keywordRef = useRef(keyword)
  keywordRef.current = keyword

  // Tangani transaksi baru / salinan: hanya alihkan filter jika item benar-benar di luar
  // rentang/jenis aktif. Bila cocok filter, pertahankan halaman aktif (misal Hal. 4)
  // dengan sorot optimis agar tidak melompat kembali ke Halaman 1 seperti full-refresh.
  useEffect(() => {
    function onTransaksiAdded(e) {
      const item = e?.detail?.item
      if (!item) return
      const isRollback = Boolean(e?.detail?.isRollback)
      const hasil = evaluasiPenambahanTransaksi({
        docs: docsEnrichedRef.current,
        item,
        range,
        jenis,
        keyword: keywordRef.current,
        currentPage: pageRef.current,
        perHalaman: PER_HALAMAN,
      })
      if (hasil.perluResetRange) ubahChip('semua')
      if (hasil.perluResetJenis) ubahJenis('semua')
      if (!isRollback) {
        setJustAddedId(item.id)
        if (justAddedTimerRef.current) window.clearTimeout(justAddedTimerRef.current)
        justAddedTimerRef.current = window.setTimeout(() => setJustAddedId(null), 1800)

        if (!hasil.perluResetRange && !hasil.perluResetJenis && hasil.targetPage !== pageRef.current) {
          const targetP = hasil.targetPage
          window.dispatchEvent(
            new CustomEvent('myduit:toast', {
              detail: {
                type: 'success',
                msg: `Transaksi dicatat di Hal. ${targetP}.`,
                actionLabel: `Lihat Hal. ${targetP}`,
                onAction: () => {
                  setPage(targetP)
                  const scroller = listRef.current?.closest('.main-scroll')
                  scroller?.scrollTo?.({ top: 0, behavior: 'smooth' })
                },
              },
            }),
          )
        }
      }
    }
    window.addEventListener('myduit:transaksi-added', onTransaksiAdded)
    return () => window.removeEventListener('myduit:transaksi-added', onTransaksiAdded)
  }, [range, jenis, ubahChip, ubahJenis])

  const totalPages = Math.max(1, Math.ceil(tampil.length / PER_HALAMAN))

  useEffect(() => {
    if (!loading && page > totalPages) {
      setPage(totalPages)
    }
  }, [loading, page, totalPages])
  const pageItems = tampil.slice((page - 1) * PER_HALAMAN, page * PER_HALAMAN)

  const touchStartX = useRef(null)
  const touchStartY = useRef(null)
  const isHorizontalSwipe = useRef(false)
  const dragXRef = useRef(0)
  const dragRafRef = useRef(0)
  const sectionRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => () => {
    if (dragRafRef.current) cancelAnimationFrame(dragRafRef.current)
    if (justAddedTimerRef.current) window.clearTimeout(justAddedTimerRef.current)
  }, [])

  function playListSlide(dir) {
    const el = listRef.current
    if (!el || typeof el.animate !== 'function') return
    try {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
      const fromX = dir === 'next' ? 14 : -14
      el.animate(
        [
          { opacity: 0.25, transform: `translate3d(${fromX}px, 0, 0)` },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        ],
        { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      )
    } catch {
      // fallback aman bila WAAPI tidak tersedia
    }
  }

  function resetDragStyles() {
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = 0
    }
    const prevX = dragXRef.current
    dragXRef.current = 0
    const el = listRef.current
    if (!el) return 0
    el.style.willChange = ''
    el.style.transform = ''
    return prevX
  }

  function snapBackListDrag() {
    const prevX = resetDragStyles()
    const el = listRef.current
    if (!el || !prevX || typeof el.animate !== 'function') return
    try {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
      el.animate(
        [{ transform: `translate3d(${prevX}px, 0, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
        { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      )
    } catch {
      // abaikan
    }
  }

  function prevPage() {
    if (page > 1) {
      setOpenDeleteId(null)
      setPage((p) => p - 1)
      playListSlide('prev')
    }
  }

  function handleTouchStart(e) {
    if (!e.touches || e.touches.length !== 1) return
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    isHorizontalSwipe.current = false
    dragXRef.current = 0
  }

  function handleTouchMove(e) {
    if (touchStartX.current === null || touchStartY.current === null) return
    const currentX = e.touches[0].clientX
    const currentY = e.touches[0].clientY
    const diffX = currentX - touchStartX.current
    const diffY = currentY - touchStartY.current

    if (!isHorizontalSwipe.current) {
      if (Math.abs(diffX) > 10 && Math.abs(diffX) > Math.abs(diffY) * 1.2) {
        isHorizontalSwipe.current = true
        if (listRef.current) listRef.current.style.willChange = 'transform'
      } else if (Math.abs(diffY) > 10) {
        touchStartX.current = null
        touchStartY.current = null
        resetDragStyles()
        return
      }
    }

    if (isHorizontalSwipe.current) {
      dragXRef.current = diffX * 0.35
      if (!dragRafRef.current) {
        dragRafRef.current = window.requestAnimationFrame(() => {
          dragRafRef.current = 0
          if (listRef.current && isHorizontalSwipe.current) {
            listRef.current.style.transform = `translate3d(${dragXRef.current}px, 0, 0)`
          }
        })
      }
    }
  }

  function handleTouchEnd(e) {
    if (touchStartX.current === null || touchStartY.current === null) {
      snapBackListDrag()
      return
    }
    const touch = e.changedTouches[0]
    const diffX = touch.clientX - touchStartX.current
    const diffY = touch.clientY - touchStartY.current
    touchStartX.current = null
    touchStartY.current = null
    const wasSwipe = isHorizontalSwipe.current
    isHorizontalSwipe.current = false

    if (wasSwipe && Math.abs(diffX) > 45 && Math.abs(diffX) > Math.abs(diffY) * 1.2) {
      if (diffX < 0 && (page < totalPages || hasMore)) {
        resetDragStyles()
        nextPage()
        return
      }
      if (diffX > 0 && page > 1) {
        resetDragStyles()
        prevPage()
        return
      }
    }
    snapBackListDrag()
  }

  async function nextPage() {
    if (page < totalPages) {
      setOpenDeleteId(null)
      setPage(page + 1)
      playListSlide('next')
      return
    }
    if (hasMore && !loadingMore) {
      setOpenDeleteId(null)
      await muatLagi()
      setPage(page + 1)
      playListSlide('next')
    }
  }

  function toggleBulk() {
    setBulkMode((b) => !b)
    setSelected(new Set())
    setOpenDeleteId(null)
  }

  const toggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }, [])

  const fallbackAkunIdRef = useRef('')
  fallbackAkunIdRef.current = akunList[0]?.id ?? ''
  const salinLockRef = useRef({ id: null, at: 0 })
  const hapusLockRef = useRef(new Set())
  const bulkHapusLockRef = useRef(false)

  useEffect(() => {
    if (bulkHapusOpen) bulkHapusLockRef.current = false
  }, [bulkHapusOpen])

  const handleSalinCepat = useCallback(async (trans) => {
    if (!trans || trans.jenis === 'pindah saldo') return
    const now = Date.now()
    if (salinLockRef.current.id === trans.id && now - salinLockRef.current.at < 800) return
    salinLockRef.current = { id: trans.id, at: now }
    setOpenDeleteId(null)
    const docId = buatTransaksiId(uid)
    const tanggalCopy = trans.tanggal ?? isoHariIni()
    const optTx = {
      id: docId,
      jumlah: Number(trans.jumlah) || 0,
      jenis: trans.jenis,
      kategoriId: trans.kategoriId ?? '',
      kategoriNama: trans.kategoriNama ?? '',
      akunId: trans.akunId ?? fallbackAkunIdRef.current ?? '',
      akunNama: trans.akunNama ?? '',
      tanggal: tanggalCopy,
      catatan: trans.catatan ?? '',
      kursSnapshot: buatSnapshotKurs(bacaBasisMataUang() || 'IDR', tanggalCopy),
      deleted: false,
      createdAt: new Date().toISOString(),
    }
    window.dispatchEvent(new CustomEvent('myduit:transaksi-added', { detail: { item: optTx } }))
    window.dispatchEvent(
      new CustomEvent('myduit:toast', {
        detail: { type: 'success', msg: 'Transaksi berhasil disalin & dicatat!' },
      })
    )
    ;(async () => {
      try {
        await simpanTransaksi(uid, {
          id: docId,
          jumlah: optTx.jumlah,
          jenis: optTx.jenis,
          kategoriId: optTx.kategoriId,
          kategoriNama: optTx.kategoriNama,
          akunId: optTx.akunId,
          akunNama: optTx.akunNama,
          tanggal: optTx.tanggal,
          catatan: optTx.catatan,
        })
      } catch (e) {
        console.warn('[salin-cepat] gagal:', e)
        window.dispatchEvent(new CustomEvent('myduit:transaksi-deleted', { detail: { ids: [docId] } }))
        window.dispatchEvent(new CustomEvent('myduit:toast', { detail: { type: 'error', msg: pesanErrorSimpan('Menyalin transaksi', e) } }))
      }
    })()
  }, [uid])

  async function konfirmHapus() {
    if (!hapusTarget || hapusLockRef.current.has(hapusTarget.id)) return
    const target = hapusTarget
    hapusLockRef.current.add(target.id)
    setHapusTarget(null)
    setHapusLoading(false)
    setOpenDeleteId(null)

    // Optimistic UI update: hapus secara instan dari tampilan tanpa refresh dan tanpa reset filter
    hapusLokal?.(target.id)

    try {
      if (target.jenis === 'pindah saldo') await hapusPindahSaldo(uid, target)
      else await hapusTransaksi(uid, target)
    } catch (e2) {
      hapusLockRef.current.delete(target.id)
      console.warn('[hapus] gagal:', e2?.message ?? e2)
      window.dispatchEvent(new CustomEvent('myduit:transaksi-added', { detail: { item: target, isRollback: true } }))
      window.dispatchEvent(
        new CustomEvent('myduit:toast', {
          detail: { type: 'error', msg: 'Gagal menghapus transaksi dari server.' },
        }),
      )
    }
  }

  async function konfirmHapusMassal() {
    if (selected.size === 0 || bulkHapusLockRef.current) return
    bulkHapusLockRef.current = true
    const ids = Array.from(selected)
    const targets = ids.map((id) => docsEnriched.find((x) => x.id === id)).filter(Boolean)
    setSelected(new Set())
    setBulkMode(false)
    setBulkHapusOpen(false)
    setHapusLoading(false)
    setOpenDeleteId(null)

    // Optimistic UI update massal: hapus semua ID terpilih secara instan
    hapusLokal?.(ids)

    try {
      await hapusTransaksiMassal(uid, targets)
    } catch (e2) {
      console.warn('[hapus-massal] gagal:', e2?.message ?? e2)
      targets.forEach((t) => {
        window.dispatchEvent(new CustomEvent('myduit:transaksi-added', { detail: { item: t, isRollback: true } }))
      })
      window.dispatchEvent(
        new CustomEvent('myduit:toast', {
          detail: { type: 'error', msg: 'Gagal menghapus transaksi terpilih dari server.' },
        }),
      )
    }
  }

  const handleToggleDelete = useCallback((id) => {
    setOpenDeleteId((prev) => (prev === id ? null : id))
  }, [])

  const handleEditRow = useCallback((tr) => bukaForm('edit', tr), [bukaForm])

  const handleDeleteRow = useCallback((tr) => {
    setOpenDeleteId(null)
    setHapusTarget(tr)
  }, [])

  const adaAkun = akunList.length > 0
  const kursVer = useKursVersi()
  const currencySymbol = simbolUang()
  useScrollReveal(listRef, [delayedLoading, pageItems.length, page])

  return (
    <section ref={sectionRef} className="view-panel-enter mx-auto max-w-3xl px-5 pb-32 md:pb-10">
      <div className="view-section active min-w-0">

        {/* Toolbar: responsif mobile — di layar kecil input search baris 1, filter baris 2 */}
        {/* ─── STICKY TOOLBAR WRAPPER ────────────────────────────────────────────────
            Mobile  (<md): bleed ke tepi layar penuh dengan -mx-5 px-5 agar background
                           mencakup keseluruhan lebar viewport. top-[52px] = header mobile.
            Desktop (md+): bleed ke tepi container scroll dengan md:-mx-6 md:px-6
                           agar saat kartu transaksi di-scroll, bayangannya di sisi
                           kiri-kanan tidak bocor melintasi toolbar.
        ─────────────────────────────────────────────────────────────────────────── */}
        <div className="sticky-fade-bottom sticky top-[52px] md:top-0 z-20
                        -mx-9 px-9 md:-mx-6 md:px-6
                        bg-surface
                        pt-2.5 pb-2.5 mb-0
                        relative">
          {/* Header mobile (md:hidden) — logo transaksi + judul embossed */}
          <header className="pb-2.5 md:hidden">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="clay-icon-tile clay-key-primary solid-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white">
                <span className="material-symbols-outlined icon-lg" style={{ fontVariationSettings: "'FILL' 1" }}>
                  receipt_long
                </span>
              </div>
              <h2 className="brand-title-embossed font-display text-2xl font-extrabold leading-tight">Transaksi</h2>
            </div>
          </header>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          {/* Kartu pencarian & filter */}
          <div className="clay clay-card clay-key-neutral w-full rounded-[22px] p-2.5 sm:p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 icon-lg text-textSecondary pointer-events-none select-none">search</span>
                <input
                  value={keyword}
                  onChange={(e) => ubahKeyword(e.target.value)}
                  placeholder="Cari transaksi..."
                  type="text"
                  className="clay-input w-full border-none py-2.5 pl-10 pr-10 text-base sm:text-sm transition-shadow duration-150 placeholder:text-textSecondary rounded-[16px] touch-manipulation"
                />
                {keyword && (
                  <button
                    type="button"
                    onClick={() => ubahKeyword('')}
                    aria-label="Hapus pencarian"
                    className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 transition-[transform,color,background-color] duration-150 active:scale-90 active:bg-slate-200/60 hover:bg-red-100 hover:text-red-500 touch-manipulation"
                    style={{
                      background: 'var(--color-surface, #E5E5E5)',
                      boxShadow: '-3px -3px 8px rgba(255,255,255,.8), 3px 3px 8px rgba(0,0,0,.14)',
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
                      onClick={() => ubahJenis(j.id)}
                      aria-label={j.title}
                      title={j.title}
                      className={`chip-btn clay-chip flex h-10 w-10 sm:h-11 sm:w-11 rounded-full shrink-0 items-center justify-center touch-manipulation ${
                        jenis === j.id
                          ? 'clay-key-primary solid-primary text-white'
                          : 'clay-key-neutral bg-surface text-textSecondary hover:bg-slate-200/60 hover:text-slate-800'
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
                  className={`chip-btn clay-chip flex h-10 w-10 sm:h-11 sm:w-11 rounded-full shrink-0 items-center justify-center touch-manipulation ${
                    bulkMode
                      ? 'clay-key-primary solid-primary text-white'
                      : 'clay-key-neutral bg-surface text-textSecondary hover:bg-slate-200/60 hover:text-slate-800'
                  }`}
                >
                  <span className="material-symbols-outlined icon-md">checklist</span>
                </button>
              </div>
            </div>
          </div>

          {/* Kartu 2: filter tanggal (desktop) — tombol sekunder clay taktil */}
          <button
            onClick={() => setFilterOpen(true)}
            aria-label="Filter Tanggal"
            className="hidden h-14 max-w-[170px] shrink-0 items-center gap-1.5 rounded-[22px] px-3.5 text-xs font-bold clay-btn clay-btn-secondary text-slate-700 md:flex"
          >
            <span className="material-symbols-outlined shrink-0 icon-md text-primary">tune</span>
            <span className="truncate">{filterLabel(chip, rentang)}</span>
          </button>

          {/* Tombol Catat Transaksi di tablet/desktop medium (768px-1279px) saat panel kanan & FAB tersembunyi */}
          <button
            onClick={() => bukaForm('add', { preset: jenis === 'pemasukan' ? 'pemasukan' : 'pengeluaran' })}
            aria-label="Catat Transaksi"
            className="hidden h-14 shrink-0 items-center gap-1.5 rounded-[22px] px-4 text-xs font-bold text-white transition-all hover:brightness-105 active:scale-95 md:flex xl:hidden"
            style={{
              background: jenis === 'pemasukan' ? '#36AE7C' : '#1E293B',
              boxShadow:
                '-4px -4px 10px rgba(255,255,255,.7), 4px 4px 10px rgba(0,0,0,.15)',
            }}
          >
            <span className="material-symbols-outlined shrink-0 icon-md">add_circle</span>
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
                onClick={prevPage}
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
        ) : delayedLoading && pageItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-sm text-textSecondary">
            <div className="riwayat-dot-spinner" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="riwayat-dot-spinner__dot"></div>
              ))}
            </div>
            <span>Memuat riwayat kas...</span>
          </div>
        ) : loading && pageItems.length === 0 ? (
          <div className="min-h-[240px]" aria-busy="true" />
        ) : pageItems.length === 0 ? (
          <div className="neu-card mx-auto my-6 flex max-w-sm flex-col items-center justify-center rounded-[28px] bg-[#E5E5E5] p-8 text-center">
            <div className="neu-well mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#E5E5E5] text-[#36AE7C]">
              <span className="material-symbols-outlined text-3xl">receipt_long</span>
            </div>
            <p className="text-base font-extrabold text-slate-800 tracking-tight">Belum Ada Transaksi</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Data transaksi tidak ditemukan. Ketuk tombol <span className="font-extrabold text-[#36AE7C]">+</span> di navigasi bawah untuk mencatat transaksi baru.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2.5">
              <button
                type="button"
                onClick={() => bukaForm('add', { preset: 'pemasukan' })}
                className="clay-btn clay-key-primary solid-primary btn-sm flex items-center gap-1.5 text-white font-bold"
              >
                <span className="material-symbols-outlined icon-xs">trending_up</span>
                Catat Pemasukan
              </button>
              <button
                type="button"
                onClick={() => bukaForm('add', { preset: 'pengeluaran' })}
                className="clay-btn clay-key-danger solid-danger btn-sm flex items-center gap-1.5 text-white font-bold"
              >
                <span className="material-symbols-outlined icon-xs">trending_down</span>
                Catat Pengeluaran
              </button>
              <button
                type="button"
                onClick={() => setPindahOpen(true)}
                className="clay-btn clay-key-blue solid-blue btn-sm flex items-center gap-1.5 text-white font-bold"
              >
                <span className="material-symbols-outlined icon-xs">swap_horiz</span>
                Catat Pindah Saldo
              </button>
            </div>
          </div>
        ) : (
          <div
            ref={listRef}
            data-tx-swipe=""
            className="-mx-4 flex flex-col gap-3 px-4 pb-4 pt-3 hide-scrollbar"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={snapBackListDrag}
            style={{ touchAction: 'pan-y', contain: 'layout style' }}
          >
            {pageItems.map((t, i) => (
              <TransaksiRow
                key={`tx-slot-${i}`}
                trans={t}
                bulkMode={bulkMode}
                selected={bulkMode && selected.has(t.id)}
                justAdded={t.id === justAddedId}
                currencySymbol={currencySymbol}
                kursVer={kursVer}
                onToggleSelect={toggleSelect}
                deleteOpen={!bulkMode && openDeleteId === t.id}
                onToggleDelete={handleToggleDelete}
                onEdit={handleEditRow}
                onSalin={handleSalinCepat}
                onDelete={handleDeleteRow}
              />
            ))}
          </div>
        )}
      </div>

      {/* BAR AKSI HAPUS MASSAL — persis GAS #bulkActionBar */}
      {bulkMode && portalBody(
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[9999] px-4 md:bottom-16">
          <div className="clay-sheet clay-key-danger pointer-events-auto mx-auto flex w-full max-w-md items-center gap-3 p-3">
            <span className="shrink-0 text-sm font-bold text-slate-800">{selected.size} dipilih</span>
            <div className="flex-1"></div>
            <button
              onClick={toggleBulk}
              className="clay-btn-secondary clay-btn btn-sm bg-surface text-textSecondary hover:bg-gray-200"
            >
              Batal
            </button>
            <button
              onClick={() => setBulkHapusOpen(true)}
              disabled={selected.size === 0}
              className="clay-btn clay-key-danger solid-danger btn-sm text-white disabled:opacity-60"
            >
              <span className="material-symbols-outlined icon-sm">delete</span>
              Hapus
            </button>
          </div>
        </div>,
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
          ubahChip(c)
          if (r) setRentang(r)
          setPage(1)
        }}
      />

      {/* Modal konfirmasi hapus tunggal — persis GAS #deleteModal */}
      {hapusTarget && portalBody(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm modal-backdrop-wrap" onClick={() => setHapusTarget(null)}>
          <div className="clay-sheet clay-key-danger w-full max-w-sm transform p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <span className="material-symbols-outlined mb-2 icon-hero text-red-500">warning</span>
            <h3 className="mb-2 text-lg font-bold text-slate-800">Hapus Transaksi?</h3>
            <p className="mb-5 text-xs text-slate-500">Tindakan ini tidak bisa dibatalkan.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setHapusTarget(null)}
                className="clay-btn-secondary clay-btn btn-md flex-1 text-textSecondary hover:bg-gray-200"
              >
                Batal
              </button>
              <button
                onClick={konfirmHapus}
                disabled={hapusLoading}
                className="clay-btn clay-key-danger solid-danger btn-md flex-1 text-white disabled:opacity-60"
              >
                {hapusLoading ? 'Menghapus…' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>,
      )}

      {/* Modal konfirmasi hapus massal — persis GAS #bulkDeleteModal */}
      {bulkHapusOpen && portalBody(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm modal-backdrop-wrap" onClick={() => setBulkHapusOpen(false)}>
          <div className="clay-sheet clay-key-danger w-full max-w-sm transform p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <span className="material-symbols-outlined mb-2 icon-hero text-red-500">delete</span>
            <h3 className="mb-2 text-lg font-bold text-slate-800">Hapus {selected.size} Transaksi?</h3>
            <p className="mb-5 text-xs text-slate-500">Semua transaksi yang dipilih akan dihapus. Tindakan ini tidak bisa dibatalkan.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setBulkHapusOpen(false)}
                className="clay-btn-secondary clay-btn btn-md flex-1 text-textSecondary hover:bg-gray-200"
              >
                Batal
              </button>
              <button
                onClick={konfirmHapusMassal}
                disabled={hapusLoading}
                className="clay-btn clay-key-danger solid-danger btn-md flex-1 text-white disabled:opacity-60"
              >
                {hapusLoading ? 'Menghapus…' : 'Ya, Hapus Semua'}
              </button>
            </div>
          </div>
        </div>,
      )}
    </section>
  )
}
