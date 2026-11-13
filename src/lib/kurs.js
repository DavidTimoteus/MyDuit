// Engine konversi mata uang global (*Money Changer*) dengan pembaruan kurs live & cache offline.

export const EVENT_KURS = 'myduit:kurs-update'
export const EVENT_BASIS_MATA_UANG = 'myduit:basis-update'
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
    terkunci: _basisTerkunci,
  }
}

export function bacaStatusBasis() {
  return {
    basis: bacaBasisMataUang(),
    terkunci: _basisTerkunci,
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

export function simpanBasisMataUang(currency, { terkunci = true } = {}) {
  const code = String(currency || '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(code)) return null
  _basisCache = code
  _basisTerkunci = Boolean(terkunci)
  tulisStorageAman(STORAGE_BASIS_LOKAL, code)
  emitEventBasis()
  emitEventKurs()
  return code
}

export function resetBasisMataUang() {
  _basisCache = null
  _basisTerkunci = false
  tulisStorageAman(STORAGE_BASIS_LOKAL, null)
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
    if (jumlah >= 40) break
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
  if (!Number.isFinite(rA) || rA <= 0 || !Number.isFinite(rB) || rB <= 0) return 1
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

