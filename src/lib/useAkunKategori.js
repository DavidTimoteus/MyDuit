import { createContext, useContext, useEffect, useState } from 'react'
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { seedKategoriJikaKosong } from './db.js'
import { getFirebase } from './firebase.js'

/**
 * Langganan akun + kategori.
 *
 * `AkunKategoriProvider` (file AkunKategoriProvider.jsx) membuka SATU langganan
 * di root dan membagikannya lewat context — itu jalur normalnya. Hook ini
 * membaca context tersebut; kalau dipanggil di luar provider (mis. komponen
 * portal) ia membuka langganan sendiri sebagai fallback supaya tidak crash.
 *
 * Mengapa satu langganan bersama penting: sebelumnya hook ini mandiri, dan enam
 * komponen memakainya (Transaksi, RightPanel, Statistik, Budget, Rekening,
 * Utang) — dua di antaranya di tab yang sama. Satu halaman bisa menahan 12
 * langganan untuk dua koleksi yang sama, sehingga tiap perubahan memicu
 * belasan pembacaan dokumen dan render, menguras kuota Firestore dan baterai.
 */

export const AkunKategoriCtx = createContext(null)

const QUERY_AKUN = (db, uid) =>
  query(collection(db, 'users', uid, 'akun'), where('deleted', '==', false))

const QUERY_KATEGORI = (db, uid) =>
  query(
    collection(db, 'users', uid, 'kategori'),
    where('deleted', '==', false),
    orderBy('nama', 'asc'),
  )

/** Dedupe defensif per-jenis & per-nama (mempertahankan kategori dengan nama sama pada jenis berbeda, mis. 'Lainnya'). */
export function dedupeKategori(docs) {
  const seen = new Set()
  const list = []
  for (const d of docs) {
    const data = d.data()
    const jenis = (data.jenis ?? '').toLowerCase()
    const nama = (data.nama ?? '').toLowerCase()
    const key = `${jenis}::${nama}`
    if (seen.has(key)) continue
    seen.add(key)
    list.push({ id: d.id, ...data })
  }
  return list
}

/** Buka dua langganan; kembalikan fungsi pembersih. */
export function langgananAkunKategori(db, uid, { onAkun, onKategori, onSiap }) {
  const unsubs = []

  // Seed kategori default sekali (diabaikan bila offline & database kosong).
  seedKategoriJikaKosong(uid).catch(() => {})

  unsubs.push(
    onSnapshot(
      QUERY_AKUN(db, uid),
      (snap) => {
        onAkun(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        onSiap(true)
      },
      // Error (mis. offline & cache kosong): tandai siap agar UI tidak menunggu
      // selamanya di skeleton.
      () => onSiap(true),
    ),
  )

  unsubs.push(
    onSnapshot(
      QUERY_KATEGORI(db, uid),
      (snap) => {
        onKategori(dedupeKategori(snap.docs))
        onSiap(true)
      },
      () => onSiap(true),
    ),
  )

  return () => unsubs.forEach((u) => u())
}

export function useAkunKategori(uid) {
  // Jumlah hook harus SAMA di setiap render. Karena itu hook fallback selalu
  // dipanggil, tetapi diberi uid null saat context tersedia sehingga ia tidak
  // membuka langganan apa pun. Memanggilnya secara kondisional (ctx ? ... )
  // mengubah jumlah hook antar-render dan React melempar error yang membuat
  // seluruh halaman kosong.
  const ctx = useContext(AkunKategoriCtx)
  const mandiri = useAkunKategoriMandiri(ctx ? null : uid)
  return ctx ?? mandiri
}

function useAkunKategoriMandiri(uid) {
  const [akunList, setAkunList] = useState([])
  const [kategoriList, setKategoriList] = useState([])
  const [siap, setSiap] = useState(false)

  useEffect(() => {
    if (!uid) return
    const { db } = getFirebase()
    return langgananAkunKategori(db, uid, {
      onAkun: setAkunList,
      onKategori: setKategoriList,
      onSiap: setSiap,
    })
  }, [uid])

  return { akunList, kategoriList, siap }
}
