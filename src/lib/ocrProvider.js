/**
 * ocrProvider.js — Abstraksi Provider OCR Hibrida Tri-Tier MyDuit.
 *
 * Mengimplementasikan arsitektur Tri-Tier Adaptive Vision:
 *  - Tier 1 (Cloud AI Super Akurat): Google Gemini 2.0 / 1.5 Flash Vision API (BYOK gratis).
 *  - Tier 2 (On-Device Neural AI): PP-OCRv4 Mobile via ONNX Runtime Web.
 *  - Tier 3 (Client Standalone 100% Offline): Tesseract.js yang disempurnakan dengan
 *    R-SWA Sliding Window Lookahead dan filter citra CLAHE + Unsharp Mask.
 *  - Opsional (Microservice): Unlimited-OCR server lokal (jika pengguna mengaktifkan).
 */

import { bacaStruk } from './ocrStruk.js'
import { petakanKategori } from './strukMeta.js'
import { bacaStrukPpOcr } from './ppocrProvider.js'
import {
  bacaGeminiKey,
  simpanGeminiKey,
  hapusGeminiKey,
  ujiKoneksiGemini,
  panggilGeminiVision,
} from './geminiOcr.js'

export { bacaGeminiKey, simpanGeminiKey, hapusGeminiKey, ujiKoneksiGemini }

export const DEFAULT_OCR_ENDPOINT = 'http://127.0.0.1:8000'
export const DEFAULT_OCR_TIMEOUT_MS = 5000

const STORAGE_KEY_ENGINE = 'myduit_ocr_engine'
const STORAGE_KEY_ENDPOINT = 'myduit_ocr_endpoint'

/**
 * Baca konfigurasi OCR aktif dari LocalStorage.
 * @returns {{ engine: 'auto'|'gemini'|'ppocr'|'local'|'unlimited', endpoint: string, hasGeminiKey: boolean }}
 */
export function bacaOcrConfig() {
  let engine = 'auto'
  let endpoint = DEFAULT_OCR_ENDPOINT
  let hasGeminiKey = false

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      engine = window.localStorage.getItem(STORAGE_KEY_ENGINE) || 'auto'
      endpoint = window.localStorage.getItem(STORAGE_KEY_ENDPOINT) || DEFAULT_OCR_ENDPOINT
      hasGeminiKey = Boolean(bacaGeminiKey())
    }
  } catch {
    /* abaikan */
  }
  return { engine, endpoint, hasGeminiKey }
}

/**
 * Simpan konfigurasi preferensi engine dan endpoint OCR.
 * @param {{ engine?: 'auto'|'gemini'|'ppocr'|'local'|'unlimited', endpoint?: string }} config
 */
export function simpanOcrConfig(config = {}) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (config.engine) window.localStorage.setItem(STORAGE_KEY_ENGINE, config.engine)
      if (config.endpoint) window.localStorage.setItem(STORAGE_KEY_ENDPOINT, config.endpoint)
    }
  } catch {
    /* abaikan */
  }
}

/**
 * Cek status ketersediaan endpoint Unlimited-OCR secara non-blocking.
 * @param {string} endpoint
 * @param {number} timeoutMs
 * @returns {Promise<{ online: boolean, engine?: string, version?: string, device?: string }>}
 */
export async function cekStatusUnlimitedOcr(endpoint = DEFAULT_OCR_ENDPOINT, timeoutMs = 2000) {
  try {
    const cleanUrl = endpoint.replace(/\/+$/, '')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(`${cleanUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    clearTimeout(timer)

    if (res.ok) {
      const data = await res.json()
      return {
        online: true,
        engine: data.engine || 'Unlimited-OCR',
        version: data.version || '1.0.0',
        device: data.device || 'unknown',
      }
    }
    return { online: false }
  } catch {
    return { online: false }
  }
}

/**
 * Kirim file gambar ke API Unlimited-OCR.
 * @param {File|Blob} file
 * @param {string} endpoint
 * @param {number} timeoutMs
 */
async function panggilUnlimitedOcrApi(file, endpoint, timeoutMs = DEFAULT_OCR_TIMEOUT_MS) {
  const cleanUrl = endpoint.replace(/\/+$/, '')
  const formData = new FormData()
  formData.append('file', file)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${cleanUrl}/api/v1/parse-receipt`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    clearTimeout(timer)

    if (!res.ok) {
      throw new Error(`Server OCR merespons HTTP ${res.status}: ${res.statusText}`)
    }
    return await res.json()
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

/**
 * Normalisasi respons dari server Unlimited-OCR ke skema terpadu MyDuit.
 */
function normalisasiHasilUnlimited(resData) {
  const d = resData?.data || resData || {}
  const total = typeof d.total === 'number' ? d.total : d.total ? Number(d.total) : null
  const barang = Array.isArray(d.barang) ? d.barang : []
  const merchant = d.merchant || ''
  const jenis = d.jenis === 'pemasukan' ? 'pemasukan' : 'pengeluaran'

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
    engine: 'unlimited-ocr',
    teks: d.teks || '',
    markdown: d.markdown || '',
    total,
    totalSumber: d.totalSumber || (total ? `Total Rp ${total.toLocaleString('id-ID')}` : null),
    tanggal: d.tanggal || null,
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
 * Entry point utama pemindaian dokumen keuangan / struk dengan arsitektur Tri-Tier.
 *
 * @param {File|Blob} file
 * @param {object} options
 * @param {'auto'|'gemini'|'ppocr'|'local'|'unlimited'} [options.engine] Mode engine OCR
 * @param {string} [options.geminiApiKey] Kunci API Gemini manual (opsional)
 * @param {string} [options.endpoint] URL server Unlimited-OCR (opsional)
 * @param {number} [options.timeoutMs] Batas waktu panggil server (default: 5000ms)
 * @param {(p: number) => void} [options.onProgress] Callback progres (0..1)
 * @returns {Promise<object>} Skema hasil terstruktur MyDuit
 */
export async function scanDokumenKeuangan(file, options = {}) {
  const cfg = bacaOcrConfig()
  const engine = options.engine || cfg.engine || 'auto'
  const endpoint = options.endpoint || cfg.endpoint || DEFAULT_OCR_ENDPOINT
  const geminiKey = (options.geminiApiKey || bacaGeminiKey()).trim()
  const timeoutMs = options.timeoutMs || DEFAULT_OCR_TIMEOUT_MS
  const onProgress = options.onProgress

  // Mode 1: Eksklusif Gemini Flash Vision
  if (engine === 'gemini') {
    return await panggilGeminiVision(file, geminiKey, { onProgress })
  }

  // Mode 2: Eksklusif PP-OCRv4 Mobile On-Device
  if (engine === 'ppocr') {
    return await bacaStrukPpOcr(file, onProgress)
  }

  // Mode 3: Eksklusif Tesseract Lokal
  if (engine === 'local') {
    const hasilLokal = await bacaStruk(file, onProgress)
    return { ...hasilLokal, engine: 'tesseract-local' }
  }

  // Mode 4: Eksklusif Unlimited-OCR Server
  if (engine === 'unlimited') {
    onProgress?.(0.15)
    try {
      const serverRes = await panggilUnlimitedOcrApi(file, endpoint, timeoutMs)
      onProgress?.(1.0)
      return normalisasiHasilUnlimited(serverRes)
    } catch (err) {
      throw new Error(`Koneksi Unlimited-OCR gagal: ${err.message}. Pastikan server menyala di ${endpoint}`)
    }
  }

  // Mode 5: 'auto' (Orkestrasi Cerdas Tri-Tier)
  // Tahap A: Jika ada Kunci Gemini dan perangkat online -> Prioritaskan Gemini Vision (>99% akurat)
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

  // Tahap B: Coba PP-OCRv4 Mobile On-Device
  try {
    onProgress?.(0.2)
    const resPp = await bacaStrukPpOcr(file, onProgress)
    return resPp
  } catch (err) {
    console.warn('[ocr-provider] PP-OCR gagal, beralih ke Tesseract lokal:', err.message)
  }

  // Tahap C: Fallback Terakhir — Tesseract Lokal + R-SWA + CLAHE
  const hasilLokal = await bacaStruk(file, onProgress)
  return {
    ...hasilLokal,
    engine: 'tesseract-local',
    fallbackReason: 'auto_fallback_tesseract',
  }
}
