// Uji unit adapter Gemini Flash Vision.
// Jalankan: node src/lib/geminiOcr.test.mjs
import {
  bacaGeminiKey,
  simpanGeminiKey,
  hapusGeminiKey,
  konversiFileKeBase64,
  panggilGeminiVision,
  ujiKoneksiGemini,
  DEFAULT_GEMINI_MODEL,
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
cek('DEFAULT_GEMINI_MODEL menggunakan model aktif >= gemini-3.8-flash', DEFAULT_GEMINI_MODEL, 'gemini-3.8-flash')

// 5. Uji auto-cascade & dynamic discovery jika model default retired/404 dengan mock fetch
const fetchAsli = globalThis.fetch
try {
  let percobaan = []
  globalThis.fetch = async (url, init = {}) => {
    const sUrl = String(url)
    if (sUrl.includes('/models?')) {
      return { ok: false, status: 404, json: async () => ({}) }
    }
    if (sUrl.endsWith('/v1beta/models') && (!init.method || init.method === 'GET')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'models/gemini-3.9-flash', supportedGenerationMethods: ['generateContent'] },
          ],
        }),
      }
    }
    percobaan.push(sUrl)
    if (sUrl.includes('gemini-3.9-flash:generateContent')) {
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }) }
    }
    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: { message: 'This model is no longer available.' } }),
    }
  }

  const hasilUji = await ujiKoneksiGemini('AQ.DummyExpressKey123')
  cek('ujiKoneksiGemini fallback ke dynamic model aktif saat model hardcoded 404', hasilUji.ok, true)
  cek('ujiKoneksiGemini menemukan model dinamis gemini-3.9-flash', hasilUji.model, 'gemini-3.9-flash')
} finally {
  globalThis.fetch = fetchAsli
}

console.log(`\n=== UJI GEMINI OCR: ${lulus} lulus, ${gagal} gagal ===`)
if (gagal) {
  console.log(galat.join('\n'))
  process.exit(1)
}
console.log('Semua uji Gemini OCR lulus.')
