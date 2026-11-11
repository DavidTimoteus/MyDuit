// Uji unit kalkulator nominal (+, -, *, /) bebas eval & CSP-safe
// Jalankan: node src/features/transaksi/kalkulatorNominal.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  evaluasiEkspresiNominal,
  formatEkspresiPreview,
  sisipTokenKalkulator,
} from './kalkulatorNominal.js'

let total = 0
let lulus = 0

function cek(nama, fn) {
  total++
  fn()
  lulus++
  console.log(`  ok    ${nama}`)
}

cek('evaluasiEkspresiNominal mendukung 4 operasi dasar (+, -, ×, ÷) & prioritas operator', () => {
  assert.deepEqual(evaluasiEkspresiNominal('15000 + 25000'), { ok: true, nilai: 40000, dibulatkan: 40000 })
  assert.deepEqual(evaluasiEkspresiNominal('100000 - 37500'), { ok: true, nilai: 62500, dibulatkan: 62500 })
  assert.deepEqual(evaluasiEkspresiNominal('25000 + 15000 * 2'), { ok: true, nilai: 55000, dibulatkan: 55000 })
  assert.deepEqual(evaluasiEkspresiNominal('90000 ÷ 3 × 2'), { ok: true, nilai: 60000, dibulatkan: 60000 })
  assert.deepEqual(evaluasiEkspresiNominal('10000 ÷ 3'), { ok: true, nilai: 10000 / 3, dibulatkan: 3333 })
  assert.deepEqual(evaluasiEkspresiNominal('1,5 * 20000'), { ok: true, nilai: 30000, dibulatkan: 30000 })
})

cek('evaluasiEkspresiNominal menolak pembagian dengan 0 dan ekspresi tidak valid', () => {
  const divZero = evaluasiEkspresiNominal('50000 / 0')
  assert.equal(divZero.ok, false)
  assert.ok(divZero.error.includes('0'))

  const neg = evaluasiEkspresiNominal('10000 - 25000')
  assert.equal(neg.ok, true)
  assert.ok(neg.dibulatkan <= 0)

  const kosong = evaluasiEkspresiNominal('   ')
  assert.equal(kosong.ok, false)
})

cek('sisipTokenKalkulator merakit ekspresi secara aman tanpa operator ganda', () => {
  let expr = ''
  expr = sisipTokenKalkulator(expr, '15000')
  expr = sisipTokenKalkulator(expr, '+')
  expr = sisipTokenKalkulator(expr, '*') // ganti operator terakhir, tidak menumpuk '+*'
  assert.equal(expr, '15000*')
  expr = sisipTokenKalkulator(expr, '2')
  assert.equal(expr, '15000*2')
  expr = sisipTokenKalkulator(expr, 'DEL')
  assert.equal(expr, '15000*')
  expr = sisipTokenKalkulator(expr, 'C')
  assert.equal(expr, '')
})

cek('formatEkspresiPreview memformat angka dan simbol operator dengan rapi', () => {
  const preview = formatEkspresiPreview('15000+2500*2')
  assert.ok(preview.includes('+') && preview.includes('×'))
  assert.ok(preview.includes('15'))
})

cek('keamanan CSP: kalkulatorNominal bebas dari eval dan new Function', () => {
  const src = readFileSync(new URL('./kalkulatorNominal.js', import.meta.url), 'utf8')
  assert.ok(!/\beval\s*\(/.test(src))
  assert.ok(!/new\s+Function\b/.test(src))
})

console.log(`\nLULUS: ${lulus}/${total} cek lolos`)

