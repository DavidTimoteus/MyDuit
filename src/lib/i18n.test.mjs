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

// Kunci baru untuk layar utama — pastikan terjemahan & interpolasinya nyata.
assert.equal(t('ringkasan'), 'Ringkasan')
assert.equal(t('belum_ada_transaksi'), 'Belum Ada Transaksi')
assert.equal(t('filter_hari'), 'Hari Ini')
assert.equal(t('bulan_08'), 'Agustus')
assert.equal(t('tempat_tidak_ada'), 'tempat_tidak_ada') // fallback kunci tak dikenal

simpanBahasa('en')
assert.equal(t('ringkasan'), 'Summary')
assert.equal(t('belum_ada_transaksi'), 'No Transactions Yet')
assert.equal(t('filter_hari'), 'Today')
assert.equal(t('bulan_08'), 'August')
assert.equal(t('streak_label'), 'Recording Streak')
assert.equal(t('rekening'), 'Accounts')
assert.equal(t('dipilih', { n: 3 }), '3 selected')
assert.equal(t('halaman', { page: 2, total: 7 }), 'Page 2/7')
assert.equal(t('filter_rentang_range', { start: '2026-01-01', end: '2026-01-31' }), '2026-01-01 to 2026-01-31')
assert.equal(t('budget_hampir_limit', { nama: 'Makan', persen: 85 }), 'Makan is nearing its limit (85%)')
assert.equal(t('mutasi_ringkas', { n: 4, masuk: 'Rp1', keluar: 'Rp2' }), '4 entries · in Rp1 · out Rp2')
assert.equal(t('periode_tahun', { tahun: 2026 }), 'Year 2026')
assert.equal(t('bulan_singkat_08'), 'Aug')
assert.equal(t('jatuh_tempo_tanggal', { tanggal: '12 Nov 2026' }), 'Due 12 Nov 2026')
assert.equal(t('lunas_badge'), '— PAID OFF ✓')

simpanBahasa('id')
assert.equal(t('jatuh_tempo_tanggal', { tanggal: '12 Nov 2026' }), 'Jatuh tempo 12 Nov 2026')
assert.equal(t('lunas_badge'), '— LUNAS ✓')
assert.equal(t('tips_1').length > 0, true)

console.log(`i18n.test: OK (${keysId.length} kunci terverifikasi untuk id & en)`)

