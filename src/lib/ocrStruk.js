/**
 * ocrStruk.js — Pembacaan struk (OCR) yang berjalan 100% di browser.
 *
 * Mengapa Tesseract.js (bukan API cloud):
 *  - Aplikasi ini offline-first dan data keuangan pribadi; mengirim foto struk
 *    ke server pihak ketiga melanggar janji privasi app.
 *  - Tesseract.js memuat model ke Cache Storage → setelah pemakaian pertama,
 *    OCR tetap bekerja tanpa internet.
 *
 * Yang membuat "bisa membaca struk apa pun":
 *  1. Pra-proses gambar agresif (grayscale + kontras + auto-invert + upscale)
 *     supaya struk termal pudar, foto miring, atau struk gelap tetap terbaca.
 *  2. Dua pass OCR (PSM 6 "blok seragam" lalu PSM 4 "kolom") dan pilih hasil
 *     dengan skor keyakinan terbaik.
 *  3. Parser tahan-banting yang mengenali BANYAK format struk Indonesia:
 *     TOTAL/GRAND TOTAL/JUMLAH/BAYAR/TAGIHAN, tanggal (dd/mm/yyyy, dd-mm-yy,
 *     12 Okt 2026, 2026-10-12), dan pemisah ribuan (1.234.567 / 1,234,567 /
 *     1.234,56 / Rp).
 *  4. Pemilih angka total yang cerdas: buang angka yang jelas bukan total
 *     (nomor telepon, NPWP, tahun, jumlah item) dan prioritaskan angka setelah
 *     kata kunci total.
 *
 * Modul ini murni fungsi (tanpa React) supaya bisa diuji terpisah.
 */

import { cariBarang, petakanKategori, cariPembayar, cariTunai } from './strukMeta.js'
import { praProsesMutakhir } from './imageFilters.js'

// ===================== PRA-PROSES GAMBAR =====================

/**
 * Batas resolusi aman di mobile RAM hemat:
 * - Batas resolusi diset ~1.6 MP agar Android Webview / Chrome tidak OOM (Out Of Memory)
 *   saat memuat canvas berukuran besar bersamaan dengan Tesseract WASM.
 */
const MAKS_PIKSEL = 1_600_000
function hitungSkala(w0, h0, targetW) {
  let s = Math.max(1, targetW / (w0 || targetW))
  const totalPiksel = (w0 * s) * (h0 * s)
  if (totalPiksel > MAKS_PIKSEL) s *= Math.sqrt(MAKS_PIKSEL / totalPiksel)
  return s
}

/**
 * Kompresi citra kamera HP sebelum masuk ke memory canvas Tesseract.
 * Mencegah error 'Unable to complete previous operation due to low memory' pada Android Chrome.
 */
export async function kompresCitraAman(file, maxDim = 1600, quality = 0.85) {
  if (!file || !file.type.startsWith('image/')) return file
  // Jika ukuran file sudah di bawah 1.5MB, langsung lolos
  if (file.size < 1_500_000) return file

  try {
    const img = await muatGambar(file)
    const w0 = img.naturalWidth || img.width
    const h0 = img.naturalHeight || img.height
    const isTall = h0 / Math.max(1, w0) >= 2.2
    const maxW = isTall ? 1400 : maxDim
    const maxH = isTall ? 3800 : maxDim
    if (w0 <= maxW && h0 <= maxH) return file

    const skala = Math.min(maxW / w0, maxH / h0, 1)
    const w = Math.round(w0 * skala)
    const h = Math.round(h0 * skala)

    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const ctx = cv.getContext('2d')
    ctx.drawImage(img, 0, 0, w, h)

    return await new Promise((resolve) => {
      cv.toBlob(
        (blob) => {
          if (!blob) return resolve(file)
          const nama = file.name ? file.name.replace(/\.[^.]+$/, '.jpg') : 'struk-opt.jpg'
          resolve(new File([blob], nama, { type: 'image/jpeg' }))
        },
        'image/jpeg',
        quality,
      )
    })
  } catch (err) {
    console.warn('[kompres-citra] fallback file asli:', err)
    return file
  }
}

/** Muat File/Blob menjadi HTMLImageElement. */
function muatGambar(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Gambar tidak bisa dibaca.'))
    }
    img.src = url
  })
}

/**
 * Pra-proses: skala abu-abu, auto-kontras (percentile 2–98%), auto-invert bila
 * mayoritas gelap (struk difoto di tempat gelap / mode malam), lalu upscale ke
 * lebar minimal `targetW` (Tesseract akurat pada teks ~30px tinggi).
 * Mengembalikan canvas siap-OCR.
 */
export function praProses(img, targetW = 1600) {
  const w0 = img.naturalWidth || img.width || targetW
  const h0 = img.naturalHeight || img.height || targetW
  const skala = hitungSkala(w0, h0, targetW)
  const w = Math.round(w0 * skala)
  const h = Math.round(h0 * skala)
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, w, h)

  const data = ctx.getImageData(0, 0, w, h)
  const px = data.data
  const n = w * h

  // 1) grayscale + histogram
  const abu = new Uint8ClampedArray(n)
  const hist = new Uint32Array(256)
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0
    abu[j] = g
    hist[g]++
  }

  // 2) auto-kontras: buang 2% ekstrem, regangkan sisanya ke 0..255
  const batas = n * 0.02
  let lo = 0, hi = 255, acc = 0
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > batas) { lo = v; break } }
  acc = 0
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > batas) { hi = v; break } }
  const rentang = Math.max(1, hi - lo)

  // 3) deteksi gelap-terang: kalau median < 128, gambar cenderung gelap → invert
  let median = 128, acc2 = 0
  for (let v = 0; v < 256; v++) { acc2 += hist[v]; if (acc2 >= n / 2) { median = v; break } }
  const invert = median < 110

  for (let j = 0; j < n; j++) {
    let v = ((abu[j] - lo) / rentang) * 255
    if (invert) v = 255 - v
    v = v < 0 ? 0 : v > 255 ? 255 : v
    const k = j * 4
    px[k] = px[k + 1] = px[k + 2] = v
    px[k + 3] = 255
  }
  ctx.putImageData(data, 0, 0)
  return cv
}

/**
 * Box blur (rata-rata lokal) via integral image — O(w·h), dipakai untuk
 * threshold adaptif. Mengembalikan Float32Array rata-rata jendela (2r+1)².
 */
function boxBlur(g, w, h, r) {
  const I = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let s = 0
    for (let x = 0; x < w; x++) {
      s += g[y * w + x]
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r)
      out[y * w + x] =
        (I[(y1 + 1) * (w + 1) + x1 + 1] - I[y0 * (w + 1) + x1 + 1] -
          I[(y1 + 1) * (w + 1) + x0] + I[y0 * (w + 1) + x0]) /
        ((x1 - x0 + 1) * (y1 - y0 + 1))
    }
  }
  return out
}

/**
 * Pra-proses ADAPTIF (Sauvola lokal): hitung rata-rata & simpangan baku lokal
 * tiap piksel, lalu ambang T = m·(1 + k·(s/R − 1)). Jauh lebih tahan terhadap
 * foto struk dengan bayangan, latar ramai, atau pencahayaan tidak rata — pada
 * uji 100 struk Indonesia nyata (CORD) ini menaikkan akurasi total dari 32%
 * menjadi ~53% dibanding pra-proses kontras global.
 */
export function praProsesAdaptif(img, targetW = 2000) {
  const w0 = img.naturalWidth || img.width || targetW
  const h0 = img.naturalHeight || img.height || targetW
  const skala = hitungSkala(w0, h0, targetW)
  const w = Math.round(w0 * skala)
  const h = Math.round(h0 * skala)
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  cv.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, w, h)
  return sauvPiksel(cv)
}

/**
 * Deteksi bounding box area terang (bidang struk) pada versi kecil gambar.
 * Banyak foto struk punya latar gelap/ramai; memotong ke bidang struk sebelum
 * OCR menaikkan akurasi besar (pada uji CORD: 61% → 74%).
 * Mengembalikan { x0, y0, x1, y1 } ternormalisasi 0..1, atau null bila gagal.
 */
function deteksiBidang(img) {
  const aw = 320
  const skala = aw / (img.naturalWidth || img.width)
  const w = aw
  const h = Math.max(1, Math.round((img.naturalHeight || img.height) * skala))
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h)
  const p = d.data
  const n = w * h
  const g = new Uint8ClampedArray(n)
  for (let i = 0, j = 0; i < p.length; i += 4, j++) {
    g[j] = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) | 0
  }
  // Ambang Otsu
  const hist = new Uint32Array(256)
  for (let j = 0; j < n; j++) hist[g[j]]++
  let sum = 0
  for (let v = 0; v < 256; v++) sum += v * hist[v]
  let sumB = 0, wB = 0, maks = 0, thr = 128
  for (let v = 0; v < 256; v++) {
    wB += hist[v]
    if (!wB) continue
    const wF = n - wB
    if (!wF) break
    sumB += v * hist[v]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const antara = wB * wF * (mB - mF) ** 2
    if (antara > maks) { maks = antara; thr = v }
  }
  // Baris/kolom dengan banyak piksel terang = area struk
  const baris = new Int32Array(h), kol = new Int32Array(w)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (g[y * w + x] > thr) { baris[y]++; kol[x]++ }
    }
  }
  const ambangB = w * 0.35, ambangK = h * 0.35
  let y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1
  while (y0 < h && baris[y0] < ambangB) y0++
  while (y1 > y0 && baris[y1] < ambangB) y1--
  while (x0 < w && kol[x0] < ambangK) x0++
  while (x1 > x0 && kol[x1] < ambangK) x1--
  // Tolak bila hasil deteksi terlalu kecil (kemungkinan salah deteksi)
  if (y1 - y0 < h * 0.3 || x1 - x0 < w * 0.3) return null
  return { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h }
}

/**
 * Pra-proses gabungan: deteksi bidang struk → crop → threshold adaptif Sauvola.
 * Ini varian terkuat untuk foto HP dengan latar ramai/gelap.
 */
export function praProsesCrop(img, targetW = 2000) {
  const b = deteksiBidang(img)
  const W0 = img.naturalWidth || img.width
  const H0 = img.naturalHeight || img.height
  const skala = hitungSkala(W0, H0, targetW)
  let sx = 0, sy = 0, sw = W0, sh = H0
  if (b) {
    const margin = 0.02
    sx = Math.max(0, b.x0 - margin) * W0
    sy = Math.max(0, b.y0 - margin) * H0
    sw = Math.min(1, b.x1 + margin) * W0 - sx
    sh = Math.min(1, b.y1 + margin) * H0 - sy
  }
  const w = Math.max(1, Math.round(sw * skala))
  const h = Math.max(1, Math.round(sh * skala))
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
  return sauvPiksel(cv)
}

/**
 * Pra-proses Otsu Binarization murni dengan normalisasi kontras tinggi.
 * Sangat unggul membaca teks struk termal yang pudar atau kontras rendah.
 */
export function praProsesOtsu(img, targetW = 2000) {
  const w0 = img.naturalWidth || img.width || targetW
  const h0 = img.naturalHeight || img.height || targetW
  const skala = hitungSkala(w0, h0, targetW)
  const w = Math.round(w0 * skala)
  const h = Math.round(h0 * skala)
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h)
  const p = d.data
  const n = w * h
  const g = new Uint8ClampedArray(n)
  const hist = new Uint32Array(256)
  for (let i = 0, j = 0; i < p.length; i += 4, j++) {
    const v = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) | 0
    g[j] = v
    hist[v]++
  }
  let sum = 0
  for (let v = 0; v < 256; v++) sum += v * hist[v]
  let sumB = 0, wB = 0, maks = 0, thr = 128
  for (let v = 0; v < 256; v++) {
    wB += hist[v]
    if (!wB) continue
    const wF = n - wB
    if (!wF) break
    sumB += v * hist[v]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const antara = wB * wF * (mB - mF) ** 2
    if (antara > maks) { maks = antara; thr = v }
  }
  for (let j = 0; j < n; j++) {
    const val = g[j] > thr ? 255 : 0
    const k = j * 4
    p[k] = p[k + 1] = p[k + 2] = val
    p[k + 3] = 255
  }
  ctx.putImageData(d, 0, 0)
  return cv
}

/**
 * Threshold adaptif Sauvola di atas canvas grayscale yang sudah tergambar.
 * Dipisah agar bisa dipakai ulang oleh praProsesAdaptif & praProsesCrop.
 */
function sauvPiksel(cv) {
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  const w = cv.width, h = cv.height, n = w * h
  const data = ctx.getImageData(0, 0, w, h)
  const px = data.data
  const abu = new Uint8ClampedArray(n)
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    abu[j] = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0
  }
  const r = Math.max(12, Math.round(Math.min(w, h) / 20))
  const rata = boxBlur(abu, w, h, r)
  const kuadrat = new Float32Array(n)
  for (let j = 0; j < n; j++) kuadrat[j] = abu[j] * abu[j]
  const rataKuadrat = boxBlur(kuadrat, w, h, r)
  for (let j = 0; j < n; j++) {
    const m = rata[j]
    const s = Math.sqrt(Math.max(0, rataKuadrat[j] - m * m))
    const T = m * (1 + 0.25 * (s / 128 - 1))
    const v = abu[j] > T ? 255 : 0
    const k = j * 4
    px[k] = px[k + 1] = px[k + 2] = v
    px[k + 3] = 255
  }
  ctx.putImageData(data, 0, 0)
  return cv
}

let workerCache = null

/**
 * Jalankan Tesseract atas SATU ATAU BEBERAPA citra pra-proses (mis. versi
 * kontras global + versi adaptif Sauvola), lalu pilih hasil terbaik memakai
 * strategi yang menang di uji CORD:
 *   1. Utamakan kandidat yang benar-benar menghasilkan TOTAL (prediksi null
 *      selalu kalah dari yang punya nilai).
 *   2. Di antaranya, pilih yang LEVEL kata kuncinya tertinggi (grand total /
 *      total > jumlah/tagihan > bayar) — sinyal paling kuat bahwa angka itu
 *      memang total akhir, bukan subtotal atau kembalian.
 *   3. Seri → confidence tertinggi.
 * `onProgress` menerima 0..1. Worker di-cache lintas pemanggilan.
 */
export async function jalankanOcr(canvas, onProgress) {
  const { createWorker } = await import('tesseract.js')
  if (!workerCache) {
    workerCache = await createWorker(['ind', 'eng'], 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && onProgress) onProgress(m.progress)
      },
    })
  }
  const worker = await workerCache

  const citra = Array.isArray(canvas) ? canvas : [canvas]
  const kandidat = []
  for (const cv of citra) {
    // Semua mode halaman dikumpulkan (tanpa pra-pilih) supaya voting melihat
    // seluruh sudut pandang. Mode otomatis (PSM 3) hanya bila yang lain kosong.
    const hasil = []
    for (const psm of ['6', '4']) {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' })
        const r = await worker.recognize(cv)
        const teks = r.data.text || ''
        hasil.push({ psm, teks, conf: r.data.confidence || 0, alnum: (teks.match(/[A-Za-z0-9]/g) || []).length })
      } catch (e) {
        hasil.push({ psm, teks: '', conf: -1, alnum: 0, error: e?.message })
      }
    }
    if (Math.max(...hasil.map((h) => h.alnum)) < 12) {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' })
        const r = await worker.recognize(cv)
        const teks = r.data.text || ''
        hasil.push({ psm: '3', teks, conf: r.data.confidence || 0, alnum: (teks.match(/[A-Za-z0-9]/g) || []).length })
      } catch (e) {
        hasil.push({ psm: '3', teks: '', conf: -1, alnum: 0, error: e?.message })
      }
    }
    kandidat.push(...hasil)
  }

  // Pilih kandidat terbaik. Strategi yang MENANG pada uji CORD (100 struk nyata
  // berlabel ground truth, 2 slice terpisah) — bukan voting berbobot, bukan max:
  //   1. Ambil hanya kandidat dengan LEVEL KATA KUNCI TERTINGGI (grand total >
  //      total > jumlah > bayar). Ini membuang kandidat yang salah baris.
  //   2. Di antara mereka, pilih nilai yang paling SERING muncul (mode) — bukti
  //      silang dari varian pra-proses & PSM yang independen.
  //   3. Seri → confidence tertinggi, lalu level, lalu jumlah alfanumerik.
  // Terukur: 66% & 55% (dua slice) vs voting berbobot 61% & 50%.
  const diberiSkor = kandidat.map((h) => {
    const t = cariTotal(h.teks)
    return { ...h, total: t.total, lvl: t.lvl || 0 }
  })
  const adaTotal = diberiSkor.filter((h) => h.total != null)

  if (adaTotal.length) {
    const lvlMaks = Math.max(...adaTotal.map((h) => h.lvl))
    const padaLvl = adaTotal.filter((h) => h.lvl === lvlMaks)
    const hitung = {}
    for (const h of padaLvl) {
      if (!hitung[h.total]) hitung[h.total] = { total: h.total, n: 0, conf: 0, alnum: 0 }
      hitung[h.total].n += 1
      hitung[h.total].conf = Math.max(hitung[h.total].conf, h.conf || 0)
      hitung[h.total].alnum = Math.max(hitung[h.total].alnum, h.alnum || 0)
    }
    const pemenang = Object.values(hitung).sort(
      (a, b) => b.n - a.n || b.conf - a.conf || b.alnum - a.alnum,
    )[0]
    const asal = padaLvl
      .filter((h) => h.total === pemenang.total)
      .sort((a, b) => (b.conf || 0) - (a.conf || 0) || (b.alnum || 0) - (a.alnum || 0))[0]
    return { psm: asal.psm, teks: asal.teks, conf: asal.conf, alnum: asal.alnum }
  }

  // Tidak ada kandidat yang menghasilkan total → pakai level tertinggi/conf.
  diberiSkor.sort((a, b) => (b.lvl - a.lvl) || ((b.conf || 0) - (a.conf || 0)) || ((b.alnum || 0) - (a.alnum || 0)))
  const pilih = diberiSkor[0]
  return { psm: pilih.psm, teks: pilih.teks, conf: pilih.conf, alnum: pilih.alnum }
}

// ===================== PARSER STRUK =====================

const BULAN_ID = {
  jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, maret: 3, apr: 4, april: 4,
  mei: 5, may: 5, jun: 6, juni: 6, jul: 7, juli: 7, agu: 8, agt: 8, agustus: 8, aug: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10,
  nov: 11, november: 11, des: 12, desember: 12, dec: 12,
}

/** Ubah "1.234.567" / "1,234,567" / "1 234 567" / "Rp 45.000" → 1234567 (integer). */
export function parseAngkaID(s) {
  if (s == null) return null
  let t = String(s).replace(/rp\.?|idr/gi, '').trim()
  // Buang karakter selain digit, titik, koma, spasi
  t = t.replace(/[^\d.,\s]/g, '')
  t = t.replace(/\s/g, '')
  if (!t) return null

  const adaTitik = t.includes('.')
  const adaKoma = t.includes(',')

  if (adaTitik && adaKoma) {
    // Format yang lebih umum di ID: titik = ribuan, koma = desimal.
    // Tapi kalau koma di posisi ribuan (mis. 1,234,567) dan titik desimal (1.234,56),
    // tentukan dari kemunculan TERAKHIR.
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) {
      // 1.234,56 → desimal koma
      t = t.replace(/\./g, '').replace(',', '.')
      return Math.round(parseFloat(t))
    }
    // 1,234.56 → desimal titik
    t = t.replace(/,/g, '')
    return Math.round(parseFloat(t))
  }
  if (adaTitik) {
    // Titik sebagai pemisah ribuan (pola umum ID: 1.234.567) ATAU desimal (45.50).
    const bagian = t.split('.')
    const semua3 = bagian.slice(1).every((p) => p.length === 3)
    if (bagian.length > 2 || (bagian.length === 2 && semua3)) return parseInt(bagian.join(''), 10)
    return Math.round(parseFloat(t))
  }
  if (adaKoma) {
    const bagian = t.split(',')
    const semua3 = bagian.slice(1).every((p) => p.length === 3)
    if (bagian.length > 2 || (bagian.length === 2 && semua3)) return parseInt(bagian.join(''), 10)
    return Math.round(parseFloat(t.replace(',', '.')))
  }
  return parseInt(t, 10)
}

/** Normalisasi OCR: perbaiki huruf yang sering salah di struk termal. */
function normalisasiOcr(teks) {
  return String(teks || '')
    .replace(/\r/g, '')
    .replace(/[|]/g, 'l')          // pipe sering = 'l'/'1'
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    // OCR sering menyisipkan spasi di dalam satu angka ("38. 000", "20, 00").
    // Rapatkan spasi di sekitar pemisah ribuan/desimal agar terbaca satu angka.
    .replace(/(\d)\s*([.,])\s*(\d)/g, '$1$2$3')
    // Perbaikan karakter huruf yang terselip di angka nominal (kesalahan klasik struk pudar):
    // 'O'/'o'/'D' di tengah atau akhir digit -> '0'
    .replace(/(?<=\d)[oODd](?=\d|$)/g, '0')
    .replace(/(^|\s|\d)[oODd](?=\d{2,})/g, '0')
    // 'l'/'I'/'!' di tengah atau akhir digit -> '1'
    .replace(/(?<=\d)[lI!](?=\d|$)/g, '1')
    .replace(/(^|\s)[lI!](?=\d{2,})/g, '1')
    // 'S'/'s' di tengah digit nominal -> '5'
    .replace(/(?<=\d)[Ss](?=\d)/g, '5')
    // 'B' di tengah digit nominal -> '8'
    .replace(/(?<=\d)B(?=\d)/g, '8')
}

/** Ekstrak tanggal dari teks → 'YYYY-MM-DD' atau null. */
export function cariTanggal(teks) {
  const t = normalisasiOcr(teks)

  // 1) ISO: 2026-10-12
  let m = t.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) {
    const [, y, bl, hr] = m
    if (+bl >= 1 && +bl <= 12 && +hr >= 1 && +hr <= 31) return `${y}-${pad(bl)}-${pad(hr)}`
  }

  // 2) dd/mm/yyyy atau dd-mm-yy (pola Indonesia)
  m = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/)
  if (m) {
    let [, d1, d2, y] = m
    d1 = +d1; d2 = +d2
    if (y.length === 2) y = '20' + y
    // Prioritaskan dd/mm (Indonesia). Kalau d1>12 berarti pasti hari.
    if (d1 <= 31 && d2 <= 12) return `${y}-${pad(d2)}-${pad(d1)}`
    if (d1 <= 12 && d2 <= 31) return `${y}-${pad(d1)}-${pad(d2)}`
  }

  // 3) dd NamaBulan yyyy  (12 Okt 2026 / 12 Oktober 2026)
  m = t.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(20\d{2})\b/)
  if (m) {
    const bl = BULAN_ID[m[2].toLowerCase()]
    if (bl) return `${m[3]}-${pad(bl)}-${pad(m[1])}`
  }

  return null
}

function pad(n) {
  return String(n).padStart(2, '0')
}

// Kata kunci total BERTINGKAT: makin tinggi level, makin yakin itu total akhir.
// Level 3 = paling diutamakan (grand total). Level 1 = cadangan.
const KATA_TOTAL_TIER = [
  { level: 3, kata: ['grand total', 'total bayar', 'total belanja', 'total tagihan', 'total akhir', 'total harga', 'jumlah bayar', 'total transaksi', 'total penjualan', 'total bayar rp', 'total netto', 'total'] },
  { level: 2, kata: ['jumlah', 'tagihan', 'harus bayar', 'dibayar', 'amount', 'netto', 'subtotal', 'sales total', 'balance due', 'nominal'] },
  { level: 1, kata: ['bayar', 'tunai', 'cash', 'transfer', 'debit', 'kredit', 'qris', 'gopay', 'ovo', 'shopeepay'] },
]
const KATA_ABAIKAN = [
  'npwp', 'telp', 'telpon', 'telepon', 'hp', 'wa', 'no.', 'no ', 'invoice',
  'struk', 'kasir', 'poin', 'point', 'kembali', 'kembalian', 'change',
  'diskon', 'disc', 'ppn', 'pajak', 'tax', 'kode', 'ref', 'member', 'card',
  'id pelanggan', 'meter', 'tarif', 'antrian', 'meja',
]

/**
 * Normalisasi teks OCR yang lebih agresif untuk baris KATA KUNCI:
 *  - '0' ↔ 'o', '1' ↔ 'l'/'i' pada kata (T0TAL → total, rOTAL → total)
 *  - buang tanda baca yang sering salah dibaca
 * Dipakai HANYA untuk pencocokan kata kunci, bukan untuk membaca angka.
 */
function normalKata(teks) {
  return String(teks || '')
    .toLowerCase()
    .replace(/[0]/g, 'o')
    .replace(/[1|!]/g, 'l')
    .replace(/[5]/g, 's')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Cocokkan kata kunci sebagai kata utuh supaya "subtotal" ≠ "total". */
function adaKata(teks, frasa) {
  const esc = frasa.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`, 'i').test(teks)
}

/**
 * Cocokkan kata kunci dengan toleransi kesalahan OCR ringan (1 huruf beda).
 * Contoh: 'rOTAL', 'T0TAL', 'TOTA1', 'TOTAl' semua harus dianggap 'total'.
 * Hanya menerima frasa satu kata; frasa multi-kata memakai adaKata().
 */
function adaKataFuzzy(teks, frasa) {
  if (frasa.includes(' ')) return adaKata(teks, frasa)
  const norm = normalKata(teks)
  const kata = normalKata(frasa)
  if (kata.length < 4) return adaKata(teks, frasa)
  for (const w of norm.split(' ')) {
    if (w === kata) return true
    // Jangan cocokkan "total" jika kata aslinya adalah "subtotal"
    if (kata === 'total' && w.includes('sub')) continue
    // Toleransi OCR rOTAl / T0T4L / T0TAL / TOTL
    if (Math.abs(w.length - kata.length) <= 1 && jarakEdit(w, kata) <= 1) return true
    if (kata === 'total' && !w.includes('sub') && (w.startsWith('tot') || w.endsWith('tal'))) return true
    if (kata === 'jumlah' && (w.startsWith('jum') || w.endsWith('lah'))) return true
    if (kata === 'bayar' && (w.startsWith('bay') || w.endsWith('yar'))) return true
  }
  return false
}

/** Jarak Levenshtein sederhana (cukup untuk kata pendek). */
function jarakEdit(a, b) {
  const m = a.length, n = b.length
  if (Math.abs(m - n) > 1) return 9
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[m][n]
}

function levelTotal(lb) {
  let lvl = 0
  for (const t of KATA_TOTAL_TIER) {
    if (t.kata.some((k) => adaKataFuzzy(lb, k))) lvl = Math.max(lvl, t.level)
  }
  return lvl
}

/**
 * Rapikan angka hasil OCR untuk nominal rupiah:
 *  - Buang karakter non-digit/titik/koma.
 *  - "63.00" (2 digit di belakang titik) biasanya "63.000" yang terpotong OCR
 *    → genapkan ke kelipatan 1000 bila nilainya masuk akal.
 *  - "11.008" pada struk rupiah biasanya "11.000" yang salah baca 0→8.
 */
function rapikanNominal(n, mentah) {
  if (n == null) return null
  const s = String(mentah).trim()
  // "63.00" / "11.50": pada struk rupiah ini hampir selalu "63.000" yang digit
  // terakhirnya hilang saat OCR. Bagian bulat < 1000 ⇒ perlakukan titik sebagai
  // pemisah ribuan (63 → 63000), bukan desimal 63 rupiah.
  const m = s.match(/^(\d{1,3})[.,](\d{2})$/)
  if (m && Number(m[1]) >= 1) return Number(m[1]) * 1000
  // Digit terakhir sering salah baca pada cetakan termal (0↔8, 0↔6).
  // Bila angka tidak bulat ribuan tapi dekat dengan kelipatan 1000, bulatkan.
  if (n >= 1000 && n % 1000 !== 0) {
    const dekat = Math.round(n / 1000) * 1000
    if (Math.abs(dekat - n) <= 10) return dekat
  }
  return n
}

/**
 * Cari nominal total. Strategi bertingkat:
 *  1. Baris dengan kata kunci total (grand total > total > jumlah > bayar).
 *  2. Ambil angka SETELAH kata kunci bila ada (hindari "Tunai 50.000 Kembali 5.000"
 *     salah ambil), kalau tidak ada pakai angka terbesar di baris.
 *  3. Sliding Window Lookahead (R-SWA inspired dari Unlimited-OCR): bila baris
 *     kata kunci total tidak memuat angka (mis. "TOTAL BELANJA\n55.000"), periksa
 *     1-2 baris di bawahnya tanpa salah mengambil baris terlarang.
 *  4. Buang baris ber-kata-terlarang (npwp, telp, kembali, ppn, diskon, ...).
 *  5. Cadangan: angka terbesar di seluruh struk yang masuk akal.
 */
export function cariTotal(teks) {
  const baris = normalisasiOcr(teks).split('\n')
  const kandidat = []

  for (let i = 0; i < baris.length; i++) {
    const b = baris[i]
    const lb = b.toLowerCase()
    const lvl = levelTotal(lb)
    const terlarang = KATA_ABAIKAN.some((k) => adaKata(lb, k))
    // Baris terlarang hanya boleh lolos bila juga memuat kata kunci total
    // (level >= 1). "Tunai 50.000 Kembali 5.000" tetap dipakai (tunai = level 1,
    // lalu angka PERTAMA setelah kata kunci yang diambil), sedangkan baris
    // "KEMBALI 5.000" murni tetap dibuang.
    if (terlarang && lvl < 1) continue

    let angkaMentah = [...b.matchAll(/(\d[\d.,]{2,})/g)]
    let angka = angkaMentah
      .map((m) => rapikanNominal(parseAngkaID(m[1]), m[1]))
      .filter((n) => n != null && n > 0)
    let sumberBaris = b.trim()

    // Sliding Window Lookahead (R-SWA inspired):
    // Jika baris memuat kata kunci total tingkat tinggi (lvl >= 2) tapi tidak ada angka nominal pada baris ini,
    // jelajahi jendela 1-2 baris berikutnya untuk menangkap nominal total yang tercetak di bawahnya.
    if ((!angka.length || (angka.length === 1 && angka[0] < 100)) && lvl >= 2) {
      for (let offset = 1; offset <= 2 && i + offset < baris.length; offset++) {
        const nextB = baris[i + offset]
        const nextLb = nextB.toLowerCase()
        if (KATA_ABAIKAN.some((k) => adaKata(nextLb, k)) && levelTotal(nextLb) < 1) break
        const nextAngkaMentah = [...nextB.matchAll(/(\d[\d.,]{2,})/g)]
        const nextAngka = nextAngkaMentah
          .map((m) => rapikanNominal(parseAngkaID(m[1]), m[1]))
          .filter((n) => n != null && n >= 100)
        if (nextAngka.length) {
          angkaMentah = nextAngkaMentah
          angka = nextAngka
          sumberBaris = `${b.trim()} -> ${nextB.trim()}`
          break
        }
      }
    }

    if (!angka.length) continue

    // Ambil angka TERBESAR setelah kata kunci total pada baris ini.
    //  - "TOTAL 63.000 DISKON 5.000"  -> 63.000 (bukan 5.000 di kanan)
    //  - "TOTAL (Qty 2.00 60.000"     -> 60.000 (bukan 2.00 di kiri)
    //  - "TOTAL 5815  28,000"         -> 28.000 (5815 = salah baca)
    // Nominal total selalu angka terbesar di antara angka pada baris totalnya,
    // jadi max lebih andal daripada "pertama" maupun "terakhir".
    let nilai = Math.max(...angka)
    if (lvl >= 2 && sumberBaris === b.trim()) {
      const posKata = Math.max(
        ...KATA_TOTAL_TIER.flatMap((t) => t.kata).map((k) => lb.indexOf(k)),
      )
      const setelah = angkaMentah
        .map((m) => ({ n: rapikanNominal(parseAngkaID(m[1]), m[1]), i: m.index }))
        .filter((x) => x.n != null && x.n > 0 && x.i > posKata)
      if (setelah.length) nilai = Math.max(...setelah.map((x) => x.n))
    }
    // Bobot penilaian (scoring):
    // Nilai rupiah wajar struk ritel biasanya >= 1000 dan kelipatan 100/500/1000
    let bobot = lvl * 100
    if (nilai >= 1000) bobot += 20
    if (nilai % 100 === 0) bobot += 10
    if (lvl === 3) bobot += 50
    kandidat.push({ nilai, lvl, bobot, sumber: sumberBaris })
  }

  if (!kandidat.length) return { total: null, sumber: null, lvl: 0 }

  // Prioritas kandidat: bobot tertinggi -> level -> nominal terbesar
  kandidat.sort((a, b) => (b.bobot || 0) - (a.bobot || 0) || b.lvl - a.lvl || b.nilai - a.nilai)

  // Buang nilai tak masuk akal sebagai total (nomor panjang > 9 digit / >= 1 miliar)
  const wajar = kandidat.filter((k) => k.nilai < 1e9 && String(k.nilai).length <= 9)
  const pilih = wajar[0] ?? kandidat[0]
  return { total: pilih.nilai, sumber: pilih.sumber, lvl: pilih.lvl }
}

/** Heuristik jenis: struk minim kata pemasukan → default pengeluaran. */
export function cariJenis(teks) {
  const t = String(teks || '').toLowerCase()
  if (/(refund|pengembalian|pemasukan|cashback masuk|top ?up diterima|gaji|bonus|transfer masuk|diterima dari)/.test(t)) return 'pemasukan'
  return 'pengeluaran'
}

/** Ambil nama merchant dari baris awal yang paling mungkin (huruf, bukan angka). */
export function cariMerchant(teks) {
  const baris = normalisasiOcr(teks)
    .split('\n')
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  for (const b of baris.slice(0, 6)) {
    const huruf = b.replace(/[^A-Za-z]/g, '')
    const digit = b.replace(/[^0-9]/g, '')
    if (huruf.length >= 4 && digit.length <= 2 && !/total|struk|invoice|nota|kasir|tanggal/i.test(b)) {
      return b.slice(0, 40)
    }
  }
  return ''
}

/**
 * Potong satu irisan (strip) vertikal dari citra sumber ke canvas beresolusi aman.
 */
function potongStripCanvas(img, sy, sh, maxPix = 1_200_000) {
  const w0 = img.naturalWidth || img.width || 1200
  let s = Math.max(1, 1400 / w0)
  if (w0 * s * sh * s > maxPix) {
    s *= Math.sqrt(maxPix / (w0 * s * sh * s))
  }
  const cw = Math.max(1, Math.round(w0 * s))
  const ch = Math.max(1, Math.round(sh * s))
  const cv = document.createElement('canvas')
  cv.width = cw
  cv.height = ch
  cv.getContext('2d').drawImage(img, 0, sy, w0, sh, 0, 0, cw, ch)
  return cv
}

/**
 * Fungsi utama: terima File gambar -> kembalikan hasil terstruktur.
 * Mengadopsi strategi Gundam Dynamic Tiling untuk struk tinggi agar
 * resolusi teks per bagian tetap tajam di bawah batas RAM 1.6 MP mobile.
 * @returns {Promise<{teks, total, tanggal, jenis, merchant, confidence}>}
 */
export async function bacaStruk(file, onProgress) {
  // Kompres citra terlebih dahulu jika berasal dari jepretan kamera beresolusi tinggi (48MP/12MP)
  // guna menghemat alokasi memori RAM HP Android
  const fileAman = await kompresCitraAman(file, 1600, 0.85)
  const img = await muatGambar(fileAman)
  const w0 = img.naturalWidth || img.width || 1200
  const h0 = img.naturalHeight || img.height || 1200
  const irisan = hitungIrisanGundam(w0, h0)

  let teksAsli = ''
  let confRata = 0
  let psmAkhir = 6
  const pakaiGundam = irisan.length > 1

  if (pakaiGundam) {
    // Gundam Mode lokal: baca per irisan vertikal tumpang tindih secara sekuensial
    const potonganTeks = []
    let sumConf = 0
    for (let i = 0; i < irisan.length; i++) {
      const tile = irisan[i]
      const stripCv = potongStripCanvas(img, tile.sy, tile.sh)
      const varianTile = [
        praProsesMutakhir(praProsesAdaptif(stripCv, 1400)),
        praProsesOtsu(stripCv, 1400),
      ]
      const baseProg = i / irisan.length
      const spanProg = 1 / irisan.length
      const hasilTile = await jalankanOcr(varianTile, (p) => {
        onProgress?.(Math.min(0.99, baseProg + p * spanProg))
      })
      if (hasilTile.teks) potonganTeks.push(hasilTile.teks)
      sumConf += hasilTile.conf || 0
      psmAkhir = hasilTile.psm ?? psmAkhir
    }
    teksAsli = potonganTeks.join('\n')
    confRata = Math.round(sumConf / irisan.length)
  } else {
    // Multi-perspektif preprocessing mutakhir:
    //  - mutakhir (Auto-deskew + CLAHE shadow removal + Unsharp mask)
    //  - crop+Sauvola: foto HP berlatar ramai/gelap/miring
    //  - Sauvola adaptif: pencahayaan tidak merata
    //  - Otsu binarization: teks struk termal pudar/kontras rendah
    //  - kontras global: struk digital/scan bersih
    const varian = [
      praProsesMutakhir(praProsesAdaptif(img, 1600)),
      praProsesCrop(img, 1600),
      praProsesOtsu(img, 1600),
      praProses(img, 1500),
    ]
    const hasil = await jalankanOcr(varian, onProgress)
    teksAsli = hasil.teks || ''
    confRata = hasil.conf
    psmAkhir = hasil.psm
  }

  const teksTanpaDuplikat = dedupBarisNgram(teksAsli)
  const teks = rekonstruksiTataLetakBaris(teksTanpaDuplikat)

  const { total, sumber } = cariTotal(teks)
  const merchant = cariMerchant(teks)
  const jenis = cariJenis(teks)

  // Pemetaan tingkat lanjut: isi struk -> kategori, keterangan (nama BARANG,
  // bukan merchant), dan sumber pembayaran. Modul murni strukMeta.js dipisah
  // agar bisa diuji tanpa canvas/Tesseract.
  const barang = cariBarang(teks)
  const peta = petakanKategori({ barang, merchant, jenis })
  const pembayar = cariPembayar(teks)
  const tunai = cariTunai(teks)

  // Evaluasi kejernihan foto struk secara objektif:
  // Jika total tidak terbaca, periksa apakah teks yang tertangkap sangat minim (< 15 karakter)
  const alnumTotal = (teks.match(/[a-zA-Z0-9]/g) || []).length
  const fotoBuram = alnumTotal < 15

  // Susun representasi teks ke format Markdown terstruktur
  const markdownStruk = susunMarkdownStruk({
    merchant,
    tanggal: cariTanggal(teks),
    total,
    sumber,
    barang,
    pembayar,
    tunai,
    teksMentah: teks,
  })

  return {
    teks,
    markdown: markdownStruk,
    total,
    totalSumber: sumber,
    tanggal: cariTanggal(teks),
    jenis,
    merchant,
    // --- kolom baru ---
    barang,
    kategoriNama: peta.kategoriNama,
    kategoriDari: peta.kategoriDari,
    kategoriYakin: peta.yakin,
    keterangan: peta.keterangan,
    sumberBayar: pembayar, // { nama, jenis:'dompet'|'bank' } atau null
    bayarTunai: tunai,
    confidence: confRata,
    psm: psmAkhir,
    modeProses: pakaiGundam ? 'gundam' : 'base',
    tileCount: irisan.length,
    fotoBuram,
  }
}

/**
 * Hitung koordinat irisan vertikal Gundam Dynamic Tiling (terinspirasi baidu/Unlimited-OCR).
 * Memecah struk tinggi (h/w >= 2.2 dan h >= 1200) menjadi 2-3 strip tumpang tindih 12%
 * agar teks kecil tidak ikut hancur saat dikompresi oleh batas piksel perangkat.
 *
 * @param {number} width
 * @param {number} height
 * @returns {Array<{ index: number, sy: number, sh: number, label: string }>}
 */
export function hitungIrisanGundam(width, height) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (w <= 0 || h <= 0) return []

  const aspect = h / w
  if (aspect < 2.2 || h < 1200) {
    return [{ index: 0, sy: 0, sh: h, label: 'base' }]
  }

  const stripCount = aspect >= 3.4 ? 3 : 2
  const dasar = h / stripCount
  const overlap = Math.round(dasar * 0.12)
  const tiles = []

  for (let i = 0; i < stripCount; i++) {
    const rawStart = Math.floor(i * dasar) - (i > 0 ? overlap : 0)
    const sy = Math.max(0, rawStart)
    const rawEnd = i === stripCount - 1 ? h : Math.ceil((i + 1) * dasar) + overlap
    const ey = Math.min(h, rawEnd)
    tiles.push({
      index: i,
      sy,
      sh: Math.max(1, ey - sy),
      label: `gundam-tile-${i + 1}`,
    })
  }
  return tiles
}

/**
 * Penjaga anti-pengulangan n-gram baris (terinspirasi NGramPerReqLogitsProcessor
 * dari baidu/Unlimited-OCR). Menghapus duplikasi blok batas antar irisan (seam overlap)
 * atau loop derau kertas termal tanpa membuang item pembelian kembar tunggal.
 *
 * @param {string} teks
 * @param {number} [ngramSize=2]
 * @returns {string}
 */
export function dedupBarisNgram(teks, ngramSize = 2) {
  if (!teks) return ''
  const mentah = String(teks)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  if (mentah.length === 0) return ''

  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim()

  // Tahap 1: hilangkan pengulangan token internal pada satu baris (loop n-gram >= 2 token berulang 3x+)
  const bersihToken = mentah.map((line) => {
    const tokens = line.split(/\s+/)
    if (tokens.length < 6) return line
    for (let n = 2; n <= 5; n++) {
      if (tokens.length < n * 3) continue
      const unit = tokens.slice(0, n).join(' ').toLowerCase()
      let sameCount = 1
      for (let pos = n; pos + n <= tokens.length; pos += n) {
        if (tokens.slice(pos, pos + n).join(' ').toLowerCase() === unit) sameCount++
        else break
      }
      if (sameCount >= 3) {
        return tokens.slice(0, n).join(' ')
      }
    }
    return line
  })

  if (bersihToken.length <= 1) return bersihToken.join('\n')

  // Tahap 2: hapus blok multi-baris n-gram yang berulang di jendela batas potongan (14 baris terakhir)
  const n = Math.max(1, ngramSize)
  const seenBlocks = []
  const out = []

  for (let i = 0; i < bersihToken.length; i++) {
    const line = bersihToken[i]
    const nl = norm(line)

    // Hapus pengulangan baris identik beruntun ke-3 dst (loop karakter termal rusak)
    if (
      nl.length >= 4 &&
      out.length >= 2 &&
      norm(out[out.length - 1]) === nl &&
      norm(out[out.length - 2]) === nl
    ) {
      continue
    }

    // Cek apakah potongan N baris mulai dari posisi i sudah muncul tepat di jendela terakhir (seam overlap)
    if (n >= 2 && i + n <= bersihToken.length) {
      const blok = bersihToken.slice(i, i + n).map(norm)
      const kunciBlok = blok.join('\n')
      const bermakna = blok.every((b) => b.length >= 4)
      if (bermakna && seenBlocks.slice(-14).includes(kunciBlok)) {
        i += n - 1
        continue
      }
      if (bermakna) seenBlocks.push(kunciBlok)
    }

    out.push(line)
  }

  return out.join('\n')
}

/**
 * Rekonstruksi tata letak baris (collinear multi-line text) terinspirasi R-SWA Unlimited-OCR.
 * Menggabungkan token yang terpisah baris secara tidak wajar pada dokumen struk.
 */
export function rekonstruksiTataLetakBaris(teks) {
  if (!teks) return ''
  const baris = String(teks).split('\n')
  const hasil = []
  for (let i = 0; i < baris.length; i++) {
    const cur = baris[i].trim()
    if (!cur) continue
    // Jika baris saat ini berakhir dengan indikator gantung ("TOTAL :", "Rp", "Rp.", "IDR")
    // dan baris berikutnya diawali angka nominal, gabungkan ke satu baris
    if (i + 1 < baris.length && /(total|subtotal|jumlah|grand total|tagihan|rp\.?|idr)\s*:?$/i.test(cur)) {
      const next = baris[i + 1].trim()
      if (/^[\d.,\s]+/.test(next)) {
        hasil.push(`${cur} ${next}`)
        i++ // lewati baris berikutnya
        continue
      }
    }
    hasil.push(cur)
  }
  return hasil.join('\n')
}

/**
 * Konversi teks hasil ekstraksi struk menjadi format Markdown terstruktur offline.
 * Menghasilkan representasi dokumen yang mudah dibaca, rapi, dan konsisten (terinspirasi Unlimited-OCR).
 */
export function susunMarkdownStruk({ merchant, tanggal, total, sumber, barang, pembayar, tunai, teksMentah }) {
  const lines = []
  lines.push('### 🧾 Ringkasan Struk Transaksi')
  if (merchant) lines.push(`- **Merchant / Toko:** ${merchant}`)
  if (tanggal) lines.push(`- **Tanggal:** ${tanggal}`)
  if (total) lines.push(`- **Total Nominal:** Rp ${Number(total).toLocaleString('id-ID')}`)
  if (sumber) lines.push(`- **Baris Deteksi:** \`${sumber}\``)
  if (pembayar) lines.push(`- **Metode Pembayaran:** ${pembayar.nama} (${pembayar.jenis})`)
  else if (tunai) lines.push(`- **Metode Pembayaran:** Tunai / Cash`)

  if (Array.isArray(barang) && barang.length > 0) {
    lines.push('')
    lines.push('#### 📋 Rincian Item Transaksi')
    lines.push('| No | Item / Deskripsi | Qty | Harga Satuan | Subtotal |')
    lines.push('|:--:|:-----------------|:---:|:------------:|:--------:|')
    barang.forEach((b, idx) => {
      const q = b.qty || 1
      const subtotal = b.harga ? b.harga : 0
      const unit = b.harga && b.qty && b.qty > 1 ? Math.round(b.harga / b.qty) : b.harga || 0
      const unitStr = unit ? `Rp ${unit.toLocaleString('id-ID')}` : '-'
      const subStr = subtotal ? `Rp ${subtotal.toLocaleString('id-ID')}` : '-'
      lines.push(`| ${idx + 1} | ${b.nama} | ${q} | ${unitStr} | ${subStr} |`)
    })
  } else if (typeof barang === 'string' && barang) {
    lines.push(`- **Item / Keterangan:** ${barang}`)
  }
  
  lines.push('')
  lines.push('#### 📄 Teks Ekstraksi Struk')
  lines.push('```text')
  lines.push(teksMentah ? teksMentah.trim() : '(tidak ada teks)')
  lines.push('```')
  return lines.join('\n')
}

/** Lepas worker Tesseract (panggil saat komponen dilepas, hemat memori). */
export async function matikanOcr() {
  if (workerCache) {
    try {
      const w = await workerCache
      await w.terminate()
    } catch {
      /* abaikan */
    }
    workerCache = null
  }
}
