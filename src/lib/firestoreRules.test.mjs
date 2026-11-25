// Uji asap firestore.rules di Firestore Emulator + Auth Emulator.
// Jalankan: npm run test:rules
//   (menyalakan kedua emulator, menjalankan test ini, lalu mematikan emulator;
//   butuh Java 21 di ~/workspace/.java — lihat skrip test:rules di package.json)
// STATUS 25 Nov 2026: test ini BELUM PERNAH hijau di VM ini — emulator Firestore
// 1.22.0 tidak bisa melayani operasi dokumen di sandbox ini (HTTP 503 "Network
// closed for unknown reason" di SEMUA jalur: SDK gRPC, admin REST, document REST;
// dua konfigurasi database dicoba). Bukan kegagalan kode — kegagalan lingkungan.
// Jangan jadikan test ini gerbang `npm run check` sebelum emulator bisa jalan.
// Regresi utama: R-01 re-audit 25 Nov 2026 — snapshot kurs asli 56 kunci HARUS
// lolos rules (cap lama 40 menolak semua tulis transaksi bila di-deploy).
// Catatan: endpoint :securityRules milik @firebase/rules-unit-testing TIDAK bisa
// dipakai di VM ini (emulator 1.22.0 mengembalikan 500/503 "http2 exception"),
// jadi rules dimuat emulator dari firebase.json saat start, dan autentikasi
// memakai Auth Emulator + Firebase JS SDK biasa.
import assert from 'node:assert/strict'
import { initializeApp } from 'firebase/app'
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore'

// Mock minimal window + localStorage sebelum mengimpor kurs.js
const _store = {}
const lsMock = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v) },
  removeItem: (k) => { delete _store[k] },
}
globalThis.localStorage = lsMock
globalThis.CustomEvent = function CustomEvent(type, init) {
  return { type, detail: init?.detail }
}
globalThis.window = {
  localStorage: lsMock,
  dispatchEvent: () => true,
  CustomEvent: globalThis.CustomEvent,
}

const kurs = await import('./kurs.js')

const app = initializeApp({ projectId: 'myduit001', apiKey: 'fake-api-key' })
const auth = getAuth(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099')
const db = getFirestore(app, 'myduit001')
connectFirestoreEmulator(db, '127.0.0.1', 8080)

function transaksiDasar(kursSnapshot) {
  return {
    deleted: false,
    jumlah: 50000,
    jenis: 'pengeluaran',
    tanggal: '2026-11-25',
    catatan: 'tes emulator',
    kursSnapshot,
  }
}

function snapshotDenganJumlah(n) {
  const snap = kurs.buatSnapshotKurs('IDR')
  // Tambah kode 3 huruf valid sampai tepat n kunci.
  let i = 0
  while (Object.keys(snap.usdKe).length < n) {
    const kode = String.fromCharCode(65 + Math.floor(i / 676), 65 + Math.floor(i / 26) % 26, 65 + (i % 26))
    if (!(kode in snap.usdKe)) snap.usdKe[kode] = 1 + i
    i++
  }
  return snap
}

let lulus = 0
async function berhasil(nama, fn) {
  await fn()
  lulus++
  console.log(`  ok - ${nama}`)
}
async function ditolak(nama, fn) {
  let gagal = null
  try {
    await fn()
  } catch (err) {
    gagal = err
  }
  assert.ok(gagal, `${nama}: operasi seharusnya DITOLAK rules tapi lolos`)
  assert.equal(
    gagal.code,
    'permission-denied',
    `${nama}: penolakan harus permission-denied, dapat ${gagal.code}: ${gagal.message}`,
  )
  lulus++
  console.log(`  ok - ${nama}`)
}

async function buatPengguna(email) {
  const cred = await createUserWithEmailAndPassword(auth, email, 'password123')
  return cred.user.uid
}
async function masukSebagai(email) {
  await signInWithEmailAndPassword(auth, email, 'password123')
  return auth.currentUser.uid
}

const uidA = await buatPengguna('usera@test.local')
const uidB = await buatPengguna('userb@test.local')

// 1. R-01: snapshot kurs ASLI (56 kunci) lolos.
await masukSebagai('usera@test.local')
await berhasil('R-01: create transaksi dgn snapshot asli 56 kunci LOLOS', async () => {
  const snap = kurs.buatSnapshotKurs('IDR')
  assert.equal(Object.keys(snap.usdKe).length, 56)
  await setDoc(doc(db, `users/${uidA}/transaksi/t1`), transaksiDasar(snap))
})

// 2. Batas cap: 96 kunci lolos, 97 kunci ditolak.
await berhasil('batas cap: snapshot 96 kunci LOLOS', async () => {
  await setDoc(doc(db, `users/${uidA}/transaksi/t2`), transaksiDasar(snapshotDenganJumlah(96)))
})
await ditolak('batas cap: snapshot 97 kunci DITOLAK', async () => {
  await setDoc(doc(db, `users/${uidA}/transaksi/t3`), transaksiDasar(snapshotDenganJumlah(97)))
})

// 3. Isolasi tenant: pemilik lain & anonim tidak bisa menulis ke dokumen userA.
await masukSebagai('userb@test.local')
await ditolak('isolasi: user lain TIDAK BISA create di path userA', async () => {
  await setDoc(doc(db, `users/${uidA}/transaksi/t4`), transaksiDasar(kurs.buatSnapshotKurs('IDR')))
})
await signOut(auth)
await ditolak('isolasi: anonim TIDAK BISA create di path userA', async () => {
  await setDoc(doc(db, `users/${uidA}/transaksi/t5`), transaksiDasar(kurs.buatSnapshotKurs('IDR')))
})

// 4. kursSnapshot tidak boleh diubah setelah dibuat.
await masukSebagai('usera@test.local')
await berhasil('setup t6: create transaksi untuk uji immutable', async () => {
  await setDoc(doc(db, `users/${uidA}/transaksi/t6`), transaksiDasar(kurs.buatSnapshotKurs('IDR')))
})
await ditolak('kursSnapshot immutable: update kursSnapshot DITOLAK', async () => {
  await updateDoc(doc(db, `users/${uidA}/transaksi/t6`), {
    kursSnapshot: kurs.buatSnapshotKurs('USD'),
  })
})

// 5. Soft-delete lolos sekali; update jumlah pada dokumen yang sudah dihapus ditolak.
await berhasil('soft-delete lolos', async () => {
  await setDoc(doc(db, `users/${uidA}/transaksi/t7`), transaksiDasar(kurs.buatSnapshotKurs('IDR')))
  await updateDoc(doc(db, `users/${uidA}/transaksi/t7`), { deleted: true })
})
await ditolak('update setelah soft-delete DITOLAK', async () => {
  await updateDoc(doc(db, `users/${uidA}/transaksi/t7`), { jumlah: 999 })
})

// 6. baseCurrency terkunci setelah dibuat.
await berhasil('baseCurrency: create IDR lolos', async () => {
  await setDoc(doc(db, `users/${uidA}/meta/mataUang`), { baseCurrency: 'IDR' })
})
await ditolak('baseCurrency: update ke USD DITOLAK', async () => {
  await updateDoc(doc(db, `users/${uidA}/meta/mataUang`), { baseCurrency: 'USD' })
})

// 7. Akun tanpa nama ditolak (validasi bentuk create).
await ditolak('akun tanpa nama DITOLAK', async () => {
  await setDoc(doc(db, `users/${uidA}/akun/a1`), { deleted: false, saldo: 100 })
})

// 8. Hard-delete masih diizinkan pemilik (celah R-01 keamanan — ditutup di Fase 3).
await berhasil('hard-delete pemilik diizinkan (catat: celah delete+create, Fase 3)', async () => {
  await deleteDoc(doc(db, `users/${uidA}/transaksi/t1`))
})

console.log(`firestoreRules: ${lulus} cek lulus (emulator)`)
process.exit(0)
