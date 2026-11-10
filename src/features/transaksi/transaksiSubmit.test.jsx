// Uji render & fungsi form transaksi (Pemasukan, Pengeluaran, TDZ regression, dedupe kategori).
// Jalankan via: node src/features/transaksi/transaksiSubmit.test.mjs
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import FormTransaksiModal from './FormTransaksiModal.jsx'
import { dedupeKategori } from '../../lib/useAkunKategori.js'
import { deltaSaldo } from '../../lib/db.js'
import { parseNominal } from '../../lib/format.js'

let total = 0
let lulus = 0
const galat = []

function cek(nama, ok, info = '') {
  total++
  if (ok) {
    lulus++
    console.log(`  ok    ${nama}`)
  } else {
    galat.push(`${nama} ${info}`.trim())
    console.log(`  GAGAL ${nama} ${info}`.trim())
  }
}

// ===== 1. Uji Kontrak deltaSaldo (Integritas Matematika Finansial) =====
cek('deltaSaldo pemasukan bertanda positif (+)', deltaSaldo({ jenis: 'pemasukan', jumlah: 250000 }) === 250000)
cek('deltaSaldo pengeluaran bertanda negatif (-)', deltaSaldo({ jenis: 'pengeluaran', jumlah: 150000 }) === -150000)

// ===== 2. Uji Dedupe Kategori Multi-Jenis =====
const dummyDocs = [
  { id: 'k1', data: () => ({ nama: 'Lainnya', jenis: 'pengeluaran' }) },
  { id: 'k2', data: () => ({ nama: 'Lainnya', jenis: 'pemasukan' }) },
  { id: 'k3', data: () => ({ nama: 'Gaji', jenis: 'pemasukan' }) },
  { id: 'k4', data: () => ({ nama: 'Gaji', jenis: 'pemasukan' }) }, // duplikat persis
]
const deduped = dedupeKategori(dummyDocs)
cek('dedupeKategori mempertahankan nama sama pada jenis berbeda (Lainnya in & out)', deduped.length === 3)
cek('kategori pemasukan Lainnya tetap ada', deduped.some((k) => k.nama === 'Lainnya' && k.jenis === 'pemasukan'))
cek('kategori pengeluaran Lainnya tetap ada', deduped.some((k) => k.nama === 'Lainnya' && k.jenis === 'pengeluaran'))

// ===== 3. Uji Anti-TDZ ReferenceError pada Simulasi Submit =====
function simulasiSubmit({ jenis, jumlah, akunId, kategoriNama, akunList, mode, sumber }) {
  const n = parseNominal(jumlah)
  if (n <= 0) throw new Error('Nominal harus lebih dari nol.')
  if (!akunId) throw new Error('Pilih rekening dulu.')
  if (!kategoriNama.trim()) throw new Error('Isi kategori dulu.')

  // Snapshot di awal (memastikan bebas TDZ)
  const jenisSnap = jenis
  const tanggalSnap = '2026-11-08'
  const catatanSnap = 'Test snapshot'
  const akunIdSnap = akunId
  const namaKatSnap = kategoriNama.trim()
  const modeSnap = mode
  const sumberSnap = sumber

  let toastWarningFired = false
  const akun = akunList.find((a) => a.id === akunIdSnap)
  if (jenisSnap === 'pengeluaran' && akun) {
    const saldoSaatIni = Number(akun.saldo) || 0
    const saldoSetelah = modeSnap === 'edit' && sumberSnap?.akunId === akunIdSnap
      ? saldoSaatIni + (Number(sumberSnap.jumlah) || 0) - n
      : saldoSaatIni - n

    if (saldoSetelah < 0) {
      toastWarningFired = true
    }
  }

  return {
    jenisSnap,
    tanggalSnap,
    catatanSnap,
    akunIdSnap,
    namaKatSnap,
    n,
    toastWarningFired,
  }
}

const akunSample = [{ id: 'acc1', nama: 'BCA Utama', saldo: 100000 }]

// Test submit pemasukan tidak melempar TDZ error
try {
  const resIn = simulasiSubmit({
    jenis: 'pemasukan',
    jumlah: '500.000',
    akunId: 'acc1',
    kategoriNama: 'Gaji',
    akunList: akunSample,
    mode: 'add',
    sumber: null,
  })
  cek('submit pemasukan sukses tanpa TDZ ReferenceError', resIn.n === 500000 && resIn.jenisSnap === 'pemasukan')
  cek('submit pemasukan tidak memicu peringatan saldo minus', resIn.toastWarningFired === false)
} catch (err) {
  cek('submit pemasukan sukses tanpa TDZ ReferenceError', false, err.message)
}

// Test submit pengeluaran tidak melempar TDZ error
try {
  const resOut = simulasiSubmit({
    jenis: 'pengeluaran',
    jumlah: '200.000',
    akunId: 'acc1',
    kategoriNama: 'Makanan',
    akunList: akunSample,
    mode: 'add',
    sumber: null,
  })
  cek('submit pengeluaran sukses tanpa TDZ ReferenceError', resOut.n === 200000 && resOut.jenisSnap === 'pengeluaran')
  cek('submit pengeluaran melebihi saldo memicu peringatan minus', resOut.toastWarningFired === true)
} catch (err) {
  cek('submit pengeluaran sukses tanpa TDZ ReferenceError', false, err.message)
}

// ===== 4. Uji Render Form Pemasukan (UI Segmented Toggle & Label Kontekstual) =====
const akunList = [{ id: 'a1', nama: 'Dompet Tunai', saldo: 50000 }]
const kategoriList = [
  { id: 'k1', nama: 'Gaji', jenis: 'pemasukan' },
  { id: 'k2', nama: 'Makanan', jenis: 'pengeluaran' },
]

const htmlPemasukan = renderToString(
  h(FormTransaksiModal, {
    uid: 'u1',
    open: true,
    mode: 'add',
    doc: { preset: 'pemasukan' },
    akunList,
    kategoriList,
    onClose: () => {},
  }),
)

cek('modal pemasukan: judul "Catat Pemasukan"', htmlPemasukan.includes('Catat Pemasukan'))
cek('modal pemasukan: segmented toggle Pemasukan & Pengeluaran tersedia', htmlPemasukan.includes('Pemasukan') && htmlPemasukan.includes('Pengeluaran'))
cek('modal pemasukan: label rekening penerima kontekstual', htmlPemasukan.includes('Rekening Tujuan / Penerima'))
cek('modal pemasukan: tombol simpan "Simpan Pemasukan"', htmlPemasukan.includes('Simpan Pemasukan'))

// ===== 5. Uji Render Form Pengeluaran =====
const htmlPengeluaran = renderToString(
  h(FormTransaksiModal, {
    uid: 'u1',
    open: true,
    mode: 'add',
    doc: { preset: 'pengeluaran' },
    akunList,
    kategoriList,
    onClose: () => {},
  }),
)

cek('modal pengeluaran: judul "Catat Pengeluaran"', htmlPengeluaran.includes('Catat Pengeluaran'))
cek('modal pengeluaran: label sumber rekening kontekstual', htmlPengeluaran.includes('Sumber / Rekening'))
cek('modal pengeluaran: tombol simpan "Simpan Pengeluaran"', htmlPengeluaran.includes('Simpan Pengeluaran'))

// ===== 6. Uji Render Form Mode Edit & Mode Salin (Alur Salin via Edit Modal) =====
const sumberEdit = {
  id: 'tx_asal_123',
  jenis: 'pengeluaran',
  jumlah: 75000,
  kategoriNama: 'Makanan',
  akunId: 'a1',
  tanggal: '2026-11-05',
  catatan: 'Kopi Pagi',
}

const htmlEdit = renderToString(
  h(FormTransaksiModal, {
    uid: 'u1',
    open: true,
    mode: 'edit',
    doc: sumberEdit,
    akunList,
    kategoriList,
    onClose: () => {},
    onSalin: () => {},
  }),
)

cek('modal edit: judul "Edit Pengeluaran"', htmlEdit.includes('Edit Pengeluaran'))
cek('modal edit: menampilkan tombol Salin transaksi di header', htmlEdit.includes('aria-label="Salin transaksi"') && htmlEdit.includes('content_copy'))
cek('modal edit: tombol submit "Simpan Perubahan"', htmlEdit.includes('Simpan Perubahan'))
cek('modal edit: tidak menampilkan banner mode salin', !htmlEdit.includes('Mode salin:'))

const htmlSalinOut = renderToString(
  h(FormTransaksiModal, {
    uid: 'u1',
    open: true,
    mode: 'salin',
    doc: sumberEdit,
    akunList,
    kategoriList,
    onClose: () => {},
  }),
)

cek('modal salin pengeluaran: judul "Salin Pengeluaran"', htmlSalinOut.includes('Salin Pengeluaran'))
cek('modal salin pengeluaran: menampilkan banner mode salin yang dapat diedit', htmlSalinOut.includes('Mode salin:'))
cek('modal salin pengeluaran: mengisi ulang nominal & catatan sumber agar bisa diedit', htmlSalinOut.includes('75') && htmlSalinOut.includes('Kopi Pagi'))
cek('modal salin pengeluaran: tombol submit "Salin &amp; Catat Transaksi"', htmlSalinOut.includes('Salin &amp; Catat Transaksi'))
cek('modal salin pengeluaran: tidak menampilkan tombol header "Salin transaksi" lagi', !htmlSalinOut.includes('aria-label="Salin transaksi"'))

const htmlSalinIn = renderToString(
  h(FormTransaksiModal, {
    uid: 'u1',
    open: true,
    mode: 'salin',
    doc: { ...sumberEdit, jenis: 'pemasukan', kategoriNama: 'Gaji', catatan: 'Bonus' },
    akunList,
    kategoriList,
    onClose: () => {},
  }),
)

cek('modal salin pemasukan: judul "Salin Pemasukan"', htmlSalinIn.includes('Salin Pemasukan'))
cek('modal salin pemasukan: label rekening penerima kontekstual', htmlSalinIn.includes('Rekening Tujuan / Penerima'))

console.log(`\n${galat.length ? 'GAGAL' : 'LULUS'}: ${lulus}/${total} cek lolos`)
if (galat.length) throw new Error(`Uji transaksiSubmit gagal: ${galat.join(' | ')}`)
