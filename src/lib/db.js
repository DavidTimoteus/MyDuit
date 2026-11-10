import {
  addDoc,
  collection,
  deleteField,
  getDoc,
  getDocs,
  increment,
  limit as fbLimit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  doc,
  updateDoc,
  where,
  writeBatch,
  startAfter,
} from 'firebase/firestore'
import { getFirebase } from './firebase.js'
import { IS_DEMO_UID, MOCK_AKUN, MOCK_BUDGET, MOCK_KATEGORI, MOCK_TRANSAKSI, MOCK_UTANG } from './mockData.js'
import { MAX_NOMINAL, kanonikTanggal } from './format.js'

function wajibAngkaPositif(nilai, label = 'Nominal') {
  const n = Math.round(Number(nilai))
  if (!Number.isFinite(n) || n <= 0 || n > MAX_NOMINAL) {
    throw new Error(`${label} tidak valid (harus lebih dari nol).`)
  }
  return n
}

function angkaAman(nilai) {
  const n = Number(nilai)
  if (!Number.isFinite(n)) return 0
  return Math.max(-MAX_NOMINAL, Math.min(MAX_NOMINAL, Math.round(n)))
}

// ===== KOLEKSI =====
// users/{uid}/transaksi : { jumlah(int), jenis('pemasukan'|'pengeluaran'), kategoriId,
//   kategoriNama, akunId, akunNama, tanggal('YYYY-MM-DD'), catatan, deleted, createdAt }
// users/{uid}/akun      : { nama, tipe, saldo(int), deleted, createdAt, updatedAt }
// users/{uid}/kategori  : { nama, jenis, deleted, createdAt }

export function userCol(uid, nama) {
  const { db } = getFirebase()
  return collection(db, 'users', uid, nama)
}

export function transaksiRef(uid, id) {
  const { db } = getFirebase()
  return doc(db, 'users', uid, 'transaksi', id)
}

export function akunRef(uid, id) {
  const { db } = getFirebase()
  return doc(db, 'users', uid, 'akun', id)
}

// Delta saldo: pemasukan menambah, pengeluaran mengurangi (0 bila non-reguler/korup).
export function deltaSaldo(trans) {
  const jml = Math.max(0, angkaAman(trans?.jumlah))
  if (jml === 0) return 0
  if (trans?.jenis === 'pemasukan') return jml
  if (trans?.jenis === 'pengeluaran') return -jml
  return 0
}

// ===== KATEGORI DEFAULT (seed sekali saat pertama login) =====
export const KATEGORI_DEFAULT = {
  pemasukan: ['Gaji', 'Bonus', 'Hadiah', 'Penjualan', 'Lainnya'],
  pengeluaran: ['Makanan', 'Transportasi', 'Tagihan', 'Belanja', 'Hiburan', 'Kesehatan', 'Pendidikan', 'Lainnya'],
}

export async function seedKategoriJikaKosong(uid) {
  // ANTI-DUPLIKAT: hook ini terpasang di beberapa komponen yang mount bersamaan
  // (TransaksiView + RightPanel + Budget) — check-then-insert murni berisiko
  // TOCTOU (semua melihat "kosong" lalu men-seed berkali-kali). Karena Firestore
  // tidak punya unique constraint: (1) hanya buat nama yang MEMANG belum ada
  // (upsert per-nama, aman dipanggil ulang), (2) marker meta agar kebanyakan
  // pemanggilan berikutnya skip dengan 1 pembacaan dokumen saja tanpa baca besar.
  const markerRef = doc(userCol(uid, 'meta'), 'seedKategori')
  const markerSnap = await getDoc(markerRef)
  if (markerSnap.exists() && markerSnap.data()?.done) return false

  const existing = new Set()
  const katSnap = await getDocs(userCol(uid, 'kategori'))
  katSnap.docs.forEach((d) => {
    const dt = d.data()
    const j = (dt.jenis ?? '').toLowerCase()
    const n = (dt.nama ?? '').toLowerCase()
    existing.add(`${j}::${n}`)
  })

  const missing = []
  for (const jenis of Object.keys(KATEGORI_DEFAULT)) {
    for (const nama of KATEGORI_DEFAULT[jenis]) {
      if (!existing.has(`${jenis.toLowerCase()}::${nama.toLowerCase()}`)) missing.push({ nama, jenis })
    }
  }
  if (missing.length === 0) {
    await setDoc(markerRef, { done: true, at: serverTimestamp() })
    return false
  }
  const batch = writeBatch(getFirebase().db)
  for (const { nama, jenis } of missing) {
    batch.set(doc(userCol(uid, 'kategori')), { nama, jenis, deleted: false, createdAt: serverTimestamp() })
  }
  batch.set(markerRef, { done: true, at: serverTimestamp() })
  await batch.commit()
  return true
}

// ===== AKUN (minimal utk Fase 2; modul lengkap di Fase 3) =====
export async function tambahAkun(uid, { nama, saldoAwal = 0, tipe = 'Rekening Utama' }) {
  const namaBersih = String(nama ?? '').trim()
  if (!namaBersih) throw new Error('Nama rekening wajib diisi.')
  const saldoInt = angkaAman(saldoAwal)
  if (IS_DEMO_UID(uid)) {
    const id = 'demo_acc_' + Date.now()
    MOCK_AKUN.push({ id, nama: namaBersih, tipe, saldo: saldoInt, deleted: false })
    return id
  }
  const ref = await addDoc(userCol(uid, 'akun'), {
    nama: namaBersih,
    tipe,
    saldo: saldoInt,
    deleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(saldoInt !== 0
      ? { mutasiTerakhir: { delta: saldoInt, keterangan: 'Saldo awal', at: serverTimestamp() } }
      : {}),
  })
  return ref.id
}

export async function updateAkun(uid, id, { nama, tipe, saldo, saldoLama }) {
  const namaBersih = String(nama ?? '').trim()
  if (!namaBersih) throw new Error('Nama rekening wajib diisi.')
  if (IS_DEMO_UID(uid)) {
    const idx = MOCK_AKUN.findIndex((a) => a.id === id)
    if (idx !== -1) {
      MOCK_AKUN[idx] = {
        ...MOCK_AKUN[idx],
        nama: namaBersih,
        tipe,
        ...(saldo !== undefined && saldo !== null && Number.isFinite(Number(saldo))
          ? { saldo: angkaAman(saldo) }
          : {}),
      }
    }
    return
  }
  const patch = { nama: namaBersih, tipe, updatedAt: serverTimestamp() }
  if (saldo !== undefined && saldo !== null && Number.isFinite(Number(saldo))) {
    const saldoBaru = angkaAman(saldo)
    patch.saldo = saldoBaru
    const adaLama = saldoLama !== undefined && saldoLama !== null && Number.isFinite(Number(saldoLama))
    const saldoLamaInt = adaLama ? angkaAman(saldoLama) : saldoBaru
    if (!adaLama || saldoBaru !== saldoLamaInt) {
      patch.mutasiTerakhir = {
        delta: adaLama ? saldoBaru - saldoLamaInt : 0,
        keterangan: 'Koreksi penyesuaian saldo',
        at: serverTimestamp(),
      }
    }
  }
  await updateDoc(akunRef(uid, id), patch)
}

export async function hapusAkun(uid, id) {
  if (IS_DEMO_UID(uid)) {
    const idx = MOCK_AKUN.findIndex((a) => a.id === id)
    if (idx !== -1) MOCK_AKUN.splice(idx, 1)
    return
  }
  await updateDoc(akunRef(uid, id), { deleted: true, updatedAt: serverTimestamp() })
}

// ===== TRANSAKSI CRUD (offline-first) =====
// KONTRAK DATA (ternormalisasi — anti redundansi):
//   transaksi = { jumlah, jenis, kategoriId→kategori, akunId?→akun,
//                 dariId?/keId? (khusus pindah saldo), tanggal, catatan, deleted, createdAt }
// Nama kategori/akun TIDAK disimpan di transaksi — selalu di-resolve saat read
// dari snapshot kategori/akun (sudah live di app via useAkunKategori, 0 extra read).
// Dokumen lama yang masih punya kategoriNama/akunNama tetap terbaca (fallback),
// dan dibersihkan sekali oleh migrasiNormalisasi().
// Catatan desain: saldo akun diupdate via increment() — mutation ini masuk antrean
// offline Firestore sama seperti penulisan dokumen, jadi catat saat offline tetap
// konsisten saat online. (Trade-off v1: bukan transaksi atomik lintas dokumen.)

export function buatTransaksiId(uid) {
  if (IS_DEMO_UID(uid)) {
    return 'demo_tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
  }
  return doc(userCol(uid, 'transaksi')).id
}

export async function simpanTransaksi(uid, data) {
  const jumlahInt = wajibAngkaPositif(data?.jumlah, 'Nominal transaksi')
  if (data?.jenis !== 'pemasukan' && data?.jenis !== 'pengeluaran') {
    throw new Error('Jenis transaksi tidak valid.')
  }
  if (!data?.akunId) throw new Error('Rekening wajib dipilih.')
  const transId = data.id || buatTransaksiId(uid)
  const trans = {
    jumlah: jumlahInt,
    jenis: data.jenis,
    kategoriId: data.kategoriId ?? '',
    akunId: data.akunId,
    tanggal: kanonikTanggal(data.tanggal),
    catatan: data.catatan ?? '',
    deleted: false,
    createdAt: IS_DEMO_UID(uid) ? new Date().toISOString() : serverTimestamp(),
  }
  if (IS_DEMO_UID(uid)) {
    const idx = MOCK_TRANSAKSI.findIndex((t) => t.id === transId)
    if (idx !== -1) {
      MOCK_TRANSAKSI[idx] = { id: transId, ...trans }
    } else {
      MOCK_TRANSAKSI.unshift({ id: transId, ...trans })
    }
    return transId
  }
  const { db } = getFirebase()
  const batch = writeBatch(db)
  const ref = doc(userCol(uid, 'transaksi'), transId)
  batch.set(ref, trans)
  batch.update(akunRef(uid, data.akunId), {
    saldo: increment(deltaSaldo(trans)),
    updatedAt: serverTimestamp(),
    mutasiTerakhir: { delta: deltaSaldo(trans), keterangan: `Transaksi ${data.kategoriNama ?? ''}`.trim(), at: serverTimestamp() },
  })
  await batch.commit()
  return transId
}

export async function updateTransaksi(uid, lama, data) {
  // Guard: pindah saldo punya field & efek saldo berbeda (dariId/keId, bukan
  // akunId+kategori). Melewatinya ke sini akan menulis akunId salah dan
  // merusak saldo — tolak keras, jangan pernah "koreksi diam-diam".
  if (lama?.jenis === 'pindah saldo' || data?.jenis === 'pindah saldo') {
    throw new Error('Pindah saldo tidak bisa diedit lewat form transaksi. Hapus lalu buat ulang.')
  }
  if (lama?.utangId || data?.utangId) {
    throw new Error('Transaksi pembayaran utang tidak bisa diedit lewat form transaksi. Hapus lalu catat ulang pembayaran.')
  }
  const jumlahInt = wajibAngkaPositif(data?.jumlah, 'Nominal transaksi')
  if (data?.jenis !== 'pemasukan' && data?.jenis !== 'pengeluaran') {
    throw new Error('Jenis transaksi tidak valid.')
  }
  if (!data?.akunId) throw new Error('Rekening wajib dipilih.')
  const baru = {
    jumlah: jumlahInt,
    jenis: data.jenis,
    kategoriId: data.kategoriId ?? '',
    akunId: data.akunId,
    tanggal: kanonikTanggal(data.tanggal),
    catatan: data.catatan ?? '',
  }
  if (IS_DEMO_UID(uid)) {
    const idx = MOCK_TRANSAKSI.findIndex((t) => t.id === lama.id)
    if (idx !== -1) {
      MOCK_TRANSAKSI[idx] = { ...MOCK_TRANSAKSI[idx], ...baru }
    }
    return
  }
  const { db } = getFirebase()
  const batch = writeBatch(db)
  batch.update(transaksiRef(uid, lama.id), baru)

  const akunLama = lama.akunId
  const akunBaru = baru.akunId
  if (akunLama && akunLama === akunBaru) {
    // Rekening TIDAK berpindah: cukup SATU delta bersih (baru - lama).
    // Menulis dua kali ke dokumen akun yang sama dalam satu batch membuat
    // `mutasiTerakhir` saling menimpa dan hasil saldo bergantung urutan
    // penerapan — digabung agar deterministik.
    const delta = deltaSaldo(baru) - deltaSaldo(lama)
    batch.update(akunRef(uid, akunBaru), {
      saldo: increment(delta),
      updatedAt: serverTimestamp(),
      mutasiTerakhir: { delta, keterangan: 'Koreksi edit transaksi', at: serverTimestamp() },
    })
  } else {
    if (akunLama) {
      batch.update(akunRef(uid, akunLama), {
        saldo: increment(-deltaSaldo(lama)),
        updatedAt: serverTimestamp(),
        mutasiTerakhir: { delta: -deltaSaldo(lama), keterangan: 'Koreksi edit transaksi', at: serverTimestamp() },
      })
    }
    batch.update(akunRef(uid, akunBaru), {
      saldo: increment(deltaSaldo(baru)),
      updatedAt: serverTimestamp(),
      mutasiTerakhir: { delta: deltaSaldo(baru), keterangan: `Transaksi ${data.kategoriNama ?? ''}`.trim(), at: serverTimestamp() },
    })
  }
  await batch.commit()
}

export async function hapusTransaksi(uid, trans) {
  if (!trans?.id) return
  if (trans.jenis === 'pindah saldo') {
    return hapusPindahSaldo(uid, trans)
  }
  if (IS_DEMO_UID(uid)) {
    const idx = MOCK_TRANSAKSI.findIndex((t) => t.id === trans.id)
    if (idx !== -1) MOCK_TRANSAKSI.splice(idx, 1)
    return
  }
  const { db } = getFirebase()
  const batch = writeBatch(db)
  batch.update(transaksiRef(uid, trans.id), { deleted: true })
  if (trans.akunId) {
    batch.update(akunRef(uid, trans.akunId), {
      saldo: increment(-deltaSaldo(trans)),
      updatedAt: serverTimestamp(),
      mutasiTerakhir: { delta: -deltaSaldo(trans), keterangan: `Hapus transaksi ${trans.kategoriNama ?? ''}`.trim(), at: serverTimestamp() },
    })
  }
  if (trans.utangId) {
    const jml = Math.max(0, angkaAman(trans.jumlah))
    if (jml > 0) {
      batch.update(utangRef(uid, trans.utangId), {
        sisa: increment(jml),
        status: 'Belum Lunas',
        updatedAt: serverTimestamp(),
      })
    }
    if (trans.pembayaranUtangId) {
      batch.update(doc(userCol(uid, 'pembayaranUtang'), trans.pembayaranUtangId), {
        deleted: true,
        updatedAt: serverTimestamp(),
      })
    }
  }
  await batch.commit()
}

// Hapus massal atomik: gabungkan penghapusan banyak transaksi (reguler, pindah saldo,
// maupun pembayaran utang) ke dalam writeBatch terkelompok dengan akumulasi delta per
// akunId & utangId agar tidak menimpa dokumen akun yang sama berulang kali.
export async function hapusTransaksiMassal(uid, targets) {
  if (!Array.isArray(targets) || targets.length === 0) return
  if (IS_DEMO_UID(uid)) {
    const idSet = new Set(targets.map((t) => t.id))
    for (let i = MOCK_TRANSAKSI.length - 1; i >= 0; i--) {
      if (idSet.has(MOCK_TRANSAKSI[i].id)) MOCK_TRANSAKSI.splice(i, 1)
    }
    return
  }
  const { db } = getFirebase()
  const CHUNK = 120
  for (let i = 0; i < targets.length; i += CHUNK) {
    const slice = targets.slice(i, i + CHUNK)
    const batch = writeBatch(db)
    const deltaPerAkun = new Map()
    const deltaPerUtang = new Map()

    for (const t of slice) {
      if (!t?.id) continue
      batch.update(transaksiRef(uid, t.id), { deleted: true })
      const jml = Math.max(0, angkaAman(t.jumlah))
      if (t.jenis === 'pindah saldo') {
        if (t.dariId && t.dariId !== t.keId) deltaPerAkun.set(t.dariId, (deltaPerAkun.get(t.dariId) || 0) + jml)
        if (t.keId && t.dariId !== t.keId) deltaPerAkun.set(t.keId, (deltaPerAkun.get(t.keId) || 0) - jml)
      } else {
        if (t.akunId) deltaPerAkun.set(t.akunId, (deltaPerAkun.get(t.akunId) || 0) - deltaSaldo(t))
        if (t.utangId && jml > 0) {
          deltaPerUtang.set(t.utangId, (deltaPerUtang.get(t.utangId) || 0) + jml)
          if (t.pembayaranUtangId) {
            batch.update(doc(userCol(uid, 'pembayaranUtang'), t.pembayaranUtangId), {
              deleted: true,
              updatedAt: serverTimestamp(),
            })
          }
        }
      }
    }

    for (const [akunId, delta] of deltaPerAkun.entries()) {
      if (delta === 0) continue
      batch.update(akunRef(uid, akunId), {
        saldo: increment(delta),
        updatedAt: serverTimestamp(),
        mutasiTerakhir: { delta, keterangan: `Hapus ${slice.length} transaksi`, at: serverTimestamp() },
      })
    }
    for (const [utangId, deltaSisa] of deltaPerUtang.entries()) {
      if (deltaSisa <= 0) continue
      batch.update(utangRef(uid, utangId), {
        sisa: increment(deltaSisa),
        status: 'Belum Lunas',
        updatedAt: serverTimestamp(),
      })
    }

    await batch.commit()
  }
}

// ===== PINDAH SALDO (transfer antar rekening) =====
// 1 dokumen transaksi jenis 'pindah saldo' (tanpa +/- pada nominal) + saldo
// sumber dikurangi & tujuan ditambah. dariId/keId disimpan utk pembatalan.
export async function pindahSaldo(uid, { id, dariId, dariNama, keId, keNama, jumlah, tanggal, catatan }) {
  if (!dariId || !keId) throw new Error('Pilih rekening sumber & tujuan dulu.')
  if (dariId === keId) throw new Error('Rekening sumber & tujuan tidak boleh sama.')
  const jumlahInt = wajibAngkaPositif(jumlah, 'Nominal pindah saldo')
  const transId = id || buatTransaksiId(uid)
  const trans = {
    jumlah: jumlahInt,
    jenis: 'pindah saldo',
    kategoriId: '',
    akunId: dariId,
    dariId,
    keId,
    tanggal: kanonikTanggal(tanggal),
    catatan: catatan ?? '',
    deleted: false,
    createdAt: IS_DEMO_UID(uid) ? new Date().toISOString() : serverTimestamp(),
  }
  if (IS_DEMO_UID(uid)) {
    const idx = MOCK_TRANSAKSI.findIndex((t) => t.id === transId)
    if (idx !== -1) {
      MOCK_TRANSAKSI[idx] = { id: transId, ...trans }
    } else {
      MOCK_TRANSAKSI.unshift({ id: transId, ...trans })
    }
    return transId
  }
  const { db } = getFirebase()
  const batch = writeBatch(db)
  const ref = doc(userCol(uid, 'transaksi'), transId)
  batch.set(ref, trans)
  batch.update(akunRef(uid, dariId), {
    saldo: increment(-jumlahInt),
    updatedAt: serverTimestamp(),
    mutasiTerakhir: { delta: -jumlahInt, keterangan: `Pindah saldo ke ${keNama}`, at: serverTimestamp() },
  })
  batch.update(akunRef(uid, keId), {
    saldo: increment(jumlahInt),
    updatedAt: serverTimestamp(),
    mutasiTerakhir: { delta: jumlahInt, keterangan: `Pindah saldo dari ${dariNama}`, at: serverTimestamp() },
  })
  await batch.commit()
  return transId
}

// Kembalikan efek pindah saldo (hapus): sumber +jumlah, tujuan -jumlah.
export async function hapusPindahSaldo(uid, trans) {
  if (!trans?.id) return
  if (IS_DEMO_UID(uid)) {
    const idx = MOCK_TRANSAKSI.findIndex((t) => t.id === trans.id)
    if (idx !== -1) MOCK_TRANSAKSI.splice(idx, 1)
    return
  }
  const jml = Math.max(0, angkaAman(trans.jumlah))
  const { db } = getFirebase()
  const batch = writeBatch(db)
  batch.update(transaksiRef(uid, trans.id), { deleted: true })
  if (trans.dariId && trans.dariId !== trans.keId) {
    batch.update(akunRef(uid, trans.dariId), {
      saldo: increment(jml),
      updatedAt: serverTimestamp(),
      mutasiTerakhir: { delta: jml, keterangan: 'Batal pindah saldo', at: serverTimestamp() },
    })
  }
  if (trans.keId && trans.dariId !== trans.keId) {
    batch.update(akunRef(uid, trans.keId), {
      saldo: increment(-jml),
      updatedAt: serverTimestamp(),
      mutasiTerakhir: { delta: -jml, keterangan: 'Batal pindah saldo', at: serverTimestamp() },
    })
  }
  await batch.commit()
}

// ===== QUERY RIWAYAT =====
// Filter tanggal pakai perbandingan string 'YYYY-MM-DD' (aman kronologis).
// Butuh composite index (lihat firestore.indexes.json); bila error missing-index
// saat dev, klik link di pesan error untuk membuatnya sekali di console.
export function buildTransQuery(uid, { jenis, range, pageSize, cursor }) {
  const constraints = [where('deleted', '==', false)]
  if (jenis && jenis !== 'semua') constraints.push(where('jenis', '==', jenis))
  if (range) {
    constraints.push(where('tanggal', '>=', range.start))
    constraints.push(where('tanggal', '<=', range.end))
  }
  constraints.push(orderBy('tanggal', 'desc'))
  constraints.push(orderBy('createdAt', 'desc'))
  if (pageSize && Number.isFinite(pageSize) && pageSize > 0) {
    constraints.push(fbLimit(pageSize))
  }
  if (cursor) constraints.push(startAfter(cursor))
  return query(userCol(uid, 'transaksi'), ...constraints)
}

export function docKeTransaksi(d) {
  const data = d.data({ serverTimestamps: 'estimate' })
  return { id: d.id, ...data }
}

// ===== RESOLVE NAMA SAAT READ (anti redundansi) =====
// Nama kategori/akun tidak lagi disimpan per transaksi; di-resolve dari map
// snapshot akun/kategori yang memang sudah live di app. Dokumen legacy yang
// masih menyimpan nama tetap terbaca apa adanya (fallback, tanpa migrasi paksa).
export function enrichTransaksi(docs, akunById, kategoriById) {
  return docs.map((t) => {
    if (t.jenis === 'pindah saldo') {
      const derived =
        akunById[t.dariId]?.nama && akunById[t.keId]?.nama
          ? `${akunById[t.dariId].nama} ${String.fromCharCode(0x2192)} ${akunById[t.keId].nama}`
          : ''
      return {
        ...t,
        kategoriNama: t.kategoriNama ?? kategoriById[t.kategoriId] ?? 'Pindah Saldo',
        akunNama: t.akunNama ?? derived,
      }
    }
    return {
      ...t,
      kategoriNama: t.kategoriNama ?? kategoriById[t.kategoriId] ?? '(tanpa kategori)',
      akunNama: t.akunNama ?? akunById[t.akunId]?.nama ?? '',
    }
  })
}

// Kunci kanonik kategori: WAJIB menyertakan jenis agar kategori bernama sama
// lintas jenis (mis. 'Lainnya' pemasukan vs 'Lainnya' pengeluaran) tidak terhapus/tertukar.
export function kunciKategori(nama, jenis) {
  return `${String(jenis ?? '').trim().toLowerCase()}::${String(nama ?? '').trim().toLowerCase()}`
}

// ===== MIGRASI SEKALI-JALAN: buang nama redundan, backfill kategoriId =====
// Untuk semua dokumen lama: (1) kategoriId kosong tapi ada nama -> buat/temukan
// kategori resmi; (2) hapus field kategoriNama/akunNama/utangNama via deleteField.
// Idempoten — dokumen bersih dilewati. Dipanggil sekali per user setelah login.
export async function migrasiNormalisasi(uid) {
  if (!uid || IS_DEMO_UID(uid)) return 0
  const { db } = getFirebase()
  const markerRef = doc(userCol(uid, 'meta'), 'migrasiNormalisasi')
  const markerSnap = await getDoc(markerRef)
  if (markerSnap.exists() && markerSnap.data()?.done) return 0

  const patches = []

  // 0) Dedupe kategori lama per jenis+nama — simpan yang terlama, sisanya soft-delete.
  const semuaKat = await getDocs(userCol(uid, 'kategori'))
  const grupKat = {}
  semuaKat.docs.forEach((d) => {
    const v = d.data()
    if (v.deleted) return
    const key = kunciKategori(v.nama, v.jenis)
    ;(grupKat[key] ??= []).push({ id: d.id, createdAt: v.createdAt?.toMillis?.() ?? 0 })
  })
  Object.values(grupKat).forEach((grup) => {
    if (grup.length < 2) return
    grup.sort((a, b) => a.createdAt - b.createdAt)
    grup.slice(1).forEach((d) => patches.push({ ref: doc(db, 'users', uid, 'kategori', d.id), data: { deleted: true } }))
  })

  // Kategori map per jenis::nama (cukup sekali baca dari hasil snapshot yang sama)
  const katByKey = {}
  semuaKat.docs.forEach((d) => {
    const v = d.data()
    if (v.deleted) return
    const key = kunciKategori(v.nama, v.jenis)
    if (!katByKey[key]) katByKey[key] = d.id
  })
  async function ensureKategori(nama, jenis) {
    const key = kunciKategori(nama, jenis)
    if (katByKey[key]) return katByKey[key]
    const id = await ambilAtauBuatKategori(uid, nama, jenis)
    katByKey[key] = id
    return id
  }

  // 1) transaksi
  const txSnap = await getDocs(userCol(uid, 'transaksi'))
  for (const d of txSnap.docs) {
    const v = d.data()
    const punyaNama = 'kategoriNama' in v || 'akunNama' in v
    const butuhKat = !v.kategoriId && !!v.kategoriNama && v.jenis !== 'pindah saldo'
    const butuhDeleted = !('deleted' in v)
    const butuhCreatedAt = !('createdAt' in v)
    const tglKanonik = kanonikTanggal(v.tanggal)
    const butuhTanggal = v.tanggal !== tglKanonik
    if (!punyaNama && !butuhKat && !butuhDeleted && !butuhCreatedAt && !butuhTanggal) continue
    const patch = {}
    if (butuhKat)
      patch.kategoriId = await ensureKategori(v.kategoriNama, v.jenis === 'pemasukan' ? 'pemasukan' : 'pengeluaran')
    if ('kategoriNama' in v) patch.kategoriNama = deleteField()
    if ('akunNama' in v) patch.akunNama = deleteField()
    if (butuhDeleted) patch.deleted = false
    if (butuhCreatedAt) patch.createdAt = serverTimestamp()
    if (butuhTanggal) patch.tanggal = tglKanonik
    patches.push({ ref: transaksiRef(uid, d.id), data: patch })
  }

  // 2) budget (kategoriNama redundan)
  const budSnap = await getDocs(userCol(uid, 'budget'))
  for (const d of budSnap.docs) {
    const v = d.data()
    if (!('kategoriNama' in v)) continue
    const patch = { kategoriNama: deleteField() }
    if (!v.kategoriId && v.kategoriNama) patch.kategoriId = await ensureKategori(v.kategoriNama, 'pengeluaran')
    patches.push({ ref: budgetRef(uid, d.id), data: patch })
  }

  // 3) pembayaranUtang (utangNama/akunNama redundan)
  const bayarSnap = await getDocs(userCol(uid, 'pembayaranUtang'))
  for (const d of bayarSnap.docs) {
    const v = d.data()
    if (!('utangNama' in v) && !('akunNama' in v)) continue
    const patch = {}
    if ('utangNama' in v) patch.utangNama = deleteField()
    if ('akunNama' in v) patch.akunNama = deleteField()
    patches.push({ ref: doc(db, 'users', uid, 'pembayaranUtang', d.id), data: patch })
  }

  for (let i = 0; i < patches.length; i += 400) {
    const b = writeBatch(db)
    patches.slice(i, i + 400).forEach((p) => b.set(p.ref, p.data, { merge: true }))
    await b.commit()
  }
  await setDoc(markerRef, { done: true, at: serverTimestamp() })
  return patches.length
}

// ===== BUDGET (Fase 3) =====
export function budgetRef(uid, id) {
  const { db } = getFirebase()
  return doc(db, 'users', uid, 'budget', id)
}

export async function simpanBudget(uid, { id, kategoriId, limitNominal, bulan, tahun }) {
  const limitInt = wajibAngkaPositif(limitNominal, 'Limit budget')
  const bulanInt = Number(bulan)
  const tahunInt = Number(tahun)
  if (!kategoriId) throw new Error('Pilih kategori dulu.')
  if (!Number.isInteger(bulanInt) || bulanInt < 0 || bulanInt > 11) throw new Error('Bulan budget tidak valid.')
  if (!Number.isInteger(tahunInt) || tahunInt < 2000 || tahunInt > 2100) throw new Error('Tahun budget tidak valid.')
  const data = {
    kategoriId,
    limitNominal: limitInt,
    bulan: bulanInt,
    tahun: tahunInt,
  }
  if (IS_DEMO_UID(uid)) {
    if (id) {
      const idx = MOCK_BUDGET.findIndex((b) => b.id === id)
      if (idx !== -1) MOCK_BUDGET[idx] = { ...MOCK_BUDGET[idx], ...data }
      return id
    }
    const newId = 'demo_bdg_' + Date.now()
    MOCK_BUDGET.push({ id: newId, ...data, deleted: false })
    return newId
  }
  if (id) {
    await updateDoc(budgetRef(uid, id), { ...data, updatedAt: serverTimestamp() })
    return id
  }
  const ref = await addDoc(userCol(uid, 'budget'), {
    ...data,
    deleted: false,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function hapusBudget(uid, id) {
  if (IS_DEMO_UID(uid)) {
    const idx = MOCK_BUDGET.findIndex((b) => b.id === id)
    if (idx !== -1) MOCK_BUDGET.splice(idx, 1)
    return
  }
  await updateDoc(budgetRef(uid, id), { deleted: true, updatedAt: serverTimestamp() })
}

// ===== UTANG & CICILAN (Fase 3) =====
export function utangRef(uid, id) {
  const { db } = getFirebase()
  return doc(db, 'users', uid, 'utang', id)
}

export async function simpanUtang(uid, { id, namaPihak, deskripsi, total, tipe, cicilanPerBulan, tglJatuhTempo, sisaLama, totalLama }) {
  const namaBersih = String(namaPihak ?? '').trim()
  if (!namaBersih) throw new Error('Nama pihak wajib diisi.')
  const totalInt = wajibAngkaPositif(total, 'Total utang')
  const tipeAman = tipe === 'Cicilan' ? 'Cicilan' : 'Utang'
  const cicilanInt = tipeAman === 'Cicilan' ? Math.max(0, angkaAman(cicilanPerBulan)) : 0
  const data = {
    namaPihak: namaBersih,
    deskripsi: deskripsi ?? '',
    total: totalInt,
    tipe: tipeAman,
    cicilanPerBulan: cicilanInt,
    tglJatuhTempo: tglJatuhTempo ? kanonikTanggal(tglJatuhTempo) : '',
  }
  if (IS_DEMO_UID(uid)) {
    if (id) {
      const idx = MOCK_UTANG.findIndex((u) => u.id === id)
      const selisih = totalInt - (Number(totalLama) || 0)
      const sisaBaru = Math.max(0, (Number(sisaLama) || 0) + selisih)
      if (idx !== -1) {
        MOCK_UTANG[idx] = { ...MOCK_UTANG[idx], ...data, sisa: sisaBaru, status: sisaBaru <= 0 ? 'Lunas' : 'Belum Lunas' }
      }
      return id
    }
    const newId = 'demo_ut_' + Date.now()
    MOCK_UTANG.unshift({ id: newId, ...data, sisa: totalInt, status: 'Belum Lunas', deleted: false })
    return newId
  }
  if (id) {
    // Total berubah -> sisa bergeser sebanyak selisih (jumlah terbayar tetap).
    const selisih = totalInt - angkaAman(totalLama)
    const sisaBaru = Math.max(0, angkaAman(sisaLama) + selisih)
    await updateDoc(utangRef(uid, id), {
      ...data,
      sisa: sisaBaru,
      status: sisaBaru <= 0 ? 'Lunas' : 'Belum Lunas',
      updatedAt: serverTimestamp(),
    })
    return id
  }
  const ref = await addDoc(userCol(uid, 'utang'), {
    ...data,
    sisa: data.total,
    status: 'Belum Lunas',
    deleted: false,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function hapusUtang(uid, id) {
  if (IS_DEMO_UID(uid)) {
    const idx = MOCK_UTANG.findIndex((u) => u.id === id)
    if (idx !== -1) MOCK_UTANG.splice(idx, 1)
    return
  }
  await updateDoc(utangRef(uid, id), { deleted: true, updatedAt: serverTimestamp() })
}

// Cari kategori by nama & jenis (case-insensitive & trim); buat bila belum ada.
export async function ambilAtauBuatKategori(uid, nama, jenis = 'pengeluaran') {
  const namaBersih = String(nama ?? '').trim()
  if (!namaBersih) throw new Error('Nama kategori wajib diisi.')
  const jn = (jenis || 'pengeluaran').toLowerCase() === 'pemasukan' ? 'pemasukan' : 'pengeluaran'
  if (IS_DEMO_UID(uid)) {
    const cocokMock = MOCK_KATEGORI.find(
      (k) => !k.deleted && k.nama.trim().toLowerCase() === namaBersih.toLowerCase() && (k.jenis ?? '').toLowerCase() === jn,
    )
    if (cocokMock) return cocokMock.id
    const newId = 'demo_kat_' + Date.now()
    MOCK_KATEGORI.push({ id: newId, nama: namaBersih, jenis: jn, deleted: false })
    return newId
  }
  const snap = await getDocs(
    query(userCol(uid, 'kategori'), where('deleted', '==', false)),
  )
  const targetLower = namaBersih.toLowerCase()
  const cocok = snap.docs.find((d) => {
    const dt = d.data()
    return String(dt.nama ?? '').trim().toLowerCase() === targetLower && (dt.jenis ?? '').toLowerCase() === jn
  })
  if (cocok) return cocok.id
  const ref = await addDoc(userCol(uid, 'kategori'), { nama: namaBersih, jenis: jn, deleted: false, createdAt: serverTimestamp() })
  return ref.id
}

// Bayar utang/cicilan: catat pembayaran + transaksi pengeluaran + kurangi sisa + saldo akun.
// ATOMIK: keempat penulisan dibungkus SATU writeBatch. Versi sebelumnya memakai
// empat await terpisah — bila salah satu gagal (jaringan/permission), pembayaran
// bisa tercatat tetapi saldo/sisa utang tidak ikut berubah (data uang rusak senyap).
export async function bayarUtang(uid, { id, utang, jumlah, tanggal, akun }) {
  const jumlahInt = wajibAngkaPositif(jumlah, 'Nominal pembayaran')
  if (!utang?.id) throw new Error('Data utang tidak valid.')
  if (!akun?.id) throw new Error('Pilih rekening sumber dana.')
  const katId = await ambilAtauBuatKategori(uid, 'Pembayaran', 'Pengeluaran')
  const ket = `Bayar ${utang.tipe === 'Cicilan' ? 'cicilan' : 'utang'} ${utang.namaPihak}`
  const sisaSebelum = Math.max(0, angkaAman(utang.sisa))
  const sisaBaru = Math.max(0, sisaSebelum - jumlahInt)
  const tglKanonik = kanonikTanggal(tanggal)
  if (IS_DEMO_UID(uid)) {
    const txId = id || buatTransaksiId(uid)
    MOCK_TRANSAKSI.unshift({
      id: txId,
      jumlah: jumlahInt,
      jenis: 'pengeluaran',
      kategoriId: katId,
      akunId: akun.id,
      utangId: utang.id,
      tanggal: tglKanonik,
      catatan: ket,
      deleted: false,
      createdAt: new Date().toISOString(),
    })
    const uIdx = MOCK_UTANG.findIndex((u) => u.id === utang.id)
    if (uIdx !== -1) {
      MOCK_UTANG[uIdx] = { ...MOCK_UTANG[uIdx], sisa: sisaBaru, status: sisaBaru <= 0 ? 'Lunas' : 'Belum Lunas', terakhirBayar: tglKanonik }
    }
    const aIdx = MOCK_AKUN.findIndex((a) => a.id === akun.id)
    if (aIdx !== -1) MOCK_AKUN[aIdx] = { ...MOCK_AKUN[aIdx], saldo: (Number(MOCK_AKUN[aIdx].saldo) || 0) - jumlahInt }
    return txId
  }
  const txRef = id ? doc(userCol(uid, 'transaksi'), id) : doc(userCol(uid, 'transaksi'))
  const txId = txRef.id
  const bayarRef = doc(userCol(uid, 'pembayaranUtang'))

  const { db } = getFirebase()
  const batch = writeBatch(db)
  batch.set(bayarRef, {
    utangId: utang.id,
    transaksiId: txId,
    jumlah: jumlahInt,
    tanggal: tglKanonik,
    akunId: akun.id,
    deleted: false,
    createdAt: serverTimestamp(),
  })
  batch.set(txRef, {
    jumlah: jumlahInt,
    jenis: 'pengeluaran',
    kategoriId: katId,
    akunId: akun.id,
    utangId: utang.id,
    pembayaranUtangId: bayarRef.id,
    tanggal: tglKanonik,
    catatan: ket,
    deleted: false,
    createdAt: serverTimestamp(),
  })
  batch.update(utangRef(uid, utang.id), {
    sisa: sisaBaru <= 0 ? 0 : increment(-jumlahInt),
    status: sisaBaru <= 0 ? 'Lunas' : 'Belum Lunas',
    terakhirBayar: tglKanonik,
    updatedAt: serverTimestamp(),
  })
  batch.update(akunRef(uid, akun.id), {
    saldo: increment(-jumlahInt),
    updatedAt: serverTimestamp(),
    mutasiTerakhir: { delta: -jumlahInt, keterangan: ket, at: serverTimestamp() },
  })
  await batch.commit()
  return txId
}
