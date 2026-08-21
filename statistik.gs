/*******************************************************
 * MyDuit — statistik.gs
 * Domain: Statistik & analisis (query dari skema baru 7 tabel)
 * 
 * Kompatibel dengan ViewJS.html:
 * - getStatistikPeriodeServer(mode, bulan, tahun)
 * - getStatistikBulananServer(bulan, tahun)
 * - getStatistik3BulanServer()
 * - getTren12BulanServer()
 * - getAnalisisKategoriServer()
 * - getStatistikServer()
 *******************************************************/

const BULAN_NAMA = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const NAMA_BULAN_PENDEK_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function getStatistikBulananServer(bulan, tahun) {
  const items = getSemuaTransaksiBulanServer(bulan, tahun);
  let pemasukan = 0, pengeluaran = 0;
  const kategoriData = {};

  items.forEach(function (it) {
    if (it.jenis.toLowerCase() === 'pemasukan') {
      pemasukan += it.nominal;
    } else if (it.jenis.toLowerCase() === 'pengeluaran') {
      pengeluaran += it.nominal;
      kategoriData[it.kategori] = (kategoriData[it.kategori] || 0) + it.nominal;
    }
  });

  return {
    pemasukan: pemasukan,
    pengeluaran: pengeluaran,
    saldo: pemasukan - pengeluaran,
    kategori: kategoriData
  };
}

function getSemuaTransaksiBulanServer(bulan, tahun) {
  const sheet = getTransaksiSheet_();
  const data = getRawTransaksiCached_(sheet);
  const timeZone = sheet.getParent().getSpreadsheetTimeZone();
  const list = [];

  data.forEach(function (row) {
    if (!row[0]) return;
    const tgl = parseSheetDate(row[1]);
    if (!tgl) return;
    if (tgl.getMonth() !== bulan || tgl.getFullYear() !== tahun) return;

    list.push({
      id: String(row[0]),
      tanggalRaw: Utilities.formatDate(tgl, timeZone, 'yyyy-MM-dd'),
      tanggal: Utilities.formatDate(tgl, timeZone, 'dd/MM/yyyy'),
      jenis: String(row[2] || ''),
      kategori: getKategoriTampilFromStored_(row[3]),
      sumber: getAkunTampilFromStored_(row[4]),
      keterangan: String(row[7] || ''),
      nominal: Number(row[8]) || 0
    });
  });

  return list;
}

function getSemuaTransaksiTahunServer(tahun) {
  const sheet = getTransaksiSheet_();
  const data = getRawTransaksiCached_(sheet);
  const timeZone = sheet.getParent().getSpreadsheetTimeZone();
  const list = [];

  data.forEach(function (row) {
    if (!row[0]) return;
    const tgl = parseSheetDate(row[1]);
    if (!tgl) return;
    if (tgl.getFullYear() !== tahun) return;

    list.push({
      id: String(row[0]),
      tanggalRaw: Utilities.formatDate(tgl, timeZone, 'yyyy-MM-dd'),
      tanggal: Utilities.formatDate(tgl, timeZone, 'dd/MM/yyyy'),
      jenis: String(row[2] || ''),
      kategori: getKategoriTampilFromStored_(row[3]),
      sumber: getAkunTampilFromStored_(row[4]),
      keterangan: String(row[7] || ''),
      nominal: Number(row[8]) || 0
    });
  });

  return list;
}

function getStatistikPeriodeServer(mode, bulan, tahun) {
  const isTahunan = (mode === 'tahunan');
  const items = isTahunan ? getSemuaTransaksiTahunServer(tahun) : getSemuaTransaksiBulanServer(bulan, tahun);

  const isIncome = function (jenis) {
    const j = String(jenis).toLowerCase();
    return j === 'pemasukan' || j === 'pendapatan';
  };

  let pemasukan = 0, pengeluaran = 0;
  const kategoriMap = {};
  const kategoriMapPemasukan = {};

  items.forEach(function (it) {
    if (it.jenis.toLowerCase() === 'pindah saldo') return;
    if (isIncome(it.jenis)) {
      pemasukan += it.nominal;
      const cat = it.kategori || 'Lainnya';
      kategoriMapPemasukan[cat] = (kategoriMapPemasukan[cat] || 0) + it.nominal;
    } else {
      pengeluaran += it.nominal;
      const cat = it.kategori || 'Lainnya';
      kategoriMap[cat] = (kategoriMap[cat] || 0) + it.nominal;
    }
  });

  const categories = Object.entries(kategoriMap).map(([k, v]) => ({ kategori: k, total: v })).sort((a, b) => b.total - a.total);
  const kategoriPemasukan = Object.entries(kategoriMapPemasukan).map(([k, v]) => ({ kategori: k, total: v })).sort((a, b) => b.total - a.total);

  const trend = [];
  if (isTahunan) {
    for (let m = 0; m < 12; m++) {
      let p = 0, k = 0;
      items.forEach(function (it) {
        const tgl = new Date(it.tanggalRaw);
        if (tgl.getMonth() !== m || it.jenis.toLowerCase() === 'pindah saldo') return;
        if (isIncome(it.jenis)) p += it.nominal; else k += it.nominal;
      });
      trend.push({ label: NAMA_BULAN_PENDEK_ID[m], pemasukan: p, pengeluaran: k });
    }
  } else {
    const jumlahHari = new Date(tahun, bulan + 1, 0).getDate();
    for (let d = 1; d <= jumlahHari; d++) {
      let p = 0, k = 0;
      items.forEach(function (it) {
        const tgl = new Date(it.tanggalRaw);
        if (tgl.getDate() !== d || it.jenis.toLowerCase() === 'pindah saldo') return;
        if (isIncome(it.jenis)) p += it.nominal; else k += it.nominal;
      });
      trend.push({ label: String(d), pemasukan: p, pengeluaran: k });
    }
  }

  // Periode sebelumnya
  let prevBulan = bulan, prevTahun = tahun;
  if (isTahunan) {
    prevTahun = tahun - 1;
  } else {
    prevBulan = bulan - 1;
    if (prevBulan < 0) { prevBulan = 11; prevTahun = tahun - 1; }
  }
  const itemsSebelumnya = isTahunan ? getSemuaTransaksiTahunServer(prevTahun) : getSemuaTransaksiBulanServer(prevBulan, prevTahun);
  let pemasukanSebelumnya = 0, pengeluaranSebelumnya = 0;
  itemsSebelumnya.forEach(function (it) {
    if (it.jenis.toLowerCase() === 'pindah saldo') return;
    if (isIncome(it.jenis)) pemasukanSebelumnya += it.nominal;
    else pengeluaranSebelumnya += it.nominal;
  });

  // ---- Ringkasan panel (aside kanan di desktop) ----
  // Pengeluaran HARI INI: MIRROR PERSIS filter "hari_ini" di getRiwayatKasServer()
  // (transaksi.gs) — bandingkan parsedDate vs now lewat SELISIH HARI
  // (Math.floor((now - parsedDate)/86400000) === 0), BUKAN string tanggalRaw,
  // supaya tidak rentan beda timezone spreadsheet vs script. Inilah sumber data
  // "list transaksi" yang difilter hari ini, lalu ditotal untuk Ringkasan.
  const tSheet = getTransaksiSheet_();
  const rawData = getRawTransaksiCached_(tSheet);
  const nowDay = new Date();
  nowDay.setHours(0, 0, 0, 0);
  let pengeluaranHariIni = 0, pengeluaranHariIniCount = 0;
  rawData.forEach(function (row) {
    const parsedDate = parseSheetDate(row[1]);
    if (!parsedDate) return;
    parsedDate.setHours(0, 0, 0, 0);
    if (Math.floor((nowDay - parsedDate) / 86400000) !== 0) return; // bukan hari ini
    const j = String(row[2] || '').trim().toLowerCase();
    if (j === 'pemasukan' || j === 'pendapatan' || j === 'pindah saldo') return; // bukan pengeluaran
    pengeluaranHariIni += Number(row[8]) || 0;
    pengeluaranHariIniCount += 1;
  });

  // Budget BULANAN berjalan (selalu bulan+tahun saat ini, bukan periode statistik
  // yang mungkin sedang dipilih user) -> agregat dari getBudgetServer().
  // Dipisah di try/catch supaya kalau getBudgetServer gagal, perhitungan
  // pengeluaran hari ini di atas tetap terkirim ke client.
  let budgetLimit = 0, budgetTerpakai = 0, budgetPersen = 0;
  try {
    const now = new Date();
    const budgetRows = getBudgetServer(now.getMonth(), now.getFullYear());
    (budgetRows.list || []).forEach(function (b) {
      budgetLimit += Number(b.limitNominal) || 0;
      budgetTerpakai += Number(b.terpakai) || 0;
    });
    budgetPersen = budgetLimit > 0 ? Math.round((budgetTerpakai / budgetLimit) * 100) : 0;
  } catch (e) {
    // biarkan budget 0, jangan gagalkan seluruh response
  }

  return {
    pemasukan: pemasukan,
    pengeluaran: pengeluaran,
    total: pemasukan - pengeluaran,
    saldo: pemasukan - pengeluaran,
    pemasukanSebelumnya: pemasukanSebelumnya,
    pengeluaranSebelumnya: pengeluaranSebelumnya,
    categories: categories,
    kategoriPemasukan: kategoriPemasukan,
    trend: trend,
    items: items,
    pengeluaranHariIni: pengeluaranHariIni,
    pengeluaranHariIniCount: pengeluaranHariIniCount,
    budgetLimit: budgetLimit,
    budgetTerpakai: budgetTerpakai,
    budgetPersen: budgetPersen
  };
}

function getStatistik3BulanServer() {
  const now = new Date();
  let pemasukan = 0, pengeluaran = 0;
  const map = {};
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const items = getSemuaTransaksiBulanServer(d.getMonth(), d.getFullYear());
    items.forEach(function (it) {
      if (it.jenis.toLowerCase() === 'pemasukan') {
        pemasukan += it.nominal;
      } else if (it.jenis.toLowerCase() === 'pengeluaran') {
        pengeluaran += it.nominal;
        map[it.kategori] = (map[it.kategori] || 0) + it.nominal;
      }
    });
  }
  return {
    pemasukan: pemasukan,
    pengeluaran: pengeluaran,
    total: pemasukan - pengeluaran,
    map: map,
    categories: Object.entries(map).sort((a, b) => b[1] - a[1])
  };
}

function getTren12BulanServer() {
  const now = new Date();
  const result = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const items = getSemuaTransaksiBulanServer(d.getMonth(), d.getFullYear());
    let p = 0, k = 0;
    items.forEach(function (it) {
      if (it.jenis.toLowerCase() === 'pemasukan') p += it.nominal;
      else if (it.jenis.toLowerCase() === 'pengeluaran') k += it.nominal;
    });
    result.push({ bulan: d.getMonth() + 1, tahun: d.getFullYear(), pemasukan: p, pengeluaran: k });
  }
  return result;
}

function getAnalisisKategoriServer() {
  const now = new Date();
  const items = getSemuaTransaksiBulanServer(now.getMonth(), now.getFullYear());
  const map = {};
  let totalPengeluaran = 0;
  items.forEach(function (it) {
    if (it.jenis.toLowerCase() !== 'pengeluaran') return;
    const cat = it.kategori || '';
    if (!cat) return;
    map[cat] = (map[cat] || 0) + it.nominal;
    totalPengeluaran += it.nominal;
  });
  return Object.entries(map).map(function ([k, v]) {
    return { kategori: k, total: v, persentase: totalPengeluaran > 0 ? (v / totalPengeluaran * 100).toFixed(2) : 0 };
  });
}

function getStatistikServer() {
  const stats = getStatistik3BulanServer();
  const utangList = getUtangServer().list;
  const totalUtang = utangList.reduce((a, b) => a + b.total, 0);
  return { stats, totalUtang, totalPemakaian: stats.pemasukan + stats.pengeluaran, utangList };
}
