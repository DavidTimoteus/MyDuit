import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { getFirebase } from '../../lib/firebase.js'
import { IS_DEMO_UID, MOCK_AKUN, MOCK_BUDGET, MOCK_KATEGORI, MOCK_TRANSAKSI, MOCK_UTANG } from '../../lib/mockData.js'
import { formatNominal, uangAktif } from '../../lib/format.js'
import { ambilRasioKurs, bacaBasisMataUang, statusKurs } from '../../lib/kurs.js'

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

// Font standar jsPDF (helvetica) hanya mendukung WinAnsi, jadi simbol seperti
// ₫/₱/฿/₹ tidak terender. Untuk simbol di luar WinAnsi pakai kode mata uang.
const SIMBOL_WINANSI = /^[\x20-\x7E£¥€]+$/
function simbolPdf() {
  const { currency, symbol } = uangAktif()
  return SIMBOL_WINANSI.test(symbol) ? symbol : `${currency} `
}

const rp = (n) => `${simbolPdf()}${formatNominal(n)}`
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

// Palet laporan profesional (RGB untuk jsPDF).
// Sengaja netral: satu warna aksen + tinta gelap + abu redup. Laporan keuangan
// yang baik dibaca seperti dokumen, bukan poster — jadi hindari blok warna
// jenuh dan banyak aksen berbeda.
const C = {
  aksen: [54, 174, 124],      // hijau tua tenang untuk wordmark & judul section
  tinta: [24, 30, 38],      // teks utama
  redup: [112, 122, 134],   // label & teks sekunder
  garis: [219, 224, 230],   // garis pemisah tipis
  track: [232, 236, 240],   // rel batang data
  kepalaTabel: [243, 245, 247], // latar baris kepala tabel
  hijauTeks: [54, 174, 124],
  merah: [235, 83, 83],
  biru: [24, 116, 152],
  amber: [249, 217, 35],
  putih: [255, 255, 255],
}

function selisihHari(tglIso, tipe, terakhirBayar) {
  if (!tglIso) return null
  const tglRef = new Date(`${tglIso}T00:00:00`)
  if (Number.isNaN(tglRef.getTime())) return null
  const kini = new Date()
  kini.setHours(0, 0, 0, 0)

  if (tipe === 'Cicilan') {
    const hariTgl = tglRef.getDate()
    let targetYear = kini.getFullYear()
    let targetMonth = kini.getMonth()
    if (terakhirBayar) {
      const tglBayar = new Date(`${terakhirBayar}T00:00:00`)
      if (!Number.isNaN(tglBayar.getTime())) {
        const sudahBayarBulanIni =
          tglBayar.getFullYear() === kini.getFullYear() && tglBayar.getMonth() === kini.getMonth()
        if (sudahBayarBulanIni) {
          targetMonth = kini.getMonth() + 1
        } else {
          const nextAfterBayar = tglBayar.getFullYear() * 12 + tglBayar.getMonth() + 1
          const currentYm = kini.getFullYear() * 12 + kini.getMonth()
          if (nextAfterBayar < currentYm) {
            targetYear = Math.floor(nextAfterBayar / 12)
            targetMonth = nextAfterBayar % 12
          }
        }
      }
    } else {
      const refYm = tglRef.getFullYear() * 12 + tglRef.getMonth()
      const currentYm = kini.getFullYear() * 12 + kini.getMonth()
      if (refYm < currentYm) {
        targetYear = tglRef.getFullYear()
        targetMonth = tglRef.getMonth()
      }
    }
    const normYear = targetYear + Math.floor(targetMonth / 12)
    const normMonth = ((targetMonth % 12) + 12) % 12
    let target = new Date(normYear, normMonth, hariTgl)
    if (target.getMonth() !== normMonth) {
      target = new Date(normYear, normMonth + 1, 0)
    }
    return Math.round((target - kini) / 86400000)
  }

  return Math.round((tglRef - kini) / 86400000)
}

function tglSingkat(tglIso) {
  const d = new Date(`${tglIso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return tglIso ?? '—'
  return `${String(d.getDate()).padStart(2, '0')} ${BULAN[d.getMonth()].slice(0, 3)}`
}

export async function ambilDataLaporan(uid, bulan, tahun) {
  const start = iso(tahun, bulan, 1)
  const end = iso(tahun, bulan, new Date(tahun, bulan + 1, 0).getDate())

  let txRaw, akunRaw, katRaw, utangRaw, budgetRaw
  if (IS_DEMO_UID(uid)) {
    txRaw = MOCK_TRANSAKSI.filter((t) => !t.deleted && t.tanggal >= start && t.tanggal <= end)
    akunRaw = MOCK_AKUN.filter((a) => !a.deleted)
    katRaw = MOCK_KATEGORI.filter((k) => !k.deleted)
    utangRaw = MOCK_UTANG.filter((u) => !u.deleted)
    budgetRaw = MOCK_BUDGET.filter((b) => !b.deleted && b.bulan === bulan && b.tahun === tahun)
  } else {
    const { db } = getFirebase()
    const user = (nama) => collection(db, 'users', uid, nama)
    const [txSnap, akunSnap, katSnap, utangSnap, budgetSnap] = await Promise.all([
      getDocs(query(user('transaksi'), where('deleted', '==', false), where('tanggal', '>=', start), where('tanggal', '<=', end), orderBy('tanggal', 'desc'))),
      getDocs(query(user('akun'), where('deleted', '==', false))),
      getDocs(query(user('kategori'), where('deleted', '==', false))),
      getDocs(query(user('utang'), where('deleted', '==', false))),
      getDocs(query(user('budget'), where('deleted', '==', false), where('bulan', '==', bulan), where('tahun', '==', tahun))),
    ])
    txRaw = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    akunRaw = akunSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    katRaw = katSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    utangRaw = utangSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    budgetRaw = budgetSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  }

  const akun = Object.fromEntries(akunRaw.map((d) => [d.id, d]))
  const kategori = Object.fromEntries(katRaw.map((d) => [d.id, d]))
  const transaksi = txRaw
    .map((t) => {
      const namaAkun = t.jenis === 'pindah saldo'
        ? `${akun[t.dariId]?.nama ?? akun[t.akunId]?.nama ?? '—'} > ${akun[t.keId]?.nama ?? '—'}`
        : akun[t.akunId]?.nama || t.akunNama || '—'
      return {
        ...t,
        jumlah: Number(t.jumlah) || 0,
        kategoriNama: t.jenis === 'pindah saldo' ? 'Pindah Saldo' : kategori[t.kategoriId]?.nama || t.kategoriNama || 'Lainnya',
        akunNama: namaAkun,
      }
    })
    .sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)))
  const budgets = budgetRaw
  const utangSemua = utangRaw
  let pemasukan = 0, pengeluaran = 0
  const kategoriIn = {}, kategoriOut = {}, terpakaiPerKatId = {}
  for (const t of transaksi) {
    const jml = Number(t.jumlah) || 0
    if (t.jenis === 'pemasukan') {
      pemasukan += jml
      kategoriIn[t.kategoriNama] = (kategoriIn[t.kategoriNama] || 0) + jml
    } else if (t.jenis === 'pengeluaran') {
      pengeluaran += jml
      kategoriOut[t.kategoriNama] = (kategoriOut[t.kategoriNama] || 0) + jml
      if (t.kategoriId) terpakaiPerKatId[t.kategoriId] = (terpakaiPerKatId[t.kategoriId] || 0) + jml
    }
  }
  const topIn = Object.entries(kategoriIn).sort((a, b) => b[1] - a[1])
  const topOut = Object.entries(kategoriOut).sort((a, b) => b[1] - a[1])

  const utangAktif = utangSemua
    .filter((u) => String(u.status || '').trim().toLowerCase() !== 'lunas' && (Number(u.sisa) || 0) > 0)
    .map((u) => ({ ...u, hari: selisihHari(u.tglJatuhTempo, u.tipe, u.terakhirBayar) }))
  const totalUtangAktif = utangAktif.reduce((s, u) => s + Math.max(0, Number(u.sisa) || 0), 0)
  const cicilanPerBulan = utangAktif.reduce((s, u) => s + Math.max(0, Number(u.cicilanPerBulan) || 0), 0)
  const perluPerhatian = utangAktif.filter((u) => u.hari !== null && u.hari <= 14).sort((a, b) => a.hari - b.hari)

  // Anggaran vs realisasi: cocokkan per `kategoriId` agar 100% sinkron dengan BudgetView.jsx
  // (mencegah transaksi kategori terhapus/kosong ikut menagih budget 'Lainnya').
  const seenKat = new Set()
  const anggaran = budgets
    .filter((b) => {
      const k = b.kategoriId || b.id
      if (seenKat.has(k)) return false
      seenKat.add(k)
      return true
    })
    .map((b) => {
      const nama = kategori[b.kategoriId]?.nama || b.kategoriNama || 'Tanpa kategori'
      const limit = Math.max(0, Number(b.limitNominal) || 0)
      const terpakai = b.kategoriId ? (terpakaiPerKatId[b.kategoriId] || 0) : (kategoriOut[nama] || 0)
      const persen = limit > 0 ? Math.round((terpakai / limit) * 100) : (terpakai > 0 ? 100 : 0)
      return { nama, limit, terpakai, persen, sisa: limit - terpakai, lewat: terpakai > limit }
    })
    .sort((a, b) => b.persen - a.persen)

  return {
    bulan, tahun, label: `${BULAN[bulan]} ${tahun}`,
    transaksi, akun, kategori, budgets, anggaran,
    pemasukan, pengeluaran, saldo: pemasukan - pengeluaran,
    totalSaldo: Object.values(akun).reduce((s, a) => s + (Number(a.saldo) || 0), 0),
    totalBudget: budgets.reduce((s, b) => s + (Number(b.limitNominal) || 0), 0),
    topIn, topOut,
    utang: {
      aktif: utangAktif,
      totalAktif: totalUtangAktif,
      cicilanPerBulan,
      perluPerhatian,
      terlambat: perluPerhatian.filter((u) => u.hari < 0),
      mendekati: perluPerhatian.filter((u) => u.hari >= 0),
    },
  }
}

function labelJatuhTempo(hari) {
  if (hari === null) return 'Tanpa jatuh tempo'
  if (hari < 0) return `Terlambat ${Math.abs(hari)} hari`
  if (hari === 0) return 'Jatuh tempo hari ini'
  return `H-${hari}`
}

// ===== Helper gambar =====
function bulatIsi(doc, x, y, w, h, r, warna) {
  doc.setFillColor(...warna)
  doc.roundedRect(x, y, w, h, r, r, 'F')
}

function teks(doc, str, x, y, { size = 9, warna = C.tinta, bold = false, align = 'left', spasi = null } = {}) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal')
  doc.setFontSize(size)
  doc.setTextColor(...warna)
  if (spasi != null && doc.setCharSpace) doc.setCharSpace(spasi)
  doc.text(String(str), x, y, { align })
  if (spasi != null && doc.setCharSpace) doc.setCharSpace(0)
}

/** Garis horizontal tipis pemisah section. */
function garis(doc, x1, y, x2, warna = C.garis, lebar = 0.25) {
  doc.setDrawColor(...warna)
  doc.setLineWidth(lebar)
  doc.line(x1, y, x2, y)
}

/** Judul section: huruf kapital berspasi + garis bawah tipis. */
function judulSection(doc, str, x, y, lebar, { kanan = '' } = {}) {
  teks(doc, str.toUpperCase(), x, y, { size: 8, bold: true, warna: C.aksen, spasi: 0.3 })
  if (kanan) teks(doc, kanan, x + lebar, y, { size: 8, warna: C.redup, align: 'right' })
  garis(doc, x, y + 2, x + lebar, C.garis)
  return y + 7
}

/**
 * Bangun PDF laporan memakai jsPDF + AutoTable.
 * Gaya: laporan keuangan profesional — header minimalis (wordmark + judul +
 * garis), palet netral dengan satu warna aksen, tabel garis tipis, angka rata
 * kanan. Menghindari blok warna jenuh & ornamen yang membuatnya terlihat
 * seperti template, bukan dokumen.
 */
export async function buatPdfLaporan(data, pakaiAI, nama = 'Pengguna') {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = autoTableMod.default ?? autoTableMod.autoTable

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 16
  const lebar = W - M * 2
  const tanggalCetak = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long' }).format(new Date())
  let y = M

  // ================= KOP (minimalis) =================
  // Wordmark kecil + garis aksen tipis di atas. Tanpa blok warna penuh.
  teks(doc, 'MyDuit', M, y + 4, { size: 12, bold: true, warna: C.aksen })
  teks(doc, 'Catatan Keuangan Pribadi', M + 19, y + 4, { size: 8, warna: C.redup })
  teks(doc, nama, W - M, y + 3, { size: 9, bold: true, warna: C.tinta, align: 'right' })
  teks(doc, `Dicetak ${tanggalCetak}`, W - M, y + 7, { size: 7.5, warna: C.redup, align: 'right' })
  y += 9
  garis(doc, M, y, W - M, C.aksen, 0.8)
  y += 11

  // Judul dokumen
  teks(doc, 'Laporan Keuangan Bulanan', M, y, { size: 16, bold: true, warna: C.tinta })
  y += 6.5
  const { currency } = uangAktif()
  const basis = bacaBasisMataUang()
  if (basis && basis !== currency) {
    const kursInfo = statusKurs()
    const perUnit = ambilRasioKurs(currency, basis)
    const labelKurs = perUnit >= 1
      ? `1 ${currency} = ${perUnit.toLocaleString('id-ID', { maximumFractionDigits: 2 })} ${basis}`
      : `1 ${basis} = ${ambilRasioKurs(basis, currency).toLocaleString('en-US', { maximumFractionDigits: 4 })} ${currency}`
    teks(
      doc,
      `Periode ${data.label} · Mata uang ${currency} (${labelKurs}, ${kursInfo.isFallback ? 'kurs cadangan' : kursInfo.source})`,
      M,
      y,
      { size: 9, warna: C.redup },
    )
  } else {
    teks(doc, `Periode ${data.label}`, M, y, { size: 10.5, warna: C.redup })
  }
  y += 11

  // ================= RINGKASAN (3 metrik, tanpa kotak warna) =================
  const gap = 6
  const wMetrik = (lebar - gap * 2) / 3
  const metrik = [
    ['Pemasukan', rp(data.pemasukan), C.hijauTeks],
    ['Pengeluaran', rp(data.pengeluaran), C.merah],
    ['Saldo Bersih', rp(data.saldo), data.saldo >= 0 ? C.hijauTeks : C.merah],
  ]
  metrik.forEach(([label, nilai, warna], i) => {
    const x = M + i * (wMetrik + gap)
    if (i > 0) {
      doc.setDrawColor(...C.garis)
      doc.setLineWidth(0.25)
      doc.line(x - gap / 2, y - 2, x - gap / 2, y + 12)
    }
    teks(doc, label.toUpperCase(), x, y, { size: 7.5, bold: true, warna: C.redup, spasi: 0.2 })
    teks(doc, nilai, x, y + 8, { size: 13, bold: true, warna })
  })
  y += 16
  garis(doc, M, y, W - M, C.garis)
  y += 6
  // Total kekayaan (data yang sebelumnya dihitung tapi tak pernah ditampilkan)
  teks(doc, 'Total saldo seluruh rekening', M, y, { size: 8.5, warna: C.redup })
  teks(doc, rp(data.totalSaldo), W - M, y, { size: 9, bold: true, warna: C.tinta, align: 'right' })
  y += 12

  // ================= RINGKASAN UTANG =================
  const u = data.utang
  y = judulSection(doc, 'Kewajiban', M, y, lebar, { kanan: `${u.aktif.length} utang aktif` })

  const hUtang = 14
  // Total utang aktif (satu angka besar, bukan blok merah penuh)
  teks(doc, 'TOTAL UTANG AKTIF', M, y, { size: 7.5, bold: true, warna: C.redup, spasi: 0.2 })
  teks(doc, rp(u.totalAktif), M, y + 7, { size: 13, bold: true, warna: C.merah })
  teks(doc, `Cicilan rutin ${rp(u.cicilanPerBulan)} / bulan`, M, y + 11.5, { size: 8, warna: C.redup })

  // Dua metrik kanan
  const xKan = M + lebar * 0.52
  teks(doc, 'TERLAMBAT', xKan, y, { size: 7.5, bold: true, warna: C.redup, spasi: 0.2 })
  teks(doc, String(u.terlambat.length), xKan, y + 7, { size: 13, bold: true, warna: u.terlambat.length ? C.merah : C.tinta })
  teks(doc, 'MENDEKATI (H-14)', xKan + lebar * 0.24, y, { size: 7.5, bold: true, warna: C.redup, spasi: 0.2 })
  teks(doc, String(u.mendekati.length), xKan + lebar * 0.24, y + 7, { size: 13, bold: true, warna: u.mendekati.length ? C.amber : C.tinta })
  y += hUtang + 3
  garis(doc, M, y, W - M, C.garis)
  y += 6

  // Tabel utang perlu perhatian
  const daftarUtang = u.perluPerhatian.slice(0, 6)
  if (daftarUtang.length) {
    autoTable(doc, {
      startY: y,
      head: [['Pihak', 'Jatuh Tempo', 'Sisa']],
      body: daftarUtang.map((x) => [String(x.namaPihak ?? '—'), labelJatuhTempo(x.hari), rp(x.sisa)]),
      margin: { left: M, right: M, bottom: 20 },
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 1.8, right: 2, bottom: 1.8, left: 0 }, textColor: C.tinta, lineColor: C.garis, lineWidth: { top: 0, bottom: 0.1, left: 0, right: 0 } },
      headStyles: { fontStyle: 'bold', fontSize: 8, textColor: C.redup, fillColor: false },
      columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 45 }, 2: { cellWidth: 32, halign: 'right', fontStyle: 'bold' } },
      didParseCell: (hook) => {
        if (hook.section === 'body' && hook.column.index === 1) {
          const t = String(hook.cell.raw)
          if (t.startsWith('Terlambat') || t.includes('hari ini')) hook.cell.styles.textColor = C.merah
        }
      },
    })
    y = doc.lastAutoTable.finalY + 4
  } else {
    teks(doc, 'Tidak ada kewajiban dalam 14 hari ke depan.', M, y, { size: 8.5, warna: C.redup })
    y += 8
  }
  y += 6

  // ================= ARUS PER KATEGORI =================
  const Hhal = doc.internal.pageSize.getHeight()
  const tinggiKat = 12 + Math.max(1, Math.max(data.topIn.length, data.topOut.length)) * 7.2
  if (y + tinggiKat + 12 > Hhal - 20) {
    doc.addPage()
    y = M
  }
  y = judulSection(doc, 'Arus per Kategori', M, y, lebar, { kanan: `${data.topIn.length + data.topOut.length} kategori` })

  const kolomKat = (lebar - 8) / 2
  const dataKat = [
    { judul: 'Pemasukan', items: data.topIn.slice(0, 7), warna: C.hijauTeks, kosong: 'Belum ada pemasukan.' },
    { judul: 'Pengeluaran', items: data.topOut.slice(0, 7), warna: C.merah, kosong: 'Belum ada pengeluaran.' },
  ]
  dataKat.forEach((kol, i) => {
    const x = M + i * (kolomKat + 8)
    teks(doc, kol.judul, x, y, { size: 8, bold: true, warna: C.tinta })
    let ky = y + 4.5
    if (!kol.items.length) {
      teks(doc, kol.kosong, x, ky + 3, { size: 8, warna: C.redup })
      return
    }
    const maks = Math.max(1, ...kol.items.map(([, n]) => Number(n) || 0))
    kol.items.forEach(([namaKat, total]) => {
      teks(doc, String(namaKat).slice(0, 24), x, ky + 2.6, { size: 8.2 })
      teks(doc, rp(total), x + kolomKat, ky + 2.6, { size: 8.2, warna: C.tinta, align: 'right' })
      const wTrack = kolomKat
      bulatIsi(doc, x, ky + 4, wTrack, 1.1, 0.55, C.track)
      bulatIsi(doc, x, ky + 4, Math.max(1.1, (total / maks) * wTrack), 1.1, 0.55, kol.warna)
      ky += 6.5
    })
  })
  y += tinggiKat + 6

  // ================= ANGGARAN VS REALISASI =================
  if (data.anggaran?.length) {
    if (y + 12 + data.anggaran.length * 8 > H - 22) {
      doc.addPage()
      y = M
    }
    const lewat = data.anggaran.filter((a) => a.lewat).length
    y = judulSection(doc, 'Anggaran vs Realisasi', M, y, lebar, {
      kanan: lewat ? `${lewat} kategori melebihi` : `${data.anggaran.length} anggaran terkendali`,
    })
    autoTable(doc, {
      startY: y,
      head: [['Kategori', 'Terpakai', 'Limit', 'Capaian']],
      body: data.anggaran.map((a) => [String(a.nama).slice(0, 26), rp(a.terpakai), rp(a.limit), a.lewat ? `+${a.persen - 100}%` : `${a.persen}%`]),
      margin: { left: M, right: M, bottom: 20 },
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 1.8, right: 2, bottom: 1.8, left: 0 }, textColor: C.tinta, lineColor: C.garis, lineWidth: { top: 0, bottom: 0.1, left: 0, right: 0 } },
      headStyles: { fontStyle: 'bold', fontSize: 8, textColor: C.redup, fillColor: false },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 34, halign: 'right' },
        2: { cellWidth: 34, halign: 'right' },
        3: { cellWidth: 24, halign: 'right', fontStyle: 'bold' },
      },
      didParseCell: (hook) => {
        if (hook.section === 'body' && hook.column.index === 3) {
          hook.cell.styles.textColor = String(hook.cell.raw).startsWith('+') ? C.merah : C.hijauTeks
        }
      },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // ================= RINCIAN TRANSAKSI =================
  if (y + 20 > H - 22) {
    doc.addPage()
    y = M
  }
  y = judulSection(doc, 'Rincian Transaksi', M, y, lebar, { kanan: `${data.transaksi.length} transaksi · ${data.label}` })

  const body = data.transaksi.map((t) => {
    const pindah = t.jenis === 'pindah saldo'
    const tanda = t.jenis === 'pemasukan' ? '+' : t.jenis === 'pengeluaran' ? '-' : ''
    const label = pindah ? 'Pindah Saldo' : t.jenis === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran'
    return [tglSingkat(t.tanggal), label, t.kategoriNama, t.catatan || '—', t.akunNama, `${tanda}${rp(t.jumlah)}`]
  })

  autoTable(doc, {
    startY: y,
    head: [['Tanggal', 'Jenis', 'Kategori', 'Keterangan', 'Akun', 'Nominal']],
    body: body.length ? body : [['—', '—', '—', 'Belum ada transaksi pada periode ini.', '—', '—']],
    margin: { left: M, right: M, top: M, bottom: 20 },
    theme: 'plain',
    styles: {
      font: 'helvetica',
      // 7.8pt terlalu kecil untuk laporan cetak: batas baca yang nyaman
      // untuk teks Continuity 9pt. 8.6pt masih muat 6 kolom pada A4 dengan
      // margin 16mm (lebar kolom paling rapat "Tanggal" tetap muat "20 Okt").
      fontSize: 8.6,
      cellPadding: { top: 2.3, right: 2, bottom: 2.3, left: 0 },
      textColor: C.tinta,
      lineColor: C.garis,
      lineWidth: { top: 0, bottom: 0.1, left: 0, right: 0 },
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: { fillColor: C.kepalaTabel, textColor: C.tinta, fontStyle: 'bold', fontSize: 7.8, cellPadding: { top: 2.5, bottom: 2.5, left: 0, right: 2 } },
    columnStyles: {
      0: { cellWidth: 17 },
      1: { cellWidth: 21 },
      2: { cellWidth: 28 },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 28 },
      5: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (hook) => {
      if (hook.section !== 'body') return
      const jenis = String(hook.row.raw?.[1] ?? '')
      if (hook.column.index === 5) {
        if (jenis === 'Pemasukan') hook.cell.styles.textColor = C.hijauTeks
        else if (jenis === 'Pengeluaran') hook.cell.styles.textColor = C.merah
        else if (jenis === 'Pindah Saldo') hook.cell.styles.textColor = C.biru
      }
    },
  })
  y = doc.lastAutoTable.finalY + 10

  // ================= CATATAN =================
  if (pakaiAI) {
    const rasio = data.pemasukan > 0 ? Math.round((data.saldo / data.pemasukan) * 100) : 0
    const catatan = [
      `Rasio tabungan periode ini ${rasio}%.`,
      data.topOut[0] ? `Pengeluaran terbesar: ${data.topOut[0][0]} (${rp(data.topOut[0][1])}).` : 'Belum cukup data pengeluaran.',
      u.totalAktif > 0 ? `Sisa utang aktif ${rp(u.totalAktif)} diperhitungkan dalam prioritas dana.` : 'Tidak ada kewajiban utang aktif.',
    ]
    const pecahan = catatan.map((c) => doc.splitTextToSize(`• ${c}`, lebar - 2))
    const tinggi = 12 + pecahan.reduce((s, p) => s + p.length * 4.2, 0)
    if (y + tinggi > H - 22) {
      doc.addPage()
      y = M
    }
    y = judulSection(doc, 'Catatan & Analisis', M, y, lebar)
    let cy = y
    pecahan.forEach((p) => {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(...C.tinta)
      doc.text(p, M, cy)
      cy += p.length * 4.2 + 1.5
    })
    teks(doc, 'Catatan & analisis ini dihasilkan otomatis dari data periode, bukan nasihat keuangan.', M, cy + 1, { size: 7.5, warna: C.redup })
  }

  // ================= FOOTER TIAP HALAMAN =================
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    garis(doc, M, H - 14, W - M, C.garis)
    teks(doc, 'MyDuit — dokumen pribadi dan rahasia', M, H - 9.5, { size: 7.5, warna: C.redup })
    teks(doc, `Halaman ${i} dari ${total}`, W - M, H - 9.5, { size: 7.5, warna: C.redup, align: 'right' })
  }

  return doc
}

export async function unduhLaporanPdf(data, pakaiAI, nama) {
  const doc = await buatPdfLaporan(data, pakaiAI, nama)
  doc.save(`Laporan-MyDuit-${data.label.replace(/\s+/g, '-')}.pdf`)
}
