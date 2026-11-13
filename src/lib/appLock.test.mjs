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

  console.log('appLock.test: OK (7 kasus lulus)')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

