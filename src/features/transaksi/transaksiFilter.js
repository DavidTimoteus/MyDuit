// Pure filter & page preservation evaluator on optimistic transaksi additions
import { urutkanTransaksi } from './mergeRiwayat.js'

export function cocokPencarianTransaksi(t, keyword = '') {
  const kw = String(keyword || '').trim().toLowerCase()
  if (!kw) return true
  return [t?.kategoriNama, t?.catatan, t?.akunNama, String(t?.jumlah ?? '')].some((s) =>
    String(s ?? '').toLowerCase().includes(kw),
  )
}

export function evaluasiPenambahanTransaksi({
  docs = [],
  item,
  range = null,
  jenis = 'semua',
  keyword = '',
  currentPage = 1,
  perHalaman = 20,
} = {}) {
  if (!item) {
    return {
      perluResetRange: false,
      perluResetJenis: false,
      nextPage: currentPage,
      targetPage: currentPage,
    }
  }
  const tgl = String(item.tanggal || '').slice(0, 10)
  const perluResetRange = Boolean(
    range && tgl && ((range.start && tgl < range.start) || (range.end && tgl > range.end)),
  )
  const perluResetJenis = Boolean(
    jenis && jenis !== 'semua' && item.jenis && item.jenis !== jenis,
  )

  if (perluResetRange || perluResetJenis) {
    return {
      perluResetRange,
      perluResetJenis,
      nextPage: 1,
      targetPage: 1,
    }
  }

  const base = Array.isArray(docs) ? docs.filter((d) => d && d.id !== item.id) : []
  const gabungan = [item, ...base].sort(urutkanTransaksi)
  const tersaring = keyword && String(keyword).trim()
    ? gabungan.filter((t) => cocokPencarianTransaksi(t, keyword))
    : gabungan

  const idx = item.id ? tersaring.findIndex((t) => t.id === item.id) : -1
  const size = Math.max(1, Number(perHalaman) || 20)
  const targetPage = idx >= 0 ? Math.floor(idx / size) + 1 : currentPage

  return {
    perluResetRange: false,
    perluResetJenis: false,
    nextPage: currentPage,
    targetPage,
  }
}
