import { deleteUser, reauthenticateWithPopup } from 'firebase/auth'
import { Timestamp, collection, deleteField, doc, getDoc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore'
import { getFirebase, googleProvider } from '../../lib/firebase.js'
import { jamValid, kanonikTanggal, parseAngkaEksternal } from '../../lib/format.js'
import { IS_DEMO_UID } from '../../lib/mockData.js'
import { bacaBasisMataUang, bacaStatusBasis, mataUangDidukung, resetBasisMataUang, sanitasiKursSnapshot, simpanBasisMataUang } from '../../lib/kurs.js'

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const ALLOWLIST_FIELDS = {
  transaksi: new Set([
    'jumlah', 'jenis', 'kategoriId', 'akunId', 'dariId', 'keId',
    'utangId', 'pembayaranUtangId', 'tanggal', 'jam', 'koreksiSaldo', 'delta', 'catatan', 'kursSnapshot',
    'deleted', 'deletedAt', 'createdAt', 'updatedAt',
  ]),
  akun: new Set(['nama', 'tipe', 'saldo', 'mutasiTerakhir', 'deleted', 'deletedAt', 'createdAt', 'updatedAt']),
  kategori: new Set(['nama', 'jenis', 'deleted', 'deletedAt', 'createdAt', 'updatedAt']),
  budget: new Set(['kategoriId', 'limitNominal', 'bulan', 'tahun', 'deleted', 'deletedAt', 'createdAt', 'updatedAt']),
  utang: new Set([
    'namaPihak', 'deskripsi', 'total', 'sisa', 'status', 'tipe',
    'cicilanPerBulan', 'tglJatuhTempo', 'terakhirBayar',
    'deleted', 'deletedAt', 'createdAt', 'updatedAt',
  ]),
  pembayaranUtang: new Set(['utangId', 'transaksiId', 'akunId', 'jumlah', 'tanggal', 'kursSnapshot', 'deleted', 'deletedAt', 'createdAt', 'updatedAt']),
  mutasiLog: new Set(['akunId', 'aksi', 'delta', 'transaksiId', 'timestamp', 'deleted', 'deletedAt', 'createdAt']),
}

function adaKarakterKontrol(str) {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code < 32 || code === 127) return true
  }
  return false
}

// Validasi segmen ID dokumen Firestore untuk mencegah path traversal ('a/b', '.', '..', '__proto__') & karakter kontrol.
export function validDocId(rawId) {
  if (typeof rawId !== 'string' && typeof rawId !== 'number') return null
  const id = String(rawId).trim()
  if (!id || id.length > 128) return null
  if (adaKarakterKontrol(id)) return null
  if (id === '.' || id === '..' || id.includes('/') || id.includes('\\') || id.includes('..')) return null
  if (/%2e|%2f|%5c/i.test(id)) return null
  if (UNSAFE_KEYS.has(id)) return null
  return id
}

// Rekonstruksi nilai Timestamp Firestore yang ter-serialisasi ke JSON
// ({ seconds, nanoseconds }, { _seconds, _nanoseconds }, atau ISO string pada field waktu)
// agar indeks orderBy('createdAt', 'desc') dan method .toDate() tidak rusak pasca-restore.
export function hidupkanTimestamp(val) {
  if (!val || typeof val !== 'object') return val
  if (val instanceof Timestamp) return val
  const sec =
    typeof val.seconds === 'number'
      ? val.seconds
      : typeof val._seconds === 'number'
        ? val._seconds
        : null
  const nano =
    typeof val.nanoseconds === 'number'
      ? val.nanoseconds
      : typeof val._nanoseconds === 'number'
        ? val._nanoseconds
        : 0
  if (
    sec !== null &&
    Object.keys(val).every((k) => ['seconds', 'nanoseconds', '_seconds', '_nanoseconds', 'type'].includes(k))
  ) {
    return new Timestamp(sec, nano)
  }
  if (Array.isArray(val)) return val.map(hidupkanTimestamp)
  const out = {}
  for (const [k, v] of Object.entries(val)) {
    if (UNSAFE_KEYS.has(k)) continue
    if ((k === 'createdAt' || k === 'updatedAt' || k === 'timestamp' || k === 'at') && typeof v === 'string') {
      const d = new Date(v)
      out[k] = Number.isNaN(d.getTime()) ? v : Timestamp.fromDate(d)
    } else {
      out[k] = hidupkanTimestamp(v)
    }
  }
  return out
}

// Normalisasi tipe field per koleksi agar dokumen backup selalu valid di Firestore Rules
// dan tidak memunculkan angka string ("50000"), dokumen hilang (`deleted` absen), dsb.
export function bersihkanDokumenRestore(koleksi, rawData) {
  const allow = ALLOWLIST_FIELDS[koleksi]
  const data = {}
  if (rawData && typeof rawData === 'object') {
    for (const [k, v] of Object.entries(rawData)) {
      if (UNSAFE_KEYS.has(k)) continue
      if (allow && !allow.has(k)) continue
      data[k] = v
      if (Object.keys(data).length >= 25) break
    }
  }
  data.deleted = typeof data.deleted === 'boolean' ? data.deleted : false

  switch (koleksi) {
    case 'transaksi': {
      data.jumlah = Math.max(0, parseAngkaEksternal(data.jumlah))
      if (!data.deleted && data.jumlah <= 0) data.deleted = true
      const j = String(data.jenis ?? 'pengeluaran').trim().toLowerCase()
      data.jenis = ['pemasukan', 'pengeluaran', 'pindah saldo'].includes(j) ? j : 'pengeluaran'
      data.tanggal = kanonikTanggal(data.tanggal)
      if (data.jam !== undefined) data.jam = jamValid(data.jam)
      if (data.koreksiSaldo !== true) delete data.koreksiSaldo
      if (data.koreksiSaldo === true && !Number.isFinite(Number(data.delta))) delete data.delta
      if (data.catatan !== undefined) data.catatan = String(data.catatan ?? '').slice(0, 500)
      if (data.kursSnapshot !== undefined) {
        const snap = sanitasiKursSnapshot(data.kursSnapshot)
        if (snap) data.kursSnapshot = snap
        else delete data.kursSnapshot
      }
      break
    }
    case 'akun': {
      data.saldo = parseAngkaEksternal(data.saldo)
      data.nama = String(data.nama ?? 'Rekening').trim().slice(0, 120) || 'Rekening'
      if (data.tipe !== undefined) data.tipe = String(data.tipe ?? '').trim().slice(0, 60) || 'Lainnya'
      break
    }
    case 'kategori': {
      data.nama = String(data.nama ?? '').trim().slice(0, 100) || 'Lainnya'
      const j = String(data.jenis ?? '').trim().toLowerCase()
      data.jenis = j === 'pemasukan' || j === 'pengeluaran' ? j : 'pengeluaran'
      break
    }
    case 'budget': {
      data.limitNominal = Math.max(0, parseAngkaEksternal(data.limitNominal))
      if (!data.deleted && data.limitNominal <= 0) data.deleted = true
      const b = Math.round(Number(data.bulan))
      data.bulan = Number.isFinite(b) ? Math.max(0, Math.min(11, b)) : new Date().getMonth()
      const th = Math.round(Number(data.tahun))
      data.tahun = Number.isFinite(th) ? Math.max(2000, Math.min(2100, th)) : new Date().getFullYear()
      break
    }
    case 'utang': {
      data.namaPihak = String(data.namaPihak ?? 'Pihak').trim().slice(0, 150) || 'Pihak'
      data.total = Math.max(1, parseAngkaEksternal(data.total))
      data.sisa = Math.max(0, Math.min(data.total, parseAngkaEksternal(data.sisa)))
      if (data.status !== undefined) {
        data.status = data.sisa <= 0 || data.status === 'Lunas' ? 'Lunas' : 'Belum Lunas'
      }
      if (data.cicilanPerBulan !== undefined) {
        data.cicilanPerBulan = Math.max(0, parseAngkaEksternal(data.cicilanPerBulan))
      }
      data.tipe = data.tipe === 'Cicilan' ? 'Cicilan' : 'Utang'
      if (data.deskripsi !== undefined) data.deskripsi = String(data.deskripsi ?? '').slice(0, 500)
      if (data.tglJatuhTempo) data.tglJatuhTempo = kanonikTanggal(data.tglJatuhTempo)
      break
    }
    case 'pembayaranUtang': {
      data.jumlah = Math.max(0, parseAngkaEksternal(data.jumlah))
      if (!data.deleted && data.jumlah <= 0) data.deleted = true
      data.tanggal = data.tanggal ? kanonikTanggal(data.tanggal) : kanonikTanggal(null)
      if (data.kursSnapshot !== undefined) {
        const snap = sanitasiKursSnapshot(data.kursSnapshot)
        if (snap) data.kursSnapshot = snap
        else delete data.kursSnapshot
      }
      break
    }
    case 'mutasiLog': {
      if (data.delta !== undefined) data.delta = parseAngkaEksternal(data.delta)
      break
    }
    default:
      break
  }
  return data
}

// Fail-closed: uid di path Firestore coming dari argumen, jadi satu kesalahan
// di call site (atau file backup berisi uid orang lain) akan menulis ke akun
// stranger. Security Rules memang akan menolak, tapi itu masalah: penolakan
// terjadi per-batch di tengah proses, jadi user sudah melihat "Berhasil" lalu
// kehilangan data. Guard di sini memindahkan kegagalan ke awal, sebelum ada
// data yang tersentuh.
function uidAktif(uid, deps) {
  const { auth } = deps?.getFirebase ? deps.getFirebase() : getFirebase()
  const sekarang = auth.currentUser?.uid
  if (!sekarang) throw new Error('Belum login.')
  if (uid !== sekarang) throw new Error('UID tidak cocok dengan akun yang sedang login.')
  return sekarang
}

const KOLEKSI = ['akun', 'kategori', 'transaksi', 'budget', 'utang', 'pembayaranUtang', 'mutasiLog']
const KOLEKSI_HAPUS = [...KOLEKSI, 'meta']

// Firestore membatasi 500 operasi per writeBatch.
const BATCH_LIMIT = 450

export async function exportData(uid, deps = {}) {
  uid = uidAktif(uid, deps)
  const { db } = deps.getFirebase ? deps.getFirebase() : getFirebase()
  const collectionFn = deps.collection || collection
  const getDocsFn = deps.getDocs || getDocs
  const docFn = deps.doc || doc
  const getDocFn = deps.getDoc || getDoc

  const data = {}
  for (const c of KOLEKSI) {
    const snap = await getDocsFn(collectionFn(db, 'users', uid, c))
    data[c] = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }))
  }

  let baseCurrency = bacaBasisMataUang() || 'IDR'
  try {
    const metaSnap = await getDocFn(docFn(db, 'users', uid, 'meta', 'mataUang'))
    const tersimpan = metaSnap?.exists?.() ? String(metaSnap.data()?.baseCurrency || '').toUpperCase() : ''
    if (/^[A-Z]{3}$/.test(tersimpan)) baseCurrency = tersimpan
  } catch {
    // Fallback ke basis aktif lokal
  }

  return {
    app: 'MyDuit',
    version: 1,
    baseCurrency,
    exportedAt: new Date().toISOString(),
    uid,
    data,
  }
}

// Restore dengan writeBatch.
//
// onProgress?: ({ done, total, koleksi }) => void
export async function restoreData(uid, json, onProgress, deps = {}) {
  if (!json || json.app !== 'MyDuit' || !json.data) {
    throw new Error('Berkas backup tidak valid (bukan file MyDuit).')
  }
  uid = uidAktif(uid, deps)
  const { db } = deps.getFirebase ? deps.getFirebase() : getFirebase()
  const docFn = deps.doc || doc
  const writeBatchFn = deps.writeBatch || writeBatch
  const serverTimestampFn = deps.serverTimestamp || serverTimestamp

  // Penjaga restore (F05/F17 audit 25 Nov 2026) — semua dicek SEBELUM satu pun
  // dokumen ditulis, supaya restore yang ditolak tidak meninggalkan setengah data.
  if (json.uid && String(json.uid) !== uid) {
    throw new Error('Backup ini milik akun lain (UID tidak cocok) — restore dibatalkan.')
  }
  if (json.version !== undefined && json.version !== null && json.version !== 1) {
    throw new Error(`Versi backup tidak didukung: ${json.version}.`)
  }

  const basisRaw = String(json.baseCurrency || '').trim().toUpperCase()
  const basisPulih = /^[A-Z]{3}$/.test(basisRaw) ? basisRaw : 'IDR'
  // Basis backup harus didukung (punya kurs). Tanpa ini, backup berisi kode
  // tak dikenal (mis. 'XXX') bisa menulis basis tak valid ke meta/mataUang —
  // dan karena rules mengunci baseCurrency, basis itu sesudahnya tidak bisa
  // diperbaiki lewat update biasa. Tolak lebih awal, sebelum menulis apa pun.
  if (!mataUangDidukung(basisPulih)) {
    throw new Error(`Basis mata uang backup (${basisPulih}) tidak didukung — restore dibatalkan.`)
  }
  // R02/P2 (re-review 25 Nov 2026): basis akun yang sah adalah yang tersimpan
  // di SERVER (meta/mataUang), bukan flag kunci lokal — di perangkat baru atau
  // setelah ganti perangkat, flag lokal belum ada sehingga penjaga lama
  // meloloskan restore lintas-basis, lalu penulisan meta ditolak rules di
  // akhir (data sudah ter-commit setengah). Baca server dulu sebagai otoritas;
  // bila baca gagal (offline), jatuh ke flag lokal seperti sebelumnya.
  const getDocFn = deps.getDoc || getDoc
  let basisServer = null
  try {
    const metaSnap = await getDocFn(docFn(db, 'users', uid, 'meta', 'mataUang'))
    if (metaSnap?.exists?.()) basisServer = String(metaSnap.data()?.baseCurrency || '').trim().toUpperCase()
  } catch {
    // Offline — pakai flag lokal di bawah.
  }
  // Basis berbeda = angka akan salah label (USD 5.000 jadi Rp 5.000) karena
  // restore tidak mengonversi apa pun. Tolak bila basis akun sudah ada
  // (server dulu, lalu flag lokal); bila belum ada, adopsi basis backup.
  const statusBasis = bacaStatusBasis()
  const basisOtoritatif = /^[A-Z]{3}$/.test(basisServer || '')
    ? basisServer
    : statusBasis.terkunci
      ? statusBasis.basis
      : null
  if (basisOtoritatif && basisOtoritatif !== basisPulih) {
    throw new Error(
      `Basis mata uang backup (${basisPulih}) berbeda dengan basis akun ini (${basisOtoritatif}). ` +
        'Angka tidak dikonversi otomatis saat restore — restore dibatalkan supaya saldo tidak salah label.',
    )
  }

  // Kumpulkan & validasi semua operasi tulis dulu sebelum menyentuh Firestore.
  const ops = []
  for (const c of KOLEKSI) {
    const arr = json.data[c]
    if (!Array.isArray(arr)) continue
    for (const item of arr) {
      if (!item || item.id === undefined || item.id === null || item.id === '') continue
      const safeId = validDocId(item.id)
      if (!safeId) {
        throw new Error(`ID dokumen pada koleksi "${c}" tidak valid atau berbahaya.`)
      }
      const { id: _id, ...rest } = item
      const revived = hidupkanTimestamp(rest)
      const cleaned = bersihkanDokumenRestore(c, revived)
      ops.push({ koleksi: c, ref: docFn(db, 'users', uid, c, safeId), data: cleaned, id: safeId })
    }
  }

  const totalDok = ops.length
  if (totalDok === 0) return 0

  // P2: tulis basis DULU dalam batch sendiri, SEBELUM satu pun data ditulis.
  // Dulu meta ditulis terakhir — bila rules menolaknya (basis server berbeda
  // dengan backup), data sudah ter-commit setengah dengan label basis yang
  // salah. Sekarang penolakan terjadi sebelum ada data yang tersentuh.
  const metaRef = docFn(db, 'users', uid, 'meta', 'mataUang')
  const metaBatch = writeBatchFn(db)
  // deleted:false ikut ditulis supaya meta yang sempat di-soft-delete oleh
  // hapusSemuaData hidup kembali bersama basisnya (merge tanpa field ini
  // akan mempertahankan deleted:true server).
  metaBatch.set(metaRef, { baseCurrency: basisPulih, deleted: false, updatedAt: serverTimestampFn() }, { merge: true })
  await metaBatch.commit()

  // P2: dokumen yang di backup masih hidup tapi di server sudah di-soft-delete
  // tidak bisa dipulihkan lewat set-merge — rules menolak update pada dokumen
  // terhapus (belumDihapus), sehingga slice yang memuatnya gagal di tengah
  // restore dan akun pulih setengah. Berdamai dulu dengan state server:
  // batalkan flag hapusnya (un-delete, diizinkan rules Fase 3 — bendera saja,
  // isi tidak berubah), lalu set-merge berjalan sebagai update biasa yang
  // tetap dinilai validator. Hard-delete TIDAK lagi dipakai (dihapus dari
  // rules, R-01 re-audit). Bila baca server gagal (offline), rekonsiliasi
  // dilewati — perilaku lama; tulis yang tertunda akan dinilai rules saat
  // sinkronisasi.
  // Sambil membaca server, catat saldo akun saat ini: merge-set akun yang
  // saldonya berubah wajib membawa mutasiTerakhir yang deltanya sama dengan
  // perubahan saldo (R-03) — jejak lama di backup sudah basi.
  const getDocsFn = deps.getDocs || getDocs
  const collectionFn = deps.collection || collection
  const deleteFieldFn = deps.deleteField || deleteField
  const idBackupPerKoleksi = new Map()
  for (const op of ops) {
    if (!idBackupPerKoleksi.has(op.koleksi)) idBackupPerKoleksi.set(op.koleksi, new Set())
    idBackupPerKoleksi.get(op.koleksi).add(op.id)
  }
  const pulihkanDulu = []
  const saldoServerPerAkun = new Map()
  for (const [c, idSet] of idBackupPerKoleksi.entries()) {
    try {
      const snap = await getDocsFn(collectionFn(db, 'users', uid, c))
      for (const d of snap?.docs || []) {
        const dataServer = typeof d.data === 'function' ? d.data() : null
        if (c === 'akun' && Number.isFinite(Number(dataServer?.saldo))) {
          saldoServerPerAkun.set(d.id, Number(dataServer.saldo))
        }
        if (idSet.has(d.id) && dataServer?.deleted === true) {
          pulihkanDulu.push(docFn(db, 'users', uid, c, d.id))
        }
      }
    } catch {
      // Baca koleksi gagal (offline) — lewati rekonsiliasi koleksi ini.
    }
  }
  for (let i = 0; i < pulihkanDulu.length; i += BATCH_LIMIT) {
    const batch = writeBatchFn(db)
    for (const ref of pulihkanDulu.slice(i, i + BATCH_LIMIT)) {
      batch.update(ref, { deleted: false, deletedAt: deleteFieldFn(), updatedAt: serverTimestampFn() })
    }
    await batch.commit()
  }

  const total = ops.length
  let done = 0
  for (let i = 0; i < total; i += BATCH_LIMIT) {
    const slice = ops.slice(i, i + BATCH_LIMIT)
    const batch = writeBatchFn(db)
    for (const op of slice) {
      // REGRESI JAM 25 Nov 2026: dokumen backup tanpa jam (impor lama) harus
      // diisi '00:00' di sini — kalau tidak, dokumen hasil restore hilang
      // dari query orderBy jam. jamValid sudah mengunci format HH:MM.
      if (op.koleksi === 'transaksi' && !jamValid(op.data?.jam)) {
        op.data = { ...op.data, jam: '00:00' }
      }
      if (op.koleksi === 'akun' && Number.isFinite(Number(op.data?.saldo)) && saldoServerPerAkun.has(op.id)) {
        const saldoServer = saldoServerPerAkun.get(op.id)
        const delta = Number(op.data.saldo) - saldoServer
        if (delta !== 0) {
          op.data = {
            ...op.data,
            mutasiTerakhir: { delta, keterangan: 'Pulihkan backup', at: serverTimestampFn() },
          }
        }
      }
      batch.set(op.ref, op.data, { merge: true })
    }
    await batch.commit()
    done += slice.length
    onProgress?.({ done: Math.min(done, totalDok), total: totalDok, koleksi: slice[slice.length - 1]?.koleksi })
  }
  simpanBasisMataUang(basisPulih, { terkunci: true })
  return totalDok
}

/**
 * Menghapus seluruh dokumen pengguna di Firestore (`KOLEKSI` + `meta`)
 * secara bertahap per `BATCH_LIMIT` dan membersihkan penanda lokal di `localStorage`.
 *
 * Fase 3 re-audit: penghapusan kini SOFT-DELETE (deleted:true), bukan
 * hard-delete — `allow delete` sudah dihapus dari rules (R-01). Dokumen yang
 * sudah di-soft-delete dilewati (update ulang pada dokumen terhapus ditolak
 * rules, dan satu penolakan menggagalkan seluruh batch). Data tetap ada di
 * Firestore bertanda terhapus sampai purge permanen tersedia lewat Cloud
 * Function; akun Auth sendiri tetap dicabut permanen oleh hapusAkunPermanen.
 *
 * @param {string} uid
 * @param {({ done, total, koleksi }) => void} [onProgress]
 * @param {object} [deps] Opsional injeksi dependensi untuk pengujian unit Node
 */
export async function hapusSemuaData(uid, onProgress, deps = {}) {
  if (IS_DEMO_UID(uid)) {
    throw new Error('Mode demo tidak memiliki data tersimpan untuk dihapus.')
  }
  const uidValid = uidAktif(uid, deps)
  const { db } = deps.getFirebase ? deps.getFirebase() : getFirebase()
  const collectionFn = deps.collection || collection
  const getDocsFn = deps.getDocs || getDocs
  const writeBatchFn = deps.writeBatch || writeBatch
  const serverTimestampFn = deps.serverTimestamp || serverTimestamp

  const ops = []
  const perKoleksi = {}

  for (const k of KOLEKSI_HAPUS) {
    const snap = await getDocsFn(collectionFn(db, 'users', uidValid, k))
    const daftar = snap?.docs || []
    perKoleksi[k] = daftar.length
    for (const d of daftar) {
      // Dokumen yang sudah terhapus dilewati — men-soft-delete ulang ditolak rules.
      const sudahHapus = typeof d.data === 'function' ? d.data()?.deleted === true : false
      if (!sudahHapus) ops.push({ koleksi: k, ref: d.ref })
    }
  }

  const total = ops.length
  let done = 0
  for (let i = 0; i < total; i += BATCH_LIMIT) {
    const slice = ops.slice(i, i + BATCH_LIMIT)
    const batch = writeBatchFn(db)
    for (const op of slice) {
      batch.update(op.ref, { deleted: true, deletedAt: serverTimestampFn(), updatedAt: serverTimestampFn() })
    }
    await batch.commit()
    done += slice.length
    onProgress?.({ done, total, koleksi: slice[slice.length - 1]?.koleksi })
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`myduit-migrasi-norm-${uidValid}`)
      localStorage.removeItem('myduit:tx_chip')
    }
  } catch {
    // Abaikan bila localStorage tidak tersedia
  }
  resetBasisMataUang()

  return { deleted: done, total, perKoleksi }
}

/**
 * Menghapus seluruh data Firestore + mencabut akun Firebase Auth pengguna secara permanen
 * (kepatuhan kebijakan Account Deletion Google Play Store).
 *
 * Catatan Fase 3: akun Auth dicabut permanen, tapi dokumen Firestore kini
 * hanya di-SOFT-DELETE (hard-delete dihapus dari rules, R-01) — datanya tetap
 * ada bertanda terhapus dan tidak bisa dibaca siapa pun (UID itu tidak bisa
 * dipakai login lagi). Purge permanen yang sesungguhnya masih menunggu Cloud
 * Function dengan re-autentikasi + masa tenggang.
 */
export async function hapusAkunPermanen(uid, onProgress, deps = {}) {
  const hasilData = await hapusSemuaData(uid, onProgress, deps)
  const { auth } = deps.getFirebase ? deps.getFirebase() : getFirebase()
  const user = auth?.currentUser
  if (!user) throw new Error('Sesi akun tidak ditemukan.')
  const deleteUserFn = deps.deleteUser || deleteUser
  const reauthFn = deps.reauthenticateWithPopup || reauthenticateWithPopup

  try {
    await deleteUserFn(user)
  } catch (err) {
    if (err?.code === 'auth/requires-recent-login') {
      await reauthFn(user, googleProvider)
      await deleteUserFn(user)
    } else {
      throw err
    }
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('myduit:negara')
      localStorage.removeItem('myduit:bahasa')
    }
  } catch {
    // Abaikan di mode privat
  }
  return { ...hasilData, accountDeleted: true }
}
