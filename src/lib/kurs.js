// Engine konversi mata uang global (*Money Changer*) dengan pembaruan kurs live & cache offline.

export const EVENT_KURS = 'myduit:kurs-update'
const STORAGE_KURS_CACHE = 'myduit:kurs_cache'
const STORAGE_BASIS_LOKAL = 'myduit:kurs_basis'
const TTL_SEGAR_MS = 30_000

// Tabel cadangan offline berbasis 1 USD bila belum pernah tersambung internet sama sekali.
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
  }
}

/**
 * Mengembalikan mata uang dasar tempat angka Firestore/Demo akun saat ini disimpan.
 * Mengembalikan `null` jika belum diinisialisasi (berguna agar formatter/test murni memakai rasio 1).
 */
export function bacaBasisMataUang() {
  if (_basisCache !== undefined) return _basisCache
  const s = bacaStorageAman(STORAGE_BASIS_LOKAL)
  if (s && /^[A-Z]{3}$/.test(s)) {
    _basisCache = s
    return _basisCache
  }
  _basisCache = null
  return null
}

export function simpanBasisMataUang(currency) {
  const code = String(currency || '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) return null
  _basisCache = code
  tulisStorageAman(STORAGE_BASIS_LOKAL, code)
  emitEventKurs()
  return code
}

export function resetBasisMataUang() {
  _basisCache = null
  tulisStorageAman(STORAGE_BASIS_LOKAL, null)
}

export function emitEventKurs() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new CustomEvent(EVENT_KURS, { detail: statusKurs() }))
  } catch {
    // Abaikan di environment non-DOM
  }
}

export function ambilRasioKurs(dari, ke) {
  const a = String(dari || '').trim().toUpperCase()
  const b = String(ke || '').trim().toUpperCase()
  if (!a || !b || a === b) return 1
  const { rates } = muatCacheKurs()
  const rA = Number(rates[a])
  const rB = Number(rates[b])
  if (!Number.isFinite(rA) || rA <= 0 || !Number.isFinite(rB) || rB <= 0) return 1
  return rB / rA
}

export function konversiNilai(nominal, dari, ke) {
  const n = Number(nominal)
  if (!Number.isFinite(n) || n === 0) return 0
  return n * ambilRasioKurs(dari, ke)
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
  _inflight = null
}

