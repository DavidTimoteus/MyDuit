// ============================================================================
// APP LOCK LOKAL (PIN 6 DIGIT + COOLDOWN ANTI-BRUTEFORCE)
// ----------------------------------------------------------------------------
// Kunci lokal sisi klien berbasis PBKDF2-SHA256 tersalt per perangkat
// (Web Crypto API, 100.000 iterasi, v2). Rekaman v1 lama (SHA-256 sekali jalan)
// masih diterima verifikasinya lalu DIMIGRASIKAN ke v2 pada keberhasilan
// pertama — PIN yang sama tetap lolos, hash lama tidak pernah dipakai lagi.
// Tidak menyimpan PIN mentah; dibersihkan otomatis saat pengguna keluar akun
// atau menghapus seluruh data. Catatan jujur: ini penghalang anti-intip di
// perangkat sendiri, bukan enkripsi — failCount/lockedUntil di localStorage
// yang sama bisa diedit siapa pun yang memegang perangkat; yang dibuat mahal
// oleh PBKDF2 adalah brute-force offline atas salinan rekaman (10^6 PIN x
// 100 ribu iterasi), bukan penguncian lokalnya.
// ============================================================================

export const LS_APP_LOCK = 'myduit:app_lock_v1'
export const MAX_PERCOBAAN_PIN = 5
export const COOLDOWN_LOCK_MS = 30_000
export const IDLE_LOCK_MS = 5 * 60 * 1000
export const PBKDF2_ITERASI = 100_000
export const PBKDF2_PANJANG_BIT = 256

function storageDefault(storage) {
  if (storage) return storage
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

export function validasiFormatPin(pin) {
  return /^\d{6}$/.test(String(pin ?? ''))
}

export function buatSaltHex() {
  const bytes = new Uint8Array(16)
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hashPin(pin, salt, iterasi = PBKDF2_ITERASI) {
  if (!/^[0-9a-fA-F]+$/.test(String(salt ?? '')) || String(salt).length % 2 !== 0) {
    throw new Error('Salt PIN tidak valid.')
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const keyMaterial = await globalThis.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(String(pin ?? '')),
      'PBKDF2',
      false,
      ['deriveBits'],
    )
    const saltBytes = new Uint8Array(
      String(salt)
        .match(/.{1,2}/g)
        .map((h) => parseInt(h, 16)),
    )
    const bits = await globalThis.crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations: iterasi, hash: 'SHA-256' },
      keyMaterial,
      PBKDF2_PANJANG_BIT,
    )
    return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('')
  }
  throw new Error('Web Crypto PBKDF2 tidak tersedia pada lingkungan ini.')
}

// Skema lama (v1): SHA-256(salt:PIN) sekali jalan. Hanya dipakai untuk
// memverifikasi rekaman v1 yang belum bermigrasi — tidak pernah ditulis lagi.
export async function hashPinSha256Lama(pin, salt) {
  const payload = `${salt}:${String(pin ?? '')}`
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    const encoded = new TextEncoder().encode(payload)
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded)
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  }
  throw new Error('Web Crypto SHA-256 tidak tersedia pada lingkungan ini.')
}

function bandingKonstan(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function simpanRekaman(ls, rec) {
  ls.setItem(
    LS_APP_LOCK,
    JSON.stringify({
      v: rec.v,
      salt: rec.salt,
      hash: rec.hash,
      failCount: rec.failCount || 0,
      lockedUntil: rec.lockedUntil || 0,
    }),
  )
}

export function bacaDataAppLock(storage) {
  const ls = storageDefault(storage)
  if (!ls) return null
  try {
    const raw = ls.getItem(LS_APP_LOCK)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || (parsed.v !== 1 && parsed.v !== 2) || !parsed.salt || !parsed.hash) return null
    return {
      v: parsed.v,
      salt: String(parsed.salt),
      hash: String(parsed.hash),
      failCount: Number(parsed.failCount) || 0,
      lockedUntil: Number(parsed.lockedUntil) || 0,
    }
  } catch {
    return null
  }
}

export function isAppLockAktif(storage) {
  return bacaDataAppLock(storage) !== null
}

export async function aktifkanAppLock(pin, storage) {
  const bersih = String(pin ?? '').trim()
  if (!validasiFormatPin(bersih)) {
    return { ok: false, alasan: 'FORMAT' }
  }
  const ls = storageDefault(storage)
  if (!ls) return { ok: false, alasan: 'STORAGE' }
  const salt = buatSaltHex()
  const hash = await hashPin(bersih, salt)
  simpanRekaman(ls, { v: 2, salt, hash, failCount: 0, lockedUntil: 0 })
  return { ok: true }
}

export async function verifikasiPinAppLock(pin, storage, nowMs = Date.now()) {
  const ls = storageDefault(storage)
  const rec = bacaDataAppLock(ls)
  if (!rec) return { ok: true }

  if (rec.lockedUntil > nowMs) {
    const sisaDetik = Math.max(1, Math.ceil((rec.lockedUntil - nowMs) / 1000))
    return { ok: false, terkunciSementara: true, sisaDetik }
  }

  const kandidat =
    rec.v === 1
      ? await hashPinSha256Lama(String(pin ?? '').trim(), rec.salt)
      : await hashPin(String(pin ?? '').trim(), rec.salt)
  if (bandingKonstan(kandidat, rec.hash)) {
    // Rekaman v1 yang lolos langsung naik ke PBKDF2 v2 (salt sama, PIN sama).
    const hashBaru = rec.v === 1 ? await hashPin(String(pin ?? '').trim(), rec.salt) : rec.hash
    simpanRekaman(ls, { v: 2, salt: rec.salt, hash: hashBaru, failCount: 0, lockedUntil: 0 })
    return { ok: true }
  }

  const failCount = rec.failCount + 1
  const terkunci = failCount >= MAX_PERCOBAAN_PIN
  const lockedUntil = terkunci ? nowMs + COOLDOWN_LOCK_MS : 0
  simpanRekaman(ls, {
    v: rec.v,
    salt: rec.salt,
    hash: rec.hash,
    failCount: terkunci ? 0 : failCount,
    lockedUntil,
  })
  return {
    ok: false,
    terkunciSementara: terkunci,
    sisaDetik: terkunci ? Math.ceil(COOLDOWN_LOCK_MS / 1000) : 0,
    sisaPercobaan: terkunci ? 0 : Math.max(0, MAX_PERCOBAAN_PIN - failCount),
  }
}

export async function nonaktifkanAppLock(pin, storage, nowMs = Date.now()) {
  const cek = await verifikasiPinAppLock(pin, storage, nowMs)
  if (!cek.ok) return cek
  const ls = storageDefault(storage)
  ls?.removeItem(LS_APP_LOCK)
  return { ok: true }
}

export function hapusAppLockPaksa(storage) {
  const ls = storageDefault(storage)
  ls?.removeItem(LS_APP_LOCK)
}

