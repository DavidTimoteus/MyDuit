/**
 * geminiOcr.js — Adapter Vision AI Google Gemini (Gemini 2.0 Flash / 1.5 Flash).
 *
 * Menggunakan direct REST API serverless resmi dari Google AI Studio:
 *  - 100% Client-side: Memanggil generativelanguage.googleapis.com langsung dari browser.
 *  - Kunci API (BYOK) disimpan aman di LocalStorage pengguna.
 *  - Mengembalikan JSON terstruktur native tanpa regex parsers.
 */

export const STORAGE_KEY_GEMINI_KEY = 'myduit_gemini_api_key'
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash'
export const FALLBACK_GEMINI_MODEL = 'gemini-1.5-flash'

/**
 * Baca kunci API Gemini dari LocalStorage.
 * @returns {string}
 */
export function bacaGeminiKey() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return (window.localStorage.getItem(STORAGE_KEY_GEMINI_KEY) || '').trim()
    }
  } catch {
    /* abaikan */
  }
  return ''
}

/**
 * Simpan kunci API Gemini ke LocalStorage.
 * @param {string} key
 */
export function simpanGeminiKey(key) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const clean = String(key || '').trim()
      if (clean) {
        window.localStorage.setItem(STORAGE_KEY_GEMINI_KEY, clean)
      } else {
        window.localStorage.removeItem(STORAGE_KEY_GEMINI_KEY)
      }
    }
  } catch {
    /* abaikan */
  }
}

/**
 * Hapus kunci API Gemini dari LocalStorage.
 */
export function hapusGeminiKey() {
  simpanGeminiKey('')
}

/**
 * Konversi File atau Blob menjadi base64 string dan mimeType.
 * @param {Blob|File} file
 * @returns {Promise<{ mimeType: string, base64Data: string }>}
 */
export async function konversiFileKeBase64(file) {
  if (typeof file === 'string' && file.startsWith('data:')) {
    const parts = file.split(',')
    const mimeMatch = parts[0].match(/:(.*?);/)
    return {
      mimeType: mimeMatch ? mimeMatch[1] : 'image/jpeg',
      base64Data: parts[1],
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      const parts = result.split(',')
      const mimeMatch = parts[0].match(/:(.*?);/)
      resolve({
        mimeType: mimeMatch ? mimeMatch[1] : 'image/jpeg',
        base64Data: parts[1],
      })
    }
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'))
    reader.readAsDataURL(file)
  })
}

/**
 * Validasi dan uji koneksi kunci API Gemini.
 * @param {string} apiKey
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function ujiKoneksiGemini(apiKey) {
  const key = (apiKey || bacaGeminiKey()).trim()
  if (!key) {
    return { ok: false, message: 'Kunci API kosong. Silakan masukkan kunci API Anda.' }
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent?key=${key}`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 7000)

    const res = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Balas dengan kata "OK" saja jika kunci aktif.' }] }],
      }),
    })
    clearTimeout(timer)

    if (res.ok) {
      return { ok: true, message: 'Kunci API valid! Gemini Vision siap digunakan.' }
    }

    const errData = await res.json().catch(() => ({}))
    const msg = errData?.error?.message || `HTTP ${res.status}: ${res.statusText}`
    return { ok: false, message: `Gagal memverifikasi kunci: ${msg}` }
  } catch (err) {
    return { ok: false, message: `Koneksi gagal: ${err.message}` }
  }
}

/**
 * Panggil Gemini Flash Vision untuk memindai struk belanja.
 *
 * @param {File|Blob|string} file
 * @param {string} [apiKey]
 * @param {object} [options]
 * @param {(p: number) => void} [options.onProgress]
 * @returns {Promise<object>} Skema terstruktur MyDuit
 */
export async function panggilGeminiVision(file, apiKey, options = {}) {
  const key = (apiKey || bacaGeminiKey()).trim()
  if (!key) {
    throw new Error('Kunci API Gemini belum diatur. Masukkan kunci API di pengaturan scan.')
  }

  options.onProgress?.(0.2)
  const { mimeType, base64Data } = await konversiFileKeBase64(file)
  options.onProgress?.(0.4)

  const promptSystem = `
Anda adalah sistem ekstraktor struk belanja & dokumen keuangan cerdas untuk aplikasi MyDuit.
Analisis foto struk ini secara cermat dan ekstrak informasinya ke format JSON yang valid.

Aturan Ekstraksi:
1. merchant: Nama toko/penjual (maksimal 40 karakter).
2. tanggal: Format YYYY-MM-DD. Jika tahun hanya 2 digit, jadikan 20XX. Jika tidak ada, gunakan null.
3. total: Nominal angka bulat (integer) TOTAL AKHIR / GRAND TOTAL belanja yang dibayar. Jangan keliru dengan Subtotal, Pajak, Diskon, atau Kembalian.
4. jenis: "pengeluaran" (default untuk struk belanja/nota bayar) atau "pemasukan" (jika refund/penjualan/top up masuk).
5. keterangan: Ringkasan 1-4 nama barang utama yang dibeli (pisahkan koma).
6. kategoriNama: Pilih salah satu yang paling cocok dari daftar kategori berikut:
   - "Makanan" (makanan/minuman siap saji, restoran, kafe)
   - "Bahan Makan" (sembako mentah, beras, minyak goreng, sayur, telur, bumbu)
   - "Belanja" (sabun, pakaian, alat rumah tangga, perlengkapan)
   - "Transportasi" (bensin, tol, parkir, ojek, tiket transportasi)
   - "Tagihan" (listrik, air, pulsa, internet, BPJS)
   - "Kesehatan" (obat, apotek, klinik, vitamin)
   - "Pendidikan" (buku, alat tulis, kursus)
   - "Hiburan" (tiket bioskop, game)
   - "Lainnya" (jika tidak masuk kategori di atas)
7. barang: Array objek daftar item belanja: [{ "nama": string, "qty": integer, "harga": integer (subtotal item) }]
8. sumberBayar: Jika struk mencantumkan metode bayar (misal GoPay, SeaBank, BCA, Mandiri, ShopeePay, OVO, QRIS), sebutkan {"nama": string, "jenis": "dompet"|"bank"}. Jika tidak ada / tunai, null.
9. bayarTunai: true jika struk menyatakan dibayar tunai / cash.
`

  const payload = {
    contents: [
      {
        parts: [
          { text: promptSystem },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      response_mime_type: 'application/json',
    },
  }

  // Model cascade: Coba Gemini 2.0 Flash dulu, fallback ke Gemini 1.5 Flash
  const models = [DEFAULT_GEMINI_MODEL, FALLBACK_GEMINI_MODEL]
  let lastError = null

  for (const model of models) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)

    try {
      options.onProgress?.(0.6)
      const res = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      clearTimeout(timer)

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        const errMsg = errJson?.error?.message || `HTTP ${res.status}`
        throw new Error(`${model}: ${errMsg}`)
      }

      options.onProgress?.(0.9)
      const jsonRes = await res.json()
      const rawText = jsonRes?.candidates?.[0]?.content?.parts?.[0]?.text
      if (!rawText) throw new Error('Respons Gemini kosong.')

      const parsed = JSON.parse(rawText)
      options.onProgress?.(1.0)
      return normalisasiHasilGemini(parsed)
    } catch (err) {
      clearTimeout(timer)
      lastError = err
      console.warn(`[gemini-ocr] Gagal pada ${model}:`, err.message)
    }
  }

  throw new Error(`Gemini Vision gagal: ${lastError?.message || 'Koneksi terputus'}`)
}

/**
 * Normalisasi data JSON dari Gemini ke format seragam MyDuit.
 */
function normalisasiHasilGemini(data) {
  const merchant = data.merchant || 'Toko / Merchant'
  const tanggal = data.tanggal || null
  const total = typeof data.total === 'number' ? data.total : data.total ? parseInt(data.total, 10) : null
  const jenis = data.jenis === 'pemasukan' ? 'pemasukan' : 'pengeluaran'
  const barang = Array.isArray(data.barang) ? data.barang : []
  const keterangan = data.keterangan || (barang.length ? barang.map((b) => b.nama).join(', ') : merchant)
  const kategoriNama = data.kategoriNama || 'Lainnya'

  // Susun Markdown Table
  const lines = []
  lines.push('### 🧾 Ringkasan Struk Transaksi (Gemini Flash Vision)')
  lines.push(`- **Merchant / Toko:** ${merchant}`)
  if (tanggal) lines.push(`- **Tanggal:** ${tanggal}`)
  if (total) lines.push(`- **Total Nominal:** Rp ${total.toLocaleString('id-ID')}`)
  if (data.sumberBayar?.nama) lines.push(`- **Metode Pembayaran:** ${data.sumberBayar.nama} (${data.sumberBayar.jenis})`)
  else if (data.bayarTunai) lines.push(`- **Metode Pembayaran:** Tunai / Cash`)

  if (barang.length > 0) {
    lines.push('')
    lines.push('#### 📋 Rincian Item Transaksi')
    lines.push('| No | Item / Deskripsi | Qty | Harga Satuan | Subtotal |')
    lines.push('|:--:|:-----------------|:---:|:------------:|:--------:|')
    barang.forEach((b, idx) => {
      const q = b.qty || 1
      const subtotal = b.harga || 0
      const unit = q > 1 && subtotal ? Math.round(subtotal / q) : subtotal
      const unitStr = unit ? `Rp ${unit.toLocaleString('id-ID')}` : '-'
      const subStr = subtotal ? `Rp ${subtotal.toLocaleString('id-ID')}` : '-'
      lines.push(`| ${idx + 1} | ${b.nama} | ${q} | ${unitStr} | ${subStr} |`)
    })
  }

  return {
    engine: 'gemini-flash',
    teks: `Merchant: ${merchant}\nTanggal: ${tanggal || '-'}\nTotal: ${total || '-'}\nKeterangan: ${keterangan}`,
    markdown: lines.join('\n'),
    total,
    totalSumber: total ? `Total Rp ${total.toLocaleString('id-ID')}` : null,
    tanggal,
    jenis,
    merchant,
    barang,
    kategoriNama,
    kategoriDari: 'gemini-vlm',
    kategoriYakin: true,
    keterangan,
    sumberBayar: data.sumberBayar || null,
    bayarTunai: Boolean(data.bayarTunai),
    confidence: 99.5,
    psm: 'vlm',
    fotoBuram: false,
  }
}
