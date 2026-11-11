// Uji cache kueri sesi transaksi (zero-spinner filter switching & sync mutasi lokal)
// Jalankan: node src/features/transaksi/transaksiCache.test.mjs
import assert from 'node:assert/strict'
import {
  ambilCacheTransaksi,
  buatCacheTransaksiKey,
  invalidateCacheUid,
  mutasiCacheTransaksi,
  perbaruiCacheLanjutan,
  simpanCacheTransaksi,
} from './transaksiCache.js'

let total = 0
let lulus = 0

function cek(nama, fn) {
  total++
  fn()
  lulus++
  console.log(`  ok    ${nama}`)
}

const sampleDocs = [
  { id: 't1', jenis: 'pengeluaran', jumlah: 50000, tanggal: '2026-11-10', createdAt: '2026-11-10T10:00:00.000Z' },
  { id: 't2', jenis: 'pemasukan', jumlah: 200000, tanggal: '2026-11-10', createdAt: '2026-11-10T09:00:00.000Z' },
  { id: 't3', jenis: 'pengeluaran', jumlah: 25000, tanggal: '2026-11-09', createdAt: '2026-11-09T09:00:00.000Z' },
]

cek('simpanCacheTransaksi + ambilCacheTransaksi mengembalikan hit tepat instan', () => {
  const store = new Map()
  const key = buatCacheTransaksiKey({ uid: 'u1', jenis: 'pengeluaran', range: { start: '2026-11-01', end: '2026-11-30' }, pageSize: 50 })
  simpanCacheTransaksi(store, key, { docs: [sampleDocs[0], sampleDocs[2]], hasMore: false })
  const hit = ambilCacheTransaksi(store, { uid: 'u1', jenis: 'pengeluaran', range: { start: '2026-11-01', end: '2026-11-30' }, pageSize: 50 })
  assert.equal(hit?.docs.length, 2)
  assert.equal(hit?.hasMore, false)
})

cek('ambilCacheTransaksi menurunkan filter jenis langsung dari snapshot semua yang lengkap (!hasMore)', () => {
  const store = new Map()
  const keySemua = buatCacheTransaksiKey({ uid: 'u1', jenis: 'semua', range: { start: '2026-11-01', end: '2026-11-30' }, pageSize: 50 })
  simpanCacheTransaksi(store, keySemua, { docs: sampleDocs, hasMore: false })

  const derivedOut = ambilCacheTransaksi(store, { uid: 'u1', jenis: 'pengeluaran', range: { start: '2026-11-01', end: '2026-11-30' }, pageSize: 50 })
  assert.equal(derivedOut?.docs.map((d) => d.id).join(','), 't1,t3')
  assert.equal(derivedOut?.hasMore, false)

  const derivedIn = ambilCacheTransaksi(store, { uid: 'u1', jenis: 'pemasukan', range: { start: '2026-11-01', end: '2026-11-30' }, pageSize: 50 })
  assert.equal(derivedIn?.docs.map((d) => d.id).join(','), 't2')
})

cek('ambilCacheTransaksi TIDAK menurunkan bila snapshot semua terpotong (hasMore: true)', () => {
  const store = new Map()
  const keySemua = buatCacheTransaksiKey({ uid: 'u1', jenis: 'semua', range: {}, pageSize: 50 })
  simpanCacheTransaksi(store, keySemua, { docs: sampleDocs, hasMore: true })
  const miss = ambilCacheTransaksi(store, { uid: 'u1', jenis: 'pengeluaran', range: {}, pageSize: 50 })
  assert.equal(miss, null)
})

cek('simpanCacheTransaksi menjaga batas LRU maksimal 8 kunci per sesi', () => {
  const store = new Map()
  for (let i = 0; i < 12; i++) {
    simpanCacheTransaksi(store, `u1|semua|2026-11-0${i}||50`, { docs: [], hasMore: false })
  }
  assert.equal(store.size, 8)
  assert.equal(store.has('u1|semua|2026-11-00||50'), false)
  assert.equal(store.has('u1|semua|2026-11-011||50'), true)
})

cek('mutasiCacheTransaksi memperbarui & menghapus dokumen di seluruh cache uid secara konsisten', () => {
  const store = new Map()
  const key = buatCacheTransaksiKey({ uid: 'u1', jenis: 'semua', range: { start: '2026-11-01', end: '2026-11-30' }, pageSize: 50 })
  simpanCacheTransaksi(store, key, { docs: sampleDocs, hasMore: false })

  mutasiCacheTransaksi(store, 'u1', {
    type: 'tambah',
    item: { id: 't4', jenis: 'pemasukan', jumlah: 90000, tanggal: '2026-11-11', createdAt: '2026-11-11T01:00:00.000Z' },
  })
  assert.equal(store.get(key).docs[0].id, 't4')

  mutasiCacheTransaksi(store, 'u1', { type: 'hapus', ids: ['t1', 't4'] })
  assert.equal(store.get(key).docs.map((d) => d.id).join(','), 't2,t3')

  invalidateCacheUid(store, 'u1')
  assert.equal(store.size, 0)
})

cek('perbaruiCacheLanjutan mempertahankan halaman lanjutan (>50 docs) pada cache tanpa terpotong snapshot Top-50', () => {
  const store = new Map()
  const key = buatCacheTransaksiKey({ uid: 'u1', jenis: 'semua', range: { start: '2026-10-10', end: '2026-11-11' }, pageSize: 50 })
  simpanCacheTransaksi(store, key, { docs: sampleDocs, hasMore: true })
  const lanjutDocs = [
    ...sampleDocs,
    { id: 't4-hal4', jenis: 'pengeluaran', jumlah: 15000, tanggal: '2026-10-15', createdAt: '2026-10-15T10:00:00.000Z' },
  ]
  perbaruiCacheLanjutan(store, key, { docs: lanjutDocs, hasMore: false, lastDoc: { id: 't4-hal4' } })
  const hit = ambilCacheTransaksi(store, { uid: 'u1', jenis: 'semua', range: { start: '2026-10-10', end: '2026-11-11' }, pageSize: 50 })
  assert.equal(hit?.docs.length, 4)
  assert.equal(hit?.hasMore, false)
  assert.equal(hit?.lastDoc?.id, 't4-hal4')
})

console.log(`\nLULUS: ${lulus}/${total} cek lolos`)

