// Uji integritas standar desain & anti-regresi tata letak UI (Design Integrity Contract)
// Mencegah kerusakan layout toolbar, layout-thrashing, dan visual clutter lolos uji.
// Jalankan via: node src/styles/designIntegrity.test.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../..')
let total = 0
let lulus = 0
const galat = []

function cek(nama, ok, info = '') {
  total++
  if (ok) {
    lulus++
    console.log(`  ok    ${nama}`)
  } else {
    galat.push(`${nama} ${info}`.trim())
    console.log(`  GAGAL ${nama} ${info}`.trim())
  }
}

// 1. Periksa TransaksiView.jsx: Tombol Catat Transaksi toolbar TIDAK BOLEH tampil di mobile (< 768px)
// Di mobile hanya ada satu pemicu aksi utama: Central FAB bottom nav (standar Clean Mobile UX).
const fileTransaksiView = readFileSync(join(root, 'src/features/transaksi/TransaksiView.jsx'), 'utf8')
const toolbarButtonHiddenOnMobile = fileTransaksiView.includes('hidden h-14 shrink-0 items-center gap-1.5 rounded-[22px] px-4 text-xs font-bold text-white transition-all hover:brightness-105 active:scale-95 md:flex xl:hidden')
cek('toolbar TransaksiView: tombol CTA desktop tersembunyi di mobile (hidden ... md:flex xl:hidden)', toolbarButtonHiddenOnMobile)

// 2. Periksa FormTransaksiModal.jsx: Bebas dari quick chips statis yang mengotori form modal
const fileFormModal = readFileSync(join(root, 'src/features/transaksi/FormTransaksiModal.jsx'), 'utf8')
const tanpaQuickChipsKategori = !fileFormModal.includes('Quick Category Chips')
cek('modal transaksi: bebas dari quick chips redundan di bawah combobox', tanpaQuickChipsKategori)

// 3. Periksa Shell.jsx: Bebas dari key={tab} yang merusak state dan memicu flashing unmount saat ganti menu
const fileShell = readFileSync(join(root, 'src/components/Shell.jsx'), 'utf8')
const tanpaKeyTabUnmount = !fileShell.includes('key={tab}')
cek('shell: navigasi bebas dari key={tab} unmount flashing', tanpaKeyTabUnmount)

// 4. Periksa index.css: Bebas dari content-visibility auto pada kartu transaksi (penyebab scrollbar loncat)
const fileCss = readFileSync(join(root, 'src/styles/index.css'), 'utf8')
const tanpaContentVisibilityTx = !fileCss.includes('content-visibility: auto')
cek('css: .tx-card-item bebas dari content-visibility auto (mencegah scrollbar loncat)', tanpaContentVisibilityTx)

// 5. Periksa index.css: .clay-sheet stabil tanpa scale jump yang berlebihan
const tanpaSheetPopJump = !fileCss.includes('animation: claySheetIn')
cek('css: .clay-sheet stabil tanpa scale/pop animation yang memicu jitter', tanpaSheetPopJump)

console.log(`\n${galat.length ? 'GAGAL' : 'LULUS'}: ${lulus}/${total} cek lolos`)
if (galat.length) throw new Error(`Uji designIntegrity gagal: ${galat.join(' | ')}`)
