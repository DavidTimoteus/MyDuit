// Kontrak tampilan mobile Utang & Cicilan — regresi "chip Terlambat terpotong".
//
// Bug yang dikunci (audit 25 Nov 2026, repro headless + font Manrope asli):
//   - Baris chip filter mobile memakai `overflow-x-auto hide-scrollbar`.
//     Keempat chip butuh ~298px, sementara konten HP 320px cuma ~288px,
//     jadi chip "Terlambat" terpotong ~10px tanpa petunjuk bisa di-scroll.
//   - Angka ringkasan (Total/Lunas/Cicilan) memakai `text-[13px]` di kartu
//     3 kolom: "Rp12.500.000" butuh ~86px sementara isi kartu di HP 360px
//     cuma ~84px, jadi terpotong jadi "Rp12.500.0…".
//
// Aturan yang diuji di sini:
//   1. Baris chip mobile HARUS `flex-wrap` (chip yang tak muat turun baris,
//      bukan tersembunyi di scroll horizontal).
//   2. Baris chip mobile TIDAK BOLEH `overflow-x-auto` / `hide-scrollbar`.
//   3. Ketiga angka ringkasan HARUS memakai ukuran responsif
//      `text-[10px] min-[360px]:text-[11px]` (muat penuh di 320px dan 360px).
//   4. Ketiga kartu ringkasan HARUS `p-2 min-[360px]:p-2.5`.
//   5. Baris chip desktop (UtangView.jsx) tetap `flex-wrap` — jangan
//      diseragamkan kembali ke scroll.
//
// Jalankan: node src/features/utang/chipRowMobile.test.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
const mobile = readFileSync(join(dir, 'UtangMobile.jsx'), 'utf8')
const desktop = readFileSync(join(dir, 'UtangView.jsx'), 'utf8')

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

// Ambil blok baris chip mobile: dari komentar {/* Filter Chips */} sampai
// penutup </div> pertama setelahnya.
const blokChip = mobile.match(/\{[^}]*Filter Chips[^}]*\}([\s\S]*?)<\/div>/)
cek('blok baris chip mobile ditemukan', Boolean(blokChip))
const chip = blokChip ? blokChip[1] : ''
cek('baris chip mobile memakai flex-wrap', chip.includes('flex-wrap'))
cek('baris chip mobile tanpa overflow-x-auto', !chip.includes('overflow-x-auto'))
cek('baris chip mobile tanpa hide-scrollbar', !chip.includes('hide-scrollbar'))

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

console.log(`\n${galat.length ? 'GAGAL' : 'LULUS'}: ${total - galat.length}/${total} cek lolos`)
if (galat.length) throw new Error(`Kontrak chip mobile gagal: ${galat.join(' | ')}`)
