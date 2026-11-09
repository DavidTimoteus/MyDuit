// State riwayat transaksi (docs) di balik useTransaksi — sengaja dipisah
// jadi fungsi murni supaya bisa diuji di Node tanpa Firestore/DOM.
//
// Jaminan yang dikunci di file ini:
//  1. Ganti filter -> dokumen lama DIBUANG, namun pendingAdds (transaksi baru yang
//     belum terkonfirmasi server) tetap dibawa ke filter baru sehingga tidak hilang.
//  2. Tanpa halaman lanjutan, snapshot adalah kebenaran tunggal — transaksi
//     yang dihapus langsung hilang dari daftar, bukan "hidup lagi" karena
//     dianggap dokumen halaman lanjutan.
//  3. Penghapusan optimis (aksi 'hapus') langsung mengeluarkan transaksi
//     dari state lokal seketika tanpa perlu refresh halaman atau mereset filter,
//     dan mencatat ID terhapus agar snapshot lambat dari server tidak
//     membangkitkan kembali transaksi yang sudah dibuang.
//  4. Penambahan optimis (aksi 'tambah') langsung menyisipkan transaksi ke state
//     secara kronologis (tanggal desc) sehingga seketika tampil di UI tanpa reload.

export const RIWAYAT_AWAL = {
  kunci: null,
  adaLanjutan: false,
  docs: [],
  deletedIds: new Set(),
  pendingAdds: new Map(),
}

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
//   { type: 'tambah', item }        -> penambahan optimis seketika tanpa reload
//   { type: 'update', item }        -> pembaruan optimis seketika tanpa reload
//   { type: 'hapus', id / ids }     -> penghapusan optimis seketika tanpa reload
export function kurangRiwayat(state, aksi) {
  switch (aksi.type) {
    case 'mulai': {
      // Query sama -> state dipertahankan (sinkronisasi ulang bukan ganti filter).
      if (aksi.kunci === state.kunci) return state
      const pending = state.pendingAdds ? new Map(state.pendingAdds) : new Map()
      const initialDocs = Array.from(pending.values()).sort((a, b) => {
        const cmpTgl = String(b.tanggal || '').localeCompare(String(a.tanggal || ''))
        if (cmpTgl !== 0) return cmpTgl
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      })
      return {
        kunci: aksi.kunci,
        adaLanjutan: false,
        docs: initialDocs,
        deletedIds: state.deletedIds ? new Set(state.deletedIds) : new Set(),
        pendingAdds: pending,
      }
    }
    case 'snapshot': {
      // Langganan basi (kunci sudah berganti) -> abaikan, jangan menuliskan
      // dokumen filter lama ke daftar filter baru.
      if (aksi.kunci !== state.kunci) return state
      const pending = state.pendingAdds ? new Map(state.pendingAdds) : new Map()
      // Jika dokumen dari snapshot sudah memuat pending add, hapus dari pending
      aksi.list.forEach((t) => {
        if (pending.has(t.id)) pending.delete(t.id)
      })

      // Gabungkan list snapshot dengan sisa pendingAdds yang belum masuk snapshot
      const pendingList = Array.from(pending.values())
      const combinedList = [...pendingList.filter((p) => !aksi.list.some((l) => l.id === p.id)), ...aksi.list]
      combinedList.sort((a, b) => {
        const cmpTgl = String(b.tanggal || '').localeCompare(String(a.tanggal || ''))
        if (cmpTgl !== 0) return cmpTgl
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      })

      return {
        ...state,
        pendingAdds: pending,
        docs: gabungSnapshot({
          prev: state.docs,
          list: combinedList,
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
    case 'tambah': {
      const item = aksi.item
      const pending = state.pendingAdds ? new Map(state.pendingAdds) : new Map()
      pending.set(item.id, item)

      const baruDeleted = new Set(state.deletedIds || [])
      baruDeleted.delete(item.id)

      const exists = state.docs.some((t) => t.id === item.id)
      let newDocs
      if (exists) {
        newDocs = state.docs.map((t) => (t.id === item.id ? { ...t, ...item } : t))
      } else {
        newDocs = [item, ...state.docs].sort((a, b) => {
          const cmpTgl = String(b.tanggal || '').localeCompare(String(a.tanggal || ''))
          if (cmpTgl !== 0) return cmpTgl
          return String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
        })
      }

      return {
        ...state,
        deletedIds: baruDeleted,
        pendingAdds: pending,
        docs: newDocs,
      }
    }
    case 'update': {
      const item = aksi.item
      return {
        ...state,
        docs: state.docs.map((t) => (t.id === item.id ? { ...t, ...item } : t)),
      }
    }
    case 'hapus': {
      const ids = Array.isArray(aksi.ids) ? aksi.ids : [aksi.id]
      const baruDeleted = new Set(state.deletedIds || [])
      const pending = state.pendingAdds ? new Map(state.pendingAdds) : new Map()
      ids.forEach((id) => {
        baruDeleted.add(id)
        pending.delete(id)
      })
      return {
        ...state,
        deletedIds: baruDeleted,
        pendingAdds: pending,
        docs: state.docs.filter((t) => !baruDeleted.has(t.id)),
      }
    }
    default:
      return state
  }
}
