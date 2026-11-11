// Uji unit helper & kontrak aksesibilitas useScrollEffects
// Jalankan via: node src/lib/useScrollEffects.test.mjs
import assert from 'node:assert/strict'
import {
  batchClassifyTargets,
  batchSweepPending,
  classifyRevealTarget,
  computeRevealDelayMs,
  findScrollRoot,
  prefersReducedMotion,
} from './useScrollEffects.js'

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

cek('batchClassifyTargets membaca seluruh getBoundingClientRect sebelum fase tulis DOM (anti-thrashing)', () => {
  const ops = []
  const mkEl = (top, width = 320, height = 80) => ({
    getBoundingClientRect: () => {
      ops.push(`read:${top}`)
      return { top, bottom: top + height, width, height }
    },
  })
  const els = [mkEl(100), mkEl(200), mkEl(900), mkEl(100, 0, 0)]
  const { visible, pending } = batchClassifyTargets(els, { top: 0, bottom: 750 }, 8)
  for (const el of visible) ops.push(`write:visible:${visible.indexOf(el)}`)
  for (const el of pending) ops.push(`write:pending:${pending.indexOf(el)}`)

  assert.equal(visible.length, 2)
  assert.equal(pending.length, 1)
  const firstWriteIdx = ops.findIndex((o) => o.startsWith('write:'))
  const lastReadIdx = ops.reduce((acc, o, i) => (o.startsWith('read:') ? i : acc), -1)
  assert.ok(lastReadIdx < firstWriteIdx, `Semua read harus mendahului write (ops: ${ops.join(',')})`)
})

cek('batchSweepPending memisahkan target tersembunyi (0x0) dan yang masuk viewport dalam 1 pass baca', () => {
  const ops = []
  const mkEl = (top, width = 320, height = 80) => ({
    getBoundingClientRect: () => {
      ops.push(`read:${top}`)
      return { top, bottom: top + height, width, height }
    },
  })
  const els = [mkEl(500), mkEl(1200), mkEl(0, 0, 0)]
  const { hidden, reveal } = batchSweepPending(els, { top: 0, bottom: 750 }, 24)
  assert.equal(hidden.length, 1)
  assert.equal(reveal.length, 1)
  assert.equal(ops.length, 3)
})

console.log(`\nLULUS: ${lulus}/${total} cek lolos`)

