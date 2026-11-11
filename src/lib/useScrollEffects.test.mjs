// Uji unit helper & kontrak aksesibilitas useScrollEffects
// Jalankan via: node src/lib/useScrollEffects.test.mjs
import assert from 'node:assert/strict'
import { classifyRevealTarget, computeRevealDelayMs, findScrollRoot, prefersReducedMotion } from './useScrollEffects.js'

let total = 0
let lulus = 0

function cek(nama, fn) {
  total++
  fn()
  lulus++
  console.log(`  ok    ${nama}`)
}

cek('computeRevealDelayMs men-stagger linear lalu membatasi pada maxSteps', () => {
  assert.equal(computeRevealDelayMs(0, 5, 36), 0)
  assert.equal(computeRevealDelayMs(2, 5, 36), 72)
  assert.equal(computeRevealDelayMs(5, 5, 36), 180)
  assert.equal(computeRevealDelayMs(25, 5, 36), 180)
  assert.equal(computeRevealDelayMs(-3, 5, 36), 0)
})

cek('classifyRevealTarget melewati elemen hidden (0x0) & langsung menampilkan kartu above-the-fold tanpa opacity:0', () => {
  const rootRect = { top: 0, bottom: 750 }
  assert.equal(classifyRevealTarget({ top: 100, bottom: 100, width: 0, height: 0 }, rootRect), 'skip')
  assert.equal(classifyRevealTarget({ top: -120, bottom: -20, width: 320, height: 80 }, rootRect), 'visible')
  assert.equal(classifyRevealTarget({ top: 120, bottom: 200, width: 320, height: 80 }, rootRect), 'visible')
  assert.equal(classifyRevealTarget({ top: 760, bottom: 840, width: 320, height: 80 }, rootRect), 'pending')
})

cek('prefersReducedMotion aman pada SSR / window null & mendeteksi media query', () => {
  assert.equal(prefersReducedMotion(null), false)
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: false }) }), false)
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: true }) }), true)
})

cek('findScrollRoot aman di lingkungan Node tanpa document', () => {
  assert.equal(findScrollRoot(null), null)
})

console.log(`\nLULUS: ${lulus}/${total} cek lolos`)

