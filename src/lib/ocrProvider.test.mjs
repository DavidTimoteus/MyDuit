// Uji unit modul ocrProvider (arsitektur dual-tier Unlimited-OCR & Tesseract).
// Jalankan: node src/lib/ocrProvider.test.mjs
import {
  bacaOcrConfig,
  simpanOcrConfig,
  DEFAULT_OCR_ENDPOINT,
  cekStatusUnlimitedOcr,
  bacaGeminiKey,
  simpanGeminiKey,
  hapusGeminiKey,
} from './ocrProvider.js'

let lulus = 0
let gagal = 0
const galat = []

function cek(nama, dapat, harap) {
  const ok = JSON.stringify(dapat) === JSON.stringify(harap)
  if (ok) lulus++
  else {
    gagal++
    galat.push(`  ✗ ${nama}\n      harap: ${JSON.stringify(harap)}\n      dapat: ${JSON.stringify(dapat)}`)
  }
}

// 1. Uji baca default config
const cfgAwal = bacaOcrConfig()
cek('default config engine adalah auto', cfgAwal.engine, 'auto')
cek('default config endpoint terdefinisi', cfgAwal.endpoint, DEFAULT_OCR_ENDPOINT)

// 2. Mocking local storage jika di Node environment
if (typeof globalThis.window === 'undefined') {
  const mockStorage = {}
  globalThis.window = {
    localStorage: {
      getItem: (k) => mockStorage[k] || null,
      setItem: (k, v) => { mockStorage[k] = String(v) },
    },
  }
}

simpanOcrConfig({ engine: 'unlimited', endpoint: 'http://127.0.0.1:9999' })
const cfgUpdate = bacaOcrConfig()
cek('config terupdate engine', cfgUpdate.engine, 'unlimited')
cek('config terupdate endpoint', cfgUpdate.endpoint, 'http://127.0.0.1:9999')

// Reset kembali ke auto
simpanOcrConfig({ engine: 'auto', endpoint: DEFAULT_OCR_ENDPOINT })
cek('config reset ke auto', bacaOcrConfig().engine, 'auto')

// 3. Uji cekStatusUnlimitedOcr saat endpoint offline (port tertutup)
const statusOffline = await cekStatusUnlimitedOcr('http://127.0.0.1:49999', 300)
cek('cek status offline mengembalikan online: false dengan aman', statusOffline.online, false)

// 4. Uji integrasi kunci Gemini via ocrProvider
hapusGeminiKey()
cek('bacaGeminiKey via provider awal', bacaGeminiKey(), '')
simpanGeminiKey('AIzaSyTestKey')
cek('bacaGeminiKey via provider tersimpan', bacaGeminiKey(), 'AIzaSyTestKey')
cek('hasGeminiKey terbaca di config', bacaOcrConfig().hasGeminiKey, true)
hapusGeminiKey()

// Laporan hasil uji
console.log(`\n=== UJI OCR PROVIDER: ${lulus} lulus, ${gagal} gagal ===`)
if (gagal) {
  console.log(galat.join('\n'))
  process.exit(1)
}
console.log('Semua uji provider OCR lulus.')
