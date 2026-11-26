// Kontrak sumber: wiring R-05/R-06/R-07 re-audit di src/lib/db.js.
// Keputusan angkanya diuji angka-demi-angka di keuanganAudit.suite.js
// (hitungSisaUtangBaru, hitungDeltaKoreksi, cekSaldoCukup); file ini mengunci
// bahwa jalur transaksi benar-benar memakai helper itu dengan data SERVER,
// karena emulator Firestore tidak bisa jalan di VM ini.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./db.js', import.meta.url), 'utf8')

function hitung(pola) {
  return src.split(pola).length - 1
}

let lulus = 0
function cek(nama, kondisi) {
  assert.ok(kondisi, nama)
  lulus++
  console.log(`  ok - ${nama}`)
}

cek(
  'R-07: simpanTransaksi + bayarUtang cek saldo dari akunSnap server (2x)',
  hitung('cekSaldoCukup({ saldo: akunSnap.data()?.saldo, jumlah: jumlahInt })') === 2,
)
cek(
  'R-07: pindahSaldo cek saldo dari dariSnap server',
  hitung('cekSaldoCukup({ saldo: dariSnap.data()?.saldo, jumlah: jumlahInt })') === 1,
)
cek(
  'R-07: cek saldo hanya untuk pengeluaran di simpanTransaksi',
  src.includes("if (trans.jenis === 'pengeluaran') {\n        cekSaldoCukup("),
)
cek(
  'R-05: simpanUtang edit hitung sisa dari snap server',
  src.includes('hitungSisaUtangBaru({\n          totalServer: snap.data()?.total,'),
)
cek(
  'R-06: updateAkun hitung delta dari snap server',
  src.includes('hitungDeltaKoreksi({ saldoServer: snap.data()?.saldo, saldoBaru })'),
)
cek(
  'fallback offline membaca cache (akun/utang) sebelum pakai snapshot UI',
  hitung('getDocFromCache(') >= 5,
)
cek(
  'denganTransaksi dipakai simpanUtang edit (bukan updateDoc polos)',
  src.includes('const hasil = await denganTransaksi(\n      db,\n      async (tx) => {\n        const snap = await tx.get(utangDoc)'),
)
cek(
  'denganTransaksi dipakai updateAkun (bukan writeBatch polos)',
  src.includes('await denganTransaksi(\n    db,\n    async (tx) => {\n      const snap = await tx.get(refAkun)'),
)
cek(
  'REGRESI JAM 25 Nov 2026 — DIAKTIFKAN LAGI 26 Nov 2026: buildTransQuery orderBy jam (tanggal desc, jam desc, createdAt desc); prasyarat: migrasiJam backfill dokumen lama + importGas/restore selalu isi jam + index jam READY',
  src
    .slice(src.indexOf('export function buildTransQuery'), src.indexOf('export function docKeTransaksi'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
    .includes("orderBy('jam'"),
)
const appSrc = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
cek(
  'migrasiJam diekspor db.js dan dipanggil App.jsx saat login (backfill jam dokumen lama)',
  src.includes('export async function migrasiJam') && appSrc.includes('migrasiJam'),
)

console.log(`dbKontrak: ${lulus} cek lulus`)
