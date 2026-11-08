// Uji regresi parser OCR (fungsi murni — tanpa canvas/Tesseract, jadi cepat).
// Menjaga perbaikan yang terbukti penting dari dataset CORD (100 struk nyata):
//  - pemisah ribuan dengan spasi ("38. 000", "20, 00")
//  - nominal rupiah terpotong ("63.00" -> 63000)
//  - kata kunci salah baca ("rOTAL", "T0TAL")
//  - 'subtotal' tidak boleh dianggap 'total'
//  - ambil angka SETELAH kata kunci ("Tunai 50.000 Kembali 5.000")
// Jalankan: node src/lib/ocrStruk.test.mjs
import { cariTotal, cariTanggal, parseAngkaID, cariJenis, cariMerchant, rekonstruksiTataLetakBaris, susunMarkdownStruk } from './ocrStruk.js'

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

// ---------- parseAngkaID ----------
cek('parse 1.234.567', parseAngkaID('1.234.567'), 1234567)
cek('parse 1,234,567', parseAngkaID('1,234,567'), 1234567)
cek('parse Rp 45.000', parseAngkaID('Rp 45.000'), 45000)
cek('parse 1.234,56', parseAngkaID('1.234,56'), 1235)
cek('parse 63000 polos', parseAngkaID('63000'), 63000)

// ---------- cariTotal: kasus dasar ----------
cek('TOTAL sederhana', cariTotal('TOTAL 63.000').total, 63000)
cek('Grand Total menang atas subtotal', cariTotal('SUBTOTAL 50.000\nGRAND TOTAL 63.000').total, 63000)
cek('subtotal bukan total', cariTotal('SUBTOTAL 50.000').lvl, 2)

// ---------- cariTotal: kata kunci salah baca OCR ----------
cek('rOTAL -> total', cariTotal('rOTAL 25.000').total, 25000)
cek('T0TAL -> total', cariTotal('T0TAL 31.000').total, 31000)
cek('TOTA1 -> total', cariTotal('TOTA1 18.500').total, 18500)

// ---------- cariTotal: spasi di dalam angka ----------
cek('spasi titik ribuan "38. 000"', cariTotal('TOTAL 38. 000').total, 38000)
cek('spasi koma "20, 00"', cariTotal('TOTAL 20, 00').total, 20000)

// ---------- cariTotal: nominal terpotong ----------
cek('63.00 -> 63000', cariTotal('TOTAL 63.00').total, 63000)
cek('88.00 -> 88000', cariTotal('TOTAL 88.00').total, 88000)

// ---------- cariTotal: ambil angka setelah kata kunci ----------
cek('Tunai+Kembali -> 50.000', cariTotal('Tunai 50.000 Kembali 5.000').total, 50000)

// ---------- cariTotal: baris terlarang diabaikan ----------
cek('baris NPWP diabaikan', cariTotal('NPWP 01.234.567.8\nTOTAL 42.000').total, 42000)
cek('kembalian tidak jadi total', cariTotal('KEMBALI 5.000\nTOTAL 63.000').total, 63000)

// ---------- cariTotal: tanpa kata kunci -> angka terbesar wajar ----------
cek('tanpa kata kunci -> terbesar', cariTotal('Ayam Geprek 25.000\nEs Teh 8.000\n45.000').total, 45000)

// ---------- cariTotal: kosong ----------
cek('teks kosong -> null', cariTotal('').total, null)

// ---------- cariTanggal ----------
cek('ISO', cariTanggal('2026-10-12'), '2026-10-12')
cek('dd/mm/yyyy', cariTanggal('12/10/2026'), '2026-10-12')
cek('dd-mm-yy', cariTanggal('05-03-26'), '2026-03-05')
cek('dd NamaBulan yyyy', cariTanggal('12 Oktober 2026'), '2026-10-12')
cek('tanggal tanpa kandidat -> null', cariTanggal('TOTAL 50.000'), null)

// ---------- cariJenis ----------
cek('default pengeluaran', cariJenis('TOTAL 50.000'), 'pengeluaran')
cek('refund -> pemasukan', cariJenis('REFUND 20.000'), 'pemasukan')

// ---------- cariMerchant ----------
cek('merchant dari baris awal', cariMerchant('TOKO SUMBER REJEKI\nJl. Merdeka 12\nTOTAL 50.000'), 'TOKO SUMBER REJEKI')

// ---------- R-SWA Lookahead: multi-line total extraction ----------
cek('sliding window lookahead: TOTAL lalu nominal di baris berikutnya', cariTotal('TOTAL HARGA\n55.000').total, 55000)
cek('sliding window lookahead: GRAND TOTAL dengan baris jeda item count', cariTotal('GRAND TOTAL\n2 ITEMS\n125.000').total, 125000)
cek('sliding window lookahead: baris berikutnya terlarang (kembali) tidak diambil', cariTotal('TOTAL\nKEMBALI 5.000\n60.000').total, 60000)

// ---------- rekonstruksiTataLetakBaris ----------
cek('rekonstruksi baris gantung TOTAL :', rekonstruksiTataLetakBaris('TOTAL :\n45.000'), 'TOTAL : 45.000')
cek('rekonstruksi baris gantung Rp', rekonstruksiTataLetakBaris('JUMLAH Rp\n88.000'), 'JUMLAH Rp 88.000')

// ---------- susunMarkdownStruk ----------
const mdHasil = susunMarkdownStruk({
  merchant: 'Indomaret Merdeka',
  tanggal: '2026-11-08',
  total: 55000,
  sumber: 'TOTAL 55.000',
  barang: [{ nama: 'Roti Gandum', qty: 2, harga: 30000 }, { nama: 'Susu UHT', qty: 1, harga: 25000 }],
  tunai: true,
  teksMentah: 'INDOMARET MERDEKA\nROTI GANDUM 30.000\nSUSU UHT 25.000\nTOTAL 55.000',
})
cek('markdown struk memuat header ringkasan', mdHasil.includes('### 🧾 Ringkasan Struk Transaksi'), true)
cek('markdown struk memuat tabel rincian item', mdHasil.includes('| No | Item / Deskripsi | Qty | Harga Satuan | Subtotal |'), true)
cek('markdown struk memuat item roti gandum', mdHasil.includes('Roti Gandum'), true)

// ---------- laporan ----------
console.log(`\n=== UJI PARSER OCR: ${lulus} lulus, ${gagal} gagal ===`)
if (gagal) {
  console.log(galat.join('\n'))
  process.exit(1)
}
console.log('Semua uji parser lulus.')
