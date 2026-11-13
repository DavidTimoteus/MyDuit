/**
 * puterOcr.js — Adapter Serverless Free Unlimited OCR API via Puter.js (`puter.ai.img2txt`).
 *
 * Referensi resmi: https://developer.puter.com/tutorials/free-unlimited-ocr-api/
 * Keunggulan:
 *  - Tanpa API Key & tanpa backend/GPU lokal — berjalan langsung di browser Desktop maupun Mobile.
 *  - Mendukung provider Mistral OCR (tabel Markdown & layout kompleks) serta AWS Textract.
 *  - Lazy-loaded via `@heyputer/puter.js` agar tidak membebani cold start aplikasi offline.
 */

import { kompresCitraAman } from './ocrStruk.js'

export const STORAGE_KEY_PUTER_PROVIDER = 'myduit_ocr_puter_provider'
export const DEFAULT_PUTER_PROVIDER = 'mistral'
export const PUTER_PROVIDERS = ['mistral', 'aws-textract']

let sdkPromise = null

/**
 * Baca pilihan provider Puter OCR dari LocalStorage ('mistral' | 'aws-textract').
 * @returns {'mistral'|'aws-textract'}
 */
export function bacaPuterProvider() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = window.localStorage.getItem(STORAGE_KEY_PUTER_PROVIDER)
      if (PUTER_PROVIDERS.includes(val)) return val
    }
  } catch {
    /* abaikan */
  }
  return DEFAULT_PUTER_PROVIDER
}

/**
 * Simpan preferensi provider Puter OCR.
 * @param {'mistral'|'aws-textract'} provider
 */
export function simpanPuterProvider(provider) {
  if (!PUTER_PROVIDERS.includes(provider)) return
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY_PUTER_PROVIDER, provider)
    }
  } catch {
    /* abaikan */
  }
}

/**
 * Muat SDK `@heyputer/puter.js` secara lazy (atau pakai instance injeksi/global bila tersedia).
 * @param {object} [customPuter]
 */
export async function muatPuterSdk(customPuter) {
  if (customPuter) return customPuter
  if (typeof globalThis !== 'undefined' && globalThis.puter?.ai?.img2txt) {
    globalThis.puter.quiet = true
    return globalThis.puter
  }
  if (!sdkPromise) {
    sdkPromise = import('@heyputer/puter.js')
      .then((mod) => {
        const inst = mod?.default || mod?.puter || globalThis.puter
        if (!inst?.ai?.img2txt) {
          throw new Error('Modul Puter OCR (ai.img2txt) tidak tersedia.')
        }
        inst.quiet = true
        return inst
      })
      .catch((err) => {
        sdkPromise = null
        throw err
      })
  }
  return sdkPromise
}

/**
 * Cek cepat tanpa memuat SDK apakah sesi Puter sudah terautentikasi di memory browser.
 */
export function apakahPuterAktifDiSesi() {
  try {
    return Boolean(globalThis?.puter?.auth?.isSignedIn?.())
  } catch {
    return false
  }
}

/**
 * Cek status koneksi online & kesiapan autentikasi Puter OCR.
 */
export async function cekStatusPuterOcr(customPuter) {
  const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false
  if (!isOnline) {
    return { online: false, ready: false, signedIn: false, provider: bacaPuterProvider() }
  }
  try {
    const puter = await muatPuterSdk(customPuter)
    const signedIn = Boolean(await puter.auth?.isSignedIn?.())
    return {
      online: true,
      ready: true,
      signedIn,
      provider: bacaPuterProvider(),
    }
  } catch (err) {
    return {
      online: true,
      ready: false,
      signedIn: false,
      provider: bacaPuterProvider(),
      error: err?.message || 'Gagal memuat SDK Puter.js',
    }
  }
}

/**
 * Hubungkan akun Puter pengguna (dipicu klik tombol eksplisit agar aman dari popup-blocker).
 */
export async function sambungkanPuterOcr(customPuter) {
  const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false
  if (!isOnline) {
    throw new Error('Koneksi internet dibutuhkan untuk menghubungkan Puter Unlimited OCR.')
  }
  const puter = await muatPuterSdk(customPuter)
  if (typeof puter.auth?.isSignedIn === 'function' && (await puter.auth.isSignedIn())) {
    const user = typeof puter.auth?.getUser === 'function' ? await puter.auth.getUser().catch(() => null) : null
    return { signedIn: true, username: user?.username || '' }
  }
  if (typeof puter.auth?.signIn !== 'function') {
    throw new Error('Fungsi autentikasi Puter tidak tersedia.')
  }
  await puter.auth.signIn()
  const signedIn = Boolean(await puter.auth?.isSignedIn?.())
  const user = signedIn && typeof puter.auth?.getUser === 'function'
    ? await puter.auth.getUser().catch(() => null)
    : null
  return { signedIn, username: user?.username || '' }
}

/**
 * Ekstrak string teks/Markdown mentah dari berbagai bentuk respons `puter.ai.img2txt`.
 */
export function ekstrakTeksDariResponsPuter(res) {
  if (typeof res === 'string') return res.trim()
  if (!res || typeof res !== 'object') return ''
  if (typeof res.markdown === 'string' && res.markdown.trim()) return res.markdown.trim()
  if (typeof res.text === 'string' && res.text.trim()) return res.text.trim()
  if (typeof res.content === 'string' && res.content.trim()) return res.content.trim()
  if (Array.isArray(res.pages) && res.pages.length > 0) {
    return res.pages
      .map((p) => (typeof p === 'string' ? p : p?.markdown || p?.text || ''))
      .filter(Boolean)
      .join('\n\n')
      .trim()
  }
  if (typeof res.message?.content === 'string') return res.message.content.trim()
  return ''
}

/**
 * Jalankan Free Unlimited OCR API menggunakan `puter.ai.img2txt`.
 * Otomatis mengompres citra kamera beresolusi tinggi sebelum upload dan
 * melakukan fallback antar provider Puter (`mistral` <-> `aws-textract`) bila diperlukan.
 *
 * @param {File|Blob|string} file
 * @param {object} [options]
 * @param {'mistral'|'aws-textract'} [options.provider]
 * @param {(p: number) => void} [options.onProgress]
 * @param {object} [options.puterInstance]
 */
export async function panggilPuterOcr(file, options = {}) {
  const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false
  if (!isOnline) {
    throw new Error('Puter Unlimited OCR membutuhkan koneksi internet.')
  }

  const providerDipilih = PUTER_PROVIDERS.includes(options.provider)
    ? options.provider
    : bacaPuterProvider()

  options.onProgress?.(0.15)
  const puter = await muatPuterSdk(options.puterInstance)

  options.onProgress?.(0.3)
  let sumberSiap = file
  if (typeof document !== 'undefined' && typeof file === 'object' && file?.type?.startsWith?.('image/')) {
    sumberSiap = await kompresCitraAman(file, 1800, 0.88)
  }

  const urutanProvider = providerDipilih === 'mistral' ? ['mistral', 'aws-textract'] : ['aws-textract', 'mistral']
  let lastError = null

  for (const prov of urutanProvider) {
    try {
      options.onProgress?.(prov === urutanProvider[0] ? 0.55 : 0.75)
      const args = {
        source: sumberSiap,
        provider: prov,
      }
      if (prov === 'mistral') args.tableFormat = 'markdown'

      const res = await puter.ai.img2txt(args)
      const teksMentah = ekstrakTeksDariResponsPuter(res)
      if (!teksMentah) {
        throw new Error(`Respons Puter (${prov}) tidak memuat teks.`)
      }
      options.onProgress?.(0.95)
      return {
        teksMentah,
        provider: prov,
      }
    } catch (err) {
      lastError = err
      const msg = String(err?.message || err || '').toLowerCase()
      // Jangan coba ulang provider lain bila user membatalkan login / popup diblokir
      if (msg.includes('cancel') || msg.includes('closed') || msg.includes('abort')) {
        throw new Error(err?.message || 'Autentikasi Puter dibatalkan.')
      }
    }
  }

  throw new Error(lastError?.message || 'Gagal memproses gambar dengan Puter Unlimited OCR.')
}

