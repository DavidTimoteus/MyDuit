// ============================================================
// KONVERTER BACKUP GAS (Google Sheet / XLSX) -> SKEMA PWA
// ============================================================
// Backup dari app GAS memakai skema tabel lama (kolom kapital: ID, Nama, Tipe,
// KategoriID, ...) yang SAMA SEKALI BEDA dengan skema Firestore PWA
// (camelCase + field `deleted`). Menulis baris sheet mentah ke Firestore membuat
// dokumen "tak terlihat": semua query PWA memakai `where('deleted','==',false)`,
// sedangkan dokumen hasil impor mentah tidak punya field itu -> restore terlihat
// "sukses N dokumen" tapi tidak ada satu pun data yang muncul di UI.
//
// Modul ini memetakan tiap sheet ke bentuk dokumen yang benar-benar dibaca app.
import { Timestamp } from 'firebase/firestore'
import { kanonikTanggal, parseAngkaEksternal } from '../../lib/format.js'

// Nama sheet (lowercase) -> nama koleksi Firestore PWA
const PETA_SHEET = {
  akun: 'akun',
  kategori: 'kategori',
  transaksi: 'transaksi',
  utang: 'utang',
  pembayaranutang: 'pembayaranUtang',
  budget: 'budget',
  mutasilog: 'mutasiLog',
}

function keDate(v) {
  if (!v) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  if (typeof v === 'number') {
    // Serial date Excel (basis 1899-12-30)
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return isNaN(d.getTime()) ? null : d
  }
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? null : d
}

// 'YYYY-MM-DD' memakai waktu LOKAL (konsisten dengan isoHariIni() di app).
function keTanggalIso(v) {
  const d = keDate(v)
  if (!d) return ''
  return kanonikTanggal(d)
}

function keTimestamp(v) {
  const d = keDate(v)
  return d ? Timestamp.fromDate(d) : null
}

function keAngka(v) {
  return parseAngkaEksternal(v)
}

function keBool(v) {
  if (typeof v === 'boolean') return v
  const s = String(v ?? '').trim().toLowerCase()
  return s === 'true' || s === 'ya' || s === '1'
}

function keDeleted(row) {
  const delRaw = kolom(row, 'Deleted')
  if (delRaw !== undefined && delRaw !== '') return keBool(delRaw)
  const aktifRaw = kolom(row, 'Aktif')
  if (aktifRaw !== undefined && aktifRaw !== '') return !keBool(aktifRaw)
  return false
}

function teks(v, maks = 0) {
  const s = String(v ?? '').trim()
  return maks > 0 && s.length > maks ? s.slice(0, maks) : s
}

// Ambil nilai kolom secara case-insensitive dengan null-prototype agar aman terhadap nama kolom 'toString'/'__proto__'.
function kolom(row, ...kandidat) {
  if (!row || typeof row !== 'object') return undefined
  for (const k of kandidat) {
    if (Object.hasOwn(row, k) && row[k] !== undefined) return row[k]
  }
  const lower = Object.create(null)
  for (const [k, v] of Object.entries(row)) lower[k.toLowerCase()] = v
  for (const k of kandidat) {
    const lc = k.toLowerCase()
    if (Object.hasOwn(lower, lc) && lower[lc] !== undefined) return lower[lc]
  }
  return undefined
}

/**
 * Konversi workbook XLSX backup GAS menjadi payload restore skema PWA.
 * @param {object} wb workbook hasil XLSX.read
 * @param {object} XLSX modul xlsx (untuk sheet_to_json)
 * @param {string} uid
 * @returns {{ json: object, ringkasan: string, catatan: string[] }}
 */
export function konversiBackupGas(wb, XLSX, uid) {
  const sheets = {}
  for (const name of wb.SheetNames) {
    const koleksi = PETA_SHEET[String(name).trim().toLowerCase()]
    if (!koleksi) continue
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' })
    sheets[koleksi] = rows
  }

  const catatan = []
  const data = {}

  // ---- Pembayaran utang dulu: dipakai menghitung `sisa` tiap utang ----
  const bayarRows = sheets.pembayaranUtang ?? []
  const totalBayarPerUtang = {}
  data.pembayaranUtang = bayarRows
    .map((r) => {
      const id = teks(kolom(r, 'ID'))
      if (!id) return null
      const utangId = teks(kolom(r, 'UtangID'))
      const jumlah = Math.max(0, keAngka(kolom(r, 'Nominal', 'Jumlah')))
      const deleted = keDeleted(r)
      if (utangId && !deleted) totalBayarPerUtang[utangId] = (totalBayarPerUtang[utangId] || 0) + jumlah
      return {
        id,
        utangId,
        transaksiId: teks(kolom(r, 'TransaksiID')),
        akunId: teks(kolom(r, 'AkunID')),
        jumlah,
        tanggal: keTanggalIso(kolom(r, 'Tanggal')),
        deleted,
        createdAt: keTimestamp(kolom(r, 'Tanggal')) ?? Timestamp.now(),
      }
    })
    .filter(Boolean)

  // ---- MutasiLog: arsip + sumber `mutasiTerakhir` per akun ----
  const logRows = sheets.mutasiLog ?? []
  const logTerbaruPerAkun = {}
  data.mutasiLog = logRows
    .map((r) => {
      const id = teks(kolom(r, 'ID'))
      if (!id) return null
      const akunId = teks(kolom(r, 'AkunID'))
      const ts = keTimestamp(kolom(r, 'Timestamp', 'Tanggal'))
      const delta = keAngka(kolom(r, 'Delta'))
      const aksi = teks(kolom(r, 'Aksi'))
      if (akunId && ts) {
        const lama = logTerbaruPerAkun[akunId]
        if (!lama || ts.toMillis() > lama.at.toMillis()) {
          logTerbaruPerAkun[akunId] = { delta, keterangan: aksi || 'Perubahan saldo', at: ts }
        }
      }
      return {
        id,
        akunId,
        aksi,
        delta,
        transaksiId: teks(kolom(r, 'TransaksiID')),
        timestamp: ts ?? Timestamp.now(),
        deleted: false,
        createdAt: ts ?? Timestamp.now(),
      }
    })
    .filter(Boolean)

  // ---- Akun ----
  data.akun = (sheets.akun ?? [])
    .map((r) => {
      const id = teks(kolom(r, 'ID'))
      if (!id) return null
      const dok = {
        id,
        nama: teks(kolom(r, 'Nama'), 120) || 'Rekening',
        tipe: teks(kolom(r, 'Tipe'), 60) || 'Lainnya',
        saldo: keAngka(kolom(r, 'Saldo')),
        deleted: keDeleted(r),
        createdAt: keTimestamp(kolom(r, 'CreatedAt')) ?? Timestamp.now(),
        updatedAt: keTimestamp(kolom(r, 'UpdatedAt')) ?? Timestamp.now(),
      }
      if (logTerbaruPerAkun[id]) dok.mutasiTerakhir = logTerbaruPerAkun[id]
      return dok
    })
    .filter(Boolean)

  // ---- Kategori (jenis di PWA lowercase; Aktif -> deleted) ----
  data.kategori = (sheets.kategori ?? [])
    .map((r) => {
      const id = teks(kolom(r, 'ID'))
      if (!id) return null
      const aktifRaw = kolom(r, 'Aktif')
      const jenisRaw = teks(kolom(r, 'Jenis')).toLowerCase()
      return {
        id,
        nama: teks(kolom(r, 'Nama'), 100) || 'Lainnya',
        jenis: jenisRaw === 'pemasukan' ? 'pemasukan' : 'pengeluaran',
        deleted: aktifRaw === undefined || aktifRaw === '' ? false : !keBool(aktifRaw),
        createdAt: Timestamp.now(),
      }
    })
    .filter(Boolean)

  // ---- Transaksi ----
  let pindahSaldoCount = 0
  data.transaksi = (sheets.transaksi ?? [])
    .map((r) => {
      const id = teks(kolom(r, 'ID'))
      if (!id) return null
      const jenisRaw = teks(kolom(r, 'Jenis')).toLowerCase()
      const jenis = ['pemasukan', 'pengeluaran', 'pindah saldo'].includes(jenisRaw) ? jenisRaw : 'pengeluaran'
      const akunId = teks(kolom(r, 'AkunID'))
      const akunTujuanId = teks(kolom(r, 'AkunTujuanID'))
      const tanggal = keTanggalIso(kolom(r, 'Tanggal')) || kanonikTanggal(null)
      const jumlah = Math.max(0, keAngka(kolom(r, 'Nominal', 'Jumlah')))
      const deletedRaw = keDeleted(r)
      const deleted = deletedRaw || jumlah <= 0
      const dok = {
        id,
        jumlah,
        jenis,
        kategoriId: teks(kolom(r, 'KategoriID')),
        akunId,
        tanggal,
        catatan: teks(kolom(r, 'Keterangan', 'Catatan'), 500),
        deleted,
        createdAt: keTimestamp(kolom(r, 'Tanggal')) ?? Timestamp.now(),
      }
      const utangId = teks(kolom(r, 'UtangID'))
      if (utangId) dok.utangId = utangId
      if (jenis === 'pindah saldo') {
        dok.dariId = akunId
        dok.keId = akunTujuanId
        pindahSaldoCount++
      }
      return dok
    })
    .filter(Boolean)
  if (pindahSaldoCount) catatan.push(`${pindahSaldoCount} transaksi pindah saldo dipetakan ke dariId/keId.`)

  // ---- Utang (hitung `sisa` dari total - pembayaran) ----
  data.utang = (sheets.utang ?? [])
    .map((r) => {
      const id = teks(kolom(r, 'ID'))
      if (!id) return null
      const total = Math.max(1, keAngka(kolom(r, 'Total')))
      const statusRaw = teks(kolom(r, 'Status'))
      const terbayar = totalBayarPerUtang[id] || 0
      const isLunas = statusRaw.toLowerCase() === 'lunas'
      const sisa = isLunas ? 0 : Math.max(0, Math.min(total, total - terbayar))
      const status = isLunas || sisa <= 0 ? 'Lunas' : 'Belum Lunas'
      return {
        id,
        namaPihak: teks(kolom(r, 'NamaPihak'), 150) || 'Pihak',
        deskripsi: teks(kolom(r, 'Deskripsi'), 500),
        total,
        sisa,
        status,
        tipe: teks(kolom(r, 'Tipe')) === 'Cicilan' ? 'Cicilan' : 'Utang',
        cicilanPerBulan: Math.max(0, keAngka(kolom(r, 'CicilanPerBulan'))),
        tglJatuhTempo: keTanggalIso(kolom(r, 'TglJatuhTempo')),
        deleted: keDeleted(r),
        createdAt: keTimestamp(kolom(r, 'Tanggal')) ?? Timestamp.now(),
      }
    })
    .filter(Boolean)
  if (Object.keys(totalBayarPerUtang).length) {
    catatan.push('Sisa utang dihitung dari Total − riwayat PembayaranUtang.')
  }

  // ---- Budget (Bulan GAS 0-11, sama dengan Date.getMonth() di PWA) ----
  data.budget = (sheets.budget ?? [])
    .map((r) => {
      const id = teks(kolom(r, 'ID'))
      if (!id) return null
      const b = keAngka(kolom(r, 'Bulan'))
      const th = keAngka(kolom(r, 'Tahun'))
      return {
        id,
        kategoriId: teks(kolom(r, 'KategoriID')),
        bulan: Math.max(0, Math.min(11, b)),
        tahun: th >= 2000 && th <= 2100 ? th : new Date().getFullYear(),
        limitNominal: Math.max(0, keAngka(kolom(r, 'LimitNominal', 'Limit'))),
        deleted: keDeleted(r),
        createdAt: Timestamp.now(),
      }
    })
    .filter(Boolean)

  const ringkasan = Object.entries(data)
    .filter(([, arr]) => arr.length > 0)
    .map(([c, arr]) => `${c}: ${arr.length}`)
    .join(' · ')

  return {
    json: { app: 'MyDuit', version: 2, baseCurrency: 'IDR', sumber: 'gas-xlsx', exportedAt: new Date().toISOString(), uid, data },
    ringkasan,
    catatan,
  }
}
