// Uji render StatistikView (Fase 4 re-audit R-03/R-04): kartu ringkasan
// benar-benar membawa kelas hero-* ke DOM dan labelnya tampil, tanpa warna
// teks arbitrer yang gagal kontras.
//
// RED yang disaksikan re-audit: HTML hasil renderToString(StatistikView)
// mengandung 0 kemunculan `hero-` (prop `cls` tidak pernah dipakai definisi
// SummaryCard) — lihat reaudit-ui.md R-03.
//
// Jalankan: node src/features/statistik/statistikRender.test.mjs
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import StatistikView from './StatistikView.jsx'

const galat = []
let total = 0

function cek(nama, html, patokan) {
  total++
  const ok = typeof patokan === 'function' ? patokan(html) : html.includes(patokan)
  if (ok) console.log(`  ok    ${nama}`)
  else {
    galat.push(nama)
    console.log(`  GAGAL ${nama}`)
  }
}

const user = { uid: 'u1', displayName: 'Penguji', email: 'uji@contoh.id', photoURL: null }
const html = renderToString(h(StatistikView, { user }))

cek('kartu pemasukan membawa kelas hero-primary', html, 'hero-primary')
cek('kartu pengeluaran membawa kelas hero-danger', html, 'hero-danger')
cek('kartu saldo bersih membawa kelas hero-blue', html, 'hero-blue')
cek('tepat 3 kartu hero ter-render', html, (s) => (s.match(/hero-(primary|danger|blue)/g) ?? []).length === 3)
cek('label "Pemasukan" tampil', html, 'Pemasukan')
cek('label "Pengeluaran" tampil', html, 'Pengeluaran')
cek('label "Saldo Bersih" tampil', html, 'Saldo Bersih')
cek(
  'tidak ada kelas teks arbitrer yang gagal kontras di output render',
  html,
  (s) =>
    !s.includes('text-[#36AE7C]') && !s.includes('text-[#EB5353]') && !s.includes('text-[#187498]'),
)
cek('kartu memakai token teks yang lolos kontras (bukan hex mentah)', html, (s) =>
  s.includes('text-primary') && s.includes('text-danger') && s.includes('text-info'),
)
// Fase 6 (G01): grafik canvas punya alternatif teks — tabel sr-only dengan
// data yang sama + canvas berlabel role=img.
cek('canvas grafik berlabel role=img', html, (s) => s.includes('role="img"'))
cek(
  'tabel alternatif grafik ter-render (sr-only, berisi kolom Pemasukan)',
  html,
  (s) => s.includes('<table class="sr-only"') && s.includes('Pemasukan') && s.includes('<th scope="row">'),
)

console.log(`\n${galat.length ? 'GAGAL' : 'LULUS'}: ${total - galat.length}/${total} cek lolos`)
if (galat.length) throw new Error(`Render StatistikView gagal: ${galat.join(' | ')}`)
console.log(`statistikRender: OK (${total} kasus lulus)`)
