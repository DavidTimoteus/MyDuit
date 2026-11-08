/**
 * imageFilters.js — Pipeline Pra-proses Citra Struk Lanjutan.
 *
 * Mengimplementasikan 3 filter visual tingkat lanjut di browser (<canvas>):
 *  1. Auto-Deskew: Deteksi sudut kemiringan (Radon/Projection Variance) dan rotasi otomatis ke 0°.
 *  2. CLAHE (Contrast Limited Adaptive Histogram Equalization): Menghilangkan bayangan HP/tangan/lipatan kertas.
 *  3. Unsharp Masking: Menajamkan font dot-matrix kasir dan tinta termal pudar.
 */

/**
 * Deteksi sudut kemiringan citra struk dan rotasi otomatis agar teks tegak lurus.
 * Menggunakan variansi profil proyeksi horizontal pada versi thumbnail citra (hemat memori).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} [maxSudut=15] Rentang sudut yang diperiksa (-maxSudut .. +maxSudut)
 * @returns {HTMLCanvasElement} Canvas hasil rotasi (atau canvas asli jika kemiringan minimal)
 */
export function autoDeskew(canvas, maxSudut = 15) {
  if (!canvas || !canvas.getContext) return canvas

  try {
    const w = canvas.width
    const h = canvas.height
    if (w < 50 || h < 50) return canvas

    // 1. Buat versi kecil untuk estimasi sudut cepat (lebar ~320px)
    const scale = Math.min(1, 320 / w)
    const sw = Math.max(1, Math.round(w * scale))
    const sh = Math.max(1, Math.round(h * scale))

    const thumb = document.createElement('canvas')
    thumb.width = sw
    thumb.height = sh
    const tctx = thumb.getContext('2d', { willReadFrequently: true })
    tctx.drawImage(canvas, 0, 0, sw, sh)

    const imgData = tctx.getImageData(0, 0, sw, sh)
    const d = imgData.data
    const gray = new Uint8Array(sw * sh)

    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      gray[j] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0
    }

    // 2. Binarisasi Otsu sederhana pada thumbnail
    let sum = 0
    const hist = new Uint32Array(256)
    for (let j = 0; j < gray.length; j++) {
      hist[gray[j]]++
      sum += gray[j]
    }
    let sumB = 0, wB = 0, maksV = 0, threshold = 128
    const totalPx = sw * sh
    for (let t = 0; t < 256; t++) {
      wB += hist[t]
      if (wB === 0) continue
      const wF = totalPx - wB
      if (wF === 0) break
      sumB += t * hist[t]
      const mB = sumB / wB
      const mF = (sum - sumB) / wF
      const varAntara = wB * wF * (mB - mF) * (mB - mF)
      if (varAntara > maksV) {
        maksV = varAntara
        threshold = t
      }
    }

    const bin = new Uint8Array(sw * sh)
    for (let j = 0; j < gray.length; j++) {
      bin[j] = gray[j] < threshold ? 1 : 0 // 1 untuk teks hitam
    }

    // 3. Scan profil proyeksi horizontal pada rentang sudut -maxSudut s/d +maxSudut
    let sudutTerbaik = 0
    let variansiTerbaik = -1

    for (let sudut = -maxSudut; sudut <= maxSudut; sudut += 1.5) {
      const rad = (sudut * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      const cy = sh / 2
      const cx = sw / 2

      // Hitung profil proyeksi baris
      const profil = new Float32Array(sh)
      for (let y = 0; y < sh; y += 2) {
        for (let x = 0; x < sw; x += 2) {
          if (bin[y * sw + x] === 1) {
            // Transformasi koordinat y setelah rotasi
            const yr = Math.round((x - cx) * sin + (y - cy) * cos + cy)
            if (yr >= 0 && yr < sh) {
              profil[yr]++
            }
          }
        }
      }

      // Variansi profil baris: baris teks rata akan menghasilkan puncak dan lembah tajam
      let mean = 0
      for (let y = 0; y < sh; y++) mean += profil[y]
      mean /= sh

      let varProfil = 0
      for (let y = 0; y < sh; y++) {
        const diff = profil[y] - mean
        varProfil += diff * diff
      }

      if (varProfil > variansiTerbaik) {
        variansiTerbaik = varProfil
        sudutTerbaik = sudut
      }
    }

    // Jika sudut kemiringan di bawah 1.0°, abaikan rotasi untuk menghemat komputasi
    if (Math.abs(sudutTerbaik) < 1.0) return canvas

    // 4. Putar canvas asli sesuai sudut terbaik
    const outCanvas = document.createElement('canvas')
    const rad = (-sudutTerbaik * Math.PI) / 180
    const cos = Math.abs(Math.cos(rad))
    const sin = Math.abs(Math.sin(rad))

    const newW = Math.round(w * cos + h * sin)
    const newH = Math.round(w * sin + h * cos)

    outCanvas.width = newW
    outCanvas.height = newH
    const ctx = outCanvas.getContext('2d', { willReadFrequently: true })

    // Latar belakang putih
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, newW, newH)

    ctx.save()
    ctx.translate(newW / 2, newH / 2)
    ctx.rotate(rad)
    ctx.drawImage(canvas, -w / 2, -h / 2)
    ctx.restore()

    return outCanvas
  } catch (err) {
    console.warn('[imageFilters-deskew] gagal, memakai citra asli:', err)
    return canvas
  }
}

/**
 * CLAHE (Contrast Limited Adaptive Histogram Equalization).
 * Menghilangkan gradien bayangan tangan/HP dan menormalkan kontras lokal di seluruh area struk.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} [gridSize=8] Jumlah blok grid per dimensi (8x8)
 * @param {number} [clipLimit=3.0] Batas pemotongan histogram agar noise tidak meledak
 * @returns {HTMLCanvasElement}
 */
export function claheShadowRemoval(canvas, gridSize = 8, clipLimit = 3.0) {
  if (!canvas || !canvas.getContext) return canvas

  try {
    const w = canvas.width
    const h = canvas.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const imgData = ctx.getImageData(0, 0, w, h)
    const d = imgData.data
    const totalPx = w * h

    // Grayscale buffer
    const gray = new Uint8Array(totalPx)
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      gray[j] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0
    }

    const tileW = Math.ceil(w / gridSize)
    const tileH = Math.ceil(h / gridSize)

    // Hitung CDF ternormalisasi untuk tiap tile
    const cdfs = []
    for (let ty = 0; ty < gridSize; ty++) {
      cdfs[ty] = []
      for (let tx = 0; tx < gridSize; tx++) {
        const x0 = tx * tileW
        const y0 = ty * tileH
        const x1 = Math.min(w, x0 + tileW)
        const y1 = Math.min(h, y0 + tileH)
        const nTilePx = (x1 - x0) * (y1 - y0)

        // 1. Histogram lokal
        const hist = new Uint32Array(256)
        for (let y = y0; y < y1; y++) {
          const rowOff = y * w
          for (let x = x0; x < x1; x++) {
            hist[gray[rowOff + x]]++
          }
        }

        // 2. Clip histogram
        const clipVal = Math.max(1, Math.round(clipLimit * (nTilePx / 256)))
        let excess = 0
        for (let i = 0; i < 256; i++) {
          if (hist[i] > clipVal) {
            excess += hist[i] - clipVal
            hist[i] = clipVal
          }
        }
        const redist = (excess / 256) | 0
        for (let i = 0; i < 256; i++) hist[i] += redist

        // 3. Cumulative Distribution Function (CDF)
        const cdf = new Uint8Array(256)
        let acc = 0
        for (let i = 0; i < 256; i++) {
          acc += hist[i]
          cdf[i] = Math.min(255, Math.round((acc / nTilePx) * 255))
        }
        cdfs[ty][tx] = cdf
      }
    }

    // 4. Bilinear Interpolation antar tile untuk tiap piksel
    for (let y = 0; y < h; y++) {
      const tyF = (y / tileH) - 0.5
      const ty0 = Math.max(0, Math.min(gridSize - 1, Math.floor(tyF)))
      const ty1 = Math.max(0, Math.min(gridSize - 1, ty0 + 1))
      const dy = Math.max(0, Math.min(1, tyF - ty0))
      const rowOff = y * w

      for (let x = 0; x < w; x++) {
        const txF = (x / tileW) - 0.5
        const tx0 = Math.max(0, Math.min(gridSize - 1, Math.floor(txF)))
        const tx1 = Math.max(0, Math.min(gridSize - 1, tx0 + 1))
        const dx = Math.max(0, Math.min(1, txF - tx0))

        const val = gray[rowOff + x]
        const c00 = cdfs[ty0][tx0][val]
        const c01 = cdfs[ty0][tx1][val]
        const c10 = cdfs[ty1][tx0][val]
        const c11 = cdfs[ty1][tx1][val]

        const top = c00 * (1 - dx) + c01 * dx
        const btm = c10 * (1 - dx) + c11 * dx
        const newVal = Math.round(top * (1 - dy) + btm * dy)

        const idx = (rowOff + x) * 4
        d[idx] = newVal
        d[idx + 1] = newVal
        d[idx + 2] = newVal
      }
    }

    ctx.putImageData(imgData, 0, 0)
    return canvas
  } catch (err) {
    console.warn('[imageFilters-clahe] gagal, memakai citra asli:', err)
    return canvas
  }
}

/**
 * Unsharp Masking filter: Menajamkan tepian karakter dot-matrix kasir dan teks termal tipis.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} [amount=1.2] Kekuatan penajaman (1.0 .. 2.0)
 * @returns {HTMLCanvasElement}
 */
export function unsharpMask(canvas, amount = 1.2) {
  if (!canvas || !canvas.getContext) return canvas

  try {
    const w = canvas.width
    const h = canvas.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const imgData = ctx.getImageData(0, 0, w, h)
    const px = imgData.data
    const totalPx = w * h

    // Salin luminansi untuk blur
    const orig = new Uint8Array(totalPx)
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      orig[j] = px[i] // citra sudah berupa skala abu-abu
    }

    // Box blur 3x3 cepat
    const blurred = new Uint8Array(totalPx)
    for (let y = 1; y < h - 1; y++) {
      const yPrev = (y - 1) * w
      const yCurr = y * w
      const yNext = (y + 1) * w
      for (let x = 1; x < w - 1; x++) {
        const sum =
          orig[yPrev + x - 1] + orig[yPrev + x] + orig[yPrev + x + 1] +
          orig[yCurr + x - 1] + orig[yCurr + x] + orig[yCurr + x + 1] +
          orig[yNext + x - 1] + orig[yNext + x] + orig[yNext + x + 1]
        blurred[yCurr + x] = (sum / 9) | 0
      }
    }

    // Rumus penajaman: Sharp = Orig + amount * (Orig - Blurred)
    for (let j = 0; j < totalPx; j++) {
      const diff = orig[j] - blurred[j]
      let val = orig[j] + Math.round(diff * amount)
      val = val < 0 ? 0 : val > 255 ? 255 : val
      const idx = j * 4
      px[idx] = val
      px[idx + 1] = val
      px[idx + 2] = val
    }

    ctx.putImageData(imgData, 0, 0)
    return canvas
  } catch (err) {
    console.warn('[imageFilters-unsharp] gagal, memakai citra asli:', err)
    return canvas
  }
}

/**
 * Pipeline Pra-proses Citra Struk Komprehensif.
 * Memadukan Auto-Deskew -> CLAHE Shadow Removal -> Unsharp Masking.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {HTMLCanvasElement}
 */
export function praProsesMutakhir(canvas) {
  if (!canvas) return canvas
  // 1. Luruskan kemiringan struk jika difoto tidak sejajar
  const deskewed = autoDeskew(canvas, 15)
  // 2. Ratakan kontras lokal & singkirkan bayangan gelap
  const equalized = claheShadowRemoval(deskewed, 8, 3.0)
  // 3. Tajamkan teks dot-matrix / cetakan termal pudar
  return unsharpMask(equalized, 1.2)
}
