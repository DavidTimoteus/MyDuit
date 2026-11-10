import { Timestamp, collection, getDocs, writeBatch, doc } from 'firebase/firestore'
import { getFirebase } from '../../lib/firebase.js'
import { kanonikTanggal, parseAngkaEksternal } from '../../lib/format.js'

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

// Validasi segmen ID dokumen Firestore untuk mencegah path traversal ('a/b', '.', '..', '__proto__').
export function validDocId(rawId) {
  if (typeof rawId !== 'string' && typeof rawId !== 'number') return null
  const id = String(rawId).trim()
  if (!id || id.length > 128) return null
  if (id === '.' || id === '..' || id.includes('/') || id.includes('\\') || id.includes('..')) return null
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
  const data = { ...(rawData && typeof rawData === 'object' ? rawData : {}) }
  data.deleted = typeof data.deleted === 'boolean' ? data.deleted : false

  switch (koleksi) {
    case 'transaksi': {
      data.jumlah = Math.max(0, parseAngkaEksternal(data.jumlah))
      const j = String(data.jenis ?? 'pengeluaran').trim().toLowerCase()
      data.jenis = ['pemasukan', 'pengeluaran', 'pindah saldo'].includes(j) ? j : 'pengeluaran'
      data.tanggal = kanonikTanggal(data.tanggal)
      if (data.catatan !== undefined) data.catatan = String(data.catatan ?? '').slice(0, 500)
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
      if (data.tanggal) data.tanggal = kanonikTanggal(data.tanggal)
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
function uidAktif(uid) {
  const { auth } = getFirebase()
  const sekarang = auth.currentUser?.uid
  if (!sekarang) throw new Error('Belum login.')
  if (uid !== sekarang) throw new Error('UID tidak cocok dengan akun yang sedang login.')
  return sekarang
}

const KOLEKSI = ['akun', 'kategori', 'transaksi', 'budget', 'utang', 'pembayaranUtang', 'mutasiLog']

// Firestore membatasi 500 operasi per writeBatch.
const BATCH_LIMIT = 450

export async function exportData(uid) {
  uid = uidAktif(uid)
  const { db } = getFirebase()
  const data = {}
  for (const c of KOLEKSI) {
    const snap = await getDocs(collection(db, 'users', uid, c))
    data[c] = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  }
  return {
    app: 'MyDuit',
    version: 1,
    exportedAt: new Date().toISOString(),
    uid,
    data,
  }
}

// Restore dengan writeBatch.
//
// onProgress?: ({ done, total, koleksi }) => void
export async function restoreData(uid, json, onProgress) {
  if (!json || json.app !== 'MyDuit' || !json.data) {
    throw new Error('Berkas backup tidak valid (bukan file MyDuit).')
  }
  uid = uidAktif(uid)
  const { db } = getFirebase()

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
      ops.push({ koleksi: c, ref: doc(db, 'users', uid, c, safeId), data: cleaned })
    }
  }

  const total = ops.length
  if (total === 0) return 0

  let done = 0
  for (let i = 0; i < total; i += BATCH_LIMIT) {
    const slice = ops.slice(i, i + BATCH_LIMIT)
    const batch = writeBatch(db)
    for (const op of slice) batch.set(op.ref, op.data, { merge: true })
    await batch.commit()
    done += slice.length
    onProgress?.({ done, total, koleksi: slice[slice.length - 1]?.koleksi })
  }
  return done
}
