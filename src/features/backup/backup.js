import { Timestamp, collection, getDocs, writeBatch, doc } from 'firebase/firestore'
import { getFirebase } from '../../lib/firebase.js'

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
    if ((k === 'createdAt' || k === 'updatedAt' || k === 'timestamp' || k === 'at') && typeof v === 'string') {
      const d = new Date(v)
      out[k] = Number.isNaN(d.getTime()) ? v : Timestamp.fromDate(d)
    } else {
      out[k] = hidupkanTimestamp(v)
    }
  }
  return out
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

// Restore dengan writeBatch. Versi lama memakai `await setDoc()` per dokumen di
// dalam loop → untuk backup dari Google Sheet (ratusan/ribuan baris) berarti
// ratusan round-trip berurutan ke server, sehingga UI tampak "stuck loading"
// sangat lama dan sering tak pernah selesai. Batch memotong itu jadi
// ceil(total/450) request saja.
//
// onProgress?: ({ done, total, koleksi }) => void
export async function restoreData(uid, json, onProgress) {
  if (!json || json.app !== 'MyDuit' || !json.data) {
    throw new Error('Berkas backup tidak valid (bukan file MyDuit).')
  }
  uid = uidAktif(uid)
  const { db } = getFirebase()

  // Kumpulkan semua operasi tulis dulu supaya total diketahui (untuk progress).
  const ops = []
  for (const c of KOLEKSI) {
    const arr = json.data[c]
    if (!Array.isArray(arr)) continue
    for (const item of arr) {
      if (!item || !item.id) continue
      const { id, ...rest } = item
      ops.push({ koleksi: c, ref: doc(db, 'users', uid, c, String(id)), data: hidupkanTimestamp(rest) })
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
