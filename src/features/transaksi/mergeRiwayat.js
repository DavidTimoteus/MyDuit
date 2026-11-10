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

// Konversi createdAt serbaguna: mendukung Timestamp Firestore (toMillis / toDate / { seconds, nanoseconds }),
// string ISO (mis. optimis), dan angka milidetik. Mengembalikan angka numerik murni.
export function createdAtMillis(val) {
  if (!val) return 0
  if (typeof val === 'number') return val
  if (typeof val.toMillis === 'function') return val.toMillis()
  if (typeof val.toDate === 'function') {
    const t = val.toDate()
    return t instanceof Date && !isNaN(t.getTime()) ? t.getTime() : 0
  }
  if (typeof val.seconds === 'number') {
    return val.seconds * 1000 + (val.nanoseconds ? Math.floor(val.nanoseconds / 1e6) : 0)
  }
  if (typeof val === 'string') {
    const parsed = Date.parse(val)
    if (!isNaN(parsed)) return parsed
  }
  const d = new Date(val)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

// Pengurutan deterministik transaksi:
//  1. Tanggal transaksi menurun (YYYY-MM-DD desc).
//  2. Waktu pembuatan menurun (createdAtMillis desc) — memastikan transaksi baru selalu di atas.
//  3. Bila sama persis atau kosong, pertahankan urutan snapshot (stabil / return 0).
export function urutkanTransaksi(a, b) {
  const cmpTgl = String(b.tanggal || '').localeCompare(String(a.tanggal || ''))
  if (cmpTgl !== 0) return cmpTgl
  const ma = createdAtMillis(a.createdAt)
  const mb = createdAtMillis(b.createdAt)
  if (ma !== mb) return mb - ma
  return 0
}

// Periksa apakah dokumen transaksi memenuhi filter pada `kunci` (`uid|jenis|start|end`).
// Penting agar event global `myduit:transaksi-added` (misal Pemasukan atau tanggal bulan lalu)
// tidak mencemari instance `useTransaksi` lain yang sedang memfilter jenis/rentang spesifik
// (seperti `transHariIni` khusus pengeluaran hari ini di RightPanel).
export function cocokKunci(item, kunci) {
  if (!item) return false
  if (!kunci) return true
  const [, jenis = 'semua', start = '', end = ''] = String(kunci).split('|')
  if (jenis && jenis !== 'semua' && item.jenis && item.jenis !== jenis) {
    return false
  }
  const tgl = String(item.tanggal || '')
  if (start && tgl && tgl < start) return false
  if (end && tgl && tgl > end) return false
  return true
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
      const initialDocs = Array.from(pending.values())
        .filter((p) => cocokKunci(p, aksi.kunci))
        .sort(urutkanTransaksi)
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
      // Jika dokumen dari snapshot sudah memuat pending add, atau pending add
      // memang tidak cocok dengan kunci filter ini, bersihkan dari pending.
      aksi.list.forEach((t) => {
        if (pending.has(t.id)) pending.delete(t.id)
      })
      for (const [id, p] of pending.entries()) {
        if (!cocokKunci(p, state.kunci)) pending.delete(id)
      }

      // Gabungkan list snapshot dengan sisa pendingAdds yang cocok filter namun belum masuk snapshot
      const pendingList = Array.from(pending.values()).filter((p) => cocokKunci(p, state.kunci))
      const combinedList = [...pendingList.filter((p) => !aksi.list.some((l) => l.id === p.id)), ...aksi.list]
      combinedList.sort(urutkanTransaksi)

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

      // Hanya sisipkan ke docs tampilan aktif bila item cocok dengan filter kunci saat ini.
      // Item tetap disimpan di pendingAdds agar bila pemanggil langsung mereset filter ke
      // 'semua' (aksi 'mulai' berikutnya), item tersebut langsung tampil.
      if (!cocokKunci(item, state.kunci)) {
        return {
          ...state,
          deletedIds: baruDeleted,
          pendingAdds: pending,
          docs: state.docs.filter((t) => t.id !== item.id),
        }
      }

      const exists = state.docs.some((t) => t.id === item.id)
      let newDocs
      if (exists) {
        newDocs = state.docs.map((t) => (t.id === item.id ? { ...t, ...item } : t)).sort(urutkanTransaksi)
      } else {
        newDocs = [item, ...state.docs].sort(urutkanTransaksi)
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
      const pending = state.pendingAdds ? new Map(state.pendingAdds) : new Map()
      if (pending.has(item.id)) {
        pending.set(item.id, { ...pending.get(item.id), ...item })
      }
      if (!cocokKunci(item, state.kunci)) {
        return {
          ...state,
          pendingAdds: pending,
          docs: state.docs.filter((t) => t.id !== item.id),
        }
      }
      const exists = state.docs.some((t) => t.id === item.id)
      const newDocs = exists
        ? state.docs.map((t) => (t.id === item.id ? { ...t, ...item } : t)).sort(urutkanTransaksi)
        : [item, ...state.docs].sort(urutkanTransaksi)
      return {
        ...state,
        pendingAdds: pending,
        docs: newDocs,
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
