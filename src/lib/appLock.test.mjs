import assert from 'node:assert/strict'
import {
  COOLDOWN_LOCK_MS,
  MAX_PERCOBAAN_PIN,
  aktifkanAppLock,
  bacaDataAppLock,
  hapusAppLockPaksa,
  isAppLockAktif,
  nonaktifkanAppLock,
  validasiFormatPin,
  verifikasiPinAppLock,
} from './appLock.js'

function mockStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  }
}

async function run() {
  const ls = mockStorage()

  // 1. Validasi format 6 digit angka
  assert.equal(validasiFormatPin('123456'), true)
  assert.equal(validasiFormatPin('12345'), false)
  assert.equal(validasiFormatPin('12a456'), false)
  assert.equal(isAppLockAktif(ls), false)

  // 2. Aktivasi dengan PIN tidak valid ditolak
  const bad = await aktifkanAppLock('99', ls)
  assert.equal(bad.ok, false)
  assert.equal(bad.alasan, 'FORMAT')

  // 3. Aktivasi PIN valid + tersalt (hash != PIN)
  const ok = await aktifkanAppLock('258046', ls)
  assert.equal(ok.ok, true)
  assert.equal(isAppLockAktif(ls), true)
  const saved = bacaDataAppLock(ls)
  assert.ok(saved.salt.length === 32)
  assert.ok(saved.hash.length === 64)
  assert.notEqual(saved.hash.includes('258046'), true)

  // 4. Verifikasi PIN benar lulus
  const v1 = await verifikasiPinAppLock('258046', ls, 10_000)
  assert.equal(v1.ok, true)

  // 5. Cooldown sesudah 5x salah
  let t = 20_000
  for (let i = 1; i < MAX_PERCOBAAN_PIN; i++) {
    const miss = await verifikasiPinAppLock('000000', ls, t)
    assert.equal(miss.ok, false)
    assert.equal(miss.terkunciSementara, false)
    assert.equal(miss.sisaPercobaan, MAX_PERCOBAAN_PIN - i)
  }
  const locked = await verifikasiPinAppLock('000000', ls, t)
  assert.equal(locked.ok, false)
  assert.equal(locked.terkunciSementara, true)
  assert.equal(locked.sisaDetik, Math.ceil(COOLDOWN_LOCK_MS / 1000))

  // Bahkan PIN benar ditolak saat masa tunggu aktif, lalu lolos sesudahnya
  const whileLocked = await verifikasiPinAppLock('258046', ls, t + 5_000)
  assert.equal(whileLocked.ok, false)
  assert.equal(whileLocked.terkunciSementara, true)
  const afterCooldown = await verifikasiPinAppLock('258046', ls, t + COOLDOWN_LOCK_MS + 1)
  assert.equal(afterCooldown.ok, true)

  // 6. Nonaktifkan mewajibkan PIN benar lalu menghapus
  const failOff = await nonaktifkanAppLock('111111', ls, t + 50_000)
  assert.equal(failOff.ok, false)
  assert.equal(isAppLockAktif(ls), true)

  const okOff = await nonaktifkanAppLock('258046', ls, t + 51_000)
  assert.equal(okOff.ok, true)
  assert.equal(isAppLockAktif(ls), false)

  // 7. Hapus paksa saat logout
  await aktifkanAppLock('654321', ls)
  assert.equal(isAppLockAktif(ls), true)
  hapusAppLockPaksa(ls)
  assert.equal(isAppLockAktif(ls), false)

  // 8. Aktivasi baru memakai PBKDF2 v2 (bukan SHA-256 sekali jalan) —
  // hash-nya berbeda dari SHA-256(salt:PIN) yang lama.
  const { createHash } = await import('node:crypto')
  const ok2 = await aktifkanAppLock('112233', ls)
  assert.equal(ok2.ok, true)
  const rec2 = bacaDataAppLock(ls)
  assert.equal(rec2.v, 2, 'rekaman baru harus v2')
  assert.equal(rec2.hash.length, 64)
  const shaLama = createHash('sha256').update(`${rec2.salt}:112233`).digest('hex')
  assert.notEqual(rec2.hash, shaLama, 'hash PBKDF2 tidak boleh sama dengan SHA-256 lama')
  const v2 = await verifikasiPinAppLock('112233', ls, 60_000)
  assert.equal(v2.ok, true)
  const v2Salah = await verifikasiPinAppLock('000000', ls, 61_000)
  assert.equal(v2Salah.ok, false)

  // 9. Rekaman v1 lama (SHA-256) masih bisa dibuka, lalu MIGRASI ke v2
  // pada verifikasi pertama yang berhasil.
  const saltLama = 'aabbccddeeff00112233445566778899'
  const hashLama = createHash('sha256').update(`${saltLama}:445566`).digest('hex')
  ls.setItem(
    'myduit:app_lock_v1',
    JSON.stringify({ v: 1, salt: saltLama, hash: hashLama, failCount: 0, lockedUntil: 0 }),
  )
  assert.equal(bacaDataAppLock(ls).v, 1)
  const mig = await verifikasiPinAppLock('445566', ls, 70_000)
  assert.equal(mig.ok, true)
  const sesudahMig = bacaDataAppLock(ls)
  assert.equal(sesudahMig.v, 2, 'rekaman v1 harus naik ke v2 sesudah verifikasi berhasil')
  assert.notEqual(sesudahMig.hash, hashLama, 'hash lama harus diganti PBKDF2')
  const migLagi = await verifikasiPinAppLock('445566', ls, 71_000)
  assert.equal(migLagi.ok, true, 'PIN tetap lolos sesudah migrasi')

  // 10. PIN salah pada rekaman v1 TIDAK memigrasi.
  ls.setItem(
    'myduit:app_lock_v1',
    JSON.stringify({ v: 1, salt: saltLama, hash: hashLama, failCount: 0, lockedUntil: 0 }),
  )
  const gagalV1 = await verifikasiPinAppLock('000000', ls, 72_000)
  assert.equal(gagalV1.ok, false)
  assert.equal(bacaDataAppLock(ls).v, 1, 'rekaman v1 gagal verifikasi tetap v1')

  console.log('appLock.test: OK (10 kasus lulus)')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

