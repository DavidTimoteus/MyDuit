// Self-check mata uang aktif: `node src/lib/format.check.mjs`
// Memverifikasi prioritas lokasi manual > deteksi otomatis, dan bahwa cache
// mata uang di format.js benar-benar direset oleh simpanNegaraManual().
import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
// Node >=21 punya `navigator` global read-only, jadi override lewat defineProperty.
Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true })
globalThis.window = { dispatchEvent: () => {} }
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o?.detail } }

const f = await import('./format.js')

// Otomatis: tanpa pilihan manual, ikut timezone/locale (di CI biasanya en-US).
f.simpanNegaraManual('')
assert.equal(f.detectCountryInfo(navigator.language).manual, false)

// Manual menang & seluruh formatter ikut berubah.
f.simpanNegaraManual('US')
assert.equal(f.detectCurrency(navigator.language), 'USD')
assert.equal(f.detectLocale(), 'en-US')
assert.equal(f.simbolUang(), 'US$')
assert.equal(f.formatRupiah(1234567), 'US$1,234,567')
assert.equal(f.formatNominal(1234567), '1,234,567')
assert.equal(f.formatRibuanInput('1234567'), '1,234,567')

// Ganti negara -> cache modul harus ikut invalid (bukan nilai USD lama).
f.simpanNegaraManual('ID')
assert.equal(f.simbolUang(), 'Rp')
assert.equal(f.formatRupiah(1234567), 'Rp1.234.567')
assert.equal(f.formatRupiah(-5000, { tanda: true }), '− Rp5.000')

// Kode kosong = balik ke deteksi otomatis.
f.simpanNegaraManual('')
assert.equal(f.negaraManual(), '')

// parseNominal tetap toleran terhadap pemisah locale apa pun & mencegah overflow / float korup.
assert.equal(f.parseNominal('1,234,567'), 1234567)
assert.equal(f.parseNominal('1.234.567'), 1234567)
assert.equal(f.parseNominal(12500.5), 12501)
assert.equal(f.parseNominal('99999999999999999999'), f.MAX_NOMINAL)

// parseNominalBertanda & formatRibuanInputBertanda menjaga saldo minus saat edit rekening.
f.simpanNegaraManual('ID')
assert.equal(f.parseNominalBertanda('-50.000'), -50000)
assert.equal(f.formatRibuanInputBertanda(-50000), '-50.000')
assert.equal(f.formatRibuanInputBertanda(0), '0')

// parseAngkaEksternal membedakan desimal vs ribuan agar tidak berlipat 100x.
assert.equal(f.parseAngkaEksternal('50000.00'), 50000)
assert.equal(f.parseAngkaEksternal('Rp 50.000,00'), 50000)
assert.equal(f.parseAngkaEksternal('1,250.75'), 1251)
assert.equal(f.parseAngkaEksternal('-25.000,00'), -25000)

// Tanggal korup tidak pernah melempar RangeError dan kalender invalid ditolak.
assert.equal(f.parseTanggalIsoAman('2026-02-31'), null)
assert.equal(f.kanonikTanggal('2026-02-31'), f.isoHariIni())
assert.equal(f.tanggalLabel(''), 'Tanpa tanggal')
assert.equal(f.tanggalPendek('bukan-tanggal'), 'bukan-tanggal')

// Rentang terbalik otomatis dinormalisasi.
assert.deepEqual(f.rangeForFilter('rentang', { start: '2026-11-10', end: '2026-11-01' }), {
  start: '2026-11-01',
  end: '2026-11-10',
})

console.log('format.check: OK')
