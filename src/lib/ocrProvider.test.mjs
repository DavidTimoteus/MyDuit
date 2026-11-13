// Uji unit modul ocrProvider (arsitektur Multi-Tier Unlimited-OCR SGLang/Bridge, Gemini & Tesseract).
// Jalankan: node src/lib/ocrProvider.test.mjs
import {
  bacaOcrConfig,
  simpanOcrConfig,
  DEFAULT_OCR_ENDPOINT,
  DEFAULT_SGLANG_ENDPOINT,
  cekStatusUnlimitedOcr,
  parseUnlimitedRawOutput,
  scanDokumenKeuangan,
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
cek('default config endpoint adalah SGLang port 30000', DEFAULT_OCR_ENDPOINT, DEFAULT_SGLANG_ENDPOINT)
cek('default config endpoint terdefinisi', cfgAwal.endpoint, DEFAULT_OCR_ENDPOINT)
cek('default cropMode adalah gundam', cfgAwal.cropMode, 'gundam')

// 2. Mocking local storage jika di Node environment
if (typeof globalThis.window === 'undefined') {
  const mockStorage = {}
  globalThis.window = {
    localStorage: {
      getItem: (k) => mockStorage[k] || null,
      setItem: (k, v) => { mockStorage[k] = String(v) },
      removeItem: (k) => { delete storeDel(mockStorage, k) },
    },
  }
}
function storeDel(s, k) {
  delete s[k]
}

simpanOcrConfig({ engine: 'unlimited', endpoint: 'http://127.0.0.1:9999', cropMode: 'base' })
const cfgUpdate = bacaOcrConfig()
cek('config terupdate engine', cfgUpdate.engine, 'unlimited')
cek('config terupdate endpoint', cfgUpdate.endpoint, 'http://127.0.0.1:9999')
cek('config terupdate cropMode', cfgUpdate.cropMode, 'base')

// Reset kembali ke auto & gundam
simpanOcrConfig({ engine: 'auto', endpoint: DEFAULT_OCR_ENDPOINT, cropMode: 'gundam' })
cek('config reset ke auto', bacaOcrConfig().engine, 'auto')
cek('config reset cropMode ke gundam', bacaOcrConfig().cropMode, 'gundam')

// 3. Uji cekStatusUnlimitedOcr saat endpoint offline (port tertutup)
const statusOffline = await cekStatusUnlimitedOcr('http://127.0.0.1:49999', 300)
cek('cek status offline mengembalikan online: false dengan aman', statusOffline.online, false)

// 4. Uji parseUnlimitedRawOutput (porting process_unlimitedOCR2.py)
const rawVlmOutput = [
  '<PAGE><|ref|>title<|/ref|><|det|>[[10,12,240,40]]<|/det|>TOKO KOPI KENANGAN NUSANTARA',
  '<|ref|>text<|/ref|><|det|>[[10,45,200,70]]<|/det|>13/11/2026',
  '<BLOCK><table><tr><th>Item</th><th>Qty</th><th>Harga</th></tr><tr><td>Kopi Susu Gula Aren</td><td>2</td><td>36.000</td></tr><tr><td>Roti Bakar Coklat</td><td>1</td><td>22.000</td></tr></table></BLOCK>',
  '<|ref|>text<|/ref|><|det|>[[10,300,250,330]]<|/det|>GRAND TOTAL 58.000',
  'Tunai 60.000</PAGE>',
].join('\n')

const hasilVlm = parseUnlimitedRawOutput(rawVlmOutput)
cek('grounding tag <|ref|> terhapus bersih', hasilVlm.markdown.includes('<|ref|>'), false)
cek('grounding tag <|det|> terhapus bersih', hasilVlm.markdown.includes('<|det|>'), false)
cek('tag HTML <table> terkonversi menjadi Markdown table', hasilVlm.markdown.includes('| Kopi Susu Gula Aren | 2 |'), true)
cek('item barang terekstrak dari HTML table', hasilVlm.barang.length, 2)
cek('total transaksi terdeteksi dari keluaran VLM', hasilVlm.total, 58000)
cek('tanggal transaksi terdeteksi dari keluaran VLM', hasilVlm.tanggal, '2026-11-13')
cek('deteksi bayarTunai aktif', hasilVlm.bayarTunai, true)

// 5. Uji protokol SGLang /v1/models + /v1/chat/completions dan fallback auto dengan mock fetch
const fetchAsli = globalThis.fetch
try {
  let payloadTerkirim = null
  globalThis.fetch = async (url, init = {}) => {
    const sUrl = String(url)
    if (sUrl.endsWith('/v1/models')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'baidu/Unlimited-OCR' }] }),
      }
    }
    if (sUrl.endsWith('/v1/chat/completions')) {
      payloadTerkirim = JSON.parse(init.body)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'ALFAMART MELATI\n12/11/2026\n<table><tr><th>Item</th><th>Harga</th></tr><tr><td>Air Mineral</td><td>5.000</td></tr></table>\nTOTAL 5.000',
              },
            },
          ],
        }),
      }
    }
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) }
  }

  const dummyDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const resSglang = await scanDokumenKeuangan(dummyDataUrl, {
    engine: 'unlimited',
    endpoint: 'http://127.0.0.1:30000',
    cropMode: 'gundam',
  })
  cek('SGLang mengirimkan prompt <image>document parsing.', payloadTerkirim?.messages?.[0]?.content?.[1]?.text, '<image>document parsing.')
  cek('SGLang Gundam crop_mode aktif di images_config', payloadTerkirim?.images_config?.crop_mode, true)
  cek('SGLang Gundam image_size 640', payloadTerkirim?.images_config?.image_size, 640)
  cek('hasil SGLang mengekstrak total 5000', resSglang.total, 5000)

  // Uji auto-fallback saat server Unlimited-OCR HTTP 503 lalu jatuh ke Gemini Vision
  globalThis.fetch = async (url) => {
    const sUrl = String(url)
    if (sUrl.endsWith('/health')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', engine: 'Unlimited-OCR', model_loaded: false }),
      }
    }
    if (sUrl.includes('generativelanguage.googleapis.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      merchant: 'Warung Bakso',
                      tanggal: '2026-11-13',
                      total: 32000,
                      jenis: 'pengeluaran',
                      barang: [{ nama: 'Bakso Urat', qty: 1, harga: 32000 }],
                    }),
                  },
                ],
              },
            },
          ],
        }),
      }
    }
    return { ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) }
  }

  const resFallback = await scanDokumenKeuangan(dummyDataUrl, {
    engine: 'auto',
    endpoint: 'http://127.0.0.1:8000',
    geminiApiKey: 'AIzaSyFallbackTest',
  })
  cek('mode auto melewati bridge model_loaded:false dan fallback ke Gemini', resFallback.engine, 'gemini-flash')
  cek('mode auto fallback Gemini menghasilkan total 32000', resFallback.total, 32000)
} finally {
  globalThis.fetch = fetchAsli
}

// 6. Uji integrasi kunci Gemini via ocrProvider
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
