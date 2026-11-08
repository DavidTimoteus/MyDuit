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

// 6. Periksa index.css: Bebas dari kurva overshoot liar 1.56 (mencegah wobble kartun pada aksi utilitas)
const tanpaOvershootWobble = !fileCss.includes('1.56')
cek('css: bebas dari kurva overshoot liar 1.56 (mencegah wobble pada tombol & kartu utilitas)', tanpaOvershootWobble)

// 7. Periksa index.css: Sistem motion physics terdefinisi (--motion-ease-spring dan durasi sinkron)
const motionPhysicsTerdefinisi = fileCss.includes('--motion-ease-spring') && fileCss.includes('--motion-dur-fast')
cek('css: sistem motion physics terdefinisi (--motion-ease-spring dan durasi sinkron)', motionPhysicsTerdefinisi)

// 8. Periksa FormTransaksiModal.jsx: Menggunakan .clay-segmented-track taktil, bebas dari tombol template bg-red-500
const segmentedTrackTaktil = fileFormModal.includes('clay-segmented-track') && !fileFormModal.includes('bg-red-500 text-white shadow-')
cek('modal transaksi: memakai .clay-segmented-track taktil (bebas dari template button bg-red-500)', segmentedTrackTaktil)

// 9. Periksa TransaksiView.jsx: Bebas dari kelas generik bg-blue-700 shadow-md di toolbar
const toolbarBebasGenericShadow = !fileTransaksiView.includes('bg-blue-700 text-white shadow-md')
cek('toolbar TransaksiView: chip filter memakai token solid-blue (bebas dari bg-blue-700 shadow-md generik)', toolbarBebasGenericShadow)

// 10. Periksa index.css: Kanvas tanah liat hangat styleguide (--clay-bg: #f0f3f0) terdefinisi
const kanvasClayHangat = fileCss.includes('--clay-bg: #f0f3f0;')
cek('css: kanvas tanah liat hangat styleguide (--clay-bg: #f0f3f0) terdefinisi', kanvasClayHangat)

// 11. Periksa index.css: Token ekstrusi 3D claymorphism terdefinisi di :root
const tokenEkstrusi3DTerdefinisi =
  fileCss.includes('--clay-lip-btn-primary') &&
  fileCss.includes('--clay-lip-card') &&
  fileCss.includes('--clay-lip-chip')
cek('css: token ekstrusi 3D claymorphism (--clay-lip-*) terdefinisi di :root', tokenEkstrusi3DTerdefinisi)

// 12. Periksa index.css: Cincin fokus zamrud luminous terdefinisi pada focus-visible
const cincinFokusZamrud = fileCss.includes('rgba(45, 106, 79, 0.35)') && fileCss.includes('--clay-focus-ring')
cek('css: cincin fokus zamrud luminous terpasang pada focus-visible', cincinFokusZamrud)

// 13. Periksa index.css: Sumur galian input (excavated trench) terpasang pada .clay-field & .clay-input
const sumurGalianInput =
  fileCss.includes('inset 3px 3px 6px rgba(0, 0, 0, 0.10)') &&
  fileCss.includes('inset -2px -2px 5px rgba(255, 255, 255, 0.95)')
cek('css: sumur galian input (excavated trench) terpasang pada .clay-field & .clay-input', sumurGalianInput)

// 14. Periksa index.css: Tombol 3D extruded shelf terpasang pada .clay-btn-primary
const tombol3DExtrudedShelf =
  fileCss.includes('0 4px 0 var(--clay-lip-btn-primary)') &&
  fileCss.includes('0 1px 0 var(--clay-lip-btn-primary)')
cek('css: tombol 3D extruded shelf dan kompresi tekan terpasang pada tombol aksi', tombol3DExtrudedShelf)

// 15. Periksa index.css: FAB dome 3D extruded shelf terpasang pada .clay-fab
const fab3DDomeShelf =
  fileCss.includes('0 5px 0 var(--clay-lip-btn-primary)') &&
  fileCss.includes('0 1.5px 0 var(--clay-lip-btn-primary)')
cek('css: FAB central dome 3D extruded shelf terpasang pada .clay-fab', fab3DDomeShelf)

console.log(`\n${galat.length ? 'GAGAL' : 'LULUS'}: ${lulus}/${total} cek lolos`)
if (galat.length) throw new Error(`Uji designIntegrity gagal: ${galat.join(' | ')}`)
