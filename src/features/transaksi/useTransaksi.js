import { IS_DEMO_UID, MOCK_TRANSAKSI } from '../../lib/mockData.js';
import { getDocs, onSnapshot } from 'firebase/firestore'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { buildTransQuery, docKeTransaksi } from '../../lib/db.js'
import { RIWAYAT_AWAL, kurangRiwayat } from './mergeRiwayat.js'
import {
  ambilCacheTransaksi,
  buatCacheTransaksiKey,
  mutasiCacheTransaksi,
  simpanCacheTransaksi,
} from './transaksiCache.js'

const PAGE_SIZE = 50
const globalTransaksiCache = new Map()

// Kunci langganan = uid + jenis + rentang. Berganti kunci = ganti filter.
const kunciQuery = (uid, jenis, range) => `${uid}|${jenis}|${range?.start ?? ''}|${range?.end ?? ''}`

// Langganan live riwayat transaksi sesuai filter + pagination kursor ("Muat lagi").
// Dokumen pertama selalu live (onSnapshot) -> tulis offline tampil instan.
// Logika daftar (kapan dokumen lama dibuang, kapan halaman lanjutan dipertahankan)
// hidup di mergeRiwayat.js dan diuji terpisah tanpa Firestore.
export function useTransaksi(uid, { jenis, range, pageSize = PAGE_SIZE } = {}) {
  const [riwayat, dispatch] = useReducer(kurangRiwayat, RIWAYAT_AWAL)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const lastDocRef = useRef(null)

  // Tangani event global penambahan, pembaruan, dan penghapusan transaksi
  // agar seluruh instans useTransaksi (mis. TransaksiView dan RightPanel)
  // langsung sinkron secara optimis tanpa perlu reload atau mereset filter.
  useEffect(() => {
    function onHapus(e) {
      const ids = e?.detail?.ids || (e?.detail?.id ? [e.detail.id] : null)
      if (ids && ids.length) {
        mutasiCacheTransaksi(globalTransaksiCache, uid, { type: 'hapus', ids })
        dispatch({ type: 'hapus', ids })
      }
    }
    function onTambah(e) {
      const item = e?.detail?.item
      if (item && item.id) {
        mutasiCacheTransaksi(globalTransaksiCache, uid, { type: 'tambah', item })
        dispatch({ type: 'tambah', item })
      }
    }
    function onUpdate(e) {
      const item = e?.detail?.item
      if (item && item.id) {
        mutasiCacheTransaksi(globalTransaksiCache, uid, { type: 'update', item })
        dispatch({ type: 'update', item })
      }
    }
    window.addEventListener('myduit:transaksi-deleted', onHapus)
    window.addEventListener('myduit:transaksi-added', onTambah)
    window.addEventListener('myduit:transaksi-updated', onUpdate)
    return () => {
      window.removeEventListener('myduit:transaksi-deleted', onHapus)
      window.removeEventListener('myduit:transaksi-added', onTambah)
      window.removeEventListener('myduit:transaksi-updated', onUpdate)
    }
  }, [uid])

  useEffect(() => {
    if (!uid) return
    const kunci = kunciQuery(uid, jenis, range)
    const cacheKey = buatCacheTransaksiKey({ uid, jenis, range, pageSize })
    const cached = ambilCacheTransaksi(globalTransaksiCache, { uid, jenis, range, pageSize })
    // 'mulai' membuang dokumen filter sebelumnya (bila kuncinya berbeda).
    // Bila hit cache tersedia (eksak atau turunan filter jenis dari snapshot 'semua' yg lengkap),
    // batch dispatch snapshot langsung di effect yang sama -> 0ms instan tanpa flash spinner.
    dispatch({ type: 'mulai', kunci })
    setError('')
    lastDocRef.current = null
    if (cached) {
      dispatch({ type: 'snapshot', kunci, list: cached.docs })
      setHasMore(cached.hasMore)
      setLoading(false)
    } else {
      setLoading(true)
      setHasMore(false)
    }

    if (IS_DEMO_UID(uid)) {
      let filtered = MOCK_TRANSAKSI.filter(t => !t.deleted);
      if (jenis && jenis !== 'semua') filtered = filtered.filter(t => t.jenis === jenis);
      if (range?.start) filtered = filtered.filter(t => t.tanggal >= range.start);
      if (range?.end) filtered = filtered.filter(t => t.tanggal <= range.end);
      if (!cached) {
        simpanCacheTransaksi(globalTransaksiCache, cacheKey, { docs: filtered, hasMore: false })
      }
      dispatch({ type: 'snapshot', kunci, list: filtered });
      setLoading(false);
      return () => {};
    }
    const q = buildTransQuery(uid, { jenis, range, pageSize })
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map(docKeTransaksi)
        const more = Boolean(pageSize && pageSize > 0 && snap.docs.length === pageSize)
        lastDocRef.current = snap.docs[snap.docs.length - 1] ?? null
        simpanCacheTransaksi(globalTransaksiCache, cacheKey, { docs: list, hasMore: more })
        // Snapshot hanya mencakup pageSize dokumen pertama (bila dibatasi); reducer yang
        // memutuskan apakah halaman "Muat lagi" ikut dipertahankan.
        dispatch({ type: 'snapshot', kunci, list })
        setHasMore(more)
        setLoading(false)
      },
      (e) => {
        setError(e?.message ?? String(e))
        setLoading(false)
      },
    )
    return () => unsub()
    // Sengaja bergantung pada range.start/range.end (string), BUKAN objek
    // `range`: objek baru dibuat setiap render pemanggil, jadi memasukkannya
    // akan membuka ulang langganan Firestore tanpa henti. ESLint tidak
    // menandai ini karena keduanya primitif yang stabil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, jenis, range?.start, range?.end, pageSize])

  // Fungsi optimis lokal (hapus, tambah, update): langsung memperbarui memori
  // seketika dan menyebarkannya via event bus tanpa perlu reload/reset filter.
  const hapusLokal = useCallback((idOrIds) => {
    if (!idOrIds) return
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds]
    mutasiCacheTransaksi(globalTransaksiCache, uid, { type: 'hapus', ids })
    dispatch({ type: 'hapus', ids })
    window.dispatchEvent(new CustomEvent('myduit:transaksi-deleted', { detail: { ids } }))
  }, [uid])

  const tambahLokal = useCallback((item) => {
    if (!item?.id) return
    mutasiCacheTransaksi(globalTransaksiCache, uid, { type: 'tambah', item })
    dispatch({ type: 'tambah', item })
    window.dispatchEvent(new CustomEvent('myduit:transaksi-added', { detail: { item } }))
  }, [uid])

  const updateLokal = useCallback((item) => {
    if (!item?.id) return
    mutasiCacheTransaksi(globalTransaksiCache, uid, { type: 'update', item })
    dispatch({ type: 'update', item })
    window.dispatchEvent(new CustomEvent('myduit:transaksi-updated', { detail: { item } }))
  }, [uid])

  async function muatLagi() {
    if (!uid || !lastDocRef.current || loadingMore) return
    setLoadingMore(true)
    try {
      const q = buildTransQuery(uid, { jenis, range, pageSize: PAGE_SIZE, cursor: lastDocRef.current })
      const snap = await getDocs(q)
      const list = snap.docs.map(docKeTransaksi)
      lastDocRef.current = snap.docs[snap.docs.length - 1] ?? lastDocRef.current
      // Dedupe + penanda halaman lanjutan: dokumen di batas halaman bisa
      // muncul lagi kalau ada penulisan baru di antara dua permintaan.
      dispatch({ type: 'lanjut', kunci: kunciQuery(uid, jenis, range), list })
      setHasMore(snap.docs.length === PAGE_SIZE)
    } catch (e) {
      setError(e?.message ?? String(e))
    } finally {
      setLoadingMore(false)
    }
  }

  return { docs: riwayat.docs, loading, loadingMore, hasMore, error, muatLagi, pageSize: PAGE_SIZE, hapusLokal, tambahLokal, updateLokal }
}
