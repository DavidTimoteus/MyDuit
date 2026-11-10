import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { deltaSaldo, kunciKategori, pindahSaldo, simpanBudget, simpanTransaksi, simpanUtang, bayarUtang } from './db.js'
import { bersihkanDokumenRestore, hidupkanTimestamp, validDocId } from '../features/backup/backup.js'
import { konversiBackupGas } from '../features/backup/importGas.js'
import { aturanAnalitik, hitungPersenPerubahan } from '../features/statistik/_aturan.js'
import { validasiEndpointOcr } from './ocrProvider.js'
import { RIWAYAT_AWAL, kurangRiwayat } from '../features/transaksi/mergeRiwayat.js'

let total = 0
let lulus = 0
const galat = []

async function cek(nama, fn) {
  total++
  try {
    await fn()
    lulus++
    console.log(`  ok    ${nama}`)
  } catch (e) {
    galat.push(`${nama}: ${e?.message ?? e}`)
    console.log(`  GAGAL ${nama}: ${e?.message ?? e}`)
  }
}

// 1. Integritas deltaSaldo & kunciKategori
await cek('deltaSaldo menahan NaN, string, Infinity, dan pindah saldo (kembali 0)', () => {
  assert.equal(deltaSaldo({ jenis: 'pemasukan', jumlah: 100000 }), 100000)
  assert.equal(deltaSaldo({ jenis: 'pengeluaran', jumlah: 50000 }), -50000)
  assert.equal(deltaSaldo({ jenis: 'pindah saldo', jumlah: 50000 }), 0)
  assert.equal(deltaSaldo({ jenis: 'pengeluaran', jumlah: 'bukan-angka' }), 0)
  assert.equal(deltaSaldo({ jenis: 'pemasukan', jumlah: Number.POSITIVE_INFINITY }), 0)
})

await cek('kunciKategori memisahkan nama "Lainnya" lintas pemasukan & pengeluaran', () => {
  const kIn = kunciKategori('Lainnya', 'pemasukan')
  const kOut = kunciKategori('Lainnya', 'pengeluaran')
  assert.notEqual(kIn, kOut)
  assert.equal(kunciKategori(' makanan ', 'Pengeluaran'), kunciKategori('Makanan', 'pengeluaran'))
})

// 2. Guard layer db.js menolak input tidak valid
await cek('db.js menolak nominal <= 0 / NaN dan pindah saldo ke rekening sama', async () => {
  await assert.rejects(() => simpanTransaksi('demo_user_001', { jumlah: 0, jenis: 'pengeluaran', akunId: 'a1' }))
  await assert.rejects(() => simpanTransaksi('demo_user_001', { jumlah: Number.NaN, jenis: 'pemasukan', akunId: 'a1' }))
  await assert.rejects(() => pindahSaldo('demo_user_001', { dariId: 'a1', keId: 'a1', jumlah: 50000 }))
  await assert.rejects(() => simpanBudget('demo_user_001', { kategoriId: 'k1', limitNominal: 0, bulan: 5, tahun: 2026 }))
  await assert.rejects(() => simpanBudget('demo_user_001', { kategoriId: 'k1', limitNominal: 10000, bulan: 12, tahun: 2026 }))
  await assert.rejects(() => simpanUtang('demo_user_001', { namaPihak: 'Bank', total: -5000 }))
  await assert.rejects(() => bayarUtang('demo_user_001', { utang: { id: 'u1', sisa: 1000 }, jumlah: 0, akun: { id: 'a1' } }))
})

// 3. Perhitungan Statistik (trend negatif & proyeksi bulan lampau)
await cek('hitungPersenPerubahan benar saat periode sebelumnya negatif (-1jt -> +500rb = +150%)', () => {
  assert.equal(hitungPersenPerubahan(500000, -1000000, true), 150)
  assert.equal(hitungPersenPerubahan(-1000000, -500000, true), -100)
  assert.equal(hitungPersenPerubahan(-500000, 0, true), null)
  assert.equal(hitungPersenPerubahan(0, 0, true), 0)
  assert.equal(hitungPersenPerubahan(100000, 50000, false), null)
})

await cek('aturanAnalitik tidak membuat proyeksi untuk bulan lampau & aman pada tanggal korup', () => {
  const now = new Date()
  const prevBulan = now.getMonth() === 0 ? 11 : now.getMonth() - 1
  const prevTahun = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  const saran = aturanAnalitik({
    mode: 'bulanan',
    ringkas: {
      in_: 5000000,
      out: 2000000,
      saldo: 3000000,
      pengeluaran: [{ nama: 'Makanan', total: 2000000 }],
      harian: { '': { out: 100000 }, '2026-01-02': { out: 500000 }, '2026-01-03': { out: 700000 } },
      jmlTransaksi: 3,
    },
    tren: { ada: false, out: 0 },
    jumlahHariBulan: 30,
    bulan: prevBulan,
    tahun: prevTahun,
  })
  assert.equal(saran.some((s) => s.judul.startsWith('Proyeksi akhir bulan')), false)
})

// 4. Keamanan Backup/Restore & Konversi GAS
await cek('validDocId menolak path traversal dan kunci prototype berbahaya', () => {
  assert.equal(validDocId('tx_123'), 'tx_123')
  assert.equal(validDocId('a/b/c'), null)
  assert.equal(validDocId('..\\secret'), null)
  assert.equal(validDocId('..'), null)
  assert.equal(validDocId('__proto__'), null)
})

await cek('hidupkanTimestamp dan bersihkanDokumenRestore memblokir __proto__ & menormalkan tipe', () => {
  const payload = JSON.parse('{"jumlah":"50000.00","catatan":"Test","__proto__":{"polluted":true}}')
  const revived = hidupkanTimestamp(payload)
  assert.equal(Object.prototype.hasOwnProperty.call(revived, '__proto__'), false)
  const cleanTx = bersihkanDokumenRestore('transaksi', revived)
  assert.equal(cleanTx.deleted, false)
  assert.equal(cleanTx.jumlah, 50000)
  assert.equal(cleanTx.jenis, 'pengeluaran')

  const cleanBudget = bersihkanDokumenRestore('budget', { limitNominal: '250.000', bulan: 99, tahun: 1990 })
  assert.equal(cleanBudget.limitNominal, 250000)
  assert.equal(cleanBudget.bulan, 11)
  assert.equal(cleanBudget.tahun, 2000)

  const cleanAkun = bersihkanDokumenRestore('akun', { nama: 'Kas', saldo: '-75000' })
  assert.equal(cleanAkun.saldo, -75000)
})

await cek('konversiBackupGas tidak meloncati 100x pada desimal string & lewati pembayaran terhapus', () => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ ID: 'u1', Total: '100000.00', Status: 'Belum Lunas', NamaPihak: 'A' }]),
    'Utang',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { ID: 'p1', UtangID: 'u1', Nominal: '40000.00', Tanggal: '2026-11-01', Deleted: 'false' },
      { ID: 'p2', UtangID: 'u1', Nominal: '60000.00', Tanggal: '2026-11-02', Deleted: 'true' },
    ]),
    'PembayaranUtang',
  )
  const { json } = konversiBackupGas(wb, XLSX, 'uid_test')
  assert.equal(json.data.utang[0].total, 100000)
  assert.equal(json.data.utang[0].sisa, 60000)
})

// 5. Keamanan Endpoint OCR & Isolasi Sesi mergeRiwayat
await cek('validasiEndpointOcr menolak protokol berbahaya & HTTP eksternal non-localhost', () => {
  assert.equal(validasiEndpointOcr('http://127.0.0.1:8000/'), 'http://127.0.0.1:8000')
  assert.equal(validasiEndpointOcr('https://ocr.example.com'), 'https://ocr.example.com')
  assert.throws(() => validasiEndpointOcr('javascript:alert(1)'))
  assert.throws(() => validasiEndpointOcr('http://evil.example.com/ocr'))
})

await cek('mergeRiwayat mereset pendingAdds & deletedIds saat UID berubah', () => {
  let st = kurangRiwayat(RIWAYAT_AWAL, { type: 'mulai', kunci: 'uidA|semua||' })
  st = kurangRiwayat(st, { type: 'tambah', item: { id: 'txA', jenis: 'pengeluaran', tanggal: '2026-11-05' } })
  st = kurangRiwayat(st, { type: 'hapus', ids: ['txHapusA'] })
  assert.equal(st.pendingAdds.size, 1)
  assert.equal(st.deletedIds.size, 1)

  const stBaru = kurangRiwayat(st, { type: 'mulai', kunci: 'uidB|semua||' })
  assert.equal(stBaru.pendingAdds.size, 0)
  assert.equal(stBaru.deletedIds.size, 0)
  assert.equal(stBaru.docs.length, 0)
})

console.log(`\n${galat.length ? 'GAGAL' : 'LULUS'}: ${lulus}/${total} cek audit lolos`)
if (galat.length) throw new Error(`Uji keuanganAudit gagal: ${galat.join(' | ')}`)

