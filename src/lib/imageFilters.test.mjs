// Uji unit modul filter citra mutakhir (Auto-deskew, CLAHE, Unsharp Mask).
// Jalankan: node src/lib/imageFilters.test.mjs
import { autoDeskew, claheShadowRemoval, unsharpMask, praProsesMutakhir } from './imageFilters.js'

let lulus = 0
let gagal = 0
const galat = []

function cek(nama, dapat, harap) {
  const ok = JSON.stringify(dapat) === JSON.stringify(harap)
  if (ok) lulus++
  else {
    gagal++
    galat.push(`  ✗ ${nama}\n      harap: ${JSON.stringify(harap)}\n      dapat: ${JSON.stringify(dapat)}`)
  }
}

// 1. Guard check saat input null/undefined
cek('autoDeskew aman dengan null', autoDeskew(null), null)
cek('claheShadowRemoval aman dengan null', claheShadowRemoval(null), null)
cek('unsharpMask aman dengan null', unsharpMask(null), null)
cek('praProsesMutakhir aman dengan null', praProsesMutakhir(null), null)

// 2. Mocking minimal Canvas dan ImageData untuk pengujian algoritma di Node
class MockImageData {
  constructor(w, h) {
    this.width = w
    this.height = h
    this.data = new Uint8ClampedArray(w * h * 4)
    // Isi data sintetis (gradien bayangan)
    for (let i = 0; i < this.data.length; i += 4) {
      const g = (i / 4) % 256
      this.data[i] = g
      this.data[i + 1] = g
      this.data[i + 2] = g
      this.data[i + 3] = 255
    }
  }
}

class MockContext2D {
  constructor(canvas) {
    this.canvas = canvas
  }
  getImageData(x, y, w, h) {
    return new MockImageData(w, h)
  }
  putImageData(_imgData, _x, _y) {}
  drawImage() {}
  fillRect() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
}

class MockCanvas {
  constructor(w = 100, h = 100) {
    this.width = w
    this.height = h
  }
  getContext() {
    return new MockContext2D(this)
  }
}

if (typeof document === 'undefined') {
  globalThis.document = {
    createElement: (tag) => {
      if (tag === 'canvas') return new MockCanvas(100, 100)
      return {}
    },
  }
}

const mockCv = new MockCanvas(80, 80)

// 3. Uji eksekusi filter pada canvas
const resDeskew = autoDeskew(mockCv)
cek('autoDeskew menghasilkan objek canvas', Boolean(resDeskew && resDeskew.width), true)

const resClahe = claheShadowRemoval(mockCv)
cek('claheShadowRemoval mempertahankan canvas', Boolean(resClahe && resClahe.width), true)

const resUnsharp = unsharpMask(mockCv)
cek('unsharpMask mempertahankan canvas', Boolean(resUnsharp && resUnsharp.width), true)

const resMutakhir = praProsesMutakhir(mockCv)
cek('praProsesMutakhir menjalankan seluruh rantai filter', Boolean(resMutakhir && resMutakhir.width), true)

console.log(`\n=== UJI IMAGE FILTERS: ${lulus} lulus, ${gagal} gagal ===`)
if (gagal) {
  console.log(galat.join('\n'))
  process.exit(1)
}
console.log('Semua uji filter citra lulus.')
