// Penanda operasi keuangan yang sudah selesai — mencegah pengulangan efek
// saldo yang sama (retry setelah commit berhasil, klik ganda lintas tab di
// browser yang sama).
//
// Mengapa localStorage: operasinya sinkron dan dibagi antar tab dalam satu
// origin, jadi pola cek-lalu-tandai dalam satu giliran JS bersifat atomik
// antar tab — dua tab tidak bisa sama-sama "belum diproses".
//
// BATASAN: ini hanya penanda di perangkat yang sama. Balapan lintas perangkat
// dicegah oleh runTransaction di db.js (baca state server dulu) dan oleh
// firestore.rules (menolak update dokumen yang sudah di-soft-delete). Penanda
// HANYA ditulis setelah commit berhasil; bila commit gagal, operasi boleh
// diulang — penanda tidak pernah ditulis sebelum sukses.
const MEMORI = new Set()

function kunci(uid, jenis, id) {
  return `myduit:op:${uid}:${jenis}:${id}`
}

export function sudahDiproses(uid, jenis, id) {
  if (!uid || !jenis || !id) return false
  const k = kunci(uid, jenis, id)
  if (MEMORI.has(k)) return true
  try {
    if (typeof window !== 'undefined' && window.localStorage?.getItem(k) === '1') {
      MEMORI.add(k)
      return true
    }
  } catch {
    // Storage diblokir — anggap belum diproses (transaksi server tetap menjaga).
  }
  return false
}

export function tandaiDiproses(uid, jenis, id) {
  if (!uid || !jenis || !id) return
  const k = kunci(uid, jenis, id)
  MEMORI.add(k)
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(k, '1')
    }
  } catch {
    // Storage diblokir — penanda memori tetap berlaku selama sesi ini.
  }
}

export function _resetUntukUji() {
  MEMORI.clear()
}
