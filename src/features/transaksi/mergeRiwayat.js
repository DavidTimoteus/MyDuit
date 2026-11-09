// State riwayat transaksi (docs) di balik useTransaksi — sengaja dipisah
// jadi fungsi murni supaya bisa diuji di Node tanpa Firestore/DOM.
//
// Jaminan yang dikunci di file ini:
//  1. Ganti filter -> dokumen lama DIBUANG. Tanpa ini, langkah "Muat lagi"
//     (yang mempertahankan dokumen di luar halaman pertama) menyuntikkan
//     dokumen filter sebelumnya ke daftar baru: pilih "Semua Transaksi" lalu
//     kembali ke "Hari Ini", tampilannya tidak pernah berubah.
//  2. Tanpa halaman lanjutan, snapshot adalah kebenaran tunggal — transaksi
//     yang dihapus langsung hilang dari daftar, bukan "hidup lagi" karena
//     dianggap dokumen halaman lanjutan.
//  3. Penghapusan optimis (aksi 'hapus') langsung mengeluarkan transaksi
//     dari state lokal seketika tanpa perlu refresh halaman atau mereset filter,
//     dan mencatat ID terhapus agar snapshot lambat dari server tidak
//     membangkitkan kembali transaksi yang sudah dibuang.

export const RIWAYAT_AWAL = { kunci: null, adaLanjutan: false, docs: [], deletedIds: new Set() }

// Gabungkan halaman pertama (live onSnapshot, maks PAGE_SIZE dokumen) dengan
// riwayat halaman lanjutan hasil "Muat lagi", serta menyaring transaksi yang
// sudah dihapus secara optimis.
export function gabungSnapshot({ prev, list, adaLanjutan, deletedIds }) {
  const isDeleted = (id) => deletedIds && deletedIds.has(id)
  const listClean = list.filter((t) => !isDeleted(t.id))
  if (!adaLanjutan) return listClean
  if (prev.length <= listClean.length) return listClean
  const idsBaru = new Set(listClean.map((t) => t.id))
  return [...listClean, ...prev.filter((t) => !idsBaru.has(t.id) && !isDeleted(t.id))]
}

// Aksi:
//   { type: 'mulai', kunci }        -> langganan query baru (ganti filter/uid)
//   { type: 'snapshot', kunci, list } -> halaman pertama terbaru dari Firestore
//   { type: 'lanjut', kunci, list }   -> hasil getDocs "Muat lagi"
//   { type: 'hapus', id / ids }     -> penghapusan optimis seketika tanpa reload
export function kurangRiwayat(state, aksi) {
  switch (aksi.type) {
    case 'mulai': {
      // Query sama -> state dipertahankan (sinkronisasi ulang bukan ganti filter).
      if (aksi.kunci === state.kunci) return state
      return {
        kunci: aksi.kunci,
        adaLanjutan: false,
        docs: [],
        deletedIds: state.deletedIds ? new Set(state.deletedIds) : new Set(),
      }
    }
    case 'snapshot': {
      // Langganan basi (kunci sudah berganti) -> abaikan, jangan menuliskan
      // dokumen filter lama ke daftar filter baru.
      if (aksi.kunci !== state.kunci) return state
      return {
        ...state,
        docs: gabungSnapshot({
          prev: state.docs,
          list: aksi.list,
          adaLanjutan: state.adaLanjutan,
          deletedIds: state.deletedIds,
        }),
      }
    }
    case 'lanjut': {
      if (aksi.kunci !== state.kunci) return state
      const ada = new Set(state.docs.map((t) => t.id))
      const isDeleted = (id) => state.deletedIds && state.deletedIds.has(id)
      return {
        ...state,
        adaLanjutan: true,
        docs: [...state.docs, ...aksi.list.filter((t) => !ada.has(t.id) && !isDeleted(t.id))],
      }
    }
    case 'hapus': {
      const ids = Array.isArray(aksi.ids) ? aksi.ids : [aksi.id]
      const baruDeleted = new Set(state.deletedIds || [])
      ids.forEach((id) => baruDeleted.add(id))
      return {
        ...state,
        deletedIds: baruDeleted,
        docs: state.docs.filter((t) => !baruDeleted.has(t.id)),
      }
    }
    default:
      return state
  }
}
