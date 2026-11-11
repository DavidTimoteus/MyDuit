// Pure LRU session cache helpers for transaksi query results (max 8 keys)
import { cocokKunci, urutkanTransaksi } from './mergeRiwayat.js'

const MAX_CACHE_KEYS = 8

export function buatCacheTransaksiKey({ uid = '', jenis = 'semua', range = {}, pageSize = 50 } = {}) {
  return `${uid}|${jenis}|${range?.start ?? ''}|${range?.end ?? ''}|${pageSize ?? 50}`
}

export function simpanCacheTransaksi(store, key, { docs = [], hasMore = false, lastDoc = null } = {}) {
  if (!store || !key) return
  if (store.has(key)) store.delete(key)
  const payload = lastDoc ? { docs, hasMore: Boolean(hasMore), lastDoc } : { docs, hasMore: Boolean(hasMore) }
  store.set(key, payload)
  while (store.size > MAX_CACHE_KEYS) {
    const oldestKey = store.keys().next().value
    if (oldestKey === undefined) break
    store.delete(oldestKey)
  }
}

export function perbaruiCacheLanjutan(store, key, { docs = [], hasMore = false, lastDoc = null } = {}) {
  simpanCacheTransaksi(store, key, { docs, hasMore, lastDoc })
}

export function ambilCacheTransaksi(store, { uid = '', jenis = 'semua', range = {}, pageSize = 50 } = {}) {
  if (!store || !uid) return null
  const key = buatCacheTransaksiKey({ uid, jenis, range, pageSize })
  if (store.has(key)) {
    const entry = store.get(key)
    // Refresh LRU recency
    store.delete(key)
    store.set(key, entry)
    return entry
  }
  // Bila snapshot 'semua' pada rentang & pageSize yang sama lengkap (!hasMore),
  // filter jenis (pemasukan/pengeluaran) langsung diturunkan secara instan (0ms).
  if (jenis && jenis !== 'semua') {
    const keySemua = buatCacheTransaksiKey({ uid, jenis: 'semua', range, pageSize })
    const semuaEntry = store.get(keySemua)
    if (semuaEntry && !semuaEntry.hasMore) {
      return {
        docs: semuaEntry.docs.filter((d) => !d.deleted && d.jenis === jenis),
        hasMore: false,
        derived: true,
      }
    }
  }
  return null
}

export function mutasiCacheTransaksi(store, uid, action) {
  if (!store || !uid || !action) return
  const prefix = `${uid}|`
  for (const [key, entry] of store.entries()) {
    if (!key.startsWith(prefix) || !entry) continue
    const prevDocs = entry.docs || []
    if (action.type === 'hapus') {
      const idSet = new Set(action.ids || (action.id ? [action.id] : []))
      if (!idSet.size) continue
      const nextDocs = prevDocs.filter((d) => !idSet.has(d.id))
      if (nextDocs.length !== prevDocs.length) {
        store.set(key, { ...entry, docs: nextDocs })
      }
    } else if (action.type === 'tambah' && action.item?.id) {
      if (!cocokKunci(action.item, key)) continue
      const tanpaDup = prevDocs.filter((d) => d.id !== action.item.id)
      const nextDocs = [action.item, ...tanpaDup].sort(urutkanTransaksi)
      store.set(key, { ...entry, docs: nextDocs })
    } else if (action.type === 'update' && action.item?.id) {
      const tanpaItem = prevDocs.filter((d) => d.id !== action.item.id)
      const nextDocs = cocokKunci(action.item, key)
        ? [action.item, ...tanpaItem].sort(urutkanTransaksi)
        : tanpaItem
      store.set(key, { ...entry, docs: nextDocs })
    }
  }
}

export function invalidateCacheUid(store, uid) {
  if (!store || !uid) return
  const prefix = `${uid}|`
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}
