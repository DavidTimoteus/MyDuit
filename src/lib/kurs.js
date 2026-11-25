// Engine konversi mata uang global (*Money Changer*) dengan pembaruan kurs live & cache offline.

export const EVENT_KURS = 'myduit:kurs-update'
export const EVENT_BASIS_MATA_UANG = 'myduit:basis-update'
const STORAGE_KURS_CACHE = 'myduit:kurs_cache'
const STORAGE_BASIS_LOKAL = 'myduit:kurs_basis'
const STORAGE_KUNCI_BASIS = 'myduit:kurs_terkunci'
const TTL_SEGAR_MS = 30_000

// Tabel cadangan offline berbasis 1 USD bila belum pernah tersambung internet sama sekali.
// Nilai di sini PERKIRAAN (Nov 2026) — hanya jaring pengaman offline; kurs live
// selalu menang begitu perangkat tersambung. Daftar ini JUGA adalah whitelist:
// mata uang yang tidak ada di sini (dan tidak ada di cache kurs live) TIDAK BOLEH
// dipakai sebagai basis — dulu CLP/ISK diterima sebagai basis padahal tak ada
// kursnya, lalu konversi diam-diam memakai rasio 1 (CLP 95.000 tampil "US$ 95.000").
export const KURS_CADANGAN_USD = {
  USD: 1,
  IDR: 16800,
  SGD: 1.34,
  MYR: 4.45,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 154,
  AUD: 1.54,
  NZD: 1.69,
  CAD: 1.40,
  PHP: 58.2,
  THB: 34.5,
  VND: 25450,
  INR: 86.5,
  KRW: 1410,
  CNY: 7.25,
  HKD: 7.78,
  TWD: 32.4,
  LKR: 295,
  BDT: 120,
  PKR: 279,
  NPR: 138,
  CHF: 0.88,
  SAR: 3.75,
  AED: 3.67,
  BND: 1.34,
  // Mata uang besar lain yang sebelumnya "diterima tapi tanpa kurs":
  CLP: 950,
  ISK: 128,
  BRL: 5.4,
  MXN: 17.2,
  ZAR: 17.9,
  TRY: 41.5,
  PLN: 3.65,
  CZK: 21.2,
  HUF: 332,
  ILS: 3.25,
  EGP: 48,
  NGN: 1520,
  KES: 129,
  COP: 4050,
  PEN: 3.5,
  ARS: 1380,
  RUB: 82,
  UAH: 41.5,
  RON: 4.45,
  SEK: 9.4,
  NOK: 10.2,
  DKK: 6.45,
  QAR: 3.64,
  KWD: 0.305,
  BHD: 0.377,
  OMR: 0.385,
  MMK: 2100,
  KHR: 4000,
  LAK: 21500,
  MOP: 8.0,
}

const MATA_UANG_NOL_DESIMAL = new Set(['IDR', 'JPY', 'VND', 'KRW', 'CLP', 'ISK'])

export function desimalMataUang(currency) {
  return MATA_UANG_NOL_DESIMAL.has(String(currency || '').toUpperCase()) ? 0 : 2
}

function bacaStorageAman(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function tulisStorageAman(key, val) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    if (val === null || val === undefined) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, String(val))
  } catch {
    // Abaikan error quota/mode privat
  }
}

let _cacheKurs = null
let _basisCache = undefined
let _basisTerkunci = false
let _inflight = null

function muatCacheKurs() {
  if (_cacheKurs) return _cacheKurs
  const raw = bacaStorageAman(STORAGE_KURS_CACHE)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.rates === 'object' && parsed.rates.IDR > 0) {
        _cacheKurs = {
          rates: { ...KURS_CADANGAN_USD, ...parsed.rates, USD: 1 },
          source: parsed.source || 'cache-lokal',
          fetchedAt: Number(parsed.fetchedAt) || 0,
          isFallback: Boolean(parsed.isFallback),
        }
        return _cacheKurs
      }
    } catch {
      // Cache korup, pakai cadangan
    }
  }
  _cacheKurs = {
    rates: { ...KURS_CADANGAN_USD },
    source: 'cadangan-offline',
    fetchedAt: 0,
    isFallback: true,
  }
  return _cacheKurs
}

export function statusKurs() {
  const c = muatCacheKurs()
  return {
    rates: c.rates,
    source: c.source,
    fetchedAt: c.fetchedAt,
    isFallback: c.isFallback,
    basis: bacaBasisMataUang(),
    terkunci: bacaStatusBasis().terkunci,
  }
}

export function bacaStatusBasis() {
  // Kunci ikut dibaca dari storage: di sesi baru _basisTerkunci (memori) masih
  // false sebelum inisialisasi, padahal basis sudah dikunci di sesi sebelumnya.
  return {
    basis: bacaBasisMataUang(),
    terkunci: _basisTerkunci || bacaStorageAman(STORAGE_KUNCI_BASIS) === '1',
  }
}

/**
 * Mengembalikan mata uang dasar tempat angka Firestore/Demo akun saat ini disimpan.
 * Mengembalikan `null` jika belum diinisialisasi (berguna agar formatter/test murni memakai rasio 1).
 */
export function bacaBasisMataUang() {
  if (_basisCache !== undefined) return _basisCache
  const s = bacaStorageAman(STORAGE_BASIS_LOKAL)
  // Basis tersimpan yang tidak punya kurs (data lama/corrupt) diperlakukan
  // sebagai belum diinisialisasi — jangan pernah mengembalikannya sebagai basis.
  if (s && /^[A-Z]{3}$/.test(s) && mataUangDidukung(s)) {
    _basisCache = s
    return _basisCache
  }
  _basisCache = null
  return null
}

/**
 * Apakah kode mata uang punya kurs yang bisa dipakai? Didukung = ada di tabel
 * cadangan offline ATAU ada di cache kurs live (mis. mata uang di luar tabel
 * yang kursnya sudah pernah diunduh). Selain itu -> tidak didukung.
 */
export function mataUangDidukung(currency) {
  const code = String(currency || '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) return false
  if (Object.prototype.hasOwnProperty.call(KURS_CADANGAN_USD, code)) return true
  const { rates } = muatCacheKurs()
  return Number.isFinite(Number(rates?.[code])) && Number(rates[code]) > 0
}

export function simpanBasisMataUang(currency, { terkunci = true } = {}) {
  const code = String(currency || '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) return null
  // Fail-closed: jangan simpan basis yang tidak punya kurs. Sebelumnya kode
  // apa pun diterima, lalu semua konversi memakai rasio 1 secara diam-diam.
  if (!mataUangDidukung(code)) return null
  _basisCache = code
  _basisTerkunci = Boolean(terkunci)
  tulisStorageAman(STORAGE_BASIS_LOKAL, code)
  tulisStorageAman(STORAGE_KUNCI_BASIS, _basisTerkunci ? '1' : '0')
  emitEventBasis()
  emitEventKurs()
  return code
}

export function resetBasisMataUang() {
  _basisCache = null
  _basisTerkunci = false
  tulisStorageAman(STORAGE_BASIS_LOKAL, null)
  tulisStorageAman(STORAGE_KUNCI_BASIS, null)
  emitEventBasis()
}

export function emitEventBasis() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new CustomEvent(EVENT_BASIS_MATA_UANG, { detail: bacaStatusBasis() }))
  } catch {
    // Abaikan di environment non-DOM
  }
}

export function emitEventKurs() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new CustomEvent(EVENT_KURS, { detail: statusKurs() }))
  } catch {
    // Abaikan di environment non-DOM
  }
}

/**
 * Membersihkan/validasi payload snapshot kurs historis agar aman disimpan ke Firestore
 * maupun dipulihkan dari file backup eksternal.
 */
export function sanitasiKursSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const basis = String(raw.basis || '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(basis)) return null
  const rawRates = raw.usdKe && typeof raw.usdKe === 'object' ? raw.usdKe : null
  if (!rawRates) return null

  const usdKe = {}
  let jumlah = 0
  for (const [k, v] of Object.entries(rawRates)) {
    // Batas 80: tabel cadangan kini 56 entri; batas lama (40) bisa membuang
    // basis dari snapshot bila basis itu urutannya belakangan.
    if (jumlah >= 80) break
    const code = String(k || '').trim().toUpperCase()
    const num = Number(v)
    if (/^[A-Z]{3}$/.test(code) && Number.isFinite(num) && num > 0 && num < 1e12) {
      usdKe[code] = num
      jumlah++
    }
  }
  if (!usdKe.USD) usdKe.USD = 1
  if (!usdKe[basis]) return null

  return {
    basis,
    usdKe,
    tanggal: String(raw.tanggal || '').slice(0, 20),
    sumber: String(raw.sumber || '').slice(0, 60),
  }
}

/**
 * Membentuk snapshot kurs ringan secara sinkron dari cache aktif saat transaksi dicatat,
 * agar pencatatan historis tetap mempertahankan nilai konversinya walau kurs esok berubah.
 */
export function buatSnapshotKurs(basis = bacaBasisMataUang() || 'IDR', tanggal = '') {
  const { rates, source } = muatCacheKurs()
  const kodeBasis = /^[A-Z]{3}$/.test(String(basis || '').toUpperCase())
    ? String(basis).toUpperCase()
    : 'IDR'
  const usdKe = {}
  for (const k of Object.keys(KURS_CADANGAN_USD)) {
    const val = Number(rates[k] ?? KURS_CADANGAN_USD[k])
    if (Number.isFinite(val) && val > 0) usdKe[k] = val
  }
  if (!usdKe[kodeBasis]) {
    const r = Number(rates[kodeBasis])
    if (Number.isFinite(r) && r > 0) usdKe[kodeBasis] = r
  }
  usdKe.USD = 1
  const tgl = tanggal && /^\d{4}-\d{2}-\d{2}$/.test(tanggal)
    ? tanggal
    : new Date().toISOString().slice(0, 10)
  return {
    basis: kodeBasis,
    usdKe,
    tanggal: tgl,
    sumber: String(source || 'cadangan-offline').slice(0, 60),
  }
}

export function ambilRasioKurs(dari, ke, kursSnapshot = null) {
  const a = String(dari || '').trim().toUpperCase()
  const b = String(ke || '').trim().toUpperCase()
  if (!a || !b || a === b) return 1
  if (kursSnapshot && typeof kursSnapshot === 'object') {
    const mapSnap = kursSnapshot.usdKe || kursSnapshot.rates || kursSnapshot
    const sA = Number(mapSnap?.[a])
    const sB = Number(mapSnap?.[b])
    if (Number.isFinite(sA) && sA > 0 && Number.isFinite(sB) && sB > 0) {
      return sB / sA
    }
  }
  const { rates } = muatCacheKurs()
  const rA = Number(rates[a])
  const rB = Number(rates[b])
  // JANGAN pernah mengembalikan 1 untuk kurs yang tidak diketahui — itu
  // membuat CLP 95.000 tampil sebagai "US$ 95.000". Kembalikan NaN supaya
  // pemanggil yang jujur menanganinya (batas UI: rasioKursTampil di format.js).
  if (!Number.isFinite(rA) || rA <= 0 || !Number.isFinite(rB) || rB <= 0) return NaN
  return rB / rA
}

export function konversiNilai(nominal, dari, ke, kursSnapshot = null) {
  const n = Number(nominal)
  if (!Number.isFinite(n) || n === 0) return 0
  return n * ambilRasioKurs(dari, ke, kursSnapshot)
}

async function fetchJsonTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

function normalisasiMapKurs(rawMap) {
  if (!rawMap || typeof rawMap !== 'object') return null
  const out = {}
  for (const [k, v] of Object.entries(rawMap)) {
    const code = String(k || '').trim().toUpperCase()
    const num = Number(v)
    if (/^[A-Z]{3}$/.test(code) && Number.isFinite(num) && num > 0) {
      out[code] = num
    }
  }
  out.USD = 1
  if (!out.IDR || !out.SGD || !out.EUR) return null
  // Gabungkan di atas cadangan agar mata uang langka tetap terjamin tersedia
  return { ...KURS_CADANGAN_USD, ...out }
}

const PENYEDIA_KURS = [
  {
    nama: 'open.er-api.com',
    ambil: async () => {
      const json = await fetchJsonTimeout('https://open.er-api.com/v6/latest/USD')
      return normalisasiMapKurs(json?.rates)
    },
  },
  {
    nama: 'currency-api (jsDelivr)',
    ambil: async () => {
      const json = await fetchJsonTimeout(
        'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
      )
      return normalisasiMapKurs(json?.usd)
    },
  },
  {
    nama: 'frankfurter.dev',
    ambil: async () => {
      const json = await fetchJsonTimeout('https://api.frankfurter.dev/v1/latest?base=USD')
      return normalisasiMapKurs(json?.rates)
    },
  },
]

/**
 * Mengambil kurs global terbaru bila perangkat tersambung internet.
 * Menggunakan request coalescing dan menyimpan cache terakhir untuk mode offline.
 */
export async function segarkanKursGlobal({ paksa = false, penyedia = PENYEDIA_KURS } = {}) {
  const sekarang = Date.now()
  const cache = muatCacheKurs()
  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false

  if (!online) {
    return { ...statusKurs(), updated: false, reason: 'offline' }
  }
  if (!paksa && !cache.isFallback && sekarang - cache.fetchedAt < TTL_SEGAR_MS) {
    return { ...statusKurs(), updated: false, reason: 'fresh' }
  }
  if (_inflight) return _inflight

  _inflight = (async () => {
    for (const p of penyedia) {
      try {
        const rates = await p.ambil()
        if (rates) {
          _cacheKurs = {
            rates,
            source: p.nama,
            fetchedAt: Date.now(),
            isFallback: false,
          }
          tulisStorageAman(STORAGE_KURS_CACHE, JSON.stringify(_cacheKurs))
          emitEventKurs()
          return { ...statusKurs(), updated: true }
        }
      } catch {
        // Lanjut ke penyedia berikutnya
      }
    }
    return { ...statusKurs(), updated: false, reason: 'network-error' }
  })().finally(() => {
    _inflight = null
  })

  return _inflight
}

// Untuk kebutuhan pengujian agar state modul bisa di-reset antar skenario test.
export function _resetCacheKursUntukUji() {
  _cacheKurs = null
  _basisCache = undefined
  _basisTerkunci = false
  _inflight = null
}

