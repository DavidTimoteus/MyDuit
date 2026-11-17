// Uji logika ringkasan koreksi saldo (tanpa Firestore/React).
// Jalankan: node src/features/budget/mutasiKoreksi.test.mjs
import assert from 'node:assert/strict'
import { isoDari, isoHariIni } from '../../lib/format.js'
import {
  gabungkanKoreksi,
  grupKoreksi,
  jamDariWaktu,
  ringkasKoreksi,
  waktuMillis,
} from './mutasiKoreksi.js'

let lulus = 0
const galat = []
function cek(nama, dapat, harap) {
  const ok = JSON.stringify(dapat) === JSON.stringify(harap)
  if (ok) lulus++
  else galat.push(`${nama}\n  dapat : ${JSON.stringify(dapat)}\n  harap : ${JSON.stringify(harap)}`)
  console.log(`  ${ok ? 'ok  ' : 'GAGAL'} ${nama}`)
}

const t1 = new Date(2026, 10, 17, 8, 5).getTime()
const t2 = new Date(2026, 10, 17, 14, 30).getTime()
const t3 = new Date(2026, 10, 16, 9, 0).getTime()
const lama = new Date(2026, 10, 1, 10, 0).getTime()

// ===== konversi waktu =====
cek('waktuMillis angka', waktuMillis(t1), t1)
cek('waktuMillis Timestamp-like', waktuMillis({ seconds: Math.floor(t1 / 1000), nanoseconds: 0 }), Math.floor(t1 / 1000) * 1000)
cek('waktuMillis string ISO', waktuMillis(new Date(t1).toISOString()), t1)
cek('jam lokal', jamDariWaktu(t1), '08:05')

// ===== gabungkan log + legacy =====
const logs = [
  { id: 'a', akunId: 'A', aksi: 'koreksi saldo', delta: 100, timestamp: t1, deleted: false },
  { id: 'b', akunId: 'A', aksi: 'koreksi saldo', delta: 250, timestamp: t2, deleted: false },
  { id: 'c', akunId: 'B', aksi: 'koreksi saldo', delta: -75, timestamp: t3, deleted: false },
  { id: 'd', akunId: 'C', aksi: 'koreksi saldo', delta: 999, timestamp: t2, deleted: true },
  { id: 'e', akunId: 'C', aksi: 'koreksi saldo', delta: 0, timestamp: t2, deleted: false },
  { id: 'f', akunId: 'C', aksi: 'transaksi biasa', delta: 500, timestamp: t2, deleted: false },
]
const akun = [
  { id: 'A', mutasiTerakhir: { delta: 10, keterangan: 'Koreksi penyesuaian saldo', at: lama } },
  { id: 'B', mutasiTerakhir: { delta: 20, keterangan: 'Koreksi penyesuaian saldo', at: t2 } },
  { id: 'D', mutasiTerakhir: { delta: 30, keterangan: 'Koreksi penyesuaian saldo', at: t3 } },
]
const gabungan = gabungkanKoreksi(logs, akun)
cek('jumlah entri (3 log + 1 legacy A + 1 legacy D; legacy B tertimpa log)', gabungan.length, 5)
cek('urutan terbaru dulu (waktu sama mempertahankan urutan)', gabungan.map((r) => r.delta), [250, 100, -75, 30, 10])
cek('legacy lama tetap ikut', gabungan.some((r) => r.id === 'legacy-A'), true)
cek('legacy yang sudah tercakup log tidak dobel', gabungan.some((r) => r.id === 'legacy-B'), false)

// ===== ringkasan =====
const ringkas = ringkasKoreksi(gabungan)
cek('total delta', ringkas.total, 315)
cek('jumlah penyesuaian', ringkas.jumlah, 5)
cek('jumlah rekening unik', ringkas.akunCount, 3)

// ===== grouping =====
const grup = grupKoreksi(gabungan)
cek('grup pertama = hari ini', grup[0].label, 'Hari Ini')
cek('grup tanggal lokal', grup[0].key, isoHariIni())
cek('grup kedua = kemarin', grup[1].label, 'Kemarin')
cek('grup kedua benar', grup[1].key, isoDari(new Date(t3)))
cek('total item semua grup', grup.reduce((s, g) => s + g.items.length, 0), 5)

console.log(`\n${galat.length ? 'GAGAL' : 'LULUS'}: ${lulus}/${lulus + galat.length} cek lolos`)
if (galat.length) {
  console.log(galat.map((g) => `  - ${g}`).join('\n'))
  throw new Error(`Regresi mutasiKoreksi: ${galat.length} cek gagal`)
}
