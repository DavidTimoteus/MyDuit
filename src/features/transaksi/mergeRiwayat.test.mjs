// Uji regresi filter transaksi: "Semua Transaksi" -> kembali "Hari Ini"
// harus MENAMPILKAN DATA YANG BERUBAH, bukan daftar lama yang tidak bergerak.
//
// Jalankan: node src/features/transaksi/mergeRiwayat.test.mjs
import { RIWAYAT_AWAL, gabungSnapshot, kurangRiwayat } from './mergeRiwayat.js'

let lulus = 0
const galat = []

function cek(nama, dapat, harap) {
  const ok = JSON.stringify(dapat) === JSON.stringify(harap)
  if (ok) lulus++
  else galat.push(`${nama}\n      dapat : ${JSON.stringify(dapat)}\n      harap : ${JSON.stringify(harap)}`)
  console.log(`  ${ok ? 'ok  ' : 'GAGAL'} ${nama}`)
}

const trx = (id, tanggal) => ({ id, tanggal, jumlah: 1000 })
const K_SEMUA = 'u1|semua||'
const K_HARI = 'u1|semua|2026-10-08|2026-10-08'

// ===== Skenario bug: semua -> hari ini =====
// 1. Filter "Semua" terisi 50 dokumen.
let state = kurangRiwayat(RIWAYAT_AWAL, { type: 'mulai', kunci: K_SEMUA })
for (let i = 0; i < 50; i++) state = kurangRiwayat(state, { type: 'snapshot', kunci: K_SEMUA, list: Array.from({ length: 50 }, (_, k) => trx(`s${k}`, '2026-09-01')) })
cek('filter semua: 50 dokumen masuk', state.docs.length, 50)

// 2. User kembali ke "Hari Ini" -> langganan baru, snapshot hanya 3 dokumen.
state = kurangRiwayat(state, { type: 'mulai', kunci: K_HARI })
cek('ganti filter: dokumen lama dibuang', state.docs.length, 0)

const hariIni = [trx('h1', '2026-10-08'), trx('h2', '2026-10-08'), trx('h3', '2026-10-08')]
state = kurangRiwayat(state, { type: 'snapshot', kunci: K_HARI, list: hariIni })
cek('kembali ke hari ini: daftar = 3 dokumen hari ini saja', state.docs.map((t) => t.id), ['h1', 'h2', 'h3'])

// 3. Balik lagi ke "Semua" -> daftar hari ini tak ikut terselip.
state = kurangRiwayat(state, { type: 'mulai', kunci: K_SEMUA })
const semuaBaru = Array.from({ length: 50 }, (_, k) => trx(`s${k}`, '2026-09-01'))
state = kurangRiwayat(state, { type: 'snapshot', kunci: K_SEMUA, list: semuaBaru })
cek('semua lagi: 50 dokumen, tanpa sisa dokumen hari-ini', [state.docs.length, state.docs.some((t) => t.id === 'h1')], [50, false])

// 4. Snapshot dari langganan BASI (kunci lama) tidak boleh mengubah daftar.
const sebelum = state.docs
state = kurangRiwayat(state, { type: 'snapshot', kunci: K_HARI, list: hariIni })
cek('snapshot langganan basi diabaikan', state.docs === sebelum || state.docs.length === 50, true)

// ===== Transaksi terhapus harus hilang (tanpa halaman lanjutan) =====
let bersih = kurangRiwayat(RIWAYAT_AWAL, { type: 'mulai', kunci: K_SEMUA })
const empat = [trx('a', '2026-10-01'), trx('b', '2026-10-01'), trx('c', '2026-10-01'), trx('d', '2026-10-01')]
bersih = kurangRiwayat(bersih, { type: 'snapshot', kunci: K_SEMUA, list: empat })
bersih = kurangRiwayat(bersih, { type: 'snapshot', kunci: K_SEMUA, list: empat.filter((t) => t.id !== 'c') })
cek('hapus transaksi: langsung keluar dari daftar', bersih.docs.map((t) => t.id), ['a', 'b', 'd'])

// ===== "Muat lagi": halaman lanjutan tetap ada walau snapshot baru datang =====
let lanjut = kurangRiwayat(RIWAYAT_AWAL, { type: 'mulai', kunci: K_SEMUA })
const hal1 = Array.from({ length: 50 }, (_, k) => trx(`h${k}`, '2026-10-08'))
lanjut = kurangRiwayat(lanjut, { type: 'snapshot', kunci: K_SEMUA, list: hal1 })
lanjut = kurangRiwayat(lanjut, { type: 'lanjut', kunci: K_SEMUA, list: Array.from({ length: 50 }, (_, k) => trx(`l${k}`, '2026-10-07')) })
cek('muat lagi: 100 dokumen', lanjut.docs.length, 100)

// Satu transaksi baru masuk -> halaman pertama bergeser. h49 keluar dari
// halaman pertama (kini nomor #51, awal halaman lanjutan) dan WAJIB tetap
// tampil, kalau tidak ada lubang di tengah daftar.
const hal1Baru = [trx('BARU', '2026-10-08'), ...hal1.slice(0, 49)]
lanjut = kurangRiwayat(lanjut, { type: 'snapshot', kunci: K_SEMUA, list: hal1Baru })
cek(
  'snapshot baru: dokumen lanjutan dipertahankan + tanpa duplikat',
  [lanjut.docs.length, new Set(lanjut.docs.map((t) => t.id)).size, lanjut.docs.some((t) => t.id === 'h49')],
  [101, 101, true],
)

// Dokumen lanjutan yang sudah ada tidak boleh digandakan saat "Muat lagi"
// diulang; hanya dokumen BARU yang ditambahkan.
lanjut = kurangRiwayat(lanjut, { type: 'lanjut', kunci: K_SEMUA, list: [trx('l0', '2026-10-07'), trx('lBARU', '2026-10-06')] })
cek('lanjut duplikat tidak menggandakan dokumen', [lanjut.docs.length, new Set(lanjut.docs.map((t) => t.id)).size], [102, 102])

// ===== gabungSnapshot langsung =====
cek('tanpa lanjutan: snapshot menang mutlak', gabungSnapshot({ prev: [trx('x', 'd')], list: [trx('y', 'd')], adaLanjutan: false }).map((t) => t.id), ['y'])
cek('dengan lanjutan: prev > list dipertahankan', gabungSnapshot({ prev: [trx('1', 'd'), trx('2', 'd')], list: [trx('1', 'd')], adaLanjutan: true }).map((t) => t.id), ['1', '2'])

// ===== Hapus Optimis & Perlindungan Snapshot Basi =====
let opt = kurangRiwayat(RIWAYAT_AWAL, { type: 'mulai', kunci: K_SEMUA })
opt = kurangRiwayat(opt, { type: 'snapshot', kunci: K_SEMUA, list: [trx('t1', 'd'), trx('t2', 'd'), trx('t3', 'd')] })
opt = kurangRiwayat(opt, { type: 'hapus', id: 't2' })
cek('hapus optimis tunggal: id terhapus langsung hilang seketika', opt.docs.map((t) => t.id), ['t1', 't3'])

// Snapshot lama dari server/cache yang masih membawa 't2' tidak boleh memunculkannya kembali
opt = kurangRiwayat(opt, { type: 'snapshot', kunci: K_SEMUA, list: [trx('t1', 'd'), trx('t2', 'd'), trx('t3', 'd')] })
cek('snapshot basi tidak membangkitkan transaksi terhapus', opt.docs.map((t) => t.id), ['t1', 't3'])

// Hapus massal
opt = kurangRiwayat(opt, { type: 'hapus', ids: ['t1', 't3'] })
cek('hapus optimis massal: seluruh id terpilih hilang seketika', opt.docs.length, 0)

console.log(`\n${galat.length ? 'GAGAL' : 'LULUS'}: ${lulus}/${lulus + galat.length} cek lolos`)
if (galat.length) {
  console.log(galat.map((g) => `  - ${g}`).join('\n'))
  throw new Error(`Regresi filter transaksi: ${galat.length} cek gagal`)
}
