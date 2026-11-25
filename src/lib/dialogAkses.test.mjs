// Tes aksesibilitas dialog (Fase 6 re-audit: R-06/R-07 — focus trap + Escape).
// Dua lapis: (1) perilaku murni buatPenjagaDialog diuji dengan DOM palsu
// (tanpa browser); (2) pemindaian sumber mengunci setiap modal memakai
// useDialogAkses + role="dialog" + aria-modal="true".
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(__dirname, '..')
let lulus = 0
function cek(nama, fn) {
  try {
    fn()
    lulus += 1
    console.log(`  ok    ${nama}`)
  } catch (e) {
    console.log(`  GAGAL ${nama}: ${e.message}`)
    throw e
  }
}

const { buatPenjagaDialog, daftarFokusabel } = await import('./aksesDialog.js')

function elemenPalsu(nama) {
  return {
    nama,
    disabled: false,
    offsetParent: {},
    fokusDipanggil: 0,
    focus() {
      this.fokusDipanggil += 1
      globalThis.document.activeElement = this
    },
  }
}
function wadahPalsu(anak) {
  return {
    querySelectorAll() {
      return anak
    },
  }
}
function tombolPalsu(key, shiftKey = false) {
  return {
    key,
    shiftKey,
    dicegah: false,
    preventDefault() {
      this.dicegah = true
    },
    stopPropagation() {},
  }
}

await cek('Tab di elemen terakhir melompat ke pertama', () => {
  const a = elemenPalsu('a')
  const b = elemenPalsu('b')
  const c = elemenPalsu('c')
  globalThis.document = { activeElement: c }
  const jaga = buatPenjagaDialog(wadahPalsu([a, b, c]), () => {})
  const ev = tombolPalsu('Tab')
  jaga(ev)
  assert.equal(ev.dicegah, true)
  assert.equal(a.fokusDipanggil, 1)
})

await cek('Shift+Tab di elemen pertama melompat ke terakhir', () => {
  const a = elemenPalsu('a')
  const b = elemenPalsu('b')
  globalThis.document = { activeElement: a }
  const jaga = buatPenjagaDialog(wadahPalsu([a, b]), () => {})
  const ev = tombolPalsu('Tab', true)
  jaga(ev)
  assert.equal(ev.dicegah, true)
  assert.equal(b.fokusDipanggil, 1)
})

await cek('Tab di tengah tidak dicegat', () => {
  const a = elemenPalsu('a')
  const b = elemenPalsu('b')
  globalThis.document = { activeElement: a }
  const jaga = buatPenjagaDialog(wadahPalsu([a, b]), () => {})
  const ev = tombolPalsu('Tab')
  jaga(ev)
  assert.equal(ev.dicegah, false)
  assert.equal(a.fokusDipanggil, 0)
  assert.equal(b.fokusDipanggil, 0)
})

await cek('Escape memanggil onClose', () => {
  let tutup = 0
  const jaga = buatPenjagaDialog(wadahPalsu([]), () => {
    tutup += 1
  })
  jaga(tombolPalsu('Escape'))
  assert.equal(tutup, 1)
})

await cek('tanpa elemen fokusabel, Tab dicegah (fokus tidak kabur)', () => {
  const jaga = buatPenjagaDialog(wadahPalsu([]), () => {})
  const ev = tombolPalsu('Tab')
  jaga(ev)
  assert.equal(ev.dicegah, true)
})

await cek('daftarFokusabel membuang disabled dan tersembunyi', () => {
  const a = elemenPalsu('a')
  const mati = elemenPalsu('mati')
  mati.disabled = true
  const sembunyi = elemenPalsu('sembunyi')
  sembunyi.offsetParent = null
  assert.deepEqual(daftarFokusabel(wadahPalsu([a, mati, sembunyi])), [a])
})

// ---- Pemindaian sumber: semua modal memakai hook + peran dialog ----
const MODAL = [
  ['features/transaksi/FormTransaksiModal.jsx', 1],
  ['features/transaksi/ModalPindahSaldo.jsx', 1],
  ['features/budget/FormBudgetModal.jsx', 1],
  ['features/budget/FormRekeningModal.jsx', 1],
  ['features/transaksi/FilterTransaksiModal.jsx', 1],
  ['features/backup/BackupModal.jsx', 1],
  ['features/laporan/ExportPdfModal.jsx', 1],
  ['features/budget/RiwayatMutasiModal.jsx', 1],
  ['components/UserMenuSheet.jsx', 1],
  ['features/utang/UtangModals.jsx', 2],
]

function hitung(isi, pola) {
  return (isi.match(pola) ?? []).length
}

await cek('setiap modal memakai useDialogAkses + role=dialog + aria-modal', () => {
  const kurang = []
  for (const [rel, min] of MODAL) {
    const isi = readFileSync(path.join(SRC, rel), 'utf8')
    const hook = hitung(isi, /useDialogAkses\(/g)
    const peran = hitung(isi, /role="dialog"/g)
    const modal = hitung(isi, /aria-modal="true"/g)
    if (hook < min || peran < min || modal < min) {
      kurang.push(`${rel} (hook ${hook}/${min}, role ${peran}/${min}, aria-modal ${modal}/${min})`)
    }
  }
  assert.deepEqual(kurang, [])
})

await cek('aksesDialog.js mengekspor hook + penjaga + daftar fokusabel', () => {
  const isi = readFileSync(path.join(__dirname, 'aksesDialog.js'), 'utf8')
  assert.match(isi, /export function useDialogAkses/)
  assert.match(isi, /export function buatPenjagaDialog/)
  assert.match(isi, /export function daftarFokusabel/)
})

// ---- Fase 6 (E03/F01): error form terikat ke input yang salah ----
await cek('FormTransaksiModal: error terikat ke bidang via aria-invalid', () => {
  const isi = readFileSync(path.join(SRC, 'features/transaksi/FormTransaksiModal.jsx'), 'utf8')
  assert.match(isi, /const \[errorBidang, setErrorBidang\] = useState\(null\)/)
  assert.match(isi, /gagalSubmit\(tr\('nominal_harus_positif'\), 'jumlah'\)/)
  assert.match(isi, /gagalSubmit\(tr\('rekening_wajib'\), 'akun'\)/)
  assert.match(isi, /gagalSubmit\(tr\('isi_kategori_dulu'\), 'kategori'\)/)
  assert.match(isi, /aria-invalid=\{errorBidang === 'jumlah'\}/)
  assert.match(isi, /aria-invalid=\{errorBidang === 'akun'\}/)
  assert.match(isi, /'aria-invalid': errorBidang === 'kategori'/)
  assert.match(isi, /<p id="tx-error" role="alert"/)
  // Penanda tidak boleh basi: setiap penghapus pesan ikut menghapus bidang.
  // (Badan helper bersihkanError sendiri dikecualikan dari hitungan.)
  const tanpaHelper = isi.replace(/function bersihkanError\(\) \{[\s\S]*?\n  \}/, '')
  const sisa = (tanpaHelper.match(/setError\(''\)/g) ?? []).length
  assert.equal(sisa, 0, `masih ada ${sisa}x setError('') langsung (pakai bersihkanError)`)
})

console.log(`dialogAkses: OK (${lulus} cek lulus)`)
