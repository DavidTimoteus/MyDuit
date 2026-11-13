/**
 * geminiOcr.js — Adapter Vision AI Google Gemini (Gemini 3.8 Flash & Auto-Discovery).
 *
 * Menggunakan direct REST API serverless resmi dari Google AI Studio:
 *  - 100% Client-side: Memanggil generativelanguage.googleapis.com langsung dari browser.
 *  - Kunci API (BYOK, format AIza... maupun AQ....) disimpan di LocalStorage pengguna.
 *  - Auto-cascade ke model Flash terbaru + dynamic model discovery (/v1beta/models)
 *    apabila model default pensiun/deprecated oleh Google.
 *  - Mengembalikan JSON terstruktur native tanpa regex parser rentan.
 */

import { parseAngkaEksternal, parseTanggalIsoAman } from './format.js'

export const STORAGE_KEY_GEMINI_KEY = 'myduit_gemini_api_key'
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'
export const FALLBACK_GEMINI_MODEL = 'gemini-3.6-flash'
export const GEMINI_FLASH_CASCADE = [
  DEFAULT_GEMINI_MODEL,
  FALLBACK_GEMINI_MODEL,
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
]

let _modelAktifCache = ''

/**
 * Baca kunci API Gemini dari LocalStorage.
 * @returns {string}
 */
export function bacaGeminiKey() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return (window.localStorage.getItem(STORAGE_KEY_GEMINI_KEY) || '').trim()
    }
  } catch {
    /* abaikan */
  }
  return ''
}

/**
 * Simpan kunci API Gemini ke LocalStorage.
 * @param {string} key
 */
export function simpanGeminiKey(key) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const clean = String(key || '').trim()
      if (clean) {
        window.localStorage.setItem(STORAGE_KEY_GEMINI_KEY, clean)
      } else {
        window.localStorage.removeItem(STORAGE_KEY_GEMINI_KEY)
      }
    }
  } catch {
    /* abaikan */
  }
}

/**
 * Hapus kunci API Gemini dari LocalStorage.
 */
export function hapusGeminiKey() {
  simpanGeminiKey('')
}

/**
 * Konversi File atau Blob menjadi base64 string dan mimeType.
 * @param {Blob|File} file
 * @returns {Promise<{ mimeType: string, base64Data: string }>}
 */
export async function konversiFileKeBase64(file) {
  if (typeof file === 'string' && file.startsWith('data:')) {
    const parts = file.split(',')
    const mimeMatch = parts[0].match(/:(.*?);/)
    return {
      mimeType: mimeMatch ? mimeMatch[1] : 'image/jpeg',
      base64Data: parts[1],
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      const parts = result.split(',')
      const mimeMatch = parts[0].match(/:(.*?);/)
      resolve({
        mimeType: mimeMatch ? mimeMatch[1] : 'image/jpeg',
        base64Data: parts[1],
      })
    }
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'))
    reader.readAsDataURL(file)
  })
}

function apakahErrorModelTidakTersedia(status, msg) {
  if (status === 404 || status === 410) return true
  const s = String(msg || '').toLowerCase()
  return (
    s.includes('no longer available') ||
    s.includes('not found') ||
    s.includes('not supported') ||
    s.includes('deprecated') ||
    s.includes('retired')
  )
}

function apakahErrorTransientServer(status, msg) {
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true
  }
  const s = String(msg || '').toLowerCase()
  return (
    s.includes('high demand') ||
    s.includes('overloaded') ||
    s.includes('unavailable') ||
    s.includes('resource exhausted') ||
    s.includes('quota') ||
    s.includes('rate limit') ||
    s.includes('try again later')
  )
}

function apakahErrorKunciDitolak(status, msg) {
  if (status === 401) return true
  const s = String(msg || '').toLowerCase()
  return (
    s.includes('api key not valid') ||
    s.includes('api_key_invalid') ||
    s.includes('invalid api key') ||
    s.includes('permission denied') ||
    s.includes('unauthenticated')
  )
}

function daftarKandidatAwal() {
  return [...new Set([_modelAktifCache, ...GEMINI_FLASH_CASCADE].filter(Boolean))]
}

/**
 * Validasi kunci via `GET /v1beta/models` sekaligus mengekstrak daftar model Flash aktif.
 * Endpoint listing ini tidak terdampak spike `503` pada inference `generateContent`.
 * @param {string} apiKey
 */
export async function validasiKunciViaDaftarModels(apiKey) {
  const key = String(apiKey || '').trim()
  if (!key) {
    return { ok: false, authRejected: true, status: 400, message: 'Kunci API kosong.', models: [] }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'x-goog-api-key': key },
    })
    clearTimeout(timer)
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}))
      const message = errData?.error?.message || `HTTP ${res.status}`
      return {
        ok: false,
        authRejected: apakahErrorKunciDitolak(res.status, message),
        transient: apakahErrorTransientServer(res.status, message),
        status: res.status,
        message,
        models: [],
      }
    }
    const json = await res.json().catch(() => null)
    const list = Array.isArray(json?.models) ? json.models : []
    const models = list
      .filter(
        (m) =>
          Array.isArray(m?.supportedGenerationMethods) &&
          m.supportedGenerationMethods.includes('generateContent') &&
          /gemini-\d.*flash/i.test(String(m?.name || '')),
      )
      .map((m) => String(m.name).replace(/^models\//, ''))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    return { ok: true, authRejected: false, status: 200, message: '', models }
  } catch (err) {
    clearTimeout(timer)
    return { ok: false, authRejected: false, transient: true, status: 0, message: err.message, models: [] }
  }
}

/**
 * Penemuan dinamis model Flash aktif langsung dari endpoint `/v1beta/models`.
 * Berguna bila Google menghentikan model lama agar kunci baru tetap langsung bekerja.
 * @param {string} apiKey
 * @returns {Promise<string[]>}
 */
export async function temukanModelFlashAktif(apiKey) {
  const res = await validasiKunciViaDaftarModels(apiKey)
  return res.ok ? res.models : []
}

async function pingModelGemini(model, key, payload) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 7000)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(payload),
    })
    clearTimeout(timer)
    if (res.ok) return { ok: true }
    const errData = await res.json().catch(() => ({}))
    const msg = errData?.error?.message || `HTTP ${res.status}: ${res.statusText}`
    return { ok: false, status: res.status, message: msg }
  } catch (err) {
    clearTimeout(timer)
    return { ok: false, status: 0, message: err.message }
  }
}

/**
 * Validasi dan uji koneksi kunci API Gemini dengan auto-cascade & discovery model aktif.
 * Tetap mengesahkan kunci bila `/v1beta/models` 200 OK meski model inference sedang 503 high demand.
 * @param {string} apiKey
 * @returns {Promise<{ ok: boolean, model?: string, limitedByDemand?: boolean, message: string }>}
 */
export async function ujiKoneksiGemini(apiKey) {
  const key = (apiKey || bacaGeminiKey()).trim()
  if (!key) {
    return { ok: false, message: 'Kunci API kosong. Silakan masukkan kunci API Anda.' }
  }

  // 1. Validasi kunci langsung pada listing model (kebal terhadap high-demand model tertentu)
  const infoKunci = await validasiKunciViaDaftarModels(key)
  if (infoKunci.authRejected) {
    return { ok: false, message: `Gagal memverifikasi kunci: ${infoKunci.message}` }
  }

  const testPayload = {
    contents: [{ parts: [{ text: 'Balas dengan kata "OK" saja jika kunci aktif.' }] }],
  }

  // Utamakan cache, model Flash aktif dari akun Google user, lalu cascade cadangan
  const kandidat = [...new Set([_modelAktifCache, ...infoKunci.models, ...GEMINI_FLASH_CASCADE].filter(Boolean))]
  let lastErr = null
  let sawTransient = false

  for (const model of kandidat) {
    const r = await pingModelGemini(model, key, testPayload)
    if (r.ok) {
      _modelAktifCache = model
      return { ok: true, model, message: `Kunci API valid! Gemini Vision (${model}) siap digunakan.` }
    }
    lastErr = r
    if (apakahErrorKunciDitolak(r.status, r.message)) {
      return { ok: false, message: `Gagal memverifikasi kunci: ${r.message}` }
    }
    if (apakahErrorTransientServer(r.status, r.message)) {
      sawTransient = true
    }
  }

  if (infoKunci.ok && sawTransient) {
    if (infoKunci.models[0]) _modelAktifCache = infoKunci.models[0]
    return {
      ok: true,
      limitedByDemand: true,
      model: infoKunci.models[0] || DEFAULT_GEMINI_MODEL,
      message: 'Kunci API valid & tersimpan! Server Google sedang padat sementara (high demand), silakan coba scan lagi nanti.',
    }
  }

  return {
    ok: false,
    message: `Gagal memverifikasi kunci: ${lastErr?.message || infoKunci.message || 'Koneksi terputus'}`,
  }
}

/**
 * Panggil Gemini Flash Vision untuk memindai struk belanja.
 *
 * @param {File|Blob|string} file
 * @param {string} [apiKey]
 * @param {object} [options]
 * @param {(p: number) => void} [options.onProgress]
 * @returns {Promise<object>} Skema terstruktur MyDuit
 */
export async function panggilGeminiVision(file, apiKey, options = {}) {
  const key = (apiKey || bacaGeminiKey()).trim()
  if (!key) {
    throw new Error('Kunci API Gemini belum diatur. Masukkan kunci API di pengaturan scan.')
  }

  options.onProgress?.(0.2)
  const { mimeType, base64Data } = await konversiFileKeBase64(file)
  options.onProgress?.(0.4)

  const promptSystem = `
Anda adalah sistem ekstraktor struk belanja & dokumen keuangan cerdas untuk aplikasi MyDuit.
Analisis foto struk ini secara cermat dan ekstrak informasinya ke format JSON yang valid.

Aturan Ekstraksi:
1. merchant: Nama toko/penjual (maksimal 40 karakter).
2. tanggal: Format YYYY-MM-DD. Jika tahun hanya 2 digit, jadikan 20XX. Jika tidak ada, gunakan null.
3. total: Nominal angka bulat (integer) TOTAL AKHIR / GRAND TOTAL belanja yang dibayar. Jangan keliru dengan Subtotal, Pajak, Diskon, atau Kembalian.
4. jenis: "pengeluaran" (default untuk struk belanja/nota bayar) atau "pemasukan" (jika refund/penjualan/top up masuk).
5. keterangan: Ringkasan 1-4 nama barang utama yang dibeli (pisahkan koma).
6. kategoriNama: Pilih salah satu yang paling cocok dari daftar kategori berikut:
   - "Makanan" (makanan/minuman siap saji, restoran, kafe)
   - "Bahan Makan" (sembako mentah, beras, minyak goreng, sayur, telur, bumbu)
   - "Belanja" (sabun, pakaian, alat rumah tangga, perlengkapan)
   - "Transportasi" (bensin, tol, parkir, ojek, tiket transportasi)
   - "Tagihan" (listrik, air, pulsa, internet, BPJS)
   - "Kesehatan" (obat, apotek, klinik, vitamin)
   - "Pendidikan" (buku, alat tulis, kursus)
   - "Hiburan" (tiket bioskop, game)
   - "Lainnya" (jika tidak masuk kategori di atas)
7. barang: Array objek daftar item belanja: [{ "nama": string, "qty": integer, "harga": integer (subtotal item) }]
8. sumberBayar: Jika struk mencantumkan metode bayar (misal GoPay, SeaBank, BCA, Mandiri, ShopeePay, OVO, QRIS), sebutkan {"nama": string, "jenis": "dompet"|"bank"}. Jika tidak ada / tunai, null.
9. bayarTunai: true jika struk menyatakan dibayar tunai / cash.
`

  const payload = {
    contents: [
      {
        parts: [
          { text: promptSystem },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      response_mime_type: 'application/json',
    },
  }

  // Model cascade: Coba Gemini 3.8 Flash dulu, cascade ke Flash lain & discovery dinamis bila model retired
  const dicoba = new Set()
  let lastError = null
  let butuhDiscovery = false

  async function panggilSatuModel(model) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)

    try {
      options.onProgress?.(0.6)
      const res = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify(payload),
      })
      clearTimeout(timer)

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        const errMsg = errJson?.error?.message || `HTTP ${res.status}`
        if (apakahErrorModelTidakTersedia(res.status, errMsg) || apakahErrorTransientServer(res.status, errMsg)) {
          butuhDiscovery = true
        }
        const err = new Error(`${model}: ${errMsg}`)
        err.authRejected = apakahErrorKunciDitolak(res.status, errMsg)
        throw err
      }

      options.onProgress?.(0.9)
      const jsonRes = await res.json()
      const rawText = jsonRes?.candidates?.[0]?.content?.parts?.[0]?.text
      if (!rawText) throw new Error('Respons Gemini kosong.')

      _modelAktifCache = model
      const parsed = JSON.parse(rawText)
      options.onProgress?.(1.0)
      return normalisasiHasilGemini(parsed)
    } catch (err) {
      clearTimeout(timer)
      throw err
    }
  }

  for (const model of daftarKandidatAwal()) {
    dicoba.add(model)
    try {
      return await panggilSatuModel(model)
    } catch (err) {
      lastError = err
      console.warn(`[gemini-ocr] Gagal pada ${model}:`, err.message)
      if (err.authRejected) break
    }
  }

  if (butuhDiscovery && !lastError?.authRejected) {
    const dinamis = await temukanModelFlashAktif(key)
    for (const model of dinamis) {
      if (dicoba.has(model)) continue
      dicoba.add(model)
      try {
        return await panggilSatuModel(model)
      } catch (err) {
        lastError = err
        console.warn(`[gemini-ocr] Gagal pada model dinamis ${model}:`, err.message)
        if (err.authRejected) break
      }
    }
  }

  throw new Error(`Gemini Vision gagal: ${lastError?.message || 'Koneksi terputus'}`)
}

/**
 * Normalisasi data JSON dari Gemini ke format seragam MyDuit.
 */
function normalisasiHasilGemini(data) {
  const d = data && typeof data === 'object' ? data : {}
  const merchant = d.merchant || 'Toko / Merchant'
  const tanggal = parseTanggalIsoAman(d.tanggal) ? String(d.tanggal).trim().slice(0, 10) : null
  const totalParsed = parseAngkaEksternal(d.total)
  const total = totalParsed > 0 ? totalParsed : null
  const jenis = d.jenis === 'pemasukan' ? 'pemasukan' : 'pengeluaran'
  const barang = Array.isArray(d.barang) ? d.barang : []
  const keterangan = d.keterangan || (barang.length ? barang.map((b) => b.nama).join(', ') : merchant)
  const kategoriNama = d.kategoriNama || 'Lainnya'

  // Susun Markdown Table
  const lines = []
  lines.push('### 🧾 Ringkasan Struk Transaksi (Gemini Flash Vision)')
  lines.push(`- **Merchant / Toko:** ${merchant}`)
  if (tanggal) lines.push(`- **Tanggal:** ${tanggal}`)
  if (total) lines.push(`- **Total Nominal:** Rp ${total.toLocaleString('id-ID')}`)
  if (d.sumberBayar?.nama) lines.push(`- **Metode Pembayaran:** ${d.sumberBayar.nama} (${d.sumberBayar.jenis})`)
  else if (d.bayarTunai) lines.push(`- **Metode Pembayaran:** Tunai / Cash`)

  if (barang.length > 0) {
    lines.push('')
    lines.push('#### 📋 Rincian Item Transaksi')
    lines.push('| No | Item / Deskripsi | Qty | Harga Satuan | Subtotal |')
    lines.push('|:--:|:-----------------|:---:|:------------:|:--------:|')
    barang.forEach((b, idx) => {
      const q = Math.max(1, parseAngkaEksternal(b.qty) || 1)
      const subtotal = Math.max(0, parseAngkaEksternal(b.harga))
      const unit = q > 1 && subtotal ? Math.round(subtotal / q) : subtotal
      const unitStr = unit ? `Rp ${unit.toLocaleString('id-ID')}` : '-'
      const subStr = subtotal ? `Rp ${subtotal.toLocaleString('id-ID')}` : '-'
      lines.push(`| ${idx + 1} | ${b.nama} | ${q} | ${unitStr} | ${subStr} |`)
    })
  }

  return {
    engine: 'gemini-flash',
    teks: `Merchant: ${merchant}\nTanggal: ${tanggal || '-'}\nTotal: ${total || '-'}\nKeterangan: ${keterangan}`,
    markdown: lines.join('\n'),
    total,
    totalSumber: total ? `Total Rp ${total.toLocaleString('id-ID')}` : null,
    tanggal,
    jenis,
    merchant,
    barang,
    kategoriNama,
    kategoriDari: 'gemini-vlm',
    kategoriYakin: true,
    keterangan,
    sumberBayar: d.sumberBayar || null,
    bayarTunai: Boolean(d.bayarTunai),
    confidence: 99.5,
    psm: 'vlm',
    fotoBuram: false,
  }
}
