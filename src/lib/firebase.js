// Modul Firebase pasca-login (Firestore). Dipisah dari firebaseApp.js
// (Fase 5 re-audit R-01) supaya jalur login tidak menyeret SDK Firestore
// 577 kB ke bundel awal: modul ini HANYA boleh diimpor statis oleh kode
// yang berjalan setelah user ada (db.js, Shell, fitur-fitur), atau lewat
// dynamic import dari App.jsx untuk efek pasca-login.
import {
  clearIndexedDbPersistence,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
} from 'firebase/firestore'
import { getFirebaseApp } from './firebaseApp.js'

export { googleProvider, isFirebaseConfigured } from './firebaseApp.js'

// ID database Firestore. SDK default menyambung ke '(default)'; kalau database
// di Firebase Console dibuat dengan nama lain (mis. 'myduit001'), WAJIB diisi di
// .env.local lewat VITE_FIREBASE_DATABASE_ID — kalau tidak, semua operasi tulis
// menggantung menunggu ack dari database yang tidak ada ("Database '(default)'
// not found") dan data hanya tersimpan di cache lokal (hilang saat refresh).
const DATABASE_ID = import.meta.env.VITE_FIREBASE_DATABASE_ID || '(default)'

let db = null

// Inisialisasi sekali saja. Firestore memakai offline persistence (IndexedDB)
// dengan tab manager multi-tab supaya buka beberapa tab tidak bentrok.
export function getFirebase() {
  const { app, auth } = getFirebaseApp()
  if (!db) {
    db = initializeFirestore(
      app,
      { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) },
      DATABASE_ID,
    )
  }
  return { app, auth, db }
}

// H-01 re-audit: keluar / lupa-PIN harus menghapus cache Firestore lokal
// (IndexedDB) supaya data tidak bisa dibaca dari perangkat setelah sign-out
// lewat DevTools. Panggil SETELAH signOut; pemanggil WAJIB reload halaman
// sesudahnya karena terminate() mematikan instance db yang di-cache modul
// ini dan login berikutnya butuh instance baru. Mengembalikan true bila
// persistence berhasil dibersihkan; false bila tab lain masih memegangnya
// (best-effort — reload tetap jalan).
export async function hapusCacheFirestoreLokal() {
  if (!db) return false
  try {
    await terminate(db)
  } catch {
    // Instance sudah mati / belum sempat dipakai — lanjut ke pembersihan.
  }
  try {
    await clearIndexedDbPersistence(db)
  } catch {
    return false
  }
  return true
}
