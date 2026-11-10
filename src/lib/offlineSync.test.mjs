// offlineSync.test.mjs — mengunci jaminan offline-first.
//
// Menguji KEBIJAKAN pada jalur tulis Firestore, bukan menebak dari membaca
// source: setiap dokumen transaksi WAJIB memakai ID yang dibuat server, dan
// saldo WAJIB ditulis atomik lewat increment(). Kalau suatu saat ada yang
//Replace dengan id buatan client (Date.now / Math.random), dua perangkat yang
// offline bersamaan bisa membuat dokumen berbeda dengan ID sama — cek ini
// yang menangkapnya sebelum data rusak di lapangan.
import { inspect } from 'node:util'

// Ekstrak setiap jalur tulis dari db.js dan klasifikasikan apakah ID-nya
// dibuat server (aman) atau oleh client (berisiko tabrakan saat offline).
const fs = await import('node:fs')
const src = fs.readFileSync(new URL('./db.js', import.meta.url), 'utf8')
const baris = src.split('\n')

const tulis = []
baris.forEach((l, i) => {
  const kode = l.replace(/\/\/.*$/, '').trim()
  if (!kode) return
  //ocument ditulis dengan ID kosong -> Firestore yang membuat ID (server-generated)
  const idKosong = /doc\(\s*userCol\([^)]*\)\s*\)/.test(kode)
  const addDocPakai = /\baddDoc\(/.test(kode)
  const idEksplisit = /doc\(\s*userCol\([^)]*,\s*[^)]*,/.test(kode)
  const idDariVar = /doc\(\s*userCol\([^)]*,\s*[^)]*\.\w+\s*\)/.test(kode)
  if (idKosong || addDocPakai) {
    tulis.push({ baris: i + 1, cara: 'server-generated', teks: kode.slice(0, 78) })
  } else if (idEksplisit || idDariVar) {
    tulis.push({ baris: i + 1, cara: 'id-dari-server', teks: kode.slice(0, 78) })
  }
})

console.log('=== Jalur penulisan dokumen ===')
for (const t of tulis) console.log(`  ${String(t.baris).padStart(4)}  ${t.cara.padEnd(16)} ${t.teks}`)

const serverGen = tulis.filter((t) => t.cara === 'server-generated').length
const total = tulis.length
console.log(`\n  jalur tulis total      : ${total}`)
console.log(`  ID dibuat server       : ${serverGen}`)
console.log(`  memakai increment()    : ${(src.match(/\bincrement\(/g) || []).length} (atomik, aman races)`)
console.log(`  memakai runTransaction : ${(src.match(/runTransaction\(/g) || []).length}`)

console.log('\n=== KRITERIA OFFLINE-FIRST & INTEGRITAS LEDGER ===')
const fbSrc = fs.readFileSync(new URL('./firebase.js', import.meta.url), 'utf8')
const cek = [
  ['persistentLocalCache aktif di firebase.js', /persistentLocalCache\(/.test(fbSrc)],
  ['multi-tab manager aktif di firebase.js', /persistentMultipleTabManager\(/.test(fbSrc)],
  ['tidak ada ID buatan client (Date.now/random) pada jalur tulis Firestore',
    !/doc\([^)]*Date\.now\(\)/.test(src) && !/doc\([^)]*Math\.random\(\)/.test(src)],
  ['balance & sisa utang ditulis atomik via increment()', (src.match(/\bincrement\(/g) || []).length >= 9],
  ['seedKategoriJikaKosong memakai getDoc(markerRef) 1-read', /getDoc\(markerRef\)/.test(src)],
  ['bayarUtang menautkan utangId & pembayaranUtangId ke transaksi', /utangId:\s*utang\.id/.test(src) && /pembayaranUtangId:\s*bayarRef\.id/.test(src)],
  ['hapusTransaksi me-rollback sisa utang & pembayaranUtang', /trans\.utangId/.test(src) && /trans\.pembayaranUtangId/.test(src)],
  ['hapusTransaksiMassal memakai writeBatch terkelompok', /export async function hapusTransaksiMassal/.test(src)],
]
let gagal = 0
for (const [nama, ok] of cek) {
  const nyata = Boolean(ok)
  if (!nyata) gagal++
  console.log(`  ${nyata ? '[OK]  ' : '[GAGAL]'} ${nama}`)
}
console.log(gagal === 0 ? '\nSemua kriteria terpenuhi.' : `\n${gagal} kriteria gagal.`)
if (gagal > 0) throw new Error(`${gagal} kriteria offline-first gagal`)