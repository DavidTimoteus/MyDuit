// Tes laporan (Fase 6: laporan.js 547 baris tanpa tes).
// Agregasi diuji lewat jalur DEMO ambilDataLaporan('demo_user_001', 10, 2026)
// — tanpa Firestore, hanya data mock — jadi angkanya bisa dikunci persis.
// Helper tanggal diuji langsung (tanggal relatif terhadap hari ini supaya
// tes tidak basi saat tanggal berubah).
import assert from 'node:assert/strict'
import {
  ambilDataLaporan,
  iso,
  selisihHari,
  tglSingkat,
  labelJatuhTempo,
} from './laporan.js'

let lulus = 0
async function cek(nama, fn) {
  try {
    await fn()
    lulus += 1
    console.log(`  ok    ${nama}`)
  } catch (e) {
    console.log(`  GAGAL ${nama}: ${e.message}`)
    throw e
  }
}
function isoDari(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function geserHari(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

// ---- Helper tanggal ----
await cek('iso memformat YYYY-MM-DD', () => {
  assert.equal(iso(2026, 10, 5), '2026-11-05')
  assert.equal(iso(2026, 0, 1), '2026-01-01')
  assert.equal(iso(2026, 11, 31), '2026-12-31')
})

await cek('tglSingkat memendekkan bulan', () => {
  assert.equal(tglSingkat('2026-11-08'), '08 Nov')
  assert.equal(tglSingkat('2026-01-01'), '01 Jan')
  assert.equal(tglSingkat('2026-13-40'), '2026-13-40')
  assert.equal(tglSingkat(null), '—')
})

await cek('selisihHari non-cicilan relatif ke hari ini', () => {
  assert.equal(selisihHari(isoDari(geserHari(10))), 10)
  assert.equal(selisihHari(isoDari(geserHari(-3))), -3)
  assert.equal(selisihHari(isoDari(geserHari(0))), 0)
  assert.equal(selisihHari(null), null)
  assert.equal(selisihHari('bukan-tanggal'), null)
})

await cek('selisihHari cicilan: target tanggal yang sama bulan ini', () => {
  // Semantik Cicilan: tglJatuhTempo dibaca sebagai TANGGAL bulanan yang
  // berulang (hari-ke-D tiap bulan), bukan tanggal absolut — jadi "10 hari
  // lagi" sebagai tanggal kalender berarti hari-ke-5 bulan DEPAN, dan target
  // bulan ini adalah tanggal 5 (sudah lewat -> negatif). Uji memakai hari
  // yang pasti masih di depan bulan ini (dijepit ke akhir bulan).
  const kini = new Date()
  kini.setHours(0, 0, 0, 0)
  const hariIni = kini.getDate()
  const akhirBulan = new Date(kini.getFullYear(), kini.getMonth() + 1, 0).getDate()
  const targetHari = Math.min(hariIni + 3, akhirBulan)
  const tgl = iso(kini.getFullYear(), kini.getMonth(), targetHari)
  assert.equal(selisihHari(tgl, 'Cicilan'), targetHari - hariIni)
  // Sudah bayar bulan ini -> geser ke bulan depan, hari yang sama:
  // sisa bulan ini + tanggal target bulan depan.
  const hasil = selisihHari(tgl, 'Cicilan', isoDari(kini))
  assert.equal(hasil, akhirBulan - hariIni + targetHari)
})

await cek('labelJatuhTempo semua cabang', () => {
  assert.equal(labelJatuhTempo(null), 'Tanpa jatuh tempo')
  assert.equal(labelJatuhTempo(-3), 'Terlambat 3 hari')
  assert.equal(labelJatuhTempo(0), 'Jatuh tempo hari ini')
  assert.equal(labelJatuhTempo(5), 'H-5')
})

// ---- Agregasi demo November 2026 ----
const data = await ambilDataLaporan('demo_user_001', 10, 2026)

await cek('label + total pemasukan/pengeluaran/saldo demo', () => {
  assert.equal(data.label, 'November 2026')
  assert.equal(data.pemasukan, 12500000)
  // 75.000 + 35.000 + 1.500.000 + 250.000; pindah saldo 500.000 TIDAK dihitung.
  assert.equal(data.pengeluaran, 1860000)
  assert.equal(data.saldo, 10640000)
  assert.equal(data.pemasukanTampil, 12500000)
  assert.equal(data.pengeluaranTampil, 1860000)
})

await cek('transaksi demo terurut tanggal menaik, pindah saldo bernama', () => {
  assert.equal(data.transaksi.length, 6)
  assert.equal(data.transaksi[0].tanggal, '2026-11-01')
  assert.equal(data.transaksi[5].tanggal, '2026-11-08')
  const pindah = data.transaksi.find((t) => t.jenis === 'pindah saldo')
  assert.equal(pindah.kategoriNama, 'Pindah Saldo')
  assert.equal(pindah.akunNama, 'BCA Utama > GoPay / E-Wallet')
})

await cek('top kategori pengeluaran demo', () => {
  assert.deepEqual(data.topOut[0], ['Belanja Bulanan', 1500000])
  assert.deepEqual(data.topOut[1], ['Tagihan & Utilitas', 250000])
  assert.deepEqual(data.topIn[0], ['Gaji Pokok', 12500000])
})

await cek('anggaran demo: persen + urutan + total', () => {
  assert.equal(data.totalBudget, 6000000)
  assert.equal(data.anggaran.length, 3)
  assert.equal(data.anggaran[0].nama, 'Belanja Bulanan')
  assert.equal(data.anggaran[0].persen, 50)
  assert.equal(data.anggaran[0].terpakai, 1500000)
  assert.equal(data.anggaran[0].sisa, 1500000)
  assert.equal(data.anggaran[0].lewat, false)
  assert.equal(data.anggaran[1].persen, 4)
  assert.equal(data.anggaran[2].persen, 4)
})

await cek('total saldo semua rekening demo', () => {
  assert.equal(data.totalSaldo, 51300000)
})

await cek('utang demo: hanya yang aktif, lunas tersaring', () => {
  assert.equal(data.utang.aktif.length, 1)
  assert.equal(data.utang.aktif[0].namaPihak, 'Kredit Motor Honda')
  assert.equal(data.utang.totalAktif, 6000000)
  assert.equal(data.utang.cicilanPerBulan, 1500000)
})

console.log(`laporan: OK (${lulus} cek lulus)`)
