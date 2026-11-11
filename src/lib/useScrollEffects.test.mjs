// Uji unit helper & kontrak aksesibilitas useScrollEffects
// Jalankan via: node src/lib/useScrollEffects.test.mjs
import assert from 'node:assert/strict'
import { computeRevealDelayMs, findScrollRoot, prefersReducedMotion } from './useScrollEffects.js'

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

cek('prefersReducedMotion aman pada SSR / window null & mendeteksi media query', () => {
  assert.equal(prefersReducedMotion(null), false)
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: false }) }), false)
  assert.equal(prefersReducedMotion({ matchMedia: () => ({ matches: true }) }), true)
})

cek('findScrollRoot aman di lingkungan Node tanpa document', () => {
  assert.equal(findScrollRoot(null), null)
})

console.log(`\nLULUS: ${lulus}/${total} cek lolos`)

