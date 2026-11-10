// Helper format & tanggal (konvensi Indonesia, Rupiah integer).

// ===== DETEKSI CURRENCY dari lokasi akun Google =====
// Firebase Auth tidak menyimpan negara pengguna secara eksplisit, jadi kita
// mengira dari (1) TIMEZONE perangkat (paling akurat untuk lokasi) lalu
// (2) bahasa browser. Default INDONESIA (IDR) untuk app yang memang di-Indonesia.
const _CURRENCY_BY_LOCALE = {
  'id': 'IDR', 'id-id': 'IDR',
  'en-sg': 'SGD', 'en-my': 'MYR', 'en-us': 'USD', 'en-ca': 'CAD',
  'en-gb': 'GBP', 'en-au': 'AUD', 'en-ph': 'PHP', 'en-th': 'THB',
  'en-in': 'INR', 'en-vn': 'VND', 'en-nz': 'NZD', 'vi': 'VND', 'vi-vn': 'VND',
  'ms': 'MYR', 'ms-my': 'MYR', 'th': 'THB', 'th-th': 'THB', 'de': 'EUR', 'fr': 'EUR', 'ja': 'JPY',
}

// Timezone -> kode negara (peta praktis). Kabupaten/lokasi Indonesia & sekitarnya.
const COUNTRY_BY_TZ = {
  'asia/jakarta': 'ID', 'asia/pontianak': 'ID', 'asia/makassar': 'ID', 'asia/jayapura': 'ID',
  'asia/kuala_lumpur': 'MY', 'asia/singapore': 'SG', 'asia/manila': 'PH',
  'asia/bangkok': 'TH', 'asia/ho_chi_minh': 'VN', 'asia/colombo': 'LK',
  'asia/dhaka': 'BD', 'asia/karachi': 'PK', 'asia/kathmandu': 'NP',
  'asia/kolkata': 'IN', 'asia/tokyo': 'JP', 'asia/seoul': 'KR',
  'asia/shanghai': 'CN', 'asia/hong_kong': 'HK', 'asia/taipei': 'TW',
  'australia/sydney': 'AU', 'australia/melbourne': 'AU', 'pacific/auckland': 'NZ',
  'america/new_york': 'US', 'america/los_angeles': 'US', 'america/chicago': 'US',
  'america/toronto': 'CA', 'america/vancouver': 'CA',
  'europe/london': 'GB', 'europe/berlin': 'DE', 'europe/paris': 'FR',
  'europe/amsterdam': 'NL', 'europe/rome': 'IT', 'europe/madrid': 'ES',
}

// Nah, kode negara -> kode mata uang (beberapa negara pakai mata uang sendiri).
const CURRENCY_BY_COUNTRY = {
  ID: 'IDR', MY: 'MYR', SG: 'SGD', PH: 'PHP', TH: 'THB', VN: 'VND', LK: 'LKR',
  BD: 'BDT', PK: 'PKR', NP: 'NPR', IN: 'INR', JP: 'JPY', KR: 'KRW', CN: 'CNY',
  HK: 'HKD', TW: 'TWD', AU: 'AUD', NZ: 'NZD', US: 'USD', CA: 'CAD',
  GB: 'GBP', DE: 'EUR', FR: 'EUR', NL: 'EUR', IT: 'EUR', ES: 'EUR',
}

const CURRENCY_DEFAULT = 'IDR'

// Katalog negara yang didukung (dipakai deteksi otomatis & pemilih lokasi manual).
export const NEGARA = {
  ID: { nama: 'Indonesia', bendera: '🇮🇩', currency: 'IDR', symbol: 'Rp', locale: 'id-ID' },
  MY: { nama: 'Malaysia', bendera: '🇲🇾', currency: 'MYR', symbol: 'RM', locale: 'ms-MY' },
  SG: { nama: 'Singapura', bendera: '🇸🇬', currency: 'SGD', symbol: 'S$', locale: 'en-SG' },
  PH: { nama: 'Filipina', bendera: '🇵🇭', currency: 'PHP', symbol: '₱', locale: 'en-PH' },
  TH: { nama: 'Thailand', bendera: '🇹🇭', currency: 'THB', symbol: '฿', locale: 'th-TH' },
  VN: { nama: 'Vietnam', bendera: '🇻🇳', currency: 'VND', symbol: '₫', locale: 'vi-VN' },
  IN: { nama: 'India', bendera: '🇮🇳', currency: 'INR', symbol: '₹', locale: 'en-IN' },
  JP: { nama: 'Jepang', bendera: '🇯🇵', currency: 'JPY', symbol: '¥', locale: 'ja-JP' },
  US: { nama: 'Amerika Serikat', bendera: '🇺🇸', currency: 'USD', symbol: 'US$', locale: 'en-US' },
  GB: { nama: 'Inggris', bendera: '🇬🇧', currency: 'GBP', symbol: '£', locale: 'en-GB' },
  AU: { nama: 'Australia', bendera: '🇦🇺', currency: 'AUD', symbol: 'A$', locale: 'en-AU' },
  NZ: { nama: 'Selandia Baru', bendera: '🇳🇿', currency: 'NZD', symbol: 'NZ$', locale: 'en-NZ' },
  CA: { nama: 'Kanada', bendera: '🇨🇦', currency: 'CAD', symbol: 'C$', locale: 'en-CA' },
}

// ===== Lokasi manual (dipilih pengguna, menang atas deteksi timezone) =====
const LS_NEGARA = 'myduit:negara'
export const EVENT_LOKASI = 'myduit:lokasi-update'

export function negaraManual() {
  try {
    const code = localStorage.getItem(LS_NEGARA)
    return code && NEGARA[code] ? code : ''
  } catch {
    return ''
  }
}

// code kosong/null = kembali ke deteksi otomatis.
export function simpanNegaraManual(code) {
  try {
    if (code && NEGARA[code]) localStorage.setItem(LS_NEGARA, code)
    else localStorage.removeItem(LS_NEGARA)
  } catch {
    /* storage diblokir — abaikan, deteksi otomatis tetap jalan */
  }
  _uang = null
  window.dispatchEvent(new CustomEvent(EVENT_LOKASI, { detail: { code: code || '' } }))
}

export function detectTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

// Deteksi mata uang: lokasi manual > timezone > locale > default ID.
export function detectCurrency(locale) {
  const manual = negaraManual()
  if (manual) return NEGARA[manual].currency
  const info = detectCountryInfo(locale)
  return info.currency || CURRENCY_DEFAULT
}

// Locale angka: ikut negara manual bila ada, kalau tidak pakai locale browser.
export function detectLocale() {
  const manual = negaraManual()
  if (manual) return NEGARA[manual].locale
  return (typeof navigator !== 'undefined' && navigator.language) || 'id-ID'
}

// Nama & bendera negara utk indikator lokasi di sidebar.
export function detectCountryInfo(locale) {
  const manual = negaraManual()
  if (manual) return { code: manual, manual: true, ...NEGARA[manual] }

  const loc = String(locale || (typeof navigator !== 'undefined' ? navigator.language : '') || '').toLowerCase()
  if (loc.startsWith('id') || loc.includes('id') || loc.startsWith('in')) {
    return { code: 'ID', manual: false, ...NEGARA.ID }
  }

  const tz = detectTimezone().toLowerCase()
  let code = COUNTRY_BY_TZ[tz]
  // Khusus Asia/Bangkok (UTC+7): jika locale bukan bahasa Thai, arahkan ke ID (WIB)
  // karena zona waktu (UTC+7:00) Bangkok, Hanoi, Jakarta adalah standar default Windows di Indonesia.
  if (tz === 'asia/bangkok' && !loc.startsWith('th')) {
    code = 'ID'
  }

  if (!code) {
    const part = loc.split('-')[1]?.toUpperCase()
    code = part && CURRENCY_BY_COUNTRY[part] ? part : 'ID'
  }
  const data = NEGARA[code]
  if (data) return { code, manual: false, ...data }
  return { code: 'ID', manual: false, ...NEGARA.ID }
}

// ===== Mata uang aktif (cache modul) =====
// Semua formatter nominal membaca ini supaya satu pilihan lokasi otomatis
// berlaku di seluruh app. Cache di-reset oleh simpanNegaraManual().
let _uang = null

export function uangAktif() {
  if (!_uang) {
    const info = detectCountryInfo(typeof navigator !== 'undefined' ? navigator.language : 'id-ID')
    _uang = { currency: info.currency, symbol: info.symbol, locale: detectLocale() }
  }
  return _uang
}

// Simbol mata uang aktif ("Rp"/"US$"/…) utk label prefix input & judul kolom.
export function simbolUang() {
  return uangAktif().symbol
}

// Angka bergrup tanpa simbol ("1.234.500") mengikuti locale aktif.
export function formatNominal(n) {
  return (Number(n) || 0).toLocaleString(uangAktif().locale)
}

// Format nominal sesuai currency: "Rp 1.000" / "US$ 1.000" / "S$ 1.000", dst.
// `compact` dipakai utk sumbu y (Rp 1rb / 1.000) — pakai Intl currency formatter.
export function formatCurrency(n, currency = 'IDR', locale = 'id-ID', { compact = false } = {}) {
  const v = Number(n) || 0
  const abs = Math.abs(v)
  try {
    if (compact) {
      // Ubah jadi format ribuan ringkas: "1rb", "2,5jt"
      if (abs >= 1e9) return `${(v / 1e9).toLocaleString(locale, { maximumFractionDigits: 1 })}M`
      if (abs >= 1e6) return `${(v / 1e6).toLocaleString(locale, { maximumFractionDigits: 1 })}jt`
      if (abs >= 1e3) return `${(v / 1e3).toLocaleString(locale, { maximumFractionDigits: 1 })}rb`
      return v.toLocaleString(locale)
    }
    const sym = symbolForCurrency(currency)
    return `${sym} ${v.toLocaleString(locale)}`
  } catch {
    return `${v.toLocaleString(locale)}`
  }
}

// Simbol per mata uang utk tampilan "Rp"/"US$"/"S$", bukan format default Intl
// (yg bisa menghasilkan spasi / posisi berbeda-beda antar locale).
export function symbolForCurrency(currency) {
  const map = {
    IDR: 'Rp', USD: 'US$', SGD: 'S$', MYR: 'RM', CAD: 'C$', GBP: '£',
    AUD: 'A$', PHP: '₱', THB: '฿', INR: '₹', VND: '₫', EUR: '€', JPY: '¥', NZD: 'NZ$',
    KRW: '₩', CNY: '¥', HKD: 'HK$', TWD: 'NT$', LKR: 'Rs', BDT: '৳', PKR: '₨', NPR: '₨',
  }
  return map[currency] || currency
}

// Formatter nominal utama seluruh app: pakai simbol & grouping mata uang aktif.
// (Nama historis "Rupiah" dipertahankan agar call site tidak perlu diubah.)
export function formatRupiah(n, { tanda = false } = {}) {
  const { currency, locale } = uangAktif()
  const sym = symbolForCurrency(currency)
  const v = Number(n) || 0
  const abs = Math.abs(v).toLocaleString(locale)
  // Simbol menempel ke angka tanpa spasi (konvensi "Rp1.000"): kolom nominal
  // jadi rapat dan tidak bolak-balik lebar saat negara diganti.
  if (tanda) return `${v < 0 ? '−' : '+'} ${sym}${abs}`
  return `${v < 0 ? '− ' : ''}${sym}${abs}`
}

export const MAX_NOMINAL = 999_999_999_999_999

function clampNominalPositif(n) {
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(MAX_NOMINAL, Math.round(n))
}

// "12.500" -> 12500 ; menerima input bebas (bilangan bulat non-negatif)
export function parseNominal(str) {
  if (typeof str === 'number') return clampNominalPositif(str)
  const digits = String(str ?? '').replace(/\D/g, '')
  return digits ? clampNominalPositif(Number(digits)) : 0
}

// Versi bertanda untuk koreksi saldo rekening (mengizinkan saldo negatif/overdraft)
export function parseNominalBertanda(str) {
  if (typeof str === 'number') {
    if (!Number.isFinite(str)) return 0
    return Math.max(-MAX_NOMINAL, Math.min(MAX_NOMINAL, Math.round(str)))
  }
  const raw = String(str ?? '').trim()
  if (!raw) return 0
  const negatif = raw.startsWith('-') || raw.startsWith('−')
  const abs = parseNominal(raw)
  if (abs === 0) return 0
  return negatif ? -abs : abs
}

// Parser angka toleran untuk sumber eksternal (XLSX/CSV/JSON/OCR):
// membedakan akhiran desimal 1-2 digit ("50000.00", "50.000,50") dari ribuan ("50.000").
export function parseAngkaEksternal(val) {
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return 0
    return Math.max(-MAX_NOMINAL, Math.min(MAX_NOMINAL, Math.round(val)))
  }
  const raw = String(val ?? '').trim()
  if (!raw) return 0
  const negatif = raw.startsWith('-') || raw.startsWith('−')
  const s = raw.replace(/[^\d.,]/g, '')
  if (!s) return 0
  const mDec = s.match(/^([\d.,]+)[.,](\d{1,2})$/)
  if (mDec) {
    const bulat = mDec[1].replace(/[.,]/g, '')
    const num = Number(`${bulat || 0}.${mDec[2]}`)
    if (!Number.isFinite(num)) return 0
    const clamped = Math.min(MAX_NOMINAL, Math.round(num))
    return negatif ? -clamped : clamped
  }
  const digits = s.replace(/[.,]/g, '')
  const num = digits ? Math.min(MAX_NOMINAL, Number(digits)) : 0
  if (!Number.isFinite(num) || num === 0) return 0
  return negatif ? -num : num
}

// Untuk input live: angka -> "12.500" (grouping mengikuti locale aktif)
export function formatRibuanInput(str) {
  const v = parseNominal(str)
  return v ? v.toLocaleString(uangAktif().locale) : ''
}

// Untuk input koreksi saldo bertanda (mempertahankan tanda '-' & angka '0')
export function formatRibuanInputBertanda(str) {
  if (typeof str === 'number') {
    if (!Number.isFinite(str)) return ''
    if (str === 0) return '0'
    const clamped = parseNominalBertanda(str)
    return `${clamped < 0 ? '-' : ''}${Math.abs(clamped).toLocaleString(uangAktif().locale)}`
  }
  const raw = String(str ?? '').trim()
  if (!raw) return ''
  if (raw === '-' || raw === '−') return '-'
  const negatif = raw.startsWith('-') || raw.startsWith('−')
  const v = parseNominal(raw)
  if (!v) return raw.includes('0') ? '0' : (negatif ? '-' : '')
  return `${negatif ? '-' : ''}${v.toLocaleString(uangAktif().locale)}`
}

export function isoHariIni() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function isoDari(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function tanggalKalenderValid(y, bln, tgl) {
  const dt = new Date(y, bln - 1, tgl)
  return dt.getFullYear() === y && dt.getMonth() === bln - 1 && dt.getDate() === tgl
}

// Parse tanggal YYYY-MM-DD secara aman (kembalikan null bila format/kalender tidak valid).
export function parseTanggalIsoAman(iso) {
  if (typeof iso !== 'string') return null
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const y = Number(m[1]), bln = Number(m[2]), tgl = Number(m[3])
  if (!tanggalKalenderValid(y, bln, tgl)) return null
  return new Date(y, bln - 1, tgl)
}

// Pastikan nilai tanggal selalu dalam format kanonik YYYY-MM-DD
export function kanonikTanggal(val) {
  if (!val) return isoHariIni()
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
    const s = val.trim()
    return parseTanggalIsoAman(s) ? s : isoHariIni()
  }
  if (typeof val === 'string') {
    const s = val.trim()
    const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
    if (m) {
      let y = Number(m[3])
      if (y < 100) y += 2000
      const bln = Number(m[2])
      const tgl = Number(m[1])
      if (tanggalKalenderValid(y, bln, tgl)) {
        return `${y}-${String(bln).padStart(2, '0')}-${String(tgl).padStart(2, '0')}`
      }
    }
  }
  const d = val instanceof Date ? val : new Date(val)
  if (!isNaN(d.getTime())) {
    return isoDari(d)
  }
  return isoHariIni()
}

// Label grup tanggal: Hari Ini / Kemarin / "Senin, 12 Mei 2026"
export function tanggalLabel(iso) {
  const hari = isoHariIni()
  if (iso === hari) return 'Hari Ini'
  const y = new Date()
  y.setDate(y.getDate() - 1)
  if (iso === isoDari(y)) return 'Kemarin'
  const d = parseTanggalIsoAman(iso)
  if (!d) return iso || 'Tanpa tanggal'
  return new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
}

export function tanggalPendek(iso) {
  const d = parseTanggalIsoAman(iso)
  if (!d) return iso || '—'
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(d)
}

// Rentang tanggal untuk chip filter. 'semua' -> null (tanpa batas).
export function rangeForFilter(chip, rentang = {}) {
  const now = new Date()
  const today = isoHariIni()
  switch (chip) {
    case 'hari':
      return { start: today, end: today }
    case '7hari': {
      const d = new Date(now)
      d.setDate(d.getDate() - 6)
      return { start: isoDari(d), end: today }
    }
    case '30hari': {
      const d = new Date(now)
      d.setDate(d.getDate() - 29)
      return { start: isoDari(d), end: today }
    }
    case 'minggu': {
      const d = new Date(now)
      const day = (d.getDay() + 6) % 7 // Senin = 0
      d.setDate(d.getDate() - day)
      return { start: isoDari(d), end: today }
    }
    case 'bulan': {
      const awal = new Date(now.getFullYear(), now.getMonth(), 1)
      const akhir = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { start: isoDari(awal), end: isoDari(akhir) }
    }
    case 'tahun':
      return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31` }
    case 'rentang': {
      const start = rentang.start || '0000-01-01'
      const end = rentang.end || '9999-12-31'
      return start <= end ? { start, end } : { start: end, end: start }
    }
    default:
      return null // semua
  }
}
