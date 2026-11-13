// Uji unit modul ocrProvider (arsitektur Multi-Tier Puter Unlimited OCR, Gemini & Tesseract).
// Jalankan: node src/lib/ocrProvider.test.mjs
import {
  bacaOcrConfig,
  simpanOcrConfig,
  DEFAULT_OCR_ENDPOINT,
  DEFAULT_SGLANG_ENDPOINT,
  DEFAULT_PUTER_PROVIDER,
  bacaPuterProvider,
  simpanPuterProvider,
  cekStatusPuterOcr,
  sambungkanPuterOcr,
  cekStatusUnlimitedOcr,
  deteksiKapabilitasPerangkat,
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
cek('default puterProvider adalah mistral', cfgAwal.puterProvider, DEFAULT_PUTER_PROVIDER)
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

simpanOcrConfig({ engine: 'unlimited', puterProvider: 'aws-textract', endpoint: 'http://127.0.0.1:9999', cropMode: 'base' })
const cfgUpdate = bacaOcrConfig()
cek('config terupdate engine', cfgUpdate.engine, 'unlimited')
cek('config terupdate puterProvider', cfgUpdate.puterProvider, 'aws-textract')
cek('config terupdate endpoint', cfgUpdate.endpoint, 'http://127.0.0.1:9999')
cek('config terupdate cropMode', cfgUpdate.cropMode, 'base')

// Reset kembali ke auto & mistral
simpanPuterProvider('mistral')
simpanOcrConfig({ engine: 'auto', endpoint: DEFAULT_OCR_ENDPOINT, cropMode: 'gundam' })
cek('config reset ke auto', bacaOcrConfig().engine, 'auto')
cek('config reset puterProvider ke mistral', bacaPuterProvider(), 'mistral')
cek('config reset cropMode ke gundam', bacaOcrConfig().cropMode, 'gundam')

// 3. Uji cekStatusUnlimitedOcr saat endpoint offline (port tertutup)
const statusOffline = await cekStatusUnlimitedOcr('http://127.0.0.1:49999', 300)
cek('cek status offline mengembalikan online: false dengan aman', statusOffline.online, false)

// 4. Uji parseUnlimitedRawOutput (HTML table + grounding tag & Markdown pipe table native Puter Mistral)
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

const rawMistralMd = [
  '# ALFAMART MELATI',
  '12/11/2026',
  '',
  '| Item | Qty | Harga |',
  '| --- | --- | --- |',
  '| Air Mineral | 2 | 10.000 |',
  '| Roti Sobek | 1 | 15.000 |',
  '',
  'TOTAL 25.000',
].join('\n')

const hasilMistralMd = parseUnlimitedRawOutput(rawMistralMd)
cek('item barang terekstrak dari Markdown table Puter Mistral', hasilMistralMd.barang.length, 2)
cek('total transaksi terekstrak dari output Mistral Markdown', hasilMistralMd.total, 25000)
cek('tanggal terekstrak dari output Mistral Markdown', hasilMistralMd.tanggal, '2026-11-12')

// 5. Uji Puter Free Unlimited OCR (`puter.ai.img2txt`) + fallback antar provider + auto mode fallback ke Gemini
const fetchAsli = globalThis.fetch
try {
  const dummyDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const panggilanPuter = []
  const mockPuter = {
    auth: {
      isSignedIn: async () => false,
      signIn: async () => true,
      getUser: async () => ({ username: 'tester-myduit' }),
    },
    ai: {
      img2txt: async (args) => {
        panggilanPuter.push(args)
        if (args.provider === 'mistral') {
          return {
            markdown: '# WARUNG KOPI MANDALA\n13/11/2026\n| Item | Qty | Harga |\n| --- | --- | --- |\n| Espresso | 1 | 15.000 |\nTOTAL 15.000',
          }
        }
        return 'WARUNG KOPI MANDALA\n13/11/2026\nTOTAL 15.000'
      },
    },
  }

  const stPuter = await cekStatusPuterOcr(mockPuter)
  cek('cekStatusPuterOcr melaporkan ready true saat mock SDK valid', stPuter.ready, true)
  cek('cekStatusPuterOcr melaporkan signedIn false sebelum signIn', stPuter.signedIn, false)

  const resSignIn = await sambungkanPuterOcr({
    auth: {
      isSignedIn: async () => true,
      getUser: async () => ({ username: 'dtimo-puter' }),
    },
  })
  cek('sambungkanPuterOcr mengembalikan username saat sudah masuk', resSignIn.username, 'dtimo-puter')

  const resPuter = await scanDokumenKeuangan(dummyDataUrl, {
    engine: 'unlimited',
    puterProvider: 'mistral',
    puterInstance: mockPuter,
  })
  cek('Puter memanggil provider mistral', panggilanPuter[0]?.provider, 'mistral')
  cek('Puter mistral meminta tableFormat markdown', panggilanPuter[0]?.tableFormat, 'markdown')
  cek('engine output adalah puter-ocr', resPuter.engine, 'puter-ocr')
  cek('total terdeteksi dari Puter Mistral 15000', resPuter.total, 15000)

  // Uji fallback otomatis mistral -> aws-textract jika mistral gagal
  const panggilanFallback = []
  const mockPuterFallbackProv = {
    ai: {
      img2txt: async (args) => {
        panggilanFallback.push(args.provider)
        if (args.provider === 'mistral') throw new Error('Mistral sibuk')
        return 'INDOMARET SUDIRMAN\n13/11/2026\nTOTAL 27.500'
      },
    },
  }
  const resPuterTextract = await scanDokumenKeuangan(dummyDataUrl, {
    engine: 'unlimited',
    puterProvider: 'mistral',
    puterInstance: mockPuterFallbackProv,
  })
  cek('fallback provider Puter mencoba mistral lalu aws-textract', panggilanFallback, ['mistral', 'aws-textract'])
  cek('puterProvider aktif pada hasil fallback adalah aws-textract', resPuterTextract.puterProvider, 'aws-textract')
  cek('total terdeteksi dari AWS Textract 27500', resPuterTextract.total, 27500)

  // Uji cancel popup auth tidak di-retry ke provider lain
  let countCancelCalls = 0
  let cancelErrMsg = ''
  try {
    await scanDokumenKeuangan(dummyDataUrl, {
      engine: 'unlimited',
      puterProvider: 'mistral',
      puterInstance: {
        ai: {
          img2txt: async () => {
            countCancelCalls++
            throw new Error('User cancelled sign-in popup')
          },
        },
      },
    })
  } catch (err) {
    cancelErrMsg = err.message
  }
  cek('cancel auth hanya dipanggil 1x tanpa fallback provider', countCancelCalls, 1)
  cek('cancel auth mengembalikan pesan pembatalan', cancelErrMsg.includes('cancel'), true)

  // Uji auto mode saat Puter gagal lalu fallback ke Gemini Vision
  globalThis.fetch = async (url) => {
    const sUrl = String(url)
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

  const mockPuterFail = {
    ai: {
      img2txt: async () => {
        throw new Error('Puter rate limit sementara')
      },
    },
  }
  const resFallback = await scanDokumenKeuangan(dummyDataUrl, {
    engine: 'auto',
    puterInstance: mockPuterFail,
    geminiApiKey: 'AIzaSyFallbackTest',
  })
  cek('mode auto fallback ke Gemini saat Puter error', resFallback.engine, 'gemini-flash')
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

// 7. Uji deteksiKapabilitasPerangkat dengan dukungan langsung browser via Puter AI
const profilDev = await deteksiKapabilitasPerangkat()
cek('deteksiKapabilitasPerangkat mengembalikan ringkasan non-kosong', Boolean(profilDev.ringkasan), true)
cek('deteksiKapabilitasPerangkat unlimitedBrowserDirect aktif via Puter', profilDev.unlimitedBrowserDirect, true)

// Laporan hasil uji
console.log(`\n=== UJI OCR PROVIDER: ${lulus} lulus, ${gagal} gagal ===`)
if (gagal) {
  console.log(galat.join('\n'))
  process.exit(1)
}
console.log('Semua uji provider OCR lulus.')
