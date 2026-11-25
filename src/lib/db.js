import {
  addDoc,
  collection,
  deleteField,
  getDoc,
  getDocFromCache,
  getDocFromServer,
  getDocs,
  getDocsFromCache,
  increment,
  limit as fbLimit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  doc,
  runTransaction,
  updateDoc,
  where,
  writeBatch,
  startAfter,
} from 'firebase/firestore'
import { getFirebase } from './firebase.js'
import { IS_DEMO_UID, MOCK_AKUN, MOCK_BUDGET, MOCK_KATEGORI, MOCK_TRANSAKSI, MOCK_UTANG } from './mockData.js'
import { MAX_NOMINAL, jamSekarang, jamValid, kanonikTanggal, negaraUntukMataUang, simpanNegaraManual, uangAktif } from './format.js'
import { bacaBasisMataUang, bacaStatusBasis, buatSnapshotKurs, desimalMataUang, mataUangDidukung, segarkanKursGlobal, simpanBasisMataUang } from './kurs.js'
import { sudahDiproses, tandaiDiproses } from './idempotensi.js'

function bulatkanKeBasis(nilai) {
  const n = Number(nilai)
  if (!Number.isFinite(n)) return NaN
  const d = desimalMataUang(bacaBasisMataUang() || 'IDR')
  const faktor = d > 0 ? 10 ** d : 1
  return Math.round(n * faktor) / faktor
}

function wajibAngkaPositif(nilai, label = 'Nominal') {
  const n = bulatkanKeBasis(nilai)
  if (!Number.isFinite(n) || n <= 0 || n > MAX_NOMINAL) {
    throw new Error(`${label} tidak valid (harus lebih dari nol).`)
  }
  return n
}

function angkaAman(nilai) {
  const n = bulatkanKeBasis(nilai)
  if (!Number.isFinite(n)) return 0
  return Math.max(-MAX_NOMINAL, Math.min(MAX_NOMINAL, n))
}

function potongTeks(nilai, maks) {
  const s = String(nilai ?? '').trim()
  return s.length > maks ? s.slice(0, maks) : s
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

// ===== TRANSAKSI ATOMIK (perbaikan audit 25 Nov 2026) =====
// Dulu semua mutasi saldo memakai writeBatch + snapshot klien: hapus ganda,
// retry, dan dua tab yang menulis bersamaan bisa merusak saldo secara permanen
// karena tidak ada yang membaca state server sebelum menulis.
// Sekarang: coba runTransaction dulu (baca dokumen server, validasi, tulis).
// Bila perangkat offline, Firestore menolak transaksi dengan 'unavailable' —
// baru saat itu jatuh ke jalur batch lama + penanda idempotensi (idempotensi.js),
// supaya janji offline-first tetap hidup. Batasan yang tersisa: balapan lintas
// perangkat saat SAMA-SAMA offline tidak bisa dicegah dari klien; rules menolak
// update dokumen yang sudah di-soft-delete, jadi pengulangan efek tidak lolos
// diam-diam saat sinkronisasi.
// Jalankan penulisan lewat runTransaction; bila offline (atau respons hilang)
// jatuh ke writeBatch dengan data yang sama. Jalur batch memakai increment()
// yang TIDAK idempotent, jadi sebelum menjalankannya kita WAJIB memastikan
// transaksi belum diterapkan server — kalau tidak, saldo bisa naik dua kali.
//
// P3 (re-review keamanan 25 Nov 2026): commit transaksi bisa mendarat di
// server sementara responsnya hilang dan retry SDK habis — lalu fallback batch
// menulis increment kedua. `cekSudahDiterapkan` menutup celah itu: ia membaca
// state server (getDocFromServer — BUKAN cache lokal) dan mengembalikan nilai
// sukses pemanggil bila efeknya sudah ada, atau `undefined` bila batch boleh
// jalan. Bila server tidak bisa dihubungi, cek melempar dan kita tetap lanjut
// ke batch (perilaku lama) — jendela sisa: transaksi mendarat + masih offline
// saat cek + batch ikut tersinkron nanti. Jendela itu sempit (butuh commit
// mendarat di tengah putusnya koneksi lalu offline berkepanjangan), dan
// didokumentasikan sebagai residu — menutupnya penuh butuh pola outbox
// (antrean operasi + rekonsiliasi saat online), bukan perbaikan sebaris.
async function denganTransaksi(db, fnTransaksi, fnBatch, cekSudahDiterapkan) {
  try {
    return await runTransaction(db, fnTransaksi)
  } catch (e) {
    if (e?.code !== 'unavailable') throw e
    if (cekSudahDiterapkan) {
      try {
        const sudah = await cekSudahDiterapkan()
        if (sudah !== undefined) return sudah
      } catch {
        // Cek tidak bisa memastikan apa pun (masih offline) — lanjut ke batch.
      }
    }
    return fnBatch()
  }
}

// Apakah dokumen transaksi server sudah sama persis dengan state baru yang
// hendak ditulis? Dipakai updateTransaksi: bila ya, transaksi pertama sudah
// diterapkan (atomik — saldonya pun sudah), jadi fallback batch harus dilewati.
function dokumenSudahSama(dokServer, baru) {
  if (!dokServer) return false
  return (
    Number(dokServer.jumlah) === Number(baru.jumlah) &&
    dokServer.jenis === baru.jenis &&
    (dokServer.kategoriId ?? '') === (baru.kategoriId ?? '') &&
    (dokServer.akunId ?? '') === (baru.akunId ?? '') &&
    (dokServer.tanggal ?? '') === (baru.tanggal ?? '') &&
    (dokServer.jam ?? '') === (baru.jam ?? '') &&
    (dokServer.catatan ?? '') === (baru.catatan ?? '')
  )
}

// Delta saldo: pemasukan menambah, pengeluaran mengurangi (0 bila non-reguler/korup).
export function deltaSaldo(trans) {
  const jml = Math.max(0, angkaAman(trans?.jumlah))
  if (jml === 0) return 0
  if (trans?.jenis === 'pemasukan') return jml
  if (trans?.jenis === 'pengeluaran') return -jml
  return 0
}

// ===== LOGIKA MURNI R-05/R-06/R-07 (re-audit 25 Nov 2026) =====
// Dipisah murni supaya bisa diuji tanpa emulator (yang rusak di VM ini):
// keputusan angkanya diuji di saldoCukup.test.mjs, pemakaian di jalur
// transaksi dikunci kontrak sumber dbKontrak.test.mjs.

// R-05: sisa utang baru dari data SERVER (bukan snapshot UI yang bisa basi).
// dibayar = totalServer - sisaServer (yang sudah dibayar tidak boleh hilang).
// Total baru tidak boleh lebih kecil dari yang sudah dibayar.
export function hitungSisaUtangBaru({ totalServer, sisaServer, totalBaru }) {
  const totalSrv = angkaAman(totalServer)
  const sisaSrv = angkaAman(sisaServer)
  const dibayar = Math.max(0, totalSrv - sisaSrv)
  const total = angkaAman(totalBaru)
  if (total < dibayar) {
    throw new Error(
      `Total utang baru (Rp${total.toLocaleString('id-ID')}) lebih kecil dari yang sudah dibayar (Rp${dibayar.toLocaleString('id-ID')}).`,
    )
  }
  return { sisaBaru: Math.max(0, total - dibayar), dibayar }
}

// R-06: delta koreksi saldo dari saldo SERVER (bukan saldoLama dari UI).
export function hitungDeltaKoreksi({ saldoServer, saldoBaru }) {
  return angkaAman(saldoBaru) - angkaAman(saldoServer)
}

// R-07: tolak tulis yang membuat saldo sumber negatif. Koreksi manual lewat
// updateAkun tetap boleh negatif (tindakan eksplisit user, tercatat di
// mutasiLog) — yang diblokir di sini adalah belanja/pindah/bayar yang
// menggerus saldo diam-diam.
export function cekSaldoCukup({ saldo, jumlah }) {
  const s = angkaAman(saldo)
  const j = angkaAman(jumlah)
  if (j > s) {
    throw new Error(
      `Saldo tidak mencukupi (saldo Rp${s.toLocaleString('id-ID')}, perlu Rp${j.toLocaleString('id-ID')}).`,
    )
  }
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
  const namaBersih = potongTeks(nama, 120)
  if (!namaBersih) throw new Error('Nama rekening wajib diisi.')
  const tipeAman = potongTeks(tipe || 'Rekening Utama', 60) || 'Rekening Utama'
  const saldoInt = angkaAman(saldoAwal)
  if (IS_DEMO_UID(uid)) {
    const id = 'demo_acc_' + Date.now()
    MOCK_AKUN.push({ id, nama: namaBersih, tipe: tipeAman, saldo: saldoInt, deleted: false })
    return id
  }
  const ref = doc(userCol(uid, 'akun'))
  await setDoc(ref, {
    nama: namaBersih,
    tipe: tipeAman,
    saldo: saldoInt,
    deleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(saldoInt !== 0
      ? { mutasiTerakhir: { delta: saldoInt, keterangan: 'Saldo awal', at: serverTimestamp() } }
      : {}),
  })
  pastikanBasisTerkunciSetelahTulis(uid).catch(() => {})
  return ref.id
}

export async function updateAkun(uid, id, { nama, tipe, saldo, saldoLama }) {
  const namaBersih = potongTeks(nama, 120)
  if (!namaBersih) throw new Error('Nama rekening wajib diisi.')
  const tipeAman = potongTeks(tipe || 'Rekening Utama', 60) || 'Rekening Utama'
  if (IS_DEMO_UID(uid)) {
    const idx = MOCK_AKUN.findIndex((a) => a.id === id)
    if (idx !== -1) {
      MOCK_AKUN[idx] = {
        ...MOCK_AKUN[idx],
        nama: namaBersih,
        tipe: tipeAman,
        ...(saldo !== undefined && saldo !== null && Number.isFinite(Number(saldo))
          ? { saldo: angkaAman(saldo) }
          : {}),
      }
    }
    return
  }
  const adaSaldoBaru = saldo !== undefined && saldo !== null && Number.isFinite(Number(saldo))
  const saldoBaru = adaSaldoBaru ? angkaAman(saldo) : null
  const { db } = getFirebase()
  const refAkun = akunRef(uid, id)
  // R-06: delta koreksi dihitung dari saldo SERVER di dalam transaksi, bukan
  // dari saldoLama UI. Offline: coba cache dulu; tanpa cache pakai saldoLama
  // UI (perilaku lama — delta bisa 0 bila saldoLama tidak dikirim).
  await denganTransaksi(
    db,
    async (tx) => {
      const snap = await tx.get(refAkun)
      if (!snap.exists()) throw new Error('Rekening tidak ditemukan.')
      const patch = { nama: namaBersih, tipe: tipeAman, updatedAt: serverTimestamp() }
      let deltaKoreksi = 0
      if (adaSaldoBaru) {
        patch.saldo = saldoBaru
        deltaKoreksi = hitungDeltaKoreksi({ saldoServer: snap.data()?.saldo, saldoBaru })
        if (deltaKoreksi !== 0) {
          patch.mutasiTerakhir = {
            delta: deltaKoreksi,
            keterangan: 'Koreksi penyesuaian saldo',
            at: serverTimestamp(),
          }
        }
      }
      tx.update(refAkun, patch)
      if (deltaKoreksi !== 0) {
        tx.set(doc(userCol(uid, 'mutasiLog')), {
          akunId: id,
          aksi: 'koreksi saldo',
          delta: deltaKoreksi,
          timestamp: serverTimestamp(),
          deleted: false,
          createdAt: serverTimestamp(),
        })
      }
    },
    async () => {
      const patch = { nama: namaBersih, tipe: tipeAman, updatedAt: serverTimestamp() }
      let deltaKoreksi = 0
      if (adaSaldoBaru) {
        patch.saldo = saldoBaru
        let saldoAcuan = null
        try {
          const c = await getDocFromCache(refAkun)
          if (c.exists()) saldoAcuan = c.data()?.saldo
        } catch {
          // Tanpa cache — pakai saldoLama UI (perilaku lama).
        }
        if (saldoAcuan !== null && saldoAcuan !== undefined) {
          deltaKoreksi = hitungDeltaKoreksi({ saldoServer: saldoAcuan, saldoBaru })
        } else {
          const adaLama = saldoLama !== undefined && saldoLama !== null && Number.isFinite(Number(saldoLama))
          const saldoLamaInt = adaLama ? angkaAman(saldoLama) : saldoBaru
          deltaKoreksi = adaLama ? saldoBaru - saldoLamaInt : 0
        }
        if (deltaKoreksi !== 0) {
          patch.mutasiTerakhir = {
            delta: deltaKoreksi,
            keterangan: 'Koreksi penyesuaian saldo',
            at: serverTimestamp(),
          }
        }
      }

      // Setiap koreksi saldo dicatat sebagai entri BARU di mutasiLog (append-only).
      // Tidak pernah menimpa entri lama, jadi edit berulang per hari/bulan tetap
      // lengkap. Tidak menyentuh koleksi transaksi sama sekali.
      const batch = writeBatch(db)
      batch.update(refAkun, patch)
      if (deltaKoreksi !== 0) {
        batch.set(doc(userCol(uid, 'mutasiLog')), {
          akunId: id,
          aksi: 'koreksi saldo',
          delta: deltaKoreksi,
          timestamp: serverTimestamp(),
          deleted: false,
          createdAt: serverTimestamp(),
        })
      }
      await batch.commit()
    },
  )
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
// konsisten saat online. Sejak perbaikan audit 25 Nov 2026, mutasi saldo utama
// (simpan/edit/hapus transaksi, pindah saldo, bayar utang) memakai runTransaction
// dulu dan hanya jatuh ke writeBatch bila perangkat offline.

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
  const tglKanonik = kanonikTanggal(data.tanggal)
  const transId = data.id || buatTransaksiId(uid)
  const trans = {
    jumlah: jumlahInt,
    jenis: data.jenis,
    kategoriId: data.kategoriId ?? '',
    akunId: data.akunId,
    tanggal: tglKanonik,
    jam: jamValid(data.jam) || jamSekarang(),
    catatan: potongTeks(data.catatan, 500),
    kursSnapshot: data.kursSnapshot || buatSnapshotKurs(bacaBasisMataUang() || 'IDR', tglKanonik),
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
  const ref = doc(userCol(uid, 'transaksi'), transId)
  const akunDoc = akunRef(uid, data.akunId)
  const mutasiAkun = {
    saldo: increment(deltaSaldo(trans)),
    updatedAt: serverTimestamp(),
    mutasiTerakhir: { delta: deltaSaldo(trans), keterangan: `Transaksi ${data.kategoriNama ?? ''}`.trim(), at: serverTimestamp() },
  }
  // Retry setelah commit berhasil: jangan tulis ulang saldo.
  if (sudahDiproses(uid, 'simpan', transId)) return transId
  const hasil = await denganTransaksi(
    db,
    async (tx) => {
      const snap = await tx.get(ref)
      if (snap.exists()) return transId // dokumen sudah ada = retry; saldo sudah diterapkan
      const akunSnap = await tx.get(akunDoc)
      if (!akunSnap.exists()) throw new Error('Rekening tidak ditemukan.')
      // R-07: pengeluaran tidak boleh membuat saldo negatif (baca dari server).
      if (trans.jenis === 'pengeluaran') {
        cekSaldoCukup({ saldo: akunSnap.data()?.saldo, jumlah: jumlahInt })
      }
      tx.set(ref, trans)
      tx.update(akunDoc, mutasiAkun)
      return transId
    },
    async () => {
      // Offline: cek terhadap cache lokal bila ada (sumber kebenaran saat
      // offline); tanpa cache, cek dilewati — tidak bisa dipastikan (R-07).
      if (trans.jenis === 'pengeluaran') {
        let akunCache = null
        try {
          akunCache = await getDocFromCache(akunDoc)
        } catch {
          akunCache = null
        }
        if (akunCache?.exists()) {
          cekSaldoCukup({ saldo: akunCache.data()?.saldo, jumlah: jumlahInt })
        }
      }
      const batch = writeBatch(db)
      batch.set(ref, trans)
      batch.update(akunDoc, mutasiAkun)
      await batch.commit()
      return transId
    },
    // P3: bila dokumen sudah ada di server, percobaan transaksi pertama
    // sudah mendarat (responsnya saja yang hilang) — jangan increment lagi.
    async () => {
      const snap = await getDocFromServer(ref)
      return snap.exists() ? transId : undefined
    },
  )
  tandaiDiproses(uid, 'simpan', transId)
  return hasil
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
    jam: jamValid(data.jam) || jamSekarang(),
    catatan: potongTeks(data.catatan, 500),
  }
  if (IS_DEMO_UID(uid)) {
    const idx = MOCK_TRANSAKSI.findIndex((t) => t.id === lama.id)
    if (idx !== -1) {
      MOCK_TRANSAKSI[idx] = { ...MOCK_TRANSAKSI[idx], ...baru }
    }
    return
  }
  const { db } = getFirebase()
  const ref = transaksiRef(uid, lama.id)
  // Jalur transaksi membaca transaksi LAMA dari server (bukan dari UI yang
  // bisa basi) untuk menghitung delta — edit dari dua tab tidak lagi memakai
  // nominal lama yang sudah kedaluwarsa.
  await denganTransaksi(
    db,
    async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new Error('Transaksi tidak ditemukan.')
      const lamaServer = { id: snap.id, ...snap.data() }
      if (lamaServer.deleted) throw new Error('Transaksi sudah dihapus.')
      tx.update(ref, baru)
      const akunLama = lamaServer.akunId
      const akunBaru = baru.akunId
      if (akunLama && akunLama === akunBaru) {
        // Rekening TIDAK berpindah: cukup SATU delta bersih (baru - lama).
        const delta = deltaSaldo(baru) - deltaSaldo(lamaServer)
        if (delta !== 0) {
          tx.update(akunRef(uid, akunBaru), {
            saldo: increment(delta),
            updatedAt: serverTimestamp(),
            mutasiTerakhir: { delta, keterangan: 'Koreksi edit transaksi', at: serverTimestamp() },
          })
        }
      } else {
        if (akunLama) {
          tx.update(akunRef(uid, akunLama), {
            saldo: increment(-deltaSaldo(lamaServer)),
            updatedAt: serverTimestamp(),
            mutasiTerakhir: { delta: -deltaSaldo(lamaServer), keterangan: 'Koreksi edit transaksi', at: serverTimestamp() },
          })
        }
        tx.update(akunRef(uid, akunBaru), {
          saldo: increment(deltaSaldo(baru)),
          updatedAt: serverTimestamp(),
          mutasiTerakhir: { delta: deltaSaldo(baru), keterangan: `Transaksi ${data.kategoriNama ?? ''}`.trim(), at: serverTimestamp() },
        })
      }
    },
    async () => {
      // Fallback online: hitung delta dari state server terbaru, bukan objek
      // UI `lama` yang bisa basi (di-edit tab lain di sela waktu). Bila masih
      // offline, baca gagal dan kita pakai `lama` (perilaku lama).
      let lamaEfektif = lama
      try {
        const snapSegar = await getDocFromServer(ref)
        if (snapSegar.exists() && !snapSegar.data()?.deleted) {
          lamaEfektif = { id: snapSegar.id, ...snapSegar.data() }
        }
      } catch {
        // Tetap pakai `lama`.
      }
      const batch = writeBatch(db)
      batch.update(ref, baru)
      const akunLama = lamaEfektif.akunId
      const akunBaru = baru.akunId
      if (akunLama && akunLama === akunBaru) {
        const delta = deltaSaldo(baru) - deltaSaldo(lamaEfektif)
        batch.update(akunRef(uid, akunBaru), {
          saldo: increment(delta),
          updatedAt: serverTimestamp(),
          mutasiTerakhir: { delta, keterangan: 'Koreksi edit transaksi', at: serverTimestamp() },
        })
      } else {
        if (akunLama) {
          batch.update(akunRef(uid, akunLama), {
            saldo: increment(-deltaSaldo(lamaEfektif)),
            updatedAt: serverTimestamp(),
            mutasiTerakhir: { delta: -deltaSaldo(lamaEfektif), keterangan: 'Koreksi edit transaksi', at: serverTimestamp() },
          })
        }
        batch.update(akunRef(uid, akunBaru), {
          saldo: increment(deltaSaldo(baru)),
          updatedAt: serverTimestamp(),
          mutasiTerakhir: { delta: deltaSaldo(baru), keterangan: `Transaksi ${data.kategoriNama ?? ''}`.trim(), at: serverTimestamp() },
        })
      }
      await batch.commit()
    },
    // P3: bila dokumen server sudah sama dengan state baru, transaksi pertama
    // sudah diterapkan (atomik — saldonya pun sudah) — lewati batch.
    async () => {
      const snap = await getDocFromServer(ref)
      if (!snap.exists() || snap.data()?.deleted) return undefined
      const server = { id: snap.id, ...snap.data() }
      return dokumenSudahSama(server, baru) ? true : undefined
    },
  )
}

export async function hapusTransaksi(uid, trans) {
  if (!trans?.id) return
  if (trans.jenis === 'pindah saldo') {
    return hapusPindahSaldo(uid, trans)
  }
  if (trans.deleted) return // sudah dihapus: jangan ulangi reversal
  if (IS_DEMO_UID(uid)) {
    const idx = MOCK_TRANSAKSI.findIndex((t) => t.id === trans.id)
    if (idx !== -1) MOCK_TRANSAKSI.splice(idx, 1)
    return
  }
  const { db } = getFirebase()
  const ref = transaksiRef(uid, trans.id)
  if (sudahDiproses(uid, 'hapus', trans.id)) return
  await denganTransaksi(
    db,
    async (tx) => {
      const snap = await tx.get(ref)
      // Sudah dihapus / tidak ada: no-op. Inilah yang menghentikan reversal ganda.
      if (!snap.exists() || snap.data()?.deleted) return
      const s = snap.data()
      tx.update(ref, { deleted: true })
      if (s.akunId) {
        tx.update(akunRef(uid, s.akunId), {
          saldo: increment(-deltaSaldo(s)),
          updatedAt: serverTimestamp(),
          mutasiTerakhir: { delta: -deltaSaldo(s), keterangan: `Hapus transaksi ${s.kategoriNama ?? ''}`.trim(), at: serverTimestamp() },
        })
      }
      if (s.utangId) {
        const jml = Math.max(0, angkaAman(s.jumlah))
        if (jml > 0) {
          tx.update(utangRef(uid, s.utangId), {
            sisa: increment(jml),
            status: 'Belum Lunas',
            updatedAt: serverTimestamp(),
          })
        }
        if (s.pembayaranUtangId) {
          tx.update(doc(userCol(uid, 'pembayaranUtang'), s.pembayaranUtangId), {
            deleted: true,
            updatedAt: serverTimestamp(),
          })
        }
      }
    },
    async () => {
      // Fallback online: reversal harus memakai data server terbaru, bukan
      // objek UI yang bisa basi (nominal/akun berubah di tab lain).
      let transEfektif = trans
      try {
        const snapSegar = await getDocFromServer(ref)
        if (snapSegar.exists() && !snapSegar.data()?.deleted) {
          transEfektif = { id: snapSegar.id, ...snapSegar.data() }
        }
      } catch {
        // Tetap pakai `trans`.
      }
      const batch = writeBatch(db)
      batch.update(ref, { deleted: true })
      if (transEfektif.akunId) {
        batch.update(akunRef(uid, transEfektif.akunId), {
          saldo: increment(-deltaSaldo(transEfektif)),
          updatedAt: serverTimestamp(),
          mutasiTerakhir: { delta: -deltaSaldo(transEfektif), keterangan: `Hapus transaksi ${transEfektif.kategoriNama ?? ''}`.trim(), at: serverTimestamp() },
        })
      }
      if (transEfektif.utangId) {
        const jml = Math.max(0, angkaAman(transEfektif.jumlah))
        if (jml > 0) {
          batch.update(utangRef(uid, transEfektif.utangId), {
            sisa: increment(jml),
            status: 'Belum Lunas',
            updatedAt: serverTimestamp(),
          })
        }
        if (transEfektif.pembayaranUtangId) {
          batch.update(doc(userCol(uid, 'pembayaranUtang'), transEfektif.pembayaranUtangId), {
            deleted: true,
            updatedAt: serverTimestamp(),
          })
        }
      }
      await batch.commit()
    },
    // P3: bila dokumen sudah tidak ada / sudah terhapus di server, reversal
    // sudah terjadi — jangan ulangi (reversal ganda = saldo naik dua kali).
    async () => {
      const snap = await getDocFromServer(ref)
      return !snap.exists() || snap.data()?.deleted ? true : undefined
    },
  )
  tandaiDiproses(uid, 'hapus', trans.id)
}

// Hapus massal atomik: gabungkan penghapusan banyak transaksi (reguler, pindah saldo,
// maupun pembayaran utang) ke dalam writeBatch terkelompok dengan akumulasi delta per
// akunId & utangId agar tidak menimpa dokumen akun yang sama berulang kali.
export async function hapusTransaksiMassal(uid, targets) {
  if (!Array.isArray(targets) || targets.length === 0) return
  // Re-review 25 Nov 2026: ID duplikat di `targets` membuat delta saldo
  // terhitung dua kali (dan batch.update ganda pada dokumen yang sama).
  // Dedupikasi berdasarkan id — kemunculan pertama yang dipakai.
  targets = [...new Map(targets.filter((t) => t?.id).map((t) => [t.id, t])).values()]
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
      if (t.deleted) continue // sudah dihapus: jangan ulangi reversal
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
export async function pindahSaldo(uid, { id, dariId, dariNama, keId, keNama, jumlah, tanggal, jam, catatan }) {
  if (!dariId || !keId) throw new Error('Pilih rekening sumber & tujuan dulu.')
  if (dariId === keId) throw new Error('Rekening sumber & tujuan tidak boleh sama.')
  const jumlahInt = wajibAngkaPositif(jumlah, 'Nominal pindah saldo')
  const tglKanonik = kanonikTanggal(tanggal)
  const transId = id || buatTransaksiId(uid)
  const trans = {
    jumlah: jumlahInt,
    jenis: 'pindah saldo',
    kategoriId: '',
    akunId: dariId,
    dariId,
    keId,
    tanggal: tglKanonik,
    jam: jamValid(jam) || jamSekarang(),
    catatan: potongTeks(catatan, 500),
    kursSnapshot: buatSnapshotKurs(bacaBasisMataUang() || 'IDR', tglKanonik),
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
  const ref = doc(userCol(uid, 'transaksi'), transId)
  const dariDoc = akunRef(uid, dariId)
  const keDoc = akunRef(uid, keId)
  if (sudahDiproses(uid, 'pindah', transId)) return transId
  const hasil = await denganTransaksi(
    db,
    async (tx) => {
      const snap = await tx.get(ref)
      if (snap.exists()) return transId // retry: dokumen sudah ada
      const dariSnap = await tx.get(dariDoc)
      const keSnap = await tx.get(keDoc)
      if (!dariSnap.exists() || !keSnap.exists()) throw new Error('Rekening tidak ditemukan.')
      // R-07: sumber tidak boleh minus (baca dari server).
      cekSaldoCukup({ saldo: dariSnap.data()?.saldo, jumlah: jumlahInt })
      tx.set(ref, trans)
      tx.update(dariDoc, {
        saldo: increment(-jumlahInt),
        updatedAt: serverTimestamp(),
        mutasiTerakhir: { delta: -jumlahInt, keterangan: `Pindah saldo ke ${keNama}`, at: serverTimestamp() },
      })
      tx.update(keDoc, {
        saldo: increment(jumlahInt),
        updatedAt: serverTimestamp(),
        mutasiTerakhir: { delta: jumlahInt, keterangan: `Pindah saldo dari ${dariNama}`, at: serverTimestamp() },
      })
      return transId
    },
    async () => {
      // Offline: cek terhadap cache lokal bila ada; tanpa cache dilewati (R-07).
      let dariCache = null
      try {
        dariCache = await getDocFromCache(dariDoc)
      } catch {
        dariCache = null
      }
      if (dariCache?.exists()) {
        cekSaldoCukup({ saldo: dariCache.data()?.saldo, jumlah: jumlahInt })
      }
      const batch = writeBatch(db)
      batch.set(ref, trans)
      batch.update(dariDoc, {
        saldo: increment(-jumlahInt),
        updatedAt: serverTimestamp(),
        mutasiTerakhir: { delta: -jumlahInt, keterangan: `Pindah saldo ke ${keNama}`, at: serverTimestamp() },
      })
      batch.update(keDoc, {
        saldo: increment(jumlahInt),
        updatedAt: serverTimestamp(),
        mutasiTerakhir: { delta: jumlahInt, keterangan: `Pindah saldo dari ${dariNama}`, at: serverTimestamp() },
      })
      await batch.commit()
      return transId
    },
    // P3: dokumen sudah ada di server = percobaan transaksi pertama mendarat.
    async () => {
      const snap = await getDocFromServer(ref)
      return snap.exists() ? transId : undefined
    },
  )
  tandaiDiproses(uid, 'pindah', transId)
  return hasil
}

// Kembalikan efek pindah saldo (hapus): sumber +jumlah, tujuan -jumlah.
export async function hapusPindahSaldo(uid, trans) {
  if (!trans?.id) return
  if (trans.deleted) return // sudah dihapus: jangan ulangi reversal
  if (IS_DEMO_UID(uid)) {
    const idx = MOCK_TRANSAKSI.findIndex((t) => t.id === trans.id)
    if (idx !== -1) MOCK_TRANSAKSI.splice(idx, 1)
    return
  }
  const { db } = getFirebase()
  const ref = transaksiRef(uid, trans.id)
  if (sudahDiproses(uid, 'hapus', trans.id)) return
  await denganTransaksi(
    db,
    async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists() || snap.data()?.deleted) return
      const s = snap.data()
      const jml = Math.max(0, angkaAman(s.jumlah))
      tx.update(ref, { deleted: true })
      if (s.dariId && s.dariId !== s.keId) {
        tx.update(akunRef(uid, s.dariId), {
          saldo: increment(jml),
          updatedAt: serverTimestamp(),
          mutasiTerakhir: { delta: jml, keterangan: 'Batal pindah saldo', at: serverTimestamp() },
        })
      }
      if (s.keId && s.dariId !== s.keId) {
        tx.update(akunRef(uid, s.keId), {
          saldo: increment(-jml),
          updatedAt: serverTimestamp(),
          mutasiTerakhir: { delta: -jml, keterangan: 'Batal pindah saldo', at: serverTimestamp() },
        })
      }
    },
    async () => {
      // Fallback online: reversal memakai data server terbaru, bukan objek UI.
      let transEfektif = trans
      try {
        const snapSegar = await getDocFromServer(ref)
        if (snapSegar.exists() && !snapSegar.data()?.deleted) {
          transEfektif = { id: snapSegar.id, ...snapSegar.data() }
        }
      } catch {
        // Tetap pakai `trans`.
      }
      const jml = Math.max(0, angkaAman(transEfektif.jumlah))
      const batch = writeBatch(db)
      batch.update(ref, { deleted: true })
      if (transEfektif.dariId && transEfektif.dariId !== transEfektif.keId) {
        batch.update(akunRef(uid, transEfektif.dariId), {
          saldo: increment(jml),
          updatedAt: serverTimestamp(),
          mutasiTerakhir: { delta: jml, keterangan: 'Batal pindah saldo', at: serverTimestamp() },
        })
      }
      if (transEfektif.keId && transEfektif.dariId !== transEfektif.keId) {
        batch.update(akunRef(uid, transEfektif.keId), {
          saldo: increment(-jml),
          updatedAt: serverTimestamp(),
          mutasiTerakhir: { delta: -jml, keterangan: 'Batal pindah saldo', at: serverTimestamp() },
        })
      }
      await batch.commit()
    },
    // P3: dokumen sudah terhapus di server = reversal sudah terjadi.
    async () => {
      const snap = await getDocFromServer(ref)
      return !snap.exists() || snap.data()?.deleted ? true : undefined
    },
  )
  tandaiDiproses(uid, 'hapus', trans.id)
}

// Bersihkan dokumen transaksi rusak: jumlah 0/NaN tanpa kategori & akun.
// Dokumen seperti ini tidak mengubah saldo, tapi mengotori daftar dengan
// baris "(tanpa kategori) -Rp0". Soft-delete dipakai supaya bisa dibatalkan.
//
// DAT-01 (audit 25 Nov 2026): fungsi ini + migrasiNormalisasi masing-masing
// memindai SELURUH koleksi transaksi di tiap login. Migrasi sudah punya marker
// server; pembersih ini hanya punya flag localStorage, jadi terulang di tiap
// browser/perangkat baru (~2x N read). Sekarang pembersih memakai marker
// `meta/bersihTxRusak` di Firestore — sekali selesai, login berikutnya skip
// dengan 1 read. Aman: kode tulis saat ini menolak jumlah <= 0, jadi dokumen
// rusak baru tidak bisa muncul dari versi ini.
export async function bersihkanTransaksiRusak(uid) {
  if (!uid || IS_DEMO_UID(uid)) return 0
  const { db } = getFirebase()
  const markerRef = doc(userCol(uid, 'meta'), 'bersihTxRusak')
  try {
    const markerSnap = await getDoc(markerRef)
    if (markerSnap.exists() && markerSnap.data()?.done) return 0
  } catch {
    // Gagal baca marker jangan memblokir pembersihan — lanjut memindai.
  }
  // Baca semua dokumen (tanpa filter deleted) supaya tidak bergantung pada
  // urutan dengan migrasiNormalisasi yang bisa mengisi field deleted belakangan.
  const snap = await getDocs(userCol(uid, 'transaksi'))
  const rusak = snap.docs.filter((d) => {
    const v = d.data()
    const jml = Number(v?.jumlah)
    return !v?.deleted && (!Number.isFinite(jml) || jml <= 0)
  })
  const batch = writeBatch(db)
  rusak.forEach((d) => batch.update(d.ref, { deleted: true, updatedAt: serverTimestamp() }))
  batch.set(markerRef, { done: true, at: serverTimestamp() })
  await batch.commit()
  return rusak.length
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
    const namaAman = potongTeks(nama, 100) || 'Lainnya'
    const key = kunciKategori(namaAman, jenis)
    if (katByKey[key]) return katByKey[key]
    const jn = (jenis || 'pengeluaran').toLowerCase() === 'pemasukan' ? 'pemasukan' : 'pengeluaran'
    const ref = doc(userCol(uid, 'kategori'))
    patches.unshift({ ref, data: { nama: namaAman, jenis: jn, deleted: false, createdAt: serverTimestamp() } })
    katByKey[key] = ref.id
    return ref.id
  }

  // 1) transaksi
  // H-02 (audit 25 Nov 2026): dokumen yang sudah di-soft-delete tidak perlu
  // dinormalisasi — dan rules kini menolak update non-delete pada dokumen
  // terhapus, jadi patch ke dokumen itu akan menggagalkan migrasi.
  const txSnap = await getDocs(userCol(uid, 'transaksi'))
  for (const d of txSnap.docs) {
    const v = d.data()
    if (v.deleted) continue
    const punyaNama = 'kategoriNama' in v || 'akunNama' in v
    const butuhKat = !v.kategoriId && !!v.kategoriNama && v.jenis !== 'pindah saldo'
    const butuhDeleted = !('deleted' in v)
    const butuhCreatedAt = !('createdAt' in v)
    const tglKanonik = kanonikTanggal(v.tanggal)
    const butuhTanggal = v.tanggal !== tglKanonik
    const catatanLama = typeof v.catatan === 'string' ? v.catatan : String(v.catatan ?? '')
    const butuhCatatan = typeof v.catatan !== 'string' || catatanLama.length > 500
    const butuhJumlah =
      typeof v.jumlah !== 'number' || !Number.isFinite(v.jumlah) || v.jumlah < 0 || v.jumlah > MAX_NOMINAL
    if (!punyaNama && !butuhKat && !butuhDeleted && !butuhCreatedAt && !butuhTanggal && !butuhCatatan && !butuhJumlah) continue
    const patch = {}
    if (butuhKat)
      patch.kategoriId = await ensureKategori(v.kategoriNama, v.jenis === 'pemasukan' ? 'pemasukan' : 'pengeluaran')
    if ('kategoriNama' in v) patch.kategoriNama = deleteField()
    if ('akunNama' in v) patch.akunNama = deleteField()
    if (butuhDeleted) patch.deleted = false
    if (butuhCreatedAt) patch.createdAt = serverTimestamp()
    if (butuhTanggal) patch.tanggal = tglKanonik
    if (butuhCatatan) patch.catatan = catatanLama.slice(0, 500)
    if (butuhJumlah) patch.jumlah = Math.max(0, angkaAman(v.jumlah))
    patches.push({ ref: transaksiRef(uid, d.id), data: patch })
  }

  // 2) budget (kategoriNama redundan)
  const budSnap = await getDocs(userCol(uid, 'budget'))
  for (const d of budSnap.docs) {
    const v = d.data()
    if (v.deleted) continue
    if (!('kategoriNama' in v)) continue
    const patch = { kategoriNama: deleteField() }
    if (!v.kategoriId && v.kategoriNama) patch.kategoriId = await ensureKategori(v.kategoriNama, 'pengeluaran')
    patches.push({ ref: budgetRef(uid, d.id), data: patch })
  }

  // 3) pembayaranUtang (utangNama/akunNama redundan)
  const bayarSnap = await getDocs(userCol(uid, 'pembayaranUtang'))
  for (const d of bayarSnap.docs) {
    const v = d.data()
    if (v.deleted) continue
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
  pastikanBasisTerkunciSetelahTulis(uid).catch(() => {})
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
  const namaBersih = potongTeks(namaPihak, 150)
  if (!namaBersih) throw new Error('Nama pihak wajib diisi.')
  const totalInt = wajibAngkaPositif(total, 'Total utang')
  const tipeAman = tipe === 'Cicilan' ? 'Cicilan' : 'Utang'
  const cicilanInt = tipeAman === 'Cicilan' ? Math.max(0, angkaAman(cicilanPerBulan)) : 0
  const data = {
    namaPihak: namaBersih,
    deskripsi: potongTeks(deskripsi, 500),
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
    // R-05: total berubah -> sisa dihitung dari data SERVER (jumlah terbayar
    // tetap). Snapshot UI (sisaLama/totalLama) hanya dipakai bila offline
    // dan cache tidak punya dokumennya.
    const { db } = getFirebase()
    const utangDoc = utangRef(uid, id)
    const hasil = await denganTransaksi(
      db,
      async (tx) => {
        const snap = await tx.get(utangDoc)
        if (!snap.exists()) throw new Error('Data utang tidak ditemukan.')
        const { sisaBaru } = hitungSisaUtangBaru({
          totalServer: snap.data()?.total,
          sisaServer: snap.data()?.sisa,
          totalBaru: totalInt,
        })
        tx.update(utangDoc, {
          ...data,
          sisa: sisaBaru,
          status: sisaBaru <= 0 ? 'Lunas' : 'Belum Lunas',
          updatedAt: serverTimestamp(),
        })
        return id
      },
      async () => {
        let totalCache = null
        let sisaCache = null
        try {
          const c = await getDocFromCache(utangDoc)
          if (c.exists()) {
            totalCache = c.data()?.total
            sisaCache = c.data()?.sisa
          }
        } catch {
          // Tanpa cache — pakai snapshot UI (perilaku lama).
        }
        let sisaBaru
        if (totalCache !== null && sisaCache !== null) {
          sisaBaru = hitungSisaUtangBaru({ totalServer: totalCache, sisaServer: sisaCache, totalBaru: totalInt }).sisaBaru
        } else {
          const selisih = totalInt - angkaAman(totalLama)
          sisaBaru = Math.max(0, angkaAman(sisaLama) + selisih)
        }
        await updateDoc(utangDoc, {
          ...data,
          sisa: sisaBaru,
          status: sisaBaru <= 0 ? 'Lunas' : 'Belum Lunas',
          updatedAt: serverTimestamp(),
        })
        return id
      },
    )
    return hasil
  }
  const ref = await addDoc(userCol(uid, 'utang'), {
    ...data,
    sisa: data.total,
    status: 'Belum Lunas',
    deleted: false,
    createdAt: serverTimestamp(),
  })
  pastikanBasisTerkunciSetelahTulis(uid).catch(() => {})
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
// Membaca cache lebih dulu agar tidak memblokir antrean writeBatch offline saat membuat kategori baru.
export async function ambilAtauBuatKategori(uid, nama, jenis = 'pengeluaran', { tungguServer = false, batch = null } = {}) {
  const namaBersih = potongTeks(nama, 100)
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
  const qKat = query(userCol(uid, 'kategori'), where('deleted', '==', false))
  let snap = null
  try {
    snap = await getDocsFromCache(qKat)
  } catch {
    snap = null
  }
  if (!snap || snap.empty) {
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      try {
        snap = await getDocs(qKat)
      } catch {
        snap = null
      }
    }
  }
  const targetLower = namaBersih.toLowerCase()
  const cocok = snap?.docs.find((d) => {
    const dt = d.data()
    return String(dt.nama ?? '').trim().toLowerCase() === targetLower && (dt.jenis ?? '').toLowerCase() === jn
  })
  if (cocok) return cocok.id

  const ref = doc(userCol(uid, 'kategori'))
  const payload = { nama: namaBersih, jenis: jn, deleted: false, createdAt: serverTimestamp() }
  if (batch) {
    batch.set(ref, payload)
  } else if (tungguServer) {
    await setDoc(ref, payload)
  } else {
    void setDoc(ref, payload).catch((err) => {
      console.warn('[kategori-auto] gagal simpan kategori:', err?.message ?? err)
    })
  }
  return ref.id
}

// Bayar utang/cicilan: catat pembayaran + transaksi pengeluaran + kurangi sisa + saldo akun.
// ATOMIK: keempat penulisan dibungkus SATU runTransaction (baca sisa dari server);
// bila offline, jatuh ke writeBatch + penanda idempotensi (lihat denganTransaksi).
export async function bayarUtang(uid, { id, utang, jumlah, tanggal, akun }) {
  const jumlahInt = wajibAngkaPositif(jumlah, 'Nominal pembayaran')
  if (!utang?.id) throw new Error('Data utang tidak valid.')
  if (!akun?.id) throw new Error('Pilih rekening sumber dana.')
  const ket = potongTeks(`Bayar ${utang.tipe === 'Cicilan' ? 'cicilan' : 'utang'} ${utang.namaPihak}`, 500)
  const sisaSebelum = Math.max(0, angkaAman(utang.sisa))
  // F02 (audit 25 Nov 2026): overpay harus ditolak — sebelumnya bayar di atas
  // sisa membuat status "Lunas" sementara rekening tetap terdebit penuh dan
  // kelebihannya menguap tanpa jejak.
  if (jumlahInt > sisaSebelum) {
    throw new Error(`Nominal pembayaran melebihi sisa utang (sisa Rp${sisaSebelum.toLocaleString('id-ID')}).`)
  }
  const sisaBaru = Math.max(0, sisaSebelum - jumlahInt)
  const tglKanonik = kanonikTanggal(tanggal)
  const snapKurs = buatSnapshotKurs(bacaBasisMataUang() || 'IDR', tglKanonik)
  if (IS_DEMO_UID(uid)) {
    const katId = await ambilAtauBuatKategori(uid, 'Pembayaran', 'Pengeluaran')
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
      kursSnapshot: snapKurs,
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
  const { db } = getFirebase()
  // Kategori diselesaikan SEBELUM transaksi (tidak bisa di dalam transaksi):
  // tungguServer agar tx tidak pernah merujuk kategori yang belum ada.
  const katId = await ambilAtauBuatKategori(uid, 'Pembayaran', 'Pengeluaran', { tungguServer: true })
  const txRef = id ? doc(userCol(uid, 'transaksi'), id) : doc(userCol(uid, 'transaksi'))
  const txId = txRef.id
  const bayarRef = doc(userCol(uid, 'pembayaranUtang'))
  const utangDoc = utangRef(uid, utang.id)
  const akunDoc = akunRef(uid, akun.id)
  if (sudahDiproses(uid, 'bayar', txId)) return txId
  const hasil = await denganTransaksi(
    db,
    async (tx) => {
      const txSnap = await tx.get(txRef)
      if (txSnap.exists()) return txId // retry: pembayaran sudah tercatat
      const utangSnap = await tx.get(utangDoc)
      if (!utangSnap.exists()) throw new Error('Data utang tidak ditemukan.')
      const akunSnap = await tx.get(akunDoc)
      if (!akunSnap.exists()) throw new Error('Rekening tidak ditemukan.')
      // Sisa dibaca dari SERVER di dalam transaksi — dua tab yang membayar
      // bersamaan tidak lagi sama-sama melihat sisa lama yang sama.
      const sisaServer = Math.max(0, angkaAman(utangSnap.data()?.sisa))
      if (jumlahInt > sisaServer) {
        throw new Error(
          `Nominal pembayaran melebihi sisa utang saat ini (sisa Rp${sisaServer.toLocaleString('id-ID')}). ` +
            'Mungkin sudah dibayar dari perangkat lain — muat ulang lalu coba lagi.',
        )
      }
      const sisaBaruServer = sisaServer - jumlahInt
      // R-07: rekening sumber harus cukup (baca dari server).
      cekSaldoCukup({ saldo: akunSnap.data()?.saldo, jumlah: jumlahInt })
      tx.set(bayarRef, {
        utangId: utang.id,
        transaksiId: txId,
        jumlah: jumlahInt,
        tanggal: tglKanonik,
        akunId: akun.id,
        kursSnapshot: snapKurs,
        deleted: false,
        createdAt: serverTimestamp(),
      })
      tx.set(txRef, {
        jumlah: jumlahInt,
        jenis: 'pengeluaran',
        kategoriId: katId,
        akunId: akun.id,
        utangId: utang.id,
        pembayaranUtangId: bayarRef.id,
        tanggal: tglKanonik,
        catatan: ket,
        kursSnapshot: snapKurs,
        deleted: false,
        createdAt: serverTimestamp(),
      })
      tx.update(utangDoc, {
        sisa: sisaBaruServer,
        status: sisaBaruServer <= 0 ? 'Lunas' : 'Belum Lunas',
        terakhirBayar: tglKanonik,
        updatedAt: serverTimestamp(),
      })
      tx.update(akunDoc, {
        saldo: increment(-jumlahInt),
        updatedAt: serverTimestamp(),
        mutasiTerakhir: { delta: -jumlahInt, keterangan: ket, at: serverTimestamp() },
      })
      return txId
    },
    async () => {
      // Offline: cek saldo terhadap cache lokal bila ada; tanpa cache dilewati
      // (R-07). Overpay offline tetap mengikuti perilaku lama (R-08, di luar
      // cakupan perbaikan ini): sisa dijepit ke 0, bukan negatif.
      let akunCache = null
      try {
        akunCache = await getDocFromCache(akunDoc)
      } catch {
        akunCache = null
      }
      if (akunCache?.exists()) {
        cekSaldoCukup({ saldo: akunCache.data()?.saldo, jumlah: jumlahInt })
      }
      const batch = writeBatch(db)
      batch.set(bayarRef, {
        utangId: utang.id,
        transaksiId: txId,
        jumlah: jumlahInt,
        tanggal: tglKanonik,
        akunId: akun.id,
        kursSnapshot: snapKurs,
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
        kursSnapshot: snapKurs,
        deleted: false,
        createdAt: serverTimestamp(),
      })
      batch.update(utangDoc, {
        sisa: sisaBaru <= 0 ? 0 : increment(-jumlahInt),
        status: sisaBaru <= 0 ? 'Lunas' : 'Belum Lunas',
        terakhirBayar: tglKanonik,
        updatedAt: serverTimestamp(),
      })
      batch.update(akunDoc, {
        saldo: increment(-jumlahInt),
        updatedAt: serverTimestamp(),
        mutasiTerakhir: { delta: -jumlahInt, keterangan: ket, at: serverTimestamp() },
      })
      await batch.commit()
      return txId
    },
    // P3: dokumen transaksi sudah ada di server = pembayaran pertama mendarat
    // (pembayaranUtang dibuat bersamaan di transaksi yang sama, atomik).
    async () => {
      const snap = await getDocFromServer(txRef)
      return snap.exists() ? txId : undefined
    },
  )
  tandaiDiproses(uid, 'bayar', txId)
  return hasil
}

/**
 * Menetapkan mata uang dasar kanonik (`users/{uid}/meta/mataUang`) dan
 * menyinkronkan pilihan lokasi awal bila tersedia di katalog NEGARA.
 */
export async function tetapkanMataUangDasar(uid, currency, { paksa = false, sinkronLokasi = true } = {}) {
  const kode = String(currency || '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(kode)) throw new Error('Kode mata uang tidak valid.')
  if (!mataUangDidukung(kode)) throw new Error(`Mata uang ${kode} tidak didukung (tidak ada kursnya).`)
  if (!uid) return 'IDR'
  if (IS_DEMO_UID(uid)) {
    simpanBasisMataUang(kode, { terkunci: true })
    if (sinkronLokasi) {
      const kNeg = negaraUntukMataUang(kode)
      if (kNeg) simpanNegaraManual(kNeg)
    }
    return kode
  }
  const { db } = getFirebase()
  const metaRef = doc(db, 'users', uid, 'meta', 'mataUang')
  if (!paksa) {
    try {
      const existing = await getDoc(metaRef)
      const lama = existing.exists() ? String(existing.data()?.baseCurrency || '').toUpperCase() : ''
      if (/^[A-Z]{3}$/.test(lama) && mataUangDidukung(lama)) {
        simpanBasisMataUang(lama, { terkunci: true })
        return lama
      }
    } catch {
      // Lanjut menulis optimis (offline-first)
    }
  }
  simpanBasisMataUang(kode, { terkunci: true })
  if (sinkronLokasi) {
    const kNeg = negaraUntukMataUang(kode)
    if (kNeg) simpanNegaraManual(kNeg)
  }
  await setDoc(metaRef, { baseCurrency: kode, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {})
  return kode
}

async function pastikanBasisTerkunciSetelahTulis(uid) {
  if (!uid || IS_DEMO_UID(uid)) return
  if (bacaStatusBasis().terkunci) return
  const basisAktif = uangAktif().currency || bacaBasisMataUang() || 'IDR'
  await tetapkanMataUangDasar(uid, basisAktif, { sinkronLokasi: false })
}

/**
 * Menentukan `baseCurrency` kanonik akun. Jika akun masih 100% kosong (`!punyaData`)
 * dan belum memiliki `meta/mataUang`, penguncian ditunda (`terkunci: false`)
 * agar UI onboarding dapat menawarkan pilihan mata uang dasar pertama kali.
 */
export async function inisialisasiMataUangDasar(uid) {
  if (!uid) return 'IDR'
  if (IS_DEMO_UID(uid)) {
    simpanBasisMataUang('IDR', { terkunci: true })
    segarkanKursGlobal().catch(() => {})
    return 'IDR'
  }

  // Ambil kurs live di latar belakang secepatnya saat online
  segarkanKursGlobal().catch(() => {})

  try {
    const { db } = getFirebase()
    const metaRef = doc(db, 'users', uid, 'meta', 'mataUang')
    const snap = await getDoc(metaRef)
    const tersimpan = snap.exists() ? String(snap.data()?.baseCurrency || '').toUpperCase() : ''
    if (/^[A-Z]{3}$/.test(tersimpan)) {
      if (mataUangDidukung(tersimpan)) {
        simpanBasisMataUang(tersimpan, { terkunci: true })
        return tersimpan
      }
      // Basis lama tanpa kurs (data sebelum perbaikan whitelist): jangan dipakai
      // — lanjut ke logika akun lama/kosong di bawah, jangan percaya nilainya.
    }

    // Akun lama tanpa marker meta/mataUang dianggap berbasis IDR bila sudah memiliki data
    let punyaData = false
    for (const kol of ['transaksi', 'akun', 'utang', 'budget']) {
      const q = query(userCol(uid, kol), fbLimit(1))
      const ada = await getDocs(q)
      if (!ada.empty) {
        punyaData = true
        break
      }
    }
    if (punyaData) {
      simpanBasisMataUang('IDR', { terkunci: true })
      await setDoc(metaRef, { baseCurrency: 'IDR', updatedAt: serverTimestamp() }, { merge: true }).catch(() => {})
      return 'IDR'
    }

    // Akun masih kosong: tandai provisional agar penawaran mata uang awal muncul
    const provisional = uangAktif().currency || 'IDR'
    simpanBasisMataUang(provisional, { terkunci: false })
    return provisional
  } catch (err) {
    console.warn('[db] Gagal membaca meta/mataUang, gunakan basis IDR:', err?.message)
    const fallback = bacaBasisMataUang() || 'IDR'
    simpanBasisMataUang(fallback, { terkunci: true })
    return fallback
  }
}
