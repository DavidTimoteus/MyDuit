// Uji unit fitur hapus total data (`hapusSemuaData`) pada backup.js.
// Jalankan: node src/features/backup/backupDelete.test.mjs
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const keluar = path.resolve('node_modules/.myduit-test')
const hasil = path.join(keluar, 'backup.test.bundle.mjs')
await build({
  entryPoints: [path.resolve('src/features/backup/backup.js')],
  bundle: true,
  external: ['firebase', 'firebase/*'],
  format: 'esm',
  platform: 'node',
  define: { 'import.meta.env': '{}' },
  outfile: hasil,
  logLevel: 'warning',
})

const _store = {
  'myduit-migrasi-norm-uid-1': '1',
  'myduit:tx_chip': 'bulan',
  'myduit:kurs_basis': 'IDR',
}
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v) },
  removeItem: (k) => { delete _store[k] },
}
globalThis.window = {
  localStorage: globalThis.localStorage,
  dispatchEvent: () => true,
}

const { exportData, restoreData, hapusSemuaData, hapusAkunPermanen } = await import(pathToFileURL(hasil).href)

let lulus = 0

// 1. Menolak Demo UID
{
  let msg = ''
  try {
    await hapusSemuaData('demo_user_001')
  } catch (e) {
    msg = e.message
  }
  assert.ok(msg.includes('Mode demo'), `Harus menolak demo UID, dapat: ${msg}`)
  lulus++
}

// 2. Menolak UID yang tidak cocok dengan user login
{
  let msg = ''
  try {
    await hapusSemuaData('uid-1', undefined, {
      getFirebase: () => ({ auth: { currentUser: { uid: 'uid-lain' } }, db: {} }),
    })
  } catch (e) {
    msg = e.message
  }
  assert.ok(msg.includes('UID tidak cocok'), `Harus menolak UID mismatch, dapat: ${msg}`)
  lulus++
}

// 3. Menghapus bertahap per batch <= 450 & membersihkan penanda lokal
{
  const batches = []
  const docsByKol = {
    transaksi: Array.from({ length: 460 }, (_, i) => ({ id: `tx-${i}`, ref: { path: `transaksi/tx-${i}` } })),
    akun: [{ id: 'a1', ref: { path: 'akun/a1' } }],
    kategori: [{ id: 'k1', ref: { path: 'kategori/k1' } }],
    budget: [],
    utang: [],
    pembayaranUtang: [],
    mutasiLog: [],
    meta: [{ id: 'mataUang', ref: { path: 'meta/mataUang' } }, { id: 'seedKategori', ref: { path: 'meta/seedKategori' } }],
  }
  const progressEvents = []

  const res = await hapusSemuaData(
    'uid-1',
    (p) => progressEvents.push(p),
    {
      getFirebase: () => ({ auth: { currentUser: { uid: 'uid-1' } }, db: {} }),
      collection: (_db, _u, _uid, k) => k,
      getDocs: async (k) => ({ docs: docsByKol[k] || [] }),
      writeBatch: () => {
        const deletedRefs = []
        return {
          delete: (ref) => deletedRefs.push(ref),
          commit: async () => {
            batches.push(deletedRefs.length)
          },
        }
      },
    },
  )

  assert.equal(res.deleted, 464)
  assert.equal(res.perKoleksi.meta, 2)
  assert.deepEqual(batches, [450, 14])
  assert.equal(progressEvents.length, 2)
  assert.equal(progressEvents[1].done, 464)
  assert.equal(_store['myduit-migrasi-norm-uid-1'], undefined)
  assert.equal(_store['myduit:tx_chip'], undefined)
  assert.equal(_store['myduit:kurs_basis'], undefined)
  lulus++
}

// 4. exportData menyertakan baseCurrency & restoreData memulihkan baseCurrency + kursSnapshot
{
  const written = []
  const deps = {
    getFirebase: () => ({ auth: { currentUser: { uid: 'uid-1' } }, db: {} }),
    collection: (_db, _u, _uid, k) => k,
    getDocs: async (k) => ({
      docs: k === 'transaksi'
        ? [{ id: 'tx1', data: () => ({ jumlah: 100, jenis: 'pengeluaran', tanggal: '2026-11-13', deleted: false, kursSnapshot: { basis: 'USD', usdKe: { USD: 1, IDR: 16500 }, tanggal: '2026-11-13', sumber: 'live' } }) }]
        : [],
    }),
    doc: (_db, _u, _uid, k, id) => ({ path: `${k}/${id}` }),
    getDoc: async () => ({ exists: () => true, data: () => ({ baseCurrency: 'USD' }) }),
    serverTimestamp: () => 'SERVER_TS',
    writeBatch: () => ({
      set: (ref, data) => written.push({ path: ref.path, data }),
      commit: async () => {},
    }),
  }

  const exported = await exportData('uid-1', deps)
  assert.equal(exported.baseCurrency, 'USD')
  assert.equal(exported.data.transaksi[0].kursSnapshot.usdKe.IDR, 16500)

  const count = await restoreData('uid-1', exported, undefined, deps)
  assert.equal(count, 1)
  const metaWrite = written.find((w) => w.path === 'meta/mataUang')
  assert.equal(metaWrite?.data?.baseCurrency, 'USD')
  const txWrite = written.find((w) => w.path === 'transaksi/tx1')
  assert.equal(txWrite?.data?.kursSnapshot?.usdKe?.IDR, 16500)
  assert.equal(_store['myduit:kurs_basis'], 'USD')
  lulus++
}

// 5. hapusAkunPermanen menangani requires-recent-login & menghapus auth user
{
  let deleteCalls = 0
  let reauthCalls = 0
  _store['myduit:negara'] = 'US'
  _store['myduit:bahasa'] = 'en'
  const res = await hapusAkunPermanen('uid-1', undefined, {
    getFirebase: () => ({ auth: { currentUser: { uid: 'uid-1' } }, db: {} }),
    collection: (_db, _u, _uid, k) => k,
    getDocs: async () => ({ docs: [] }),
    writeBatch: () => ({ delete: () => {}, commit: async () => {} }),
    deleteUser: async () => {
      deleteCalls++
      if (deleteCalls === 1) throw { code: 'auth/requires-recent-login' }
    },
    reauthenticateWithPopup: async () => {
      reauthCalls++
    },
  })
  assert.equal(res.accountDeleted, true)
  assert.equal(deleteCalls, 2)
  assert.equal(reauthCalls, 1)
  assert.equal(_store['myduit:negara'], undefined)
  assert.equal(_store['myduit:bahasa'], undefined)
  lulus++
}

console.log(`backupDelete.test: OK (${lulus} kasus lulus)`)
