// Uji unit adapter Gemini Flash Vision.
// Jalankan: node src/lib/geminiOcr.test.mjs
import {
  bacaGeminiKey,
  simpanGeminiKey,
  hapusGeminiKey,
  konversiFileKeBase64,
  panggilGeminiVision,
} from './geminiOcr.js'

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

// 1. Mocking LocalStorage di environment Node
if (typeof globalThis.window === 'undefined') {
  const store = {}
  globalThis.window = {
    localStorage: {
      getItem: (k) => store[k] || null,
      setItem: (k, v) => { store[k] = String(v) },
      removeItem: (k) => { delete store[k] },
    },
  }
}

// 2. Uji manajemen kunci API di LocalStorage
hapusGeminiKey()
cek('baca key kosong di awal', bacaGeminiKey(), '')

simpanGeminiKey('AIzaSyDummyKeyForTesting123')
cek('simpan key berhasil terbaca', bacaGeminiKey(), 'AIzaSyDummyKeyForTesting123')

hapusGeminiKey()
cek('hapus key berhasil mengosongkan', bacaGeminiKey(), '')

// 3. Uji konversi data URL ke base64
const sampleDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const conv = await konversiFileKeBase64(sampleDataUrl)
cek('mimeType terdeteksi image/png', conv.mimeType, 'image/png')
cek('base64Data bersih tanpa prefix', conv.base64Data.startsWith('iVBORw0'), true)

// 4. Uji guard jika key kosong saat panggilGeminiVision
let threwNoKey = false
try {
  await panggilGeminiVision(sampleDataUrl, '')
} catch (e) {
  threwNoKey = e.message.includes('Kunci API')
}
cek('panggilGeminiVision throw error jika tanpa key', threwNoKey, true)

console.log(`\n=== UJI GEMINI OCR: ${lulus} lulus, ${gagal} gagal ===`)
if (gagal) {
  console.log(galat.join('\n'))
  process.exit(1)
}
console.log('Semua uji Gemini OCR lulus.')
