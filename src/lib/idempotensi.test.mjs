// Uji unit penanda idempotensi (tanpa Firestore).
// Jalankan: node src/lib/idempotensi.test.mjs
import assert from 'node:assert/strict'

const _store = {}
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v) },
  removeItem: (k) => { delete _store[k] },
}
globalThis.window = { localStorage: globalThis.localStorage }

const { sudahDiproses, tandaiDiproses, _resetUntukUji } = await import('./idempotensi.js')

let lulus = 0
function cek(nama, fn) {
  fn()
  lulus++
}

cek('belum diproses sebelum ditandai', () => {
  assert.equal(sudahDiproses('u1', 'hapus', 't1'), false)
})

cek('sudah diproses setelah ditandai (memori + storage)', () => {
  tandaiDiproses('u1', 'hapus', 't1')
  assert.equal(sudahDiproses('u1', 'hapus', 't1'), true)
  assert.equal(_store['myduit:op:u1:hapus:t1'], '1')
})

cek('jenis/id/uid berbeda tidak tertukar', () => {
  assert.equal(sudahDiproses('u1', 'simpan', 't1'), false)
  assert.equal(sudahDiproses('u1', 'hapus', 't2'), false)
  assert.equal(sudahDiproses('u2', 'hapus', 't1'), false)
})

cek('penanda bertahan di "tab lain" (reset memori, storage tetap)', () => {
  _resetUntukUji()
  assert.equal(sudahDiproses('u1', 'hapus', 't1'), true)
})

cek('argumen kosong aman', () => {
  assert.equal(sudahDiproses('', 'hapus', 't1'), false)
  assert.equal(sudahDiproses('u1', '', 't1'), false)
  assert.equal(sudahDiproses('u1', 'hapus', ''), false)
  tandaiDiproses('', 'hapus', 't1')
  assert.equal(Object.keys(_store).length, 1)
})

console.log(`idempotensi.test: OK (${lulus} kasus lulus)`)
