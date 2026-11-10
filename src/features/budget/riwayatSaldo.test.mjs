// Uji logika "Detail Perubahan Rekening" (riwayatSaldo.js):
//  1. filter akun benar (transaksi akun lain tidak bocor),
//  2. delta tiap jenis transaksi (pemasukan/pengeluaran/transfer 2 arah),
//  3. saldo sesudah dihitung mundur dari saldo sekarang & konsisten,
//  4. ringkasan masuk/keluar.
//
// Jalankan: node src/features/budget/riwayatSaldo.test.mjs
import { bangunMutasi, deltaMutasi, infoMutasi, ringkasMutasi, termasukAkun } from './riwayatSaldo.js'

let lulus = 0
const galat = []

function cek(nama, dapat, harap) {
  const ok = JSON.stringify(dapat) === JSON.stringify(harap)
  if (ok) lulus++
  else galat.push(`${nama}\n      dapat : ${JSON.stringify(dapat)}\n      harap : ${JSON.stringify(harap)}`)
  console.log(`  ${ok ? 'ok  ' : 'GAGAL'} ${nama}`)
}

const A = 'akunA'
const B = 'akunB'

// ===== termasukAkun =====
cek('transaksi akun ini masuk', termasukAkun({ akunId: A }, A), true)
cek('transaksi akun lain tidak masuk', termasukAkun({ akunId: B }, A), false)
cek('sumber transfer (dariId) masuk', termasukAkun({ jenis: 'pindah saldo', dariId: A, keId: B }, A), true)
cek('tujuan transfer (keId) masuk', termasukAkun({ jenis: 'pindah saldo', dariId: B, keId: A }, A), true)

// ===== deltaMutasi =====
cek('pemasukan +', deltaMutasi({ jenis: 'pemasukan', jumlah: 5000 }, A), 5000)
cek('pengeluaran −', deltaMutasi({ jenis: 'pengeluaran', jumlah: 2000 }, A), -2000)
cek('transfer keluar −', deltaMutasi({ jenis: 'pindah saldo', jumlah: 7000, dariId: A, keId: B }, A), -7000)
cek('transfer masuk +', deltaMutasi({ jenis: 'pindah saldo', jumlah: 7000, dariId: B, keId: A }, A), 7000)
cek('pindah ke diri sendiri = 0', deltaMutasi({ jenis: 'pindah saldo', jumlah: 1000, dariId: A, keId: A }, A), 0)

// ===== infoMutasi =====
cek('label pengeluaran', infoMutasi({ jenis: 'pengeluaran' }, A).label, 'Pengeluaran')
cek('label transfer keluar', infoMutasi({ jenis: 'pindah saldo', dariId: A, keId: B }, A).label, 'Transfer keluar')
cek('label transfer masuk', infoMutasi({ jenis: 'pindah saldo', dariId: B, keId: A }, A).label, 'Transfer masuk')

// ===== bangunMutasi: filter + urutan + saldo sesudah =====
// Saldo sekarang A = 15.000. Mutasi (urut query terbaru-dulu):
//   2026-10-07 pengeluaran 3.000 (A)
//   2026-10-06 pemasukan   10.000 (A)
//   2026-10-05 transfer    2.000 keluar (A -> B)
//   2026-10-05 pengeluaran 99.999 milik B (TIDAK boleh ikut)
// Mundur dari 15.000: sesudah(07-Okt)=15.000; sesudah(06-Okt)=15.000-(-3.000)=18.000;
// sesudah(05-Okt transfer)=18.000-10.000=8.000. (saldo pembuka tersirat 6.000)
const docs = [
  { id: 't3', tanggal: '2026-10-07', jenis: 'pengeluaran', jumlah: 3000, akunId: A, kategoriId: 'k1' },
  { id: 't2', tanggal: '2026-10-06', jenis: 'pemasukan', jumlah: 10000, akunId: A, kategoriId: 'k2' },
  { id: 't1', tanggal: '2026-10-05', jenis: 'pindah saldo', jumlah: 2000, dariId: A, keId: B, akunId: A },
  { id: 'x1', tanggal: '2026-10-05', jenis: 'pengeluaran', jumlah: 99999, akunId: B, kategoriId: 'k1' },
]
const katById = { k1: 'Makanan', k2: 'Gaji' }
const baris = bangunMutasi(docs, { akunId: A, saldoSekarang: 15000, kategoriById: katById })

cek('transaksi akun lain tidak bocor', baris.map((b) => b.id), ['t3', 't2', 't1'])
cek('urutan terbaru-dulu', baris.map((b) => b.tanggal), ['2026-10-07', '2026-10-06', '2026-10-05'])
cek('delta per baris', baris.map((b) => b.delta), [-3000, 10000, -2000])
cek('saldo sesudah mundur dari saldo sekarang', baris.map((b) => b.saldoSesudah), [15000, 18000, 8000])
cek('saldo sesudah baris terbaru = saldo akun', baris[0].saldoSesudah, 15000)
cek(
  'rantai saldo konsisten (sesudah lama + delta lama = sesudah baru)',
  baris[2].saldoSesudah + baris[1].delta === baris[1].saldoSesudah &&
    baris[1].saldoSesudah + baris[0].delta === baris[0].saldoSesudah,
  true,
)
cek('nama kategori dari map', baris.map((b) => b.kategoriNama), ['Makanan', 'Gaji', 'Pindah Saldo'])
cek('label transfer dari sudut akun', baris[2].label, 'Transfer keluar')

// ===== input tak berurutan tetap diurutkan =====
const acak = bangunMutasi([docs[2], docs[0], docs[1]], { akunId: A, saldoSekarang: 15000 })
cek('input acak diurutkan terbaru-dulu', acak.map((b) => b.id), ['t3', 't2', 't1'])

// ===== akun tanpa mutasi / saldo negatif =====
cek('tanpa mutasi = daftar kosong', bangunMutasi([], { akunId: A, saldoSekarang: 0 }), [])
cek(
  'saldo negatif tetap dihitung',
  bangunMutasi([{ id: 'n1', tanggal: '2026-10-01', jenis: 'pengeluaran', jumlah: 500, akunId: A }], {
    akunId: A,
    saldoSekarang: -100,
  })[0].saldoSesudah,
  -100,
)

// ===== ringkasMutasi =====
cek(
  'ringkasan masuk/keluar/jumlah',
  ringkasMutasi(baris),
  { jumlah: 3, masuk: 10000, keluar: 5000 },
)

// ===== filter rentang Kustom masa lalu mempertahankan saldoSesudah historis akurat =====
const kustom = bangunMutasi(docs, {
  akunId: A,
  saldoSekarang: 15000,
  kategoriById: katById,
  range: { start: '2026-10-05', end: '2026-10-06' },
})
cek('kustom masa lalu: hanya mutasi dalam rentang yang tampil', kustom.map((b) => b.id), ['t2', 't1'])
cek('kustom masa lalu: saldoSesudah tetap akurat (18.000 & 8.000, bukan 15.000)', kustom.map((b) => b.saldoSesudah), [18000, 8000])

console.log(`\n${galat.length ? 'GAGAL' : 'LULUS'}: ${lulus}/${lulus + galat.length} cek lolos`)
if (galat.length) {
  console.log(galat.map((g) => `  - ${g}`).join('\n'))
  throw new Error(`Regresi riwayat mutasi: ${galat.length} cek gagal`)
}
