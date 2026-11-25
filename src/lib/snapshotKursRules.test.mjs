// Uji pengikat: ukuran snapshot kurs yang ditulis klien HARUS lolos cap firestore.rules.
// Regresi R-01 re-audit 25 Nov 2026: rules membatasi usdKe <= 40 kunci, padahal
// buatSnapshotKurs() menghasilkan 56 kunci (tabel cadangan) — bila rules itu di-deploy,
// semua simpan transaksi / pindah saldo / bayar utang / restore akan ditolak.
// Test ini membaca cap LANGSUNG dari firestore.rules, jadi angka di kedua tempat
// tidak bisa meleset diam-diam lagi.
// Jalankan: node src/lib/snapshotKursRules.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

let lulus = 0
function cek(nama, fn) {
  fn()
  lulus++
}

// Cap rules dibaca dari file aslinya, bukan di-hardcode di test.
const rulesPath = new URL('../../firestore.rules', import.meta.url)
const rulesText = readFileSync(rulesPath, 'utf8')
const capMatch = rulesText.match(/usdKe\.keys\(\)\.size\(\)\s*<=\s*(\d+)/)
assert.ok(capMatch, 'firestore.rules harus memuat batas usdKe.keys().size() <= N')
const capRules = Number(capMatch[1])
assert.ok(Number.isInteger(capRules) && capRules > 0, `cap rules harus bilangan bulat positif, dapat: ${capMatch[1]}`)

// 1. Cap rules menutupi ukuran snapshot nyata (tabel cadangan + 1 kunci basis di luar tabel).
cek('cap rules >= kunci tabel cadangan + 1 (maks buatSnapshotKurs)', () => {
  const maksNyata = Object.keys(kurs.KURS_CADANGAN_USD).length + 1
  assert.ok(
    capRules >= maksNyata,
    `cap rules ${capRules} < maks snapshot nyata ${maksNyata} — naikkan cap atau pangkas tabel`,
  )
})

// 2. Cap rules menutupi keluaran sanitasiKursSnapshot (snapshot dari backup bisa 80 kunci).
cek('cap rules >= maks keluaran sanitasiKursSnapshot', () => {
  const palsu = { basis: 'IDR', usdKe: { IDR: 16000 }, tanggal: '2026-11-25', sumber: 'test' }
  // 200 kode 3 huruf valid (AAA..) — sanitasi hanya menerima /^[A-Z]{3}$/.
  for (let i = 0; i < 200; i++) {
    const kode = String.fromCharCode(65 + Math.floor(i / 676), 65 + Math.floor(i / 26) % 26, 65 + (i % 26))
    palsu.usdKe[kode] = 1 + i
  }
  const bersih = kurs.sanitasiKursSnapshot(palsu)
  assert.ok(bersih, 'sanitasiKursSnapshot harus menerima payload 200 kunci')
  const maksSanitasi = Object.keys(bersih.usdKe).length
  assert.ok(
    capRules >= maksSanitasi,
    `cap rules ${capRules} < maks sanitasi ${maksSanitasi} — snapshot hasil restore akan ditolak rules`,
  )
})

// 3. Perilaku nyata per basis: snapshot yang ditulis db.js harus lolos cap.
for (const basis of ['IDR', 'USD', 'EUR', 'JPY']) {
  cek(`buatSnapshotKurs(${basis}) <= cap rules (${capRules})`, () => {
    const snap = kurs.buatSnapshotKurs(basis)
    assert.ok(snap, `buatSnapshotKurs(${basis}) harus mengembalikan snapshot`)
    const jumlah = Object.keys(snap.usdKe).length
    assert.ok(jumlah <= capRules, `snapshot ${basis} berisi ${jumlah} kunci > cap rules ${capRules}`)
  })
}

console.log(`snapshotKursRules: ${lulus} cek lulus (cap rules = ${capRules})`)
