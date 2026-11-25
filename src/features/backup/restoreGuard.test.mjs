// Uji penjaga restore backup (F05/F17 audit 25 Nov 2026; R02/P2 re-review):
//  1. Backup milik UID lain ditolak.
//  2. Backup dengan basis berbeda dari basis akun yang TERKUNCI ditolak
//     (USD 5.000 tidak boleh dilabel ulang jadi Rp 5.000).
//  3. Versi backup yang tidak dikenal ditolak.
//  4. Restore se-basis + se-UID tetap jalan.
//  5. Basis backup yang tidak didukung ditolak.
//  6. Restore di atas dokumen server yang sudah di-soft-delete: dokumen itu
//     di-hard-delete dulu lalu dibuat ulang (bukan gagal di tengah).
//  7. Basis SERVER (meta/mataUang) adalah otoritas — restore lintas-basis
//     ditolak meski flag kunci lokal belum ada.
//  8. Tulis basis (meta) terjadi SEBELUM data — penolakan rules gagal di awal.
// Jalankan: node src/features/backup/restoreGuard.test.mjs
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const keluar = path.resolve('node_modules/.myduit-test')
const hasil = path.join(keluar, 'restoreGuard.test.bundle.mjs')
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

// Basis akun IDR dan TERKUNCI (seperti akun sungguhan yang sudah memilih basis).
const _store = { 'myduit:kurs_basis': 'IDR', 'myduit:kurs_terkunci': '1' }
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v) },
  removeItem: (k) => { delete _store[k] },
}
globalThis.window = {
  localStorage: globalThis.localStorage,
  dispatchEvent: () => true,
}

const { restoreData } = await import(pathToFileURL(hasil).href)

function buatDeps({ metaServer = null, docsServer = {} } = {}) {
  const writes = []
  const updates = []
  let committed = 0
  return {
    writes,
    updates,
    get committed() { return committed },
    deps: {
      getFirebase: () => ({ auth: { currentUser: { uid: 'uid-1' } }, db: {} }),
      doc: (db, ...segmen) => ({ __path: segmen.join('/') }),
      collection: (db, ...segmen) => ({ __path: segmen.join('/') }),
      getDoc: async () =>
        metaServer
          ? { exists: () => true, data: () => ({ ...metaServer }) }
          : { exists: () => false, data: () => ({}) },
      getDocs: async (ref) => ({ docs: docsServer[ref.__path] || [] }),
      writeBatch: () => ({
        set(ref, data) { writes.push({ ref, data }) },
        update(ref, data) { updates.push({ ref, data }) },
        commit: async () => { committed++ },
      }),
      serverTimestamp: () => 'TS',
    },
  }
}

const jsonDasar = (over = {}) => ({
  app: 'MyDuit',
  version: 1,
  baseCurrency: 'IDR',
  uid: 'uid-1',
  data: {
    transaksi: [{ id: 't1', jumlah: 50000, jenis: 'pengeluaran', akunId: 'a1', deleted: false }],
    akun: [{ id: 'a1', nama: 'Dompet', saldo: 100000 }],
  },
  ...over,
})

let lulus = 0
async function cek(nama, fn) {
  await fn()
  lulus++
}

// 1. UID lain ditolak
await cek('restore backup milik UID lain ditolak', async () => {
  const { deps } = buatDeps()
  await assert.rejects(
    () => restoreData('uid-1', jsonDasar({ uid: 'uid-lain' }), undefined, deps),
    /UID/,
  )
})

// 2. Basis berbeda ditolak (F05)
await cek('restore USD ke akun IDR terkunci ditolak', async () => {
  const { deps, writes } = buatDeps()
  await assert.rejects(
    () => restoreData('uid-1', jsonDasar({ baseCurrency: 'USD' }), undefined, deps),
    /basis/i,
  )
  assert.equal(writes.length, 0, 'tidak boleh ada satu pun tulis sebelum ditolak')
})

// 3. Versi tidak dikenal ditolak
await cek('restore versi backup tak dikenal ditolak', async () => {
  const { deps } = buatDeps()
  await assert.rejects(
    () => restoreData('uid-1', jsonDasar({ version: 99 }), undefined, deps),
    /versi/i,
  )
})

// 5. Basis backup yang tidak didukung ditolak — kalau lolos, 'XXX' akan tertulis
// ke meta/mataUang dan rules (yang mengunci baseCurrency) membuatnya tidak bisa
// diperbaiki lewat update biasa.
await cek('restore basis backup tak didukung ditolak', async () => {
  const { deps, writes } = buatDeps()
  await assert.rejects(
    () => restoreData('uid-1', jsonDasar({ baseCurrency: 'XXX' }), undefined, deps),
    /tidak didukung/i,
  )
  assert.equal(writes.length, 0, 'tidak boleh ada satu pun tulis sebelum ditolak')
})

// 4. Se-basis + se-UID tetap jalan dan menulis meta basis yang sama
await cek('restore se-basis + se-UID berhasil', async () => {
  const { deps, writes } = buatDeps()
  const n = await restoreData('uid-1', jsonDasar(), undefined, deps)
  assert.equal(n, 2)
  const meta = writes.find((w) => w.ref.__path === 'users/uid-1/meta/mataUang')
  assert.ok(meta, 'meta mataUang harus ditulis')
  assert.equal(meta.data.baseCurrency, 'IDR')
})

// 6. Dokumen server yang sudah di-soft-delete dipulihkan: flag hapusnya
// dibatalkan dulu (un-delete, Fase 3) lalu set-merge — restore tidak gagal
// di tengah (P2) dan TIDAK ada lagi hard-delete.
await cek('restore di atas dokumen server terhapus berhasil (un-delete dulu)', async () => {
  const { deps, writes, updates } = buatDeps({
    docsServer: {
      'users/uid-1/transaksi': [{ id: 't1', data: () => ({ deleted: true }) }],
      'users/uid-1/akun': [{ id: 'a1', data: () => ({ deleted: false }) }],
    },
  })
  const n = await restoreData('uid-1', jsonDasar(), undefined, deps)
  assert.equal(n, 2)
  assert.equal(updates.length, 1, 'tepat satu dokumen terhapus yang dibatalkan dulu')
  assert.equal(updates[0].ref.__path, 'users/uid-1/transaksi/t1')
  assert.equal(updates[0].data.deleted, false, 'un-delete: deleted dibalik ke false')
  assert.ok(writes.some((w) => w.ref.__path === 'users/uid-1/transaksi/t1'), 't1 tetap ditulis ulang')
})

// 7. Basis SERVER adalah otoritas — restore lintas-basis ditolak meski flag
// kunci lokal belum ada (perangkat baru).
await cek('restore lintas-basis ditolak bila basis SERVER berbeda (flag lokal belum terkunci)', async () => {
  _store['myduit:kurs_terkunci'] = '0'
  try {
    const { deps, writes, updates } = buatDeps({ metaServer: { baseCurrency: 'USD' } })
    await assert.rejects(
      () => restoreData('uid-1', jsonDasar(), undefined, deps),
      /basis/i,
    )
    assert.equal(writes.length, 0, 'tidak boleh ada satu pun tulis sebelum ditolak')
    assert.equal(updates.length, 0)
  } finally {
    _store['myduit:kurs_terkunci'] = '1'
  }
})

// 8. Tulis basis (meta) terjadi SEBELUM data — penolakan rules gagal di awal.
await cek('tulis basis (meta) terjadi sebelum data', async () => {
  const { deps, writes } = buatDeps()
  await restoreData('uid-1', jsonDasar(), undefined, deps)
  assert.equal(writes[0].ref.__path, 'users/uid-1/meta/mataUang')
  assert.equal(writes[0].data.baseCurrency, 'IDR')
  assert.equal(writes[0].data.deleted, false, 'meta yang sempat terhapus ikut hidup kembali')
})

// 9. Restore akun yang saldonya berubah sejak backup: merge-set membawa
// mutasiTerakhir segar yang deltanya sama dengan perubahan saldo (R-03),
// supaya rules tidak menolak tulisnya.
await cek('restore akun membawa mutasiTerakhir konsisten (R-03)', async () => {
  const { deps, writes } = buatDeps({
    docsServer: {
      'users/uid-1/transaksi': [{ id: 't1', data: () => ({ deleted: false }) }],
      'users/uid-1/akun': [{ id: 'a1', data: () => ({ deleted: false, saldo: 60000 }) }],
    },
  })
  const n = await restoreData('uid-1', jsonDasar(), undefined, deps)
  assert.equal(n, 2)
  const akun = writes.find((w) => w.ref.__path === 'users/uid-1/akun/a1')
  assert.ok(akun, 'akun a1 harus ditulis')
  assert.equal(akun.data.saldo, 100000)
  assert.equal(akun.data.mutasiTerakhir?.delta, 40000, 'delta = saldo backup - saldo server')
  assert.equal(akun.data.mutasiTerakhir?.keterangan, 'Pulihkan backup')
})

console.log(`restoreGuard.test: OK (${lulus} kasus lulus)`)
