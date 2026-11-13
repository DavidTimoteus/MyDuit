/**
 * ocrProvider.js — Abstraksi Provider OCR Hibrida Tri-Tier MyDuit.
 *
 * Mengimplementasikan arsitektur Adaptive Multi-Tier:
 *  - Free Unlimited OCR (Puter.js `puter.ai.img2txt`): Mistral OCR & AWS Textract
 *    serverless langsung di browser Desktop maupun Mobile tanpa API Key.
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
import { parseAngkaEksternal } from './format.js'
import {
  bacaGeminiKey,
  simpanGeminiKey,
  hapusGeminiKey,
  ujiKoneksiGemini,
  panggilGeminiVision,
} from './geminiOcr.js'
import {
  PUTER_PROVIDERS,
  DEFAULT_PUTER_PROVIDER,
  bacaPuterProvider,
  simpanPuterProvider,
  muatPuterSdk,
  apakahPuterAktifDiSesi,
  cekStatusPuterOcr,
  sambungkanPuterOcr,
  panggilPuterOcr,
} from './puterOcr.js'

export {
  bacaGeminiKey,
  simpanGeminiKey,
  hapusGeminiKey,
  ujiKoneksiGemini,
  PUTER_PROVIDERS,
  DEFAULT_PUTER_PROVIDER,
  bacaPuterProvider,
  simpanPuterProvider,
  muatPuterSdk,
  apakahPuterAktifDiSesi,
  cekStatusPuterOcr,
  sambungkanPuterOcr,
}

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
 * @returns {{ engine: 'auto'|'gemini'|'ppocr'|'local'|'unlimited', puterProvider: 'mistral'|'aws-textract', endpoint: string, cropMode: 'gundam'|'base', hasCustomEndpoint: boolean, hasGeminiKey: boolean }}
 */
export function bacaOcrConfig() {
  let engine = 'auto'
  let endpoint = DEFAULT_OCR_ENDPOINT
  let cropMode = 'gundam'
  let hasCustomEndpoint = false
  let hasGeminiKey = false
  const puterProvider = bacaPuterProvider()

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
  return { engine, puterProvider, endpoint, cropMode, hasCustomEndpoint, hasGeminiKey }
}

/**
 * Simpan konfigurasi preferensi engine OCR.
 * @param {{ engine?: 'auto'|'gemini'|'ppocr'|'local'|'unlimited', puterProvider?: 'mistral'|'aws-textract', endpoint?: string, cropMode?: 'gundam'|'base' }} config
 */
export function simpanOcrConfig(config = {}) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (config.engine) window.localStorage.setItem(STORAGE_KEY_ENGINE, config.engine)
      if (config.puterProvider) simpanPuterProvider(config.puterProvider)
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
          hardwareEligible: data.hardware_eligible,
          tier: data.tier || null,
          quantization: data.quantization || null,
          vramGb: typeof data.vram_gb === 'number' ? data.vram_gb : null,
          ramGb: typeof data.ram_gb === 'number' ? data.ram_gb : null,
          reason: data.reason || '',
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
 * Ekstrak item belanja & baris teks polos dari matriks sel tabel (HTML maupun Markdown).
 */
function ekstrakBarisTabelKeBarang(rows) {
  const barang = []
  const plainLines = []
  const skipHeader = /^(no|item|nama|deskripsi|barang|produk|menu|qty|jumlah|harga|subtotal|total)$/i

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const nonEmpty = rows[rIdx].filter(Boolean)
    if (nonEmpty.length === 0) continue
    plainLines.push(nonEmpty.join(' '))

    // Lewati baris header pertama
    if (rIdx === 0 && nonEmpty.every((c) => skipHeader.test(c.trim()))) continue

    // Cari angka terakhir sebagai nominal harga/subtotal bila bukan baris ringkasan total
    const joined = nonEmpty.join(' ')
    if (/^(sub\s*total|total|grand total|pajak|ppn|tax|diskon|tunai|cash|kembali)/i.test(joined)) {
      continue
    }
    const angkaKolom = nonEmpty.map((c) => parseAngkaEksternal(c)).filter((v) => v > 0)
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

  return { plainLines, barang }
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

  const { plainLines, barang } = ekstrakBarisTabelKeBarang(rows)
  return { markdown: md, plainLines, barang }
}

/**
 * Ekstrak item belanja dari tabel pipe Markdown bawaan (mis. keluaran Puter Mistral OCR).
 */
function ekstrakTabelMarkdownKeBarang(teks) {
  const rows = []
  for (const baris of String(teks || '').split(/\r?\n/)) {
    const trim = baris.trim()
    if (!trim.includes('|') || /^\|?[\s:-|]+\|?$/.test(trim)) continue
    const cells = trim
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim())
    if (cells.length >= 2) rows.push(cells)
  }
  if (rows.length === 0) return []
  return ekstrakBarisTabelKeBarang(rows).barang
}

/**
 * Membersihkan keluaran mentah VLM/Cloud OCR (Puter Mistral/Textract maupun Unlimited-OCR):
 *  - Menghapus tag grounding `<|ref|>...<|/ref|>`, `<|det|>[[...]]<|/det|>`, `<PAGE>`, `<BLOCK>`
 *  - Mengonversi HTML `<table>...</table>` & tabel pipe Markdown ke item belanja
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

  // Jika tidak ada HTML <table>, cek apakah keluaran memuat tabel Markdown pipe native
  if (tableItems.length === 0) {
    tableItems.push(...ekstrakTabelMarkdownKeBarang(teksMarkdownBersih))
  }

  // Bentuk teks datar untuk ekstraktor MyDuit (hapus markup heading & separator pipe)
  const teksUntukParser = dedupBarisNgram(
    rekonstruksiTataLetakBaris(
      [
        teksMarkdownBersih
          .replace(/^\|?[\s:-|]+\|?$/gm, '')
          .replace(/^#{1,6}\s+/gm, '')
          .replace(/\*\*/g, '')
          .replace(/\|/g, ' '),
        ...plainTambahan,
      ].join('\n'),
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
 * Entry point utama pemindaian dokumen keuangan / struk dengan arsitektur Adaptive Multi-Tier.
 *
 * @param {File|Blob|string} file
 * @param {object} options
 * @param {'auto'|'gemini'|'ppocr'|'local'|'unlimited'} [options.engine] Mode engine OCR
 * @param {'mistral'|'aws-textract'} [options.puterProvider] Provider Puter OCR
 * @param {object} [options.puterInstance] Injeksi mock/instance Puter untuk pengujian
 * @param {string} [options.geminiApiKey] Kunci API Gemini manual (opsional)
 * @param {(p: number) => void} [options.onProgress] Callback progres (0..1)
 * @returns {Promise<object>} Skema hasil terstruktur MyDuit
 */
export async function scanDokumenKeuangan(file, options = {}) {
  const cfg = bacaOcrConfig()
  const engine = options.engine || cfg.engine || 'auto'
  const puterProvider = options.puterProvider || cfg.puterProvider || DEFAULT_PUTER_PROVIDER
  const geminiKey = (options.geminiApiKey || bacaGeminiKey()).trim()
  const onProgress = options.onProgress

  const jalankanPuterOcr = async () => {
    const puterRes = await panggilPuterOcr(file, {
      provider: puterProvider,
      onProgress,
      puterInstance: options.puterInstance,
    })
    const parsed = parseUnlimitedRawOutput(puterRes.teksMentah)
    onProgress?.(1.0)
    return {
      ...parsed,
      engine: 'puter-ocr',
      puterProvider: puterRes.provider,
      psm: 'cloud-ocr',
    }
  }

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

  // Mode 4: Eksklusif Free Unlimited OCR (Puter.js Mistral / AWS Textract)
  if (engine === 'unlimited') {
    onProgress?.(0.1)
    try {
      return await jalankanPuterOcr()
    } catch (err) {
      throw new Error(`Puter Unlimited OCR gagal: ${err.message}`)
    }
  }

  // Mode 5: 'auto' (Orkestrasi Cerdas Multi-Tier)
  const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false

  // Tahap A: Jika Puter sudah tersambung di sesi & online -> gunakan tanpa memicu popup tak terduga
  if (isOnline && (apakahPuterAktifDiSesi() || options.puterInstance)) {
    try {
      onProgress?.(0.1)
      return await jalankanPuterOcr()
    } catch (err) {
      console.warn('[ocr-provider] Puter OCR gagal, beralih ke tier berikutnya:', err.message)
    }
  }

  // Tahap B: Jika ada Kunci Gemini dan perangkat online -> Prioritaskan Gemini Flash Vision
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

/**
 * Deteksi profil hardware perangkat pengguna saat ini (Mobile/Desktop, RAM, CPU, WebGPU).
 * Dengan Puter.js Free Unlimited OCR, fitur Unlimited OCR berjalan serverless langsung
 * di browser Desktop maupun Mobile tanpa GPU atau API Key.
 *
 * @returns {Promise<{ isMobile: boolean, ramGb: number|null, cpuCores: number|null, hasWebGpu: boolean, unlimitedBrowserDirect: boolean, unlimitedBridgeEligible: boolean, recommendedEngine: 'gemini'|'unlimited'|'local', labelPerangkat: string, ringkasan: string }>}
 */
export async function deteksiKapabilitasPerangkat() {
  const nav = typeof navigator !== 'undefined' ? navigator : null
  const ua = String(nav?.userAgent || '')
  const coarse =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || coarse
  const ramGb = typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : null
  const cpuCores = typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null

  let hasWebGpu = false
  try {
    if (nav?.gpu && typeof nav.gpu.requestAdapter === 'function') {
      const adapter = await nav.gpu.requestAdapter()
      hasWebGpu = Boolean(adapter)
    }
  } catch {
    hasWebGpu = false
  }

  const hasGemini = Boolean(bacaGeminiKey())
  const isOnline = typeof nav === 'undefined' || nav?.onLine !== false
  const recommendedEngine = hasGemini ? 'gemini' : isOnline ? 'unlimited' : 'local'

  const infoBagian = [isMobile ? 'Mobile' : 'Desktop']
  if (ramGb) infoBagian.push(`RAM ${ramGb} GB+`)
  if (cpuCores) infoBagian.push(`${cpuCores} core`)
  infoBagian.push(hasWebGpu ? 'WebGPU aktif' : 'WebGL/WASM')

  const ringkasan =
    'Unlimited OCR (Puter AI) berjalan serverless langsung di browser Desktop maupun Mobile tanpa GPU atau API Key.'

  return {
    isMobile,
    ramGb,
    cpuCores,
    hasWebGpu,
    unlimitedBrowserDirect: true,
    unlimitedBridgeEligible: !isMobile && (ramGb === null || ramGb >= 8),
    recommendedEngine,
    labelPerangkat: infoBagian.join(' · '),
    ringkasan,
  }
}
