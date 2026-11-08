// Uji unit kalkulasi posisi popup (boundary-aware smart flip)
// Jalankan via: node src/components/popupBoundary.test.mjs
import { calculatePopupPos } from './popupPos.js'

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

// 1. Kondisi normal layar desktop/tablet (ruang bawah leluasa)
const rectDesktop = { top: 100, bottom: 144, left: 400, width: 300 }
const posDesktop = calculatePopupPos(rectDesktop, 800, 1200)
cek('desktop: popup membuka ke bawah (top)', posDesktop.top === 150)
cek('desktop: popup bottom diset auto', posDesktop.bottom === 'auto')
cek('desktop: width dipertahankan', posDesktop.width === 300)

// 2. Kondisi layar mobile tertekan keyboard virtual (ruang bawah sempit)
// Mis. tinggi layar 420px (karena keyboard 350px aktif), trigger ada di y=280..324
const rectMobile = { top: 280, bottom: 324, left: 20, width: 320 }
const posMobile = calculatePopupPos(rectMobile, 420, 360)
cek('mobile keyboard: popup flip membuka ke ATAS (bottom)', typeof posMobile.bottom === 'number' && posMobile.bottom > 0)
cek('mobile keyboard: top diset auto', posMobile.top === 'auto')
cek('mobile keyboard: maxHeight dibatasi ruang atas', posMobile.maxHeight <= 280)

// 3. Batas horizontal (clamping agar tidak meluber layar sempit)
const rectOverflow = { top: 100, bottom: 144, left: 350, width: 100 }
const posOverflow = calculatePopupPos(rectOverflow, 800, 360)
cek('clamping: left dijaga tidak melewati batas kanan layar', posOverflow.left + posOverflow.width <= 360)

console.log(`\n${galat.length ? 'GAGAL' : 'LULUS'}: ${lulus}/${total} cek lolos`)
if (galat.length) throw new Error(`Uji popupBoundary gagal: ${galat.join(' | ')}`)
