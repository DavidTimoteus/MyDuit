// Uji unit sistem bilingual ID/EN (`i18n.js`): kelengkapan kunci & interpolasi parameter.
// Jalankan: node src/lib/i18n.test.mjs
import assert from 'node:assert/strict'

const _store = {}
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v) },
  removeItem: (k) => { delete _store[k] },
}
globalThis.CustomEvent = function CustomEvent(type, init) {
  return { type, detail: init?.detail }
}
globalThis.window = { dispatchEvent: () => true, CustomEvent: globalThis.CustomEvent }

const { KAMUS, bacaBahasaAktif, simpanBahasa, t } = await import('./i18n.js')

const keysId = Object.keys(KAMUS.id).sort()
const keysEn = Object.keys(KAMUS.en).sort()
assert.deepEqual(keysEn, keysId, 'Kamus EN dan ID harus memiliki pasangan kunci yang 100% identik')

for (const k of keysId) {
  assert.ok(String(KAMUS.id[k]).trim().length > 0, `Kunci id.${k} tidak boleh kosong`)
  assert.ok(String(KAMUS.en[k]).trim().length > 0, `Kunci en.${k} tidak boleh kosong`)
}

simpanBahasa('en')
assert.equal(bacaBahasaAktif(), 'en')
assert.equal(t('nav_transaksi'), 'Transactions')
assert.equal(t('onboard_tetapkan', { currency: 'USD' }), 'Use USD as Base')

simpanBahasa('id')
assert.equal(bacaBahasaAktif(), 'id')
assert.equal(t('nav_transaksi'), 'Transaksi')
assert.equal(t('onboard_tetapkan', { currency: 'IDR' }), 'Gunakan IDR sebagai Basis')

console.log(`i18n.test: OK (${keysId.length} kunci terverifikasi untuk id & en)`)

