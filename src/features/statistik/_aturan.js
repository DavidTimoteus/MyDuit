// ============================================================================
// ANALITIK KEUANGAN DETERMINISTIK (pengganti "Rekomendasi AI")
// ----------------------------------------------------------------------------
// Kenapa diganti: kartu "Rekomendasi AI" lama adalah placeholder mati. Double
// click hanya memicu alert "akan segera diaktifkan". Tidak ada panggilan API,
// tidak ada model, tidak ada output. Yang dibutuhkan user adalah angka nyata
// yang SUDAH dihitung di view ini.
//
// Semua teks lewat kamus i18n (argument `tr`) supaya kartu "Analisis Keuangan"
// mengikuti bahasa aplikasi. Angka dan aturan tetap deterministik: input sama
// selalu menghasilkan saran yang sama, hanya bahasanya yang berubah.
// ============================================================================
import { parseTanggalIsoAman, tanggalTampil } from '../../lib/format.js'

// Hitung persen perubahan periode dengan penyebut absolut agar perbaikan
// dari nilai negatif (mis. saldo -1jt -> +500rb) tampil positif (+150%).
export function hitungPersenPerubahan(baru, lama, ada = true) {
  if (!ada) return null
  const b = Number(baru) || 0
  const l = Number(lama) || 0
  if (l === 0) return b === 0 ? 0 : null
  return Math.round(((b - l) / Math.abs(l)) * 100)
}

export function aturanAnalitik({ mode, ringkas, tren, jumlahHariBulan, bulan, tahun, tr = (k) => k }) {
  const saran = []
  const periode =
    mode === 'bulanan'
      ? tr('analisis_periode_bulan', {
          bulan: new Date(tahun, bulan, 1).toLocaleDateString('id-ID', { month: 'long' }),
          tahun,
        })
      : tr('analisis_periode_tahun', { tahun })

  const R = (level, judul, detail) => saran.push({ level, judul, detail })
  const rp = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString('id-ID')}`

  // 1) Saldo minus / impas
  if (ringkas.saldo < 0) {
    const top = ringkas.pengeluaran[0]?.nama
    R(
      'kritis',
      tr('analisis_saldo_minus', { periode, nominal: rp(Math.abs(ringkas.saldo)) }),
      top
        ? tr('analisis_saldo_minus_top', { kategori: top })
        : tr('analisis_saldo_minus_detail'),
    )
  } else if (ringkas.saldo === 0 && ringkas.out > 0) {
    R(
      'info',
      tr('analisis_impas', { periode }),
      tr('analisis_impas_detail'),
    )
  }

  // 2) Rasio tabungan
  if (ringkas.in_ > 0) {
    const rasio = Math.round((ringkas.saldo / ringkas.in_) * 100)
    if (rasio < 10) {
      R('peringatan', tr('analisis_rasio_rendah', { rasio }),
        tr('analisis_rasio_rendah_detail', { poin: Math.max(1, 20 - rasio) }))
    } else if (rasio >= 30) {
      R('bagus', tr('analisis_rasio_kuat', { rasio }), tr('analisis_rasio_kuat_detail'))
    } else {
      R('bagus', tr('analisis_rasio_sehat', { rasio }), tr('analisis_rasio_sehat_detail'))
    }
  }

  // 3) Pengeluaran dibanding periode sebelumnya
  if (tren.ada && tren.out > 0) {
    const delta = Math.round(((ringkas.out - tren.out) / tren.out) * 100)
    if (delta >= 25) {
      R('peringatan', tr('analisis_pengeluaran_naik', { delta }),
        tr('analisis_pengeluaran_naik_detail', { sekarang: rp(ringkas.out), sebelumnya: rp(tren.out) }))
    } else if (delta <= -20) {
      R('bagus', tr('analisis_pengeluaran_turun', { delta: Math.abs(delta) }),
        tr('analisis_pengeluaran_turun_detail'))
    }
  }

  // 4) Kategori yang menyerap porsi besar
  if (ringkas.out > 0 && ringkas.pengeluaran[0]) {
    const [top] = ringkas.pengeluaran
    const porsi = Math.round((top.total / ringkas.out) * 100)
    if (porsi >= 40) {
      R('peringatan', tr('analisis_kategori_besar', { kategori: top.nama, porsi }),
        tr('analisis_kategori_besar_detail', { nominal: rp(top.total), total: rp(ringkas.out) }))
    } else if (porsi >= 25) {
      R('info', tr('analisis_kategori_moderat', { kategori: top.nama, porsi }),
        tr('analisis_kategori_moderat_detail'))
    }
  }

  // 5) Proyeksi akhir bulan dari laju boros saat ini (khusus bulan berjalan)
  const kini = new Date()
  const isBulanBerjalan = kini.getFullYear() === tahun && kini.getMonth() === bulan
  if (mode === 'bulanan' && isBulanBerjalan && jumlahHariBulan > 0 && ringkas.out > 0) {
    const hariBerjalan = Math.max(1, Math.min(kini.getDate(), jumlahHariBulan))
    const proyeksi = Math.round((ringkas.out / hariBerjalan) * jumlahHariBulan)
    const sisaHari = jumlahHariBulan - hariBerjalan
    const sisaRupiah = proyeksi - ringkas.out
    const sudahLewat = hariBerjalan / jumlahHariBulan > 0.5
    R(
      sudahLewat ? 'kritis' : 'info',
      tr('analisis_proyeksi', { nominal: rp(proyeksi) }),
      tr('analisis_proyeksi_detail', { laju: rp(ringkas.out / hariBerjalan), hari: hariBerjalan }) +
        (sisaHari > 0
          ? tr('analisis_proyeksi_sisa', { sisa: sisaHari, nominal: rp(sisaRupiah) })
          : '.'),
    )
  }

  // 6) Hari paling boros, dari data nyata bukan tebakan
  const perHari = Object.entries(ringkas.harian || {}).filter(([, v]) => v.out > 0)
  if (perHari.length >= 3) {
    const puncak = perHari.reduce((a, b) => (b[1].out > a[1].out ? b : a))
    const tglPuncak = parseTanggalIsoAman(puncak[0])
    if (tglPuncak) {
      const tglLabel = tanggalTampil(puncak[0])
      R('info', tr('analisis_puncak', { tanggal: tglLabel }),
        tr('analisis_puncak_detail', { nominal: rp(puncak[1].out), hemat: rp(puncak[1].out / 4) }))
    }
  }

  // 7) Pengeluaran harian versus pemasukan
  if (mode === 'bulanan' && ringkas.in_ > 0 && ringkas.out > 0) {
    const hariAktif = Object.keys(ringkas.harian || {}).length
    if (hariAktif > 0) {
      const outHarian = Math.round(ringkas.out / hariAktif)
      const proyeksiBulan = outHarian * 30
      if (proyeksiBulan > ringkas.in_) {
        R('kritis', tr('analisis_harian_tinggi'),
          tr('analisis_harian_tinggi_detail', {
            nominal: rp(outHarian),
            pangkas: rp((proyeksiBulan - ringkas.in_) / 30),
          }))
      }
    }
  }

  // 8) Fallback supaya kartu tidak pernah kosong
  if (!saran.length) {
    R(
      'info',
      ringkas.jmlTransaksi ? tr('analisis_tanpa_pola') : tr('analisis_belum_transaksi', { periode }),
      ringkas.jmlTransaksi ? tr('analisis_tanpa_pola_detail') : tr('analisis_belum_transaksi_detail'),
    )
  }

  return saran
}
