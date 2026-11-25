// Kontrak statik Fase 3 re-audit: firestore.rules menutup bypass
// delete+create, melengkapi fieldTetapAda, mengunci saldo ke jejak
// mutasiTerakhir, dan membuat mutasiLog hanya-bendera (isi tak berubah).
// Test ini MEMBACA file rules apa adanya — emulator Firestore tidak bisa
// jalan di VM ini, jadi ini pengikat teks + kompilasi dry-run, bukan uji
// perilaku runtime. Uji perilaku hidup di src/lib/firestoreRules.test.mjs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')

let lulus = 0
function cek(nama, kondisi) {
  assert.ok(kondisi, nama)
  lulus++
  console.log(`  ok - ${nama}`)
}

function badanFungsi(nama) {
  const awal = rules.indexOf(`function ${nama}(`)
  assert.ok(awal >= 0, `fungsi ${nama} ada`)
  const akhir = rules.indexOf('\n    function ', awal + 1)
  const akhirMatch = rules.indexOf('\n    match ', awal + 1)
  const batas = [akhir, akhirMatch].filter((x) => x > 0)
  return rules.slice(awal, Math.min(...batas))
}

function blokMatch(koleksi) {
  const awal = rules.indexOf(`match /users/{uid}/${koleksi}/{docId} {`)
  assert.ok(awal >= 0, `match ${koleksi} ada`)
  const akhir = rules.indexOf('\n    }', awal)
  return rules.slice(awal, akhir)
}

// R-01 + M-01: tidak ada lagi allow delete di koleksi mana pun.
// Komentar boleh menyebut frasa itu (mis. menjelaskan penghapusan), jadi
// cek dilakukan pada rules tanpa komentar baris.
const rulesTanpaKomentar = rules
  .split('\n')
  .map((baris) => baris.replace(/\/\/.*$/, ''))
  .join('\n')
cek('tidak ada "allow delete" di rules', !rulesTanpaKomentar.includes('allow delete'))
cek('tidak ada "allow read, delete" di rules', !rulesTanpaKomentar.includes('allow read, delete'))
for (const k of ['transaksi', 'akun', 'kategori', 'budget', 'utang', 'pembayaranUtang', 'mutasiLog', 'meta']) {
  cek(`match ${k} mengizinkan baca saja (tanpa delete)`, blokMatch(k).includes('allow read: if isOwner(uid);'))
}

// Un-delete (bendera saja, true -> false) tersedia di semua koleksi,
// supaya restore bisa memulihkan dokumen soft-delete tanpa hard-delete.
cek('fungsi isUnDelete didefinisikan', rules.includes('function isUnDelete()'))
cek(
  'isUnDelete mengizinkan deletedAt dihapus (deleteField)',
  badanFungsi('isUnDelete').includes("!('deletedAt' in d)"),
)
for (const k of ['transaksi', 'akun', 'kategori', 'budget', 'utang', 'pembayaranUtang', 'mutasiLog', 'meta']) {
  cek(`match ${k} mengizinkan isUnDelete()`, blokMatch(k).includes('isUnDelete()'))
}

// R-02: fieldTetapAda lengkap di semua validator.
cek('validKategori menjaga nama', badanFungsi('validKategori').includes("fieldTetapAda('nama')"))
const budget = badanFungsi('validBudget')
cek(
  'validBudget menjaga limitNominal/bulan/tahun',
  budget.includes("fieldTetapAda('limitNominal')") && budget.includes("fieldTetapAda('bulan')") && budget.includes("fieldTetapAda('tahun')"),
)
const utang = badanFungsi('validUtang')
cek(
  'validUtang menjaga namaPihak/total/sisa',
  utang.includes("fieldTetapAda('namaPihak')") && utang.includes("fieldTetapAda('total')") && utang.includes("fieldTetapAda('sisa')"),
)
cek('validPembayaranUtang menjaga jumlah', badanFungsi('validPembayaranUtang').includes("fieldTetapAda('jumlah')"))
cek('validAkun menjaga saldo', badanFungsi('validAkun').includes("fieldTetapAda('saldo')"))

// R-03: perubahan saldo wajib disertai mutasiTerakhir yang deltanya sama
// dengan perubahan saldo (tulis absolut diam-diam ditolak).
cek(
  'validAkun mengunci saldo ke mutasiTerakhir.delta',
  badanFungsi('validAkun').includes('d.mutasiTerakhir.delta == d.saldo - resource.data.saldo'),
)

// M-02: mutasiLog hanya create + ubah bendera (isi delta/aksi tak berubah);
// update tanpa perubahan (no-op, mis. restore merge-set) tetap diizinkan.
const log = blokMatch('mutasiLog')
cek('mutasiLog tidak lagi "allow create, update"', !log.includes('allow create, update'))
cek('mutasiLog mengizinkan create saja', log.includes('allow create:'))
cek('mutasiLog update hanya soft-delete/un-delete/no-op', log.includes('isSoftDelete() || isUnDelete()'))
cek('mutasiLog update no-op diizinkan', log.includes('affectedKeys().size() == 0'))

// meta boleh di-soft-delete (hapus semua data) dan dipulihkan.
cek('validMeta mengizinkan field deleted/deletedAt', badanFungsi('validMeta').includes("'deleted'") && badanFungsi('validMeta').includes("'deletedAt'"))

// Komentar perbaikan basis yang lama (delete lalu buat ulang) tidak boleh
// lagi mengklaim jalan itu ada.
cek(
  'komentar perbaikan basis tidak lagi menyebut delete',
  !rules.includes('harus dihapus dulu (delete diizinkan)'),
)

console.log(`rulesKeamanan: ${lulus} cek lulus`)
