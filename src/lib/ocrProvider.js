/**
 * ocrProvider.js — Abstraksi Provider OCR Hibrida Tri-Tier MyDuit.
 *
 * Mengimplementasikan arsitektur Adaptive Multi-Tier:
 *  - Unlimited-OCR (SGLang / FastAPI Bridge): Model VLM baidu/Unlimited-OCR
 *    (R-SWA + Gundam Dynamic Crop) via OpenAI /v1/chat/completions atau Bridge /api/v1/parse-receipt.
 *  - Gemini Vision (Cloud AI): Google Gemini Flash Vision API (BYOK).
 *  - Client Standalone 100% Offline: Tesseract.js dengan Gundam Dynamic Tiling
 *    untuk struk panjang, R-SWA Sliding Window Lookahead, dan N-Gram anti-repetition.
 */

import {
  bacaStruk,
  cariJenis,
  cariMerchant,
  cariTanggal,
  cariTotal,
  dedupBarisNgram,
  rekonstruksiTataLetakBaris,
  susunMarkdownStruk,
} from './ocrStruk.js'
import { cariBarang, cariPembayar, cariTunai, petakanKategori } from './strukMeta.js'
import { bacaStrukPpOcr } from './ppocrProvider.js'
import { parseAngkaEksternal, parseTanggalIsoAman } from './format.js'
import {
  bacaGeminiKey,
  simpanGeminiKey,
  hapusGeminiKey,
  ujiKoneksiGemini,
  panggilGeminiVision,
  konversiFileKeBase64,
} from './geminiOcr.js'

export { bacaGeminiKey, simpanGeminiKey, hapusGeminiKey, ujiKoneksiGemini }

export const DEFAULT_SGLANG_ENDPOINT = 'http://127.0.0.1:30000'
export const DEFAULT_OCR_ENDPOINT = DEFAULT_SGLANG_ENDPOINT
export const DEFAULT_OCR_TIMEOUT_MS = 30000

const STORAGE_KEY_ENGINE = 'myduit_ocr_engine'
const STORAGE_KEY_ENDPOINT = 'myduit_ocr_endpoint'
const STORAGE_KEY_CROP_MODE = 'myduit_ocr_crop_mode'

// Tolak protokol non-HTTP/S dan HTTP plaintext ke host eksternal agar foto struk
// pribadi tidak dikirim tanpa enkripsi ke server pihak ketiga.
export function validasiEndpointOcr(raw) {
  const val = String(raw || '').trim().replace(/\/+$/, '')
  if (!val) throw new Error('Endpoint OCR tidak boleh kosong.')
  let parsed
  try {
    parsed = new URL(val)
  } catch {
    throw new Error('Format URL endpoint OCR tidak valid.')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Endpoint OCR tidak boleh menyertakan kredensial dalam URL.')
  }
  const host = parsed.hostname.toLowerCase()
  if (
    host === 'metadata.google.internal' ||
    host === '169.254.169.254' ||
    host === '100.100.100.200' ||
    host === '0.0.0.0' ||
    host === '[::]' ||
    host.startsWith('169.254.')
  ) {
    throw new Error('Host endpoint OCR tidak diizinkan.')
  }
  const isLocal = host === '127.0.0.1' || host === 'localhost' || host === '[::1]'
  const cleanPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')
  if (parsed.protocol === 'https:') return `${parsed.origin}${cleanPath}`
  if (parsed.protocol === 'http:' && isLocal) return `${parsed.origin}${cleanPath}`
  throw new Error('Endpoint OCR eksternal wajib memakai HTTPS (HTTP hanya diizinkan untuk localhost).')
}

/**
 * Baca konfigurasi OCR aktif dari LocalStorage.
 * @returns {{ engine: 'auto'|'gemini'|'ppocr'|'local'|'unlimited', endpoint: string, cropMode: 'gundam'|'base', hasCustomEndpoint: boolean, hasGeminiKey: boolean }}
 */
export function bacaOcrConfig() {
  let engine = 'auto'
  let endpoint = DEFAULT_OCR_ENDPOINT
  let cropMode = 'gundam'
  let hasCustomEndpoint = false
  let hasGeminiKey = false

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      engine = window.localStorage.getItem(STORAGE_KEY_ENGINE) || 'auto'
      const rawEp = window.localStorage.getItem(STORAGE_KEY_ENDPOINT)
      if (rawEp) {
        try {
          endpoint = validasiEndpointOcr(rawEp)
          hasCustomEndpoint = true
        } catch {
          endpoint = DEFAULT_OCR_ENDPOINT
        }
      }
      const rawCrop = window.localStorage.getItem(STORAGE_KEY_CROP_MODE)
      if (rawCrop === 'base' || rawCrop === 'gundam') cropMode = rawCrop
      hasGeminiKey = Boolean(bacaGeminiKey())
    }
  } catch {
    /* abaikan */
  }
  return { engine, endpoint, cropMode, hasCustomEndpoint, hasGeminiKey }
}

/**
 * Simpan konfigurasi preferensi engine dan endpoint OCR.
 * @param {{ engine?: 'auto'|'gemini'|'ppocr'|'local'|'unlimited', endpoint?: string, cropMode?: 'gundam'|'base' }} config
 */
export function simpanOcrConfig(config = {}) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (config.engine) window.localStorage.setItem(STORAGE_KEY_ENGINE, config.engine)
      if (config.endpoint) {
        const cleanEp = validasiEndpointOcr(config.endpoint)
        window.localStorage.setItem(STORAGE_KEY_ENDPOINT, cleanEp)
      }
      if (config.cropMode === 'gundam' || config.cropMode === 'base') {
        window.localStorage.setItem(STORAGE_KEY_CROP_MODE, config.cropMode)
      }
    }
  } catch (err) {
    if (config.endpoint) throw err
  }
}

async function fetchJsonDenganTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    return res
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Cek status ketersediaan endpoint Unlimited-OCR secara non-blocking.
 * Mendukung dua protokol:
 *  1. OpenAI-Compatible SGLang/vLLM (`GET /v1/models`, default port `30000`)
 *  2. FastAPI Bridge lokal (`GET /health`, port `8000`)
 *
 * @param {string} endpoint
 * @param {number} timeoutMs
 * @returns {Promise<{ online: boolean, protocol?: 'sglang'|'bridge'|null, modelReady?: boolean, model?: string, engine?: string, version?: string, device?: string }>}
 */
export async function cekStatusUnlimitedOcr(endpoint = DEFAULT_OCR_ENDPOINT, timeoutMs = 2500) {
  let cleanUrl
  try {
    cleanUrl = validasiEndpointOcr(endpoint)
  } catch {
    return { online: false, protocol: null, modelReady: false }
  }

  const preferBridge = /:8000(?:\/|$)/.test(cleanUrl)
  const paths = preferBridge ? ['/health', '/v1/models'] : ['/v1/models', '/health']

  for (const path of paths) {
    try {
      const res = await fetchJsonDenganTimeout(
        `${cleanUrl}${path}`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        timeoutMs,
      )
      if (!res.ok) continue
      const data = await res.json().catch(() => null)
      if (!data) continue

      if (path === '/v1/models' && Array.isArray(data.data)) {
        const preferred =
          data.data.find((m) => /unlimited|ocr/i.test(String(m?.id || ''))) || data.data[0]
        return {
          online: true,
          protocol: 'sglang',
          modelReady: Boolean(preferred?.id),
          model: preferred?.id || 'baidu/Unlimited-OCR',
          engine: 'Unlimited-OCR (SGLang)',
          version: 'vlm',
          device: 'vlm-server',
        }
      }

      if (path === '/health' && (data.status === 'ok' || data.engine)) {
        return {
          online: true,
          protocol: 'bridge',
          modelReady: data.model_loaded !== false,
          model: 'baidu/Unlimited-OCR',
          engine: data.engine || 'Unlimited-OCR Bridge',
          version: data.version || '1.0.0',
          device: data.device || 'unknown',
        }
      }
    } catch (err) {
      // Bila koneksi TCP langsung ditolak / timeout, jangan ulangi jalur lain agar fallback instan
      if (err?.name === 'AbortError' || err instanceof TypeError) {
        return { online: false, protocol: null, modelReady: false }
      }
    }
  }

  return { online: false, protocol: null, modelReady: false }
}

/**
 * Bersihkan entitas & tag HTML ringan menjadi teks polos aman (tanpa DOM/innerHTML).
 */
function bersihHtmlTeks(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Konversi blok HTML <table> menjadi Markdown Table & ekstrak item belanja jika terdeteksi.
 */
function konversiTabelHtmlKeMarkdown(htmlTabel) {
  const rows = []
  const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let trMatch
  while ((trMatch = trRegex.exec(htmlTabel)) !== null) {
    const cells = []
    const cellRegex = /<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi
    let cellMatch
    while ((cellMatch = cellRegex.exec(trMatch[1])) !== null) {
      cells.push(bersihHtmlTeks(cellMatch[2]).replace(/\|/g, '/'))
    }
    if (cells.length > 0) rows.push(cells)
  }
  if (rows.length === 0) return { markdown: '', plainLines: [], barang: [] }

  const colCount = Math.max(...rows.map((r) => r.length))
  const pad = (r) => Array.from({ length: colCount }, (_, i) => r[i] ?? '')
  const header = pad(rows[0])
  const md = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${pad(r).join(' | ')} |`),
  ].join('\n')

  // Ekstrak item transaksi sederhana dari baris tabel
  const barang = []
  const plainLines = []
  const skipHeader = /^(no|item|nama|deskripsi|barang|produk|menu|qty|jumlah|harga|subtotal|total)$/i
  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const r = rows[rIdx]
    const nonEmpty = r.filter(Boolean)
    if (nonEmpty.length === 0) continue
    plainLines.push(nonEmpty.join(' '))

    // Lewati baris header pertama
    if (rIdx === 0 && nonEmpty.every((c) => skipHeader.test(c.trim()))) continue

    // Cari angka terakhir sebagai nominal harga/subtotal bila bukan baris ringkasan total
    const joined = nonEmpty.join(' ')
    if (/^(sub\s*total|total|grand total|pajak|ppn|tax|diskon|tunai|cash|kembali)/i.test(joined)) {
      continue
    }
    const angkaKolom = nonEmpty
      .map((c) => parseAngkaEksternal(c))
      .filter((v) => v > 0)
    const teksKolom = nonEmpty.filter((c) => /[a-zA-Z]{2,}/.test(c))
    if (teksKolom.length > 0 && angkaKolom.length > 0) {
      const harga = angkaKolom[angkaKolom.length - 1]
      const kandidatQty = angkaKolom.length >= 2 && angkaKolom[0] <= 99 ? angkaKolom[0] : 1
      const nama = teksKolom[0].replace(/^\d+[.)]\s*/, '').trim()
      if (nama && harga >= 100) {
        barang.push({ nama, qty: kandidatQty, harga })
      }
    }
  }

  return { markdown: md, plainLines, barang }
}

/**
 * Porting `process_unlimitedOCR2.py` untuk membersihkan keluaran mentah VLM `baidu/Unlimited-OCR`:
 *  - Menghapus tag grounding `<|ref|>...<|/ref|>`, `<|det|>[[...]]<|/det|>`, `<PAGE>`, `<BLOCK>`
 *  - Mengonversi HTML `<table>...</table>` menjadi tabel Markdown bersih
 *  - Mengekstrak entitas keuangan terstruktur MyDuit (merchant, tanggal, total, barang, kategori)
 *
 * @param {string} rawText
 * @returns {object} Skema data transaksi terstruktur
 */
export function parseUnlimitedRawOutput(rawText) {
  const mentah = String(rawText || '')
    .replace(/<\|ref\|>[\s\S]*?<\|\/ref\|>/gi, '')
    .replace(/<\|det\|>[\s\S]*?<\|\/det\|>/gi, '')
    .replace(/<\/?(?:PAGE|BLOCK)\b[^>]*>/gi, '\n')
    .replace(/<\|(?:endoftext|eos|im_end)\|>/gi, '')

  const tableItems = []
  const plainTambahan = []

  // Ubah setiap HTML <table> menjadi Markdown Table bersih
  const teksMarkdownBersih = mentah
    .replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (tbl) => {
      const conv = konversiTabelHtmlKeMarkdown(tbl)
      tableItems.push(...conv.barang)
      plainTambahan.push(...conv.plainLines)
      return conv.markdown ? `\n${conv.markdown}\n` : '\n'
    })
    // Hapus sisa tag HTML formatting umum (<p>, <div>, <b>, dll.)
    .replace(/<\/?(?:p|div|section|article|br|li|ul|ol|h[1-6]|strong|b|em|i|span)\b[^>]*>/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // Bentuk teks datar untuk ekstraktor MyDuit (gabung baris non-tabel + plainLines tabel)
  const teksUntukParser = dedupBarisNgram(
    rekonstruksiTataLetakBaris(
      [teksMarkdownBersih.replace(/^\|[\s:-|]+\|$/gm, '').replace(/\|/g, ' '), ...plainTambahan].join('\n'),
    ),
  )

  const { total, sumber } = cariTotal(teksUntukParser)
  const tanggal = cariTanggal(teksUntukParser)
  const merchant = cariMerchant(teksUntukParser)
  const jenis = cariJenis(teksUntukParser)
  const barang = tableItems.length > 0 ? tableItems : cariBarang(teksUntukParser)
  const peta = petakanKategori({ barang, merchant, jenis })
  const pembayar = cariPembayar(teksUntukParser)
  const tunai = cariTunai(teksUntukParser)

  const alnumTotal = (teksUntukParser.match(/[a-zA-Z0-9]/g) || []).length
  const fotoBuram = alnumTotal < 15

  const ringkasanMd = susunMarkdownStruk({
    merchant,
    tanggal,
    total,
    sumber,
    barang,
    pembayar,
    tunai,
    teksMentah: teksMarkdownBersih || teksUntukParser,
  })

  return {
    merchant,
    tanggal,
    total,
    totalSumber: sumber,
    jenis,
    barang,
    kategoriNama: peta.kategoriNama,
    kategoriDari: peta.kategoriDari || 'unlimited-ocr',
    kategoriYakin: peta.yakin,
    keterangan: peta.keterangan || merchant || 'Transaksi Struk',
    sumberBayar: pembayar,
    bayarTunai: tunai,
    confidence: total ? 97 : 78,
    markdown: ringkasanMd,
    teks: teksUntukParser || teksMarkdownBersih,
    fotoBuram,
  }
}

/**
 * Kirim file gambar ke API Unlimited-OCR (SGLang OpenAI /v1/chat/completions atau FastAPI Bridge).
 * @param {File|Blob} file
 * @param {string} endpoint
 * @param {number|{ timeoutMs?: number, cropMode?: 'gundam'|'base', status?: object }} [timeoutOrOpts]
 */
async function panggilUnlimitedOcrApi(file, endpoint, timeoutOrOpts = DEFAULT_OCR_TIMEOUT_MS) {
  const cleanUrl = validasiEndpointOcr(endpoint)
  const opts =
    typeof timeoutOrOpts === 'number' ? { timeoutMs: timeoutOrOpts } : timeoutOrOpts || {}
  const timeoutMs = opts.timeoutMs || DEFAULT_OCR_TIMEOUT_MS
  const cropMode = opts.cropMode === 'base' ? 'base' : 'gundam'

  const status = opts.status || (await cekStatusUnlimitedOcr(cleanUrl, 2000))
  if (!status.online) {
    throw new Error(`Server Unlimited-OCR tidak aktif di ${cleanUrl}`)
  }

  // Jalur 1: Server Resmi SGLang / vLLM OpenAI-Compatible (baidu/Unlimited-OCR)
  if (status.protocol === 'sglang') {
    const { mimeType, base64Data } = await konversiFileKeBase64(file)
    const imagesConfig =
      cropMode === 'base'
        ? { crop_mode: false, base_size: 1024, image_size: 1024 }
        : { crop_mode: true, base_size: 1024, image_size: 640 }

    const payload = {
      model: status.model || 'baidu/Unlimited-OCR',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
            { type: 'text', text: '<image>document parsing.' },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 2048,
      images_config: imagesConfig,
    }

    const res = await fetchJsonDenganTimeout(
      `${cleanUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      },
      timeoutMs,
    )
    if (!res.ok) {
      throw new Error(`SGLang Unlimited-OCR merespons HTTP ${res.status}: ${res.statusText}`)
    }
    const json = await res.json()
    const rawContent = json?.choices?.[0]?.message?.content || ''
    if (!rawContent.trim()) {
      throw new Error('Respons VLM Unlimited-OCR kosong.')
    }
    const parsed = parseUnlimitedRawOutput(rawContent)
    return { success: true, engine: 'unlimited-ocr-sglang', data: parsed }
  }

  // Jalur 2: FastAPI Microservice Bridge (/api/v1/parse-receipt)
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetchJsonDenganTimeout(
    `${cleanUrl}/api/v1/parse-receipt?crop_mode=${cropMode}`,
    {
      method: 'POST',
      body: formData,
      headers: { Accept: 'application/json' },
    },
    timeoutMs,
  )
  if (!res.ok) {
    throw new Error(`Server OCR merespons HTTP ${res.status}: ${res.statusText}`)
  }
  return await res.json()
}

/**
 * Normalisasi respons dari server Unlimited-OCR ke skema terpadu MyDuit.
 */
function normalisasiHasilUnlimited(resData) {
  const d = resData?.data || resData || {}
  const rawGabung = [d.teks || '', d.markdown || ''].join('\n')
  const butuhBersihGrounding = /<\|(?:ref|det)\|>|<table\b|<PAGE>|<BLOCK>/i.test(rawGabung)

  // Bila server mengembalikan tag mentah SGLang/HTML, jalankan normalizer process_unlimitedOCR2
  if (butuhBersihGrounding) {
    const parsed = parseUnlimitedRawOutput(d.markdown || d.teks || '')
    const totalNum = parseAngkaEksternal(d.total) || parsed.total
    return {
      engine: resData?.engine || 'unlimited-ocr',
      ...parsed,
      total: totalNum,
      totalSumber: d.totalSumber || parsed.totalSumber,
      psm: 'vlm',
    }
  }

  const totalParsed = parseAngkaEksternal(d.total)
  const total = totalParsed > 0 ? totalParsed : null
  const barang = Array.isArray(d.barang) ? d.barang : []
  const merchant = d.merchant || ''
  const jenis = d.jenis === 'pemasukan' ? 'pemasukan' : 'pengeluaran'
  const tanggal = parseTanggalIsoAman(d.tanggal) ? String(d.tanggal).trim().slice(0, 10) : null

  let kategoriNama = d.kategoriNama || ''
  let kategoriDari = d.kategoriDari || 'unlimited-ocr'
  let keterangan = d.keterangan || ''
  let kategoriYakin = d.kategoriYakin ?? true

  if (!kategoriNama) {
    const peta = petakanKategori({ barang, merchant, jenis })
    kategoriNama = peta.kategoriNama
    kategoriDari = peta.kategoriDari
    keterangan = keterangan || peta.keterangan
    kategoriYakin = peta.yakin
  }

  return {
    engine: resData?.engine || 'unlimited-ocr',
    teks: d.teks || '',
    markdown: d.markdown || '',
    total,
    totalSumber: d.totalSumber || (total ? `Total ${total.toLocaleString('id-ID')}` : null),
    tanggal,
    jenis,
    merchant,
    barang,
    kategoriNama,
    kategoriDari,
    kategoriYakin,
    keterangan: keterangan || merchant || 'Struk',
    sumberBayar: d.sumberBayar || null,
    bayarTunai: Boolean(d.bayarTunai),
    confidence: typeof d.confidence === 'number' ? d.confidence : 95,
    psm: 'vlm',
    fotoBuram: Boolean(d.fotoBuram),
  }
}

/**
 * Entry point utama pemindaian dokumen keuangan / struk dengan arsitektur Adaptive Multi-Tier.
 *
 * @param {File|Blob} file
 * @param {object} options
 * @param {'auto'|'gemini'|'ppocr'|'local'|'unlimited'} [options.engine] Mode engine OCR
 * @param {string} [options.geminiApiKey] Kunci API Gemini manual (opsional)
 * @param {string} [options.endpoint] URL server Unlimited-OCR (opsional)
 * @param {'gundam'|'base'} [options.cropMode] Mode potongan citra Unlimited-OCR
 * @param {number} [options.timeoutMs] Batas waktu panggil server (default: 30000ms)
 * @param {(p: number) => void} [options.onProgress] Callback progres (0..1)
 * @returns {Promise<object>} Skema hasil terstruktur MyDuit
 */
export async function scanDokumenKeuangan(file, options = {}) {
  const cfg = bacaOcrConfig()
  const engine = options.engine || cfg.engine || 'auto'
  const endpoint = options.endpoint || cfg.endpoint || DEFAULT_OCR_ENDPOINT
  const cropMode = options.cropMode || cfg.cropMode || 'gundam'
  const geminiKey = (options.geminiApiKey || bacaGeminiKey()).trim()
  const timeoutMs = options.timeoutMs || DEFAULT_OCR_TIMEOUT_MS
  const onProgress = options.onProgress

  // Mode 1: Eksklusif Gemini Flash Vision
  if (engine === 'gemini') {
    return await panggilGeminiVision(file, geminiKey, { onProgress })
  }

  // Mode 2: Legacy alias 'ppocr' -> transparan ke Tesseract Gundam-Enhanced
  if (engine === 'ppocr') {
    return await bacaStrukPpOcr(file, onProgress)
  }

  // Mode 3: Eksklusif Tesseract Lokal (dengan Gundam Dynamic Tiling & N-Gram Dedup)
  if (engine === 'local') {
    const hasilLokal = await bacaStruk(file, onProgress)
    return {
      ...hasilLokal,
      engine: hasilLokal.modeProses === 'gundam' ? 'tesseract-gundam' : 'tesseract-local',
    }
  }

  // Mode 4: Eksklusif Unlimited-OCR Server (SGLang OpenAI / FastAPI Bridge)
  if (engine === 'unlimited') {
    onProgress?.(0.15)
    try {
      const serverRes = await panggilUnlimitedOcrApi(file, endpoint, { timeoutMs, cropMode })
      onProgress?.(1.0)
      return normalisasiHasilUnlimited(serverRes)
    } catch (err) {
      throw new Error(`Koneksi Unlimited-OCR gagal: ${err.message}. Pastikan server menyala di ${endpoint}`)
    }
  }

  // Mode 5: 'auto' (Orkestrasi Cerdas Multi-Tier)
  // Tahap A: Jika endpoint Unlimited-OCR eksplisit dikonfigurasi dan aktif -> pakai Unlimited-OCR terlebih dulu
  if (cfg.hasCustomEndpoint || options.endpoint) {
    try {
      const statusSrv = await cekStatusUnlimitedOcr(endpoint, 1200)
      if (statusSrv.online && statusSrv.modelReady !== false) {
        onProgress?.(0.15)
        const serverRes = await panggilUnlimitedOcrApi(file, endpoint, {
          timeoutMs,
          cropMode,
          status: statusSrv,
        })
        onProgress?.(1.0)
        return normalisasiHasilUnlimited(serverRes)
      }
    } catch (err) {
      console.warn('[ocr-provider] Unlimited-OCR gagal/offline, beralih ke tier berikutnya:', err.message)
    }
  }

  // Tahap B: Jika ada Kunci Gemini dan perangkat online -> Prioritaskan Gemini Flash Vision
  const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false
  if (geminiKey && isOnline) {
    try {
      onProgress?.(0.1)
      const resGemini = await panggilGeminiVision(file, geminiKey, { onProgress })
      return resGemini
    } catch (err) {
      console.warn('[ocr-provider] Gemini gagal atau timeout, beralih ke engine on-device:', err.message)
    }
  }

  // Tahap C: Fallback Terakhir — Tesseract Lokal + Gundam Dynamic Tiling + R-SWA + N-Gram Dedup
  const hasilLokal = await bacaStruk(file, onProgress)
  return {
    ...hasilLokal,
    engine: hasilLokal.modeProses === 'gundam' ? 'tesseract-gundam' : 'tesseract-local',
    fallbackReason: 'auto_fallback_tesseract',
  }
}
