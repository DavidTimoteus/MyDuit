// Uji kontrak + render tampilan mobile Utang & Cicilan.
//
// Dua bug yang dikunci di sini (25 Nov 2026):
//   A. "Chip Terlambat terpotong" — baris chip memakai `overflow-x-auto
//      hide-scrollbar`: keempat chip butuh ~298px, konten HP 320px cuma
//      ~288px, jadi "Terlambat" terpotong ~10px tanpa petunjuk scroll.
//      Angka ringkasan memakai `text-[13px]` sehingga "Rp12.500.000"
//      terpotong di HP 360px (butuh 86px, isi kartu cuma 84px).
//   B. "Chip kosong tanpa teks" — tombol chip mobile merender `{f.label}`,
//      padahal FILTERS tidak punya properti `label` sama sekali, jadi
//      keempat chip tampil sebagai pil kosong. Bug ini ada sejak fitur
//      pager mobile dibuat (fc2dda4) dan lolos karena repro pertama
//      meng-hardcode labelnya, bukan merender komponen asli. Baris
//      desktop memakai `{tr(f.id)}` — pola yang sama dipakai di sini.
//
// Bagian render memakai renderToString pada komponen ASLI (bukan tiruan
// markup), supaya label kosong seperti bug B tidak bisa lolos lagi.
//
// Jalankan: node src/features/utang/chipRowMobile.test.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import UtangMobile from './UtangMobile.jsx'

// .jsx ini dijalankan Node lewat bundel esbuild (bukan browser), jadi
// process.cwd() tersedia di runtime walau ESLint menganggapnya browser.
// eslint-disable-next-line no-undef
const dirAkar = process.cwd()
const mobile = readFileSync(join(dirAkar, 'src/features/utang/UtangMobile.jsx'), 'utf8')
const desktop = readFileSync(join(dirAkar, 'src/features/utang/UtangView.jsx'), 'utf8')

const galat = []
let total = 0

function cek(nama, ok) {
  total++
  if (ok) console.log(`  ok    ${nama}`)
  else {
    galat.push(nama)
    console.log(`  GAGAL ${nama}`)
  }
}

// ===== 1. Kontrak sumber (chip wrap + ukuran responsif) =====
// Ambil blok baris chip mobile: dari komentar {/* Filter Chips */} sampai
// penutup </div> pertama setelahnya.
const blokChip = mobile.match(/\{[^}]*Filter Chips[^}]*\}([\s\S]*?)<\/div>/)
cek('blok baris chip mobile ditemukan', Boolean(blokChip))
const chip = blokChip ? blokChip[1] : ''
cek('baris chip mobile memakai flex-wrap', chip.includes('flex-wrap'))
cek('baris chip mobile tanpa overflow-x-auto', !chip.includes('overflow-x-auto'))
cek('baris chip mobile tanpa hide-scrollbar', !chip.includes('hide-scrollbar'))
cek('chip mobile memakai tr(f.id) untuk label', chip.includes('tr(f.id)'))
cek('chip mobile tidak lagi memakai f.label', !chip.includes('f.label'))

// Tiga angka ringkasan memakai ukuran responsif.
const jumlahAngka = mobile.split('text-[10px] min-[360px]:text-[11px] sm:text-sm').length - 1
cek(`ketiga angka ringkasan memakai ukuran responsif (${jumlahAngka}/3)`, jumlahAngka === 3)
cek('tidak ada lagi text-[13px] di angka ringkasan mobile', !mobile.includes('text-[13px] sm:text-sm'))

// Tiga kartu ringkasan memakai padding responsif.
const jumlahKartu = mobile.split('p-2 min-[360px]:p-2.5 flex flex-col justify-between').length - 1
cek(`ketiga kartu ringkasan memakai padding responsif (${jumlahKartu}/3)`, jumlahKartu === 3)

// Baris chip desktop tetap wrap (konsistensi pola).
const blokDesktop = desktop.match(/Filter desktop \+ mobile([\s\S]*?)<\/div>/)
cek('baris chip desktop tetap flex-wrap', Boolean(blokDesktop) && blokDesktop[1].includes('flex-wrap'))

// ===== 2. Render komponen asli — label chip HARUS tampil =====
const ringkasan = {
  aktifCount: 8,
  totalSisa: 1192488,
  totalLunasNominal: 2573335,
  lunasCount: 4,
  cicilanAktif: 1,
  totalCicilanPerBulan: 229689,
}
const html = renderToString(
  h(UtangMobile, {
    ringkasan,
    terurut: [],
    filter: 'semua',
    setFilter: () => {},
    onBayar: () => {},
    onLunasin: () => {},
    onEdit: () => {},
    onHapus: () => {},
  }),
)

// Label chip muncul sebagai teks langsung di dalam tombolnya. Periksa HANYA
// di dalam baris chip (bukan seluruh halaman — "Lunas" juga muncul sebagai
// judul kartu ringkasan, jadi cek global akan lolos palsu).
const barisChip = html.match(/flex flex-wrap items-center gap-2 py-2 my-1">([\s\S]*?)<\/div>/)
cek('baris chip ditemukan di hasil render', Boolean(barisChip))
const isiChip = barisChip ? barisChip[1] : ''
console.log('  --- isi baris chip (hasil render) ---')
console.log(`  ${isiChip.replace(/\s+/g, ' ').slice(0, 400)}`)
for (const label of ['Semua', 'Aktif', 'Lunas', 'Terlambat']) {
  cek(`chip mobile merender label "${label}"`, isiChip.includes(`>${label}<`))
}
// Kartu ringkasan ikut tampil (bukti komponen ter-render utuh, bukan kosong).
// Judul kartu ditulis "Total"/"Lunas"/"Cicilan" dan tampil huruf besar
// lewat CSS uppercase, jadi yang dicek adalah teks aslinya.
cek('ringkasan TOTAL tampil', html.includes('>Total<'))
cek('ringkasan LUNAS tampil', html.includes('>Lunas<'))
cek('ringkasan CICILAN tampil', html.includes('>Cicilan<'))

console.log(`\n${galat.length ? 'GAGAL' : 'LULUS'}: ${total - galat.length}/${total} cek lolos`)
if (galat.length) throw new Error(`Kontrak chip mobile gagal: ${galat.join(' | ')}`)
