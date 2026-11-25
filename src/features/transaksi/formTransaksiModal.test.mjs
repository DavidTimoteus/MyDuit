// Kontrak sumber: wiring R-04 re-audit di FormTransaksiModal.jsx.
// Edit tanpa ubah angka harus menyimpan jumlah basis asli (bukan hasil
// round-trip tampil -> basis). Logika keputusannya diuji angka-demi-angka di
// kurs.test.mjs (jumlahSimpanDariTampil); file ini mengunci pemakaiannya
// di modal, karena renderToString tidak bisa menekan tombol simpan.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./FormTransaksiModal.jsx', import.meta.url), 'utf8')

let lulus = 0
function cek(nama, kondisi) {
  assert.ok(kondisi, nama)
  lulus++
  console.log(`  ok - ${nama}`)
}

cek('modal mengimpor jumlahSimpanDariTampil', src.includes('jumlahSimpanDariTampil'))
cek('submit memakai jumlahSimpanDariTampil (bukan konversiKeBasis langsung untuk teks)', src.includes('n = jumlahSimpanDariTampil(jumlah,'))
cek('submit mengirim jumlahBasisAsli dari sumber', src.includes('jumlahBasisAsli: mode === \'edit\' ? sumber?.jumlah : null'))
cek('submit mengirim teksAwalTampil dari ref', src.includes('teksAwalTampil: jumlahAwalTampilRef.current'))
cek('ref teks awal diisi saat modal dibuka (edit/salin)', src.includes('jumlahAwalTampilRef.current = formatInputTampil(sumber.jumlah'))
cek('ref teks awal dikosongkan untuk transaksi baru', src.includes("jumlahAwalTampilRef.current = ''"))
cek('jalur kalkulator tetap konversi langsung (bukan lewat helper)', src.includes('n = konversiKeBasis(hasilTampil,'))

console.log(`formTransaksiModal: ${lulus} cek lulus`)
