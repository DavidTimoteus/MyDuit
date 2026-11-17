// Detail perubahan (mutasi) satu rekening — fungsi murni tanpa Firestore/DOM
// supaya bisa diuji Node langsung (lihat riwayatSaldo.test.mjs).
//
// Sumber data: koleksi `transaksi`. Itu SATU-satunya penulis saldo akun di
// db.js (simpanTransaksi, pindahSaldo, bayarUtang semuanya menulis transaksi
// dalam batch yang sama), sedangkan `mutasiTerakhir` di dokumen akun hanya
// menyimpan SATU baris terakhir — tidak cukup untuk riwayat.
//
// Saldo sesudah tiap mutasi dihitung MUNDUR dari saldo akun sekarang:
//   baris terbaru  -> saldoSesudah = saldo sekarang
//   baris lebih lama -> saldoSesudah = saldo baris berikutnya - delta baris itu
// Aman karena daftar selalu urut terbaru-dulu dan filter rentang (Hari Ini /
// 7 Hari / 30 Hari / Semua / Kustom) hanya memotong di sisi LAMA — semua
// mutasi lebih baru dari baris yang tampil pasti ikut terbaca, jadi hasilnya
// selalu konsisten dengan saldo tersimpan tanpa perlu saldo awal.

// Apakah transaksi menyentuh akun ini? Pindah saldo punya dua ujung
// (dariId/keId); akun sumber juga disimpan di akunId.
export function termasukAkun(t, akunId) {
  if (!t || !akunId) return false
  return t.akunId === akunId || t.dariId === akunId || t.keId === akunId
}

// Delta saldo akun dari SATU transaksi. Pemasukan +, pengeluaran −,
// pindah saldo − untuk sumber dan + untuk tujuan (pindah ke diri sendiri = 0).
export function deltaMutasi(t, akunId) {
  const jumlah = Number(t?.jumlah) || 0
  if (t?.jenis === 'pemasukan') return jumlah
  if (t?.jenis === 'pengeluaran') return -jumlah
  if (t?.jenis === 'pindah saldo') {
    const sumber = t.dariId === akunId
    const tujuan = t.keId === akunId
    if (sumber && tujuan) return 0
    if (sumber) return -jumlah
    if (tujuan) return jumlah
  }
  return 0
}

// Label + styling baris: jenis transaksi dilihat dari sudut pandang akun ini
// (transfer keluar vs transfer masuk beda arah, tapi tetap jenis "transfer").
export function infoMutasi(t, akunId) {
  if (t?.jenis === 'pindah saldo') {
    if (t.dariId === akunId && t.keId === akunId) {
      return { label: 'Pindah saldo', ikon: 'swap_horiz', kelas: 'text-[#187498] bg-[#187498]/10' }
    }
    return t.dariId === akunId
      ? { label: 'Transfer keluar', ikon: 'swap_horiz', kelas: 'text-[#187498] bg-[#187498]/10' }
      : { label: 'Transfer masuk', ikon: 'swap_horiz', kelas: 'text-[#187498] bg-[#187498]/10' }
  }
  if (t?.jenis === 'pemasukan') return { label: 'Pemasukan', ikon: 'trending_up', kelas: 'text-[#36AE7C] bg-[#36AE7C]/10' }
  return { label: 'Pengeluaran', ikon: 'trending_down', kelas: 'text-[#EB5353] bg-[#EB5353]/10' }
}

// Bangun baris riwayat mutasi untuk satu akun.
//   docs           : transaksi (bebas urutan; diurutkan ulang terbaru-dulu)
//   akunId         : akun yang ditampilkan
//   saldoSekarang  : saldo akun saat ini (sumber "saldo sesudah")
//   kategoriById   : map id -> nama kategori (fallback legacy t.kategoriNama)
//   range          : { start?, end? } opsional; pemotongan batas atas (`end`) dilakukan
//                    SETELAH rantai `saldoSesudah` dihitung mundur dari `saldoSekarang`
//                    agar filter rentang Kustom masa lalu tetap menampilkan saldo historis akurat.
export function bangunMutasi(docs, { akunId, saldoSekarang = 0, kategoriById = {}, range = null } = {}) {
  const urut = (docs ?? []).filter((t) => termasukAkun(t, akunId)).slice()
  // Stable sort terbaru-dulu: tanggal 'YYYY-MM-DD' kronologis; dokumen dengan
  // tanggal sama mempertahankan urutan query (orderBy createdAt desc).
  urut.sort((a, b) => (a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : 0))

  let saldo = Number(saldoSekarang) || 0
  const semuaBaris = urut.map((t) => {
    const delta = deltaMutasi(t, akunId)
    const info = infoMutasi(t, akunId)
    const baris = {
      id: t.id,
      tanggal: t.tanggal ?? '',
      jenis: t.jenis,
      label: info.label,
      ikon: info.ikon,
      kelas: info.kelas,
      kategoriNama:
        t.kategoriId && kategoriById[t.kategoriId]
          ? kategoriById[t.kategoriId]
          : t.kategoriNama ?? (t.jenis === 'pindah saldo' ? 'Pindah Saldo' : '(tanpa kategori)'),
      catatan: t.catatan ?? '',
      // Timestamp Firestore (atau null saat offline) — dipakai UI untuk jam.
      createdAt: t.createdAt ?? null,
      delta,
      saldoSesudah: saldo,
    }
    saldo -= delta
    return baris
  })

  if (!range || (!range.start && !range.end)) return semuaBaris
  return semuaBaris.filter((b) => {
    if (range.start && b.tanggal < range.start) return false
    if (range.end && b.tanggal > range.end) return false
    return true
  })
}

// Ringkasan angka untuk header modal: berapa baris, total masuk, total keluar.
export function ringkasMutasi(baris) {
  let masuk = 0
  let keluar = 0
  for (const b of baris ?? []) {
    if (b.delta > 0) masuk += b.delta
    else keluar += -b.delta
  }
  return { jumlah: (baris ?? []).length, masuk, keluar }
}
