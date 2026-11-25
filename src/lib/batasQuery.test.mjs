// Kontrak batas query Fase 5 re-audit (R-03): tidak ada satu pun langganan
// atau getDocs transaksi yang boleh tanpa batas. `pageSize: 0` dulu berarti
// "tanpa limit" (0 falsy) — satu listener di modal Riwayat Mutasi bisa
// menarik ribuan dokumen (rentang tahunan) dalam satu snapshot awal.
//
// Aturan: (1) buildTransQuery selalu memasang limit — nilai 0/tidak valid
// jatuh ke BATAS_DOKUMEN_QUERY, nilai di atasnya dijepit ke sana;
// (2) tidak ada pemakaian `pageSize: 0` di src; (3) query langsung di
// StatistikView/BudgetView ikut dibatasi konstanta yang sama.
// Jalankan: node src/lib/batasQuery.test.mjs
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const baca = (rel) => readFileSync(join(SRC, rel), 'utf8')

// (1) Konstanta batas ada di db.js dan nilainya 1000.
const db = baca('lib/db.js')
const m = db.match(/export const BATAS_DOKUMEN_QUERY = (\d+)/)
assert.ok(m, 'db.js harus mengekspor BATAS_DOKUMEN_QUERY')
assert.equal(Number(m[1]), 1000, 'BATAS_DOKUMEN_QUERY harus 1000')
console.log('  ok    BATAS_DOKUMEN_QUERY = 1000 di db.js')

// buildTransQuery menjepit pageSize ke batas (0/tidak valid -> batas).
const fn = db.slice(db.indexOf('export function buildTransQuery'))
const badan = fn.slice(0, fn.indexOf('\n}\n') + 3)
assert.ok(badan.includes('BATAS_DOKUMEN_QUERY'), 'buildTransQuery harus memakai BATAS_DOKUMEN_QUERY')
assert.ok(!/if \(pageSize && Number\.isFinite\(pageSize\) && pageSize > 0\)/.test(badan), 'buildTransQuery masih memakai penjaga lama (0 = tanpa batas)')
console.log('  ok    buildTransQuery selalu memasang limit (0 dijepit ke batas)')

// (2) Tidak ada `pageSize: 0` (atau `? 0 :`) di src.
function jalan(dir, keluar = []) {
  for (const entri of readdirSync(dir)) {
    const p = join(dir, entri)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (entri === 'node_modules' || entri === 'dist') continue
      jalan(p, keluar)
    } else if ((p.endsWith('.js') || p.endsWith('.jsx')) && !p.includes('.test.')) {
      keluar.push(p)
    }
  }
  return keluar
}
const pelanggaran = []
for (const file of jalan(SRC)) {
  const isi = readFileSync(file, 'utf8')
  if (/\bpageSize\s*:\s*0\b/.test(isi) || /\bpageSize\s*:\s*[^,;\n]*\?\s*0\b/.test(isi)) {
    pelanggaran.push(file.replace(SRC + '/', ''))
  }
}
assert.deepEqual(pelanggaran, [], `pageSize: 0 masih ada di:\n- ${pelanggaran.join('\n- ')}`)
console.log('  ok    tidak ada pageSize: 0 di src')

// (3) Query langsung di StatistikView/BudgetView dibatasi konstanta yang sama.
for (const [rel, jumlah] of [
  ['features/statistik/StatistikView.jsx', 2],
  ['features/budget/BudgetView.jsx', 1],
]) {
  const isi = baca(rel)
  const hitung = (isi.match(/(?:fbLimit|limit)\(BATAS_DOKUMEN_QUERY\)/g) ?? []).length
  assert.ok(
    hitung >= jumlah,
    `${rel} harus memakai limit(BATAS_DOKUMEN_QUERY) minimal ${jumlah}x (ketemu ${hitung}x)`,
  )
  console.log(`  ok    ${rel}: limit(BATAS_DOKUMEN_QUERY) ${hitung}x`)
}

console.log('batasQuery: OK')
