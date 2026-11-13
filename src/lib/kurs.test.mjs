// Uji unit engine Money Changer (kurs live, cross-rate, round-trip, & input desimal).
// Jalankan: node src/lib/kurs.test.mjs
import assert from 'node:assert/strict'

// Mock minimal window + localStorage sebelum mengimpor format.js / kurs.js
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
const fmt = await import('./format.js')

let lulus = 0
function cek(nama, fn) {
  fn()
  lulus++
}

// 1. Cross-rate dasar & desimal mata uang
cek('desimalMataUang: 0 utk IDR/JPY/VND/KRW, 2 utk USD/SGD/EUR', () => {
  assert.equal(kurs.desimalMataUang('IDR'), 0)
  assert.equal(kurs.desimalMataUang('JPY'), 0)
  assert.equal(kurs.desimalMataUang('VND'), 0)
  assert.equal(kurs.desimalMataUang('KRW'), 0)
  assert.equal(kurs.desimalMataUang('USD'), 2)
  assert.equal(kurs.desimalMataUang('SGD'), 2)
  assert.equal(kurs.desimalMataUang('EUR'), 2)
})

cek('konversiNilai cross-rate IDR -> USD -> IDR dan USD -> EUR akurat', () => {
  kurs._resetCacheKursUntukUji()
  const cadIdr = kurs.KURS_CADANGAN_USD.IDR
  assert.equal(kurs.ambilRasioKurs('IDR', 'IDR'), 1)
  assert.ok(Math.abs(kurs.konversiNilai(cadIdr, 'IDR', 'USD') - 1) < 1e-9)
  assert.ok(Math.abs(kurs.konversiNilai(1, 'USD', 'SGD') - kurs.KURS_CADANGAN_USD.SGD) < 1e-9)
  assert.ok(Math.abs(kurs.konversiNilai(cadIdr, 'IDR', 'JPY') - kurs.KURS_CADANGAN_USD.JPY) < 1e-9)
  assert.ok(Math.abs(kurs.konversiNilai(100, 'USD', 'EUR') - 100 * kurs.KURS_CADANGAN_USD.EUR) < 1e-9)
})

// 2. Prioritas fetch live & fallback provider
{
  const fetchAsli = globalThis.fetch
  try {
    kurs._resetCacheKursUntukUji()
    delete _store['myduit:kurs_cache']

    // Primer open.er-api.com gagal -> fallback ke currency-api jsDelivr
    let dipanggil = []
    globalThis.fetch = async (url) => {
      const s = String(url)
      dipanggil.push(s)
      if (s.includes('open.er-api.com')) {
        return { ok: false, status: 503 }
      }
      if (s.includes('currency-api')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ usd: { idr: 18250, sgd: 1.35, eur: 0.91, vnd: 25690 } }),
        }
      }
      return { ok: false, status: 404 }
    }

    const res = await kurs.segarkanKursGlobal({ paksa: true })
    assert.equal(res.updated, true)
    assert.equal(res.isFallback, false)
    assert.equal(res.source, 'currency-api (jsDelivr)')
    assert.equal(res.rates.IDR, 18250)
    assert.equal(res.rates.VND, 25690)
    assert.ok(dipanggil.some((u) => u.includes('open.er-api.com')))
    assert.ok(dipanggil.some((u) => u.includes('currency-api')))
    lulus++
  } finally {
    globalThis.fetch = fetchAsli
  }
}

// 3. Round-trip lossless Money Changer & sanitasi ketik sen (10.50 USD != 1050)
cek('Money Changer formatRupiah + sanitizeKetikNominal + round-trip USD <-> IDR', () => {
  kurs.simpanBasisMataUang('IDR')
  fmt.simpanNegaraManual('US')

  // Dengan kurs IDR=18250 per USD: 182500 IDR == US$10
  assert.equal(fmt.formatRupiah(182500), 'US$10')
  assert.equal(fmt.formatRupiah(18250), 'US$1')
  assert.equal(fmt.formatInputTampil(182500), '10')

  // Input sen 10.50 USD harus tidak terkorupsi jadi 1050
  assert.equal(fmt.sanitizeKetikNominal('10.'), '10.')
  assert.equal(fmt.sanitizeKetikNominal('10.05'), '10.05')
  assert.equal(fmt.sanitizeKetikNominal('1000.50'), '1,000.50')
  assert.equal(fmt.sanitizeKetikNominal('1,23'), '123') // Backspace aman dari 1,234
  assert.equal(fmt.parseInputTampil('10.50'), 10.5)

  // Konversi balik ke basis IDR: 10.5 * 18250 = 191625
  const masukIdr = fmt.konversiKeBasis(fmt.parseInputTampil('10.50'))
  assert.equal(masukIdr, 191625)

  // Kembali ke Indonesia -> tepat Rp191.625
  fmt.simpanNegaraManual('ID')
  assert.equal(fmt.formatRupiah(masukIdr), 'Rp191.625')
  assert.equal(fmt.formatInputTampil(masukIdr), '191.625')
})

// 4. Snapshot kurs historis (1 USD = 18000 hari ini, besok menguat jadi 15000):
//    transaksi lama tetap memakai kurs historis 18000, transaksi baru mengikuti 15000.
{
  const fetchAsli = globalThis.fetch
  try {
    kurs._resetCacheKursUntukUji()
    delete _store['myduit:kurs_cache']
    kurs.simpanBasisMataUang('IDR', { terkunci: true })
    assert.deepEqual(kurs.bacaStatusBasis(), { basis: 'IDR', terkunci: true })

    // Hari ini: 1 USD = 18000 IDR
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ rates: { USD: 1, IDR: 18000, SGD: 1.35, EUR: 0.92 } }),
    })
    await kurs.segarkanKursGlobal({ paksa: true })
    const snapHari1 = kurs.buatSnapshotKurs('IDR', '2026-11-13')

    // Besok: IDR menguat 1 USD = 15000 IDR
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ rates: { USD: 1, IDR: 15000, SGD: 1.32, EUR: 0.90 } }),
    })
    await kurs.segarkanKursGlobal({ paksa: true })
    const snapHari2 = kurs.buatSnapshotKurs('IDR', '2026-11-14')

    fmt.simpanNegaraManual('US')
    // Transaksi lama 18000 IDR tetap US$1 (kurs historis 18000), bukan US$1.20!
    assert.equal(fmt.formatRupiah(18000, { kursSnapshot: snapHari1 }), 'US$1')
    assert.equal(fmt.formatInputTampil(18000, { kursSnapshot: snapHari1 }), '1')
    // Transaksi baru 15000 IDR tampil US$1 sesuai kurs hari ke-2 (15000)
    assert.equal(fmt.formatRupiah(15000, { kursSnapshot: snapHari2 }), 'US$1')
    // Saldo tanpa snapshot (live spot): 18000 IDR di hari ke-2 bernilai US$1.2
    assert.equal(fmt.formatRupiah(18000), 'US$1.2')

    // Sanitasi snapshot menolak payload korup & menerima payload valid
    assert.equal(kurs.sanitasiKursSnapshot(null), null)
    assert.equal(kurs.sanitasiKursSnapshot({ basis: 'INVALID', usdKe: { IDR: 16000 } }), null)
    assert.equal(kurs.sanitasiKursSnapshot(snapHari1)?.usdKe?.IDR, 18000)

    // Reset ke mode provisional
    kurs.resetBasisMataUang()
    assert.deepEqual(kurs.bacaStatusBasis(), { basis: null, terkunci: false })
    lulus++
  } finally {
    globalThis.fetch = fetchAsli
  }
}

// Reset bersih
kurs.resetBasisMataUang()
fmt.simpanNegaraManual('')
console.log(`kurs.test: OK (${lulus} kasus lulus)`)
