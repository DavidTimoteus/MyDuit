// ============================================================================
// ANALITIK KEUANGAN DETERMINISTIK (pengganti "Rekomendasi AI")
// ----------------------------------------------------------------------------
// Kenapa diganti: kartu "Rekomendasi AI" lama adalah placeholder mati. Double
// click hanya memicu alert "akan segera diaktifkan". Tidak ada panggilan API,
// tidak ada model, tidak ada output. Label "AI" cuma ilusi; yang benar-benar
// dibutuhkan user adalah angka nyata yang SUDAH dihitung di view ini tapi
// tidak pernah ditampilkan.
//
// Prinsip penggantinya (skill myduit: "data yang DIHITUNG tapi tidak dirender
// = fitur hilang"): pakai angka yang sudah ada, aturan murni dan deterministik,
// tanpa jaringan, tanpa kunci API, tanpa kondisi acak. Hasilnya bisa
// diverifikasi user (kenapa? aturan jelas) dan bisa diuji dengan assert,
// sesuatu yang tidak bisa dijanjikan LLM.
// ============================================================================
import { parseTanggalIsoAman } from '../../lib/format.js'

// Hitung persen perubahan periode dengan penyebut absolut agar perbaikan
// dari nilai negatif (mis. saldo -1jt -> +500rb) tampil positif (+150%), bukan terbalik.
export function hitungPersenPerubahan(baru, lama, ada = true) {
  if (!ada) return null
  const b = Number(baru) || 0
  const l = Number(lama) || 0
  if (l === 0) return b === 0 ? 0 : null
  return Math.round(((b - l) / Math.abs(l)) * 100)
}

export function aturanAnalitik({ mode, ringkas, tren, jumlahHariBulan, bulan, tahun }) {
  const saran = []
  const periode =
    mode === 'bulanan'
      ? `Bulan ${new Date(tahun, bulan, 1).toLocaleDateString('id-ID', { month: 'long' })} ${tahun}`
      : `Tahun ${tahun}`

  const R = (level, judul, detail) => saran.push({ level, judul, detail })
  const rp = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString('id-ID')}`

  // 1) Saldo minus / impas
  if (ringkas.saldo < 0) {
    const top = ringkas.pengeluaran[0]?.nama
    R(
      'kritis',
      `Saldo ${periode} minus ${rp(Math.abs(ringkas.saldo))}`,
      `Pengeluaran melampaui pemasukan. ${top ? `Kategori "${top}" adalah penyumbang terbesar, mulai dari situ.` : 'Mulai dari memangkas pengeluaran terbesar.'}`,
    )
  } else if (ringkas.saldo === 0 && ringkas.out > 0) {
    R('info', `Impas, pengeluaran sama dengan pemasukan (${periode})`,
      'Tidak ada sisa untuk ditabung. Kurangi pengeluaran variabel sedikit saja sudah berarti.')
  }

  // 2) Rasio tabungan. Ini metrik yang paling sering dicari dan selama ini
  //    tidak pernah ditampilkan di halaman mana pun.
  if (ringkas.in_ > 0) {
    const rasio = Math.round((ringkas.saldo / ringkas.in_) * 100)
    if (rasio < 10) {
      R('peringatan', `Rasio tabungan ${rasio}%, di bawah standar`,
        `Rentang yang umum ditonton 20 sampai 30%. Perlu naik sekitar ${Math.max(1, 20 - rasio)} poin lagi.`)
    } else if (rasio >= 30) {
      R('bagus', `Rasio tabungan ${rasio}%, sangat kuat`,
        'Sisa dana cukup besar. Pertimbangkan memindahkannya ke aset berisiko untuk melawan inflasi.')
    } else {
      R('bagus', `Rasio tabungan ${rasio}%, sehat`,
        'Cukup stabil untuk menutup pengeluaran tak terduga. Pertahankan.')
    }
  }

  // 3) Pengeluaran dibanding periode sebelumnya
  if (tren.ada && tren.out > 0) {
    const delta = Math.round(((ringkas.out - tren.out) / tren.out) * 100)
    if (delta >= 25) {
      R('peringatan', `Pengeluaran naik ${delta}% dari periode sebelumnya`,
        `${rp(ringkas.out)} sekarang, sebelumnya ${rp(tren.out)}. Kenaikan segitu perlu ditinjau polanya.`)
    } else if (delta <= -20) {
      R('bagus', `Pengeluaran turun ${Math.abs(delta)}% dari periode sebelumnya`,
        'Hemat berhasil. Coba cari penyebabnya dan jadikan kebiasaan.')
    }
  }

  // 4) Kategori yang menyerap porsi besar
  if (ringkas.out > 0 && ringkas.pengeluaran[0]) {
    const [top] = ringkas.pengeluaran
    const porsi = Math.round((top.total / ringkas.out) * 100)
    if (porsi >= 40) {
      R('peringatan', `Kategori "${top.nama}" menyerap ${porsi}% pengeluaran`,
        `${rp(top.total)} dari total ${rp(ringkas.out)}. Memangkas separuh kategori ini saja sudah berdampak nyata.`)
    } else if (porsi >= 25) {
      R('info', `Kategori "${top.nama}" = ${porsi}% pengeluaran`,
        'Kategori dominan, wajar untuk dipantau tapi belum menjadi masalah.')
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
      `Proyeksi akhir bulan ${rp(proyeksi)}`,
      `Laju saat ini ${rp(ringkas.out / hariBerjalan)} per hari selama ${hariBerjalan} hari` +
        (sisaHari > 0
          ? `. Agar tidak lebih, sisa ${sisaHari} hari harus dibatasi maksimal ${rp(sisaRupiah)}.`
          : '.'),
    )
  }

  // 6) Hari paling boros, dari data nyata bukan tebakan
  const perHari = Object.entries(ringkas.harian || {}).filter(([, v]) => v.out > 0)
  if (perHari.length >= 3) {
    const puncak = perHari.reduce((a, b) => (b[1].out > a[1].out ? b : a))
    const tglPuncak = parseTanggalIsoAman(puncak[0])
    if (tglPuncak) {
      const namaHari = new Intl.DateTimeFormat('id-ID', { weekday: 'long' }).format(tglPuncak)
      R('info', `Puncak pengeluaran di hari ${namaHari}`,
        `${rp(puncak[1].out)} tercatat hari itu. Kalau bisa ditahan sekali seminggu, hemat sekitar ${rp(puncak[1].out / 4)} sebulan.`)
    }
  }

  // 7) Pengeluaran harian versus pemasukan
  if (mode === 'bulanan' && ringkas.in_ > 0 && ringkas.out > 0) {
    const hariAktif = Object.keys(ringkas.harian || {}).length
    if (hariAktif > 0) {
      const outHarian = Math.round(ringkas.out / hariAktif)
      const proyeksiBulan = outHarian * 30
      if (proyeksiBulan > ringkas.in_) {
        R('kritis', 'Pengeluaran harian akan melampaui pemasukan bulanan',
          `${rp(outHarian)} per hari. Perlu dipangkas sekitar ${rp((proyeksiBulan - ringkas.in_) / 30)} per hari agar impas.`)
      }
    }
  }

  // 8) Fallback supaya kartu tidak pernah kosong
  if (!saran.length) {
    R('info', ringkas.jmlTransaksi ? 'Tidak ada pola yang perlu ditindak' : `Belum ada transaksi pada ${periode}`,
      ringkas.jmlTransaksi
        ? 'Pengeluaran terkendali, tidak ada anomali yang perlu tindakan.'
        : 'Catat beberapa transaksi dulu supaya polanya bisa dianalisis.')
  }

  return saran
}

