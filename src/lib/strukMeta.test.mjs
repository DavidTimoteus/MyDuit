// Uji regresi pembacaan strukturik struk (kategori / keterangan / sumber).
// Fungsi murni — tanpa canvas/Tesseract, jadi berjalan milidetik di Node.
//
// Yang dijaga di sini adalah ATURAN BISNIS yang diminta:
//  1. Keterangan diisi NAMA BARANG, bukan nama merchant.
//  2. Kategori terisi SELALU (tidak boleh kosong) dan tepat:
//     bahan mentah -> Bahan Makan, makanan jadi -> Makanan, alat -> Belanja.
//  3. Sumber/akun terisi kalau struk menyebut dompet/bank pembayar.
//
// Jalankan: node src/lib/strukMeta.test.mjs
import { cariBarang, petakanKategori, cariPembayar, cariTunai, barisStruk } from './strukMeta.js'

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

function cekBenar(nama, syarat) {
  if (syarat) lulus++
  else {
    gagal++
    galat.push(`  ✗ ${nama}\n      syarat tidak terpenuhi`)
  }
}

// ---------- cariBarang: nama barang, bukan merchant ----------
const strukToko = `TOKO BERAS MAKMUR
Jl. Merdeka No. 12
BERAS PREMIUM 5 KG 68.000
MINYAK GORENG 2 LTR 32.000
GULA PASIR 1 KG 15.000
TOTAL 115.000
TERIMA KASIH`

const barangToko = cariBarang(strukToko)
cekBenar(
  'barang terbaca 3 item (bukan merchant)',
  barangToko.length === 3,
)
cekBenar(
  'baris TOTAL/Terima Kasir TIDAK jadi barang',
  !barangToko.some((b) => /total|terima kasih/i.test(b.nama)),
)
cekBenar(
  'merchant tidak ikut jadi barang',
  !barangToko.some((b) => /makura|makmur|merdeka/i.test(b.nama)),
)
cekBenar(
  'nama barang pertama = Beras Premium',
  barangToko[0]?.nama === 'Beras Premium',
)

// ---------- kategori: bahan makan ----------
cek('beras -> Bahan Makan', petakanKategori({ barang: barangToko }).kategoriNama, 'Bahan Makan')

// ---------- kategori: makanan jadi ----------
cek('nasi goreng -> Makanan', petakanKategori({ barang: [{ nama: 'Nasi Goreng', qty: 1, harga: 28000 }] }).kategoriNama, 'Makanan')
cek('kopi -> Makanan', petakanKategori({ barang: [{ nama: 'Kopi Susu', qty: 1, harga: 24000 }] }).kategoriNama, 'Makanan')

// ---------- kategori: alat/perlengkapan -> Belanja ----------
cek('panci -> Belanja', petakanKategori({ barang: [{ nama: 'Panci Stainless', qty: 1, harga: 175000 }] }).kategoriNama, 'Belanja')
cek('sapu +rinso -> Belanja', petakanKategori({ barang: [{ nama: 'Sapu Iplastic', qty: 1, harga: 35000 }] }).kategoriNama, 'Belanja')
cek('deterjen -> Belanja', petakanKategori({ barang: [{ nama: 'Deterjen Rinso', qty: 1, harga: 28000 }] }).kategoriNama, 'Belanja')

// ---------- kategori: domain lain ----------
cek('bensin -> Transportasi', petakanKategori({ barang: [{ nama: 'Pertamax 92', qty: 1, harga: 50000 }] }).kategoriNama, 'Transportasi')
cek('token listrik -> Tagihan', petakanKategori({ barang: [{ nama: 'Token Listrik', qty: 1, harga: 150000 }] }).kategoriNama, 'Tagihan')
cek('obat -> Kesehatan', petakanKategori({ barang: [{ nama: 'Vitamin C 1000mg', qty: 1, harga: 45000 }] }).kategoriNama, 'Kesehatan')
cek('buku -> Pendidikan', petakanKategori({ barang: [{ nama: 'Buku React Cookbook', qty: 1, harga: 120000 }] }).kategoriNama, 'Pendidikan')
cek('bioskop -> Hiburan', petakanKategori({ barang: [{ nama: 'Tiket Bioskop', qty: 2, harga: 45000 }] }).kategoriNama, 'Hiburan')

// ---------- kategori: TIDAK PERNAH KOSONG ----------
const sembarang = petakanKategori({ barang: [{ nama: 'Zxqv Widget', qty: 1, harga: 10000 }] })
cekBenar('kategori tetap terisi untuk barang tak dikenal', typeof sembarang.kategoriNama === 'string' && sembarang.kategoriNama.length > 0)
cek('barang tak dikenal -> Lainnya', sembarang.kategoriNama, 'Lainnya')
cekBenar('ket Weapons akan terisi walau kategori Lainnya', sembarang.keterangan.length > 0)

const tanpaBarang = petakanKategori({ barang: [], merchant: '' })
cekBenar('struk kosong tetap dapat kategori', tanpaBarang.kategoriNama.length > 0)
cekBenar('struk kosong tetap dapat keterangan', tanpaBarang.keterangan.length > 0)

cek('pemasukan -> kategori basing', petakanKategori({ jenis: 'pemasukan', merchant: 'PT MAJUK JAYA' }).kategoriNama, 'Lainnya')
cek('gaji -> Gaji', petakanKategori({ jenis: 'pemasukan', merchant: 'PT MAJU BERTAMBAH' }).kategoriNama, 'Lainnya')

// ---------- keterangan: ringkas & berisi nama barang ----------
const ket = petakanKategori({ barang: barangToko }).keterangan
cekBenar('keterangan menyebut isi barang', /beras|minyak|gula/i.test(ket))
cekBenar('keterangan tidak memuat nama toko', !/makura|makmur/i.test(ket))

// ---------- sumber pembayaran ----------
const strukQris = `TOKO ELEKTRONIK
TV LED 40" 3.500.000
TOTAL 3.500.000
BAYAR QRIS
VA NUMBER 8871234567`
cek('QRIS terdeteksi', cariPembayar(strukQris)?.jenis, 'bank')

const strukGopay = `TOKO KOPI
KOPI SUSU 22.000
TOTAL 22.000
BAYAR GOPAY`
cek('GoPay -> dompet', cariPembayar(strukGopay)?.jenis, 'dompet')
cek('GoPay nama terisi', cariPembayar(strukGopay)?.nama, 'Gopay')

const strukSeabank = `TOKO ELEKTRONIK
LAPTOP 7.000.000
TOTAL 7.000.000
DEBIT SEABANK 1234567890`
cek('Seabank -> bank', cariPembayar(strukSeabank)?.jenis, 'bank')

const strukBca = `TOKO ELEKTRONIK
KABEL 50.000
TOTAL 50.000
KARTU KREDIT BCA 112233`
cek('BCA -> bank', cariPembayar(strukBca)?.nama, 'Bca')

cek('struk tanpa metode bayar -> null (user pilih)', cariPembayar(strukToko), null)
cek('tunai terdeteksi', cariTunai('TOTAL 50.000\nTUNAI'), true)
cek('non-tunai bukan tunai', cariTunai(strukGopay), false)

// ---------- barisStruk ----------
cekBenar('barisStruk membuang baris kosong', barisStruk('A\n\n\nB\n  ').length === 2)
cekBenar('barisStrub rapikan spasi ganda', barisStruk('A    B\nC').includes('A B'))

// ---------- multi-line item pairing (R-SWA / spatial reading-order) ----------
const strukMultiLine = `KAFE SENJA
JL. SUDIRMAN 45
KOPI SUSU GULA AREN
1 x 22.000
ROTI BAKAR COKLAT
25.000
TOTAL 47.000`

const barangMultiLine = cariBarang(strukMultiLine)
cekBenar('multi-line item terbaca 2 item', barangMultiLine.length === 2)
cek('multi-line item 1 nama', barangMultiLine[0]?.nama, 'Kopi Susu Gula Aren')
cek('multi-line item 1 harga', barangMultiLine[0]?.harga, 22000)
cek('multi-line item 2 nama', barangMultiLine[1]?.nama, 'Roti Bakar Coklat')
cek('multi-line item 2 harga', barangMultiLine[1]?.harga, 25000)

// ---------- laporan ----------
console.log(`\n=== UJI PEMBACAAN STRUK: ${lulus} lulus, ${gagal} gagal ===`)
if (gagal) {
  console.log(galat.join('\n'))
  process.exit(1)
}
console.log('Semua uji pembacaan struk lulus.')
