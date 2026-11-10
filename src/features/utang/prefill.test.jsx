// Uji prefill form utang/cicilan & modal bayar — tanpa login (renderToString).
//
// Yang dikunci di sini: saat modal DIBUKA (mount, karena `key` di UtangView
// berubah), form WAJIB terisi dari data edit/bayar yang dikirim. Regresi
// d946fc6 menambahkan `key` pada pemanggilan modal: instance React jadi
// baru setiap kali dibuka, padahal isi form di-reset lewat pembanding
// `kunci !== kunciLama` yang di-render-phase TIDAK PERNAH jalan saat mount
// (useState(kunci) == kunci pada render pertama). Hasilnya: form edit
// terbuka KOSONG.
//
// Jalankan: node src/features/utang/prefill.test.mjs
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { formatRibuanInput } from '../../lib/format.js'
import { BayarUtangModal, FormUtangModal } from './UtangModals.jsx'
import { selisihHari } from './UtangView.jsx'

const galat = []
let total = 0

function cek(nama, html, patokan) {
  total++
  const ok = typeof patokan === 'function' ? patokan(html) : html.includes(patokan)
  if (ok) console.log(`  ok    ${nama}`)
  else {
    galat.push(nama)
    console.log(`  GAGAL ${nama}`)
  }
}

// ===== 1. Edit cicilan =====
const cicilan = {
  id: 'u1',
  namaPihak: 'Kredit Motor',
  deskripsi: 'ADPM Januari',
  total: 12000000,
  sisa: 9000000,
  tipe: 'Cicilan',
  cicilanPerBulan: 1000000,
  tglJatuhTempo: '2026-12-01',
  status: 'Belum Lunas',
}

const htmlEdit = renderToString(
  h(FormUtangModal, { open: true, edit: cicilan, mode: 'cicilan', uid: 'u1', onClose: () => {} }),
)

cek('edit cicilan: judul "Edit Utang"', htmlEdit, 'Edit Utang')
cek('edit cicilan: nama pihak terisi', htmlEdit, `value="${cicilan.namaPihak}"`)
cek('edit cicilan: total terisi', htmlEdit, `value="${formatRibuanInput(String(cicilan.total))}"`)
cek('edit cicilan: cicilan/bulan terisi', htmlEdit, `value="${formatRibuanInput(String(cicilan.cicilanPerBulan))}"`)
cek('edit cicilan: catatan terisi', htmlEdit, `value="${cicilan.deskripsi}"`)
cek('edit cicilan: tipe terpilih Cicilan', htmlEdit, 'font-medium text-slate-800">Cicilan</span>')

// ===== 2. Tambah cicilan lewat Aksi Cepat (mode="cicilan", tanpa edit) =====
const htmlTambah = renderToString(
  h(FormUtangModal, { open: true, edit: null, mode: 'cicilan', uid: 'u1', onClose: () => {} }),
)

cek('tambah cicilan: tipe default Cicilan (bukan Utang)', htmlTambah, 'Cicilan')

// ===== 3. Lunasin (modal bayar) =====
const akunList = [
  { id: 'a1', nama: 'Tunai', saldo: 500000 },
  { id: 'a2', nama: 'BCA', saldo: 1000000 },
]
const htmlBayar = renderToString(
  h(BayarUtangModal, {
    open: true,
    onClose: () => {},
    uid: 'u1',
    utang: cicilan,
    akunList,
    lunasin: true,
  }),
)

cek('lunasin: nominal default = sisa', htmlBayar, `value="${formatRibuanInput(String(cicilan.sisa))}"`)
cek('lunasin: rekening sumber terpilih', htmlBayar, 'font-medium text-slate-800">Tunai</span>')
cek('lunasin: pratinjau "LUNAS" muncul', htmlBayar, 'LUNAS')

// ===== 4. Bayar (tanpa lunasin): nominal default = cicilan/bulan =====
const htmlBayarCicilan = renderToString(
  h(BayarUtangModal, {
    open: true,
    onClose: () => {},
    uid: 'u1',
    utang: cicilan,
    akunList,
    lunasin: false,
  }),
)

cek('bayar cicilan: nominal default = cicilan/bulan', htmlBayarCicilan, `value="${formatRibuanInput(String(cicilan.cicilanPerBulan))}"`)

// ===== 5. Uji selisihHari Cicilan: sudah bayar bulan ini vs tunggakan bulan lalu =====
const nowNov = new Date('2026-11-10T00:00:00')
// Cicilan dibuat September (tgl 15), sudah dibayar bulan November -> tempo berikutnya 15 Desember (+35 hari)
const hariSudahBayar = selisihHari('2026-09-15', 'Cicilan', '2026-11-05', nowNov)
cek('cicilan sudah bayar bulan ini: jatuh tempo bergeser ke bulan depan (>0 hari)', '', () => hariSudahBayar === 35)

// Cicilan dibuat September (tgl 15), belum pernah dibayar -> tetap terdeteksi terlambat di bulan November (<0 hari)
const hariTunggak = selisihHari('2026-09-15', 'Cicilan', '', nowNov)
cek('cicilan belum pernah dibayar sejak bulan lalu: tetap terlambat (<0 hari)', '', () => hariTunggak < 0)

console.log(`\n${galat.length ? 'GAGAL' : 'LULUS'}: ${total - galat.length}/${total} cek lolos`)
if (galat.length) throw new Error(`Prefill form utang/bayar gagal: ${galat.join(' | ')}`)
