/*******************************************************
 * MyDuit — transaksi.gs
 * Domain: Tabel Transaksi (skema baru 7 tabel + kompatibilitas penuh controller.js)
 * 
 * Kompatibel dengan ViewJS.html:
 * - getRiwayatKasServer(page, limit, filterParams)
 * - simpanTransaksiServer(formData, page, limit, filterParams)
 * - updateTransaksiServer(formData, page, limit, filterParams)
 * - hapusTransaksiServer(id, page, limit, filterParams)
 * - pindahSaldoServer(formData, page, limit, filterParams)
 * - updatePindahSaldoServer(formData, page, limit, filterParams)
 * - hapusPindahSaldoServer(id, page, limit, filterParams)
 *******************************************************/

const TRANSAKSI_COL = {
  ID: 1,
  TANGGAL: 2,
  JENIS: 3,
  KATEGORIID: 4,
  AKUNID: 5,
  AKUNTUJUANID: 6,
  UTANGID: 7,
  KETERANGAN: 8,
  NOMINAL: 9
};

function getTransaksiSheet_() {
  const ss = getUserDatabase_();
  let sheet = ss.getSheetByName('Transaksi');
  if (!sheet) {
    sheet = ss.insertSheet('Transaksi');
    const headers = ['ID', 'Tanggal', 'Jenis', 'KategoriID', 'AkunID', 'AkunTujuanID', 'UtangID', 'Keterangan', 'Nominal'];
    sheet.getRange(1, 1, 1, 9).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getRiwayatKasServer(page, limit, filterParams) {
  try {
    const pageNum = page || 1;
    const limitNum = limit || 10;
    const sheet = getTransaksiSheet_();
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) return { status: 'success', data: [], totalPages: 0, currentPage: 1 };

    let rawData = getRawTransaksiCached_(sheet);
    const timeZone = sheet.getParent().getSpreadsheetTimeZone();
    const now = new Date(); now.setHours(0, 0, 0, 0);

    let formattedList = [];

    rawData.forEach((row, idx) => {
      let id = String(row[0] || '').trim();
      const parsedDate = parseSheetDate(row[1]);
      if (!id || !parsedDate) return;
      parsedDate.setHours(0, 0, 0, 0);

      const jenis = String(row[2] || '').trim();
      // Langkah C: kolom KategoriID di sheet sekarang berisi Kategori.ID (hasil Langkah B),
      // konversi balik ke nama di sini supaya field `.kategori` yang dikonsumsi ViewJS.html
      // (kartu riwayat, search, filter) tidak berubah kontraknya.
      const kategori = getKategoriTampilFromStored_(row[3]);
      const sumber = getAkunTampilFromStored_(row[4]);
      const akunTujuan = getAkunTampilFromStored_(row[5]);
      const keterangan = String(row[7] || '').trim();
      const nominal = Number(row[8]) || 0;

      // Filter
      if (filterParams) {
        if (filterParams.tipe === 'hari_ini' && Math.floor((now - parsedDate) / 86400000) !== 0) return;
        if (filterParams.tipe === '7hari' && Math.floor((now - parsedDate) / 86400000) > 7) return;
        if (filterParams.tipe === '30hari' && Math.floor((now - parsedDate) / 86400000) > 30) return;
        if (filterParams.tipe === 'custom' && filterParams.startDate && filterParams.endDate) {
          let start = parseSheetDate(filterParams.startDate);
          let end = parseSheetDate(filterParams.endDate);
          if (start && end) {
            start.setHours(0, 0, 0, 0); end.setHours(0, 0, 0, 0);
            if (start > end) { const tmp = start; start = end; end = tmp; }
            if (parsedDate < start || parsedDate > end) return;
          }
        }

        const jenisLower = jenis.toLowerCase();
        const isIncome = (jenisLower === 'pemasukan' || jenisLower === 'pendapatan');
        if (filterParams.jenis === 'Pemasukan' && !isIncome) return;
        if (filterParams.jenis === 'Pengeluaran' && (isIncome || jenisLower === 'pindah saldo')) return;

        if (filterParams.search) {
          const q = filterParams.search.toLowerCase();
          const match = keterangan.toLowerCase().includes(q) || kategori.toLowerCase().includes(q) || sumber.toLowerCase().includes(q);
          if (!match) return;
        }
      }

      // Tampilkan sumber gabungan untuk Pindah Saldo agar ViewJS.html bisa parse dengan parsePindahSaldoSumber_()
      let sumberTampil = sumber;
      if (jenis.toLowerCase() === 'pindah saldo' && akunTujuan) {
        sumberTampil = `${sumber} -> ${akunTujuan}`;
      }

      formattedList.push({
        id: id,
        tanggal: Utilities.formatDate(parsedDate, timeZone, "dd/MM/yyyy"),
        tanggalRaw: Utilities.formatDate(parsedDate, timeZone, "yyyy-MM-dd"),
        jenis: jenis,
        kategori: kategori,
        sumber: sumberTampil,
        keterangan: keterangan,
        nominal: nominal,
        rowIndex: idx
      });
    });

    formattedList.sort((a, b) => {
      const dateDiff = new Date(b.tanggalRaw) - new Date(a.tanggalRaw);
      if (dateDiff !== 0) return dateDiff;
      return b.rowIndex - a.rowIndex;
    });

    const totalPages = Math.ceil(formattedList.length / limitNum) || 1;
    const startIndex = (pageNum - 1) * limitNum;

    return {
      status: 'success',
      data: formattedList.slice(startIndex, startIndex + limitNum),
      totalPages: totalPages,
      currentPage: pageNum
    };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

// FIX INPUT CEPAT: waitLock dipindah ke dalam try (gagal dapat kunci -> pesan error
// jelas, bukan exception mentah ke client), dan baca berat (rebuild riwayat+dompet)
// dikeluarkan dari area lock -> kunci hanya ditahan selama validasi+tulis+delta saldo
// (cepat), sehingga input cepat berturut-turut tidak lagi antre >10 dtk lalu ditolak.
function simpanTransaksiServer(formData, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const jenis = String(formData.jenis || '').trim();
    const nominal = Number(formData.nominal) || 0;
    const sumber = String(formData.sumber || '').trim();

    if (nominal <= 0) throw new Error('Nominal transaksi harus lebih dari 0.');
    if (!sumber) throw new Error('Sumber akun wajib dipilih.');

    if (jenis.toLowerCase() === 'pengeluaran') {
      const saldo = getSaldoAkun_(sumber);
      if (saldo !== null && saldo - nominal < 0) {
        throw new Error(`Saldo "${sumber}" tidak cukup (Rp ${saldo.toLocaleString('id-ID')}).`);
      }
    }

    // PERBAIKAN KategoriID: kolom ini SEHARUSNYA berisi Kategori.ID asli, bukan nama
    // (lihat database.md, "Perbaikan KategoriID"). formData.kategori dari dropdown
    // frontend sumbernya sama persis dgn tabel Kategori (via fetchKategoriServer()/
    // getKategoriByJenisSumberServer()), jadi lookup ini SEHARUSNYA selalu ketemu untuk
    // alur normal. Fallback simpan nama apa adanya kalau lookup gagal (mis. kategori
    // pseudo internal spt "Pindah Saldo"/"Pembayaran" yg ditulis LANGSUNG oleh
    // pindahSaldoServer()/utang.gs tanpa lewat fungsi ini) -- TIDAK melempar error,
    // supaya CRUD tetap jalan walau datanya belum konsisten 100%.
    const kategoriNama = String(formData.kategori || '').trim();
    const kategoriID = kategoriNama ? (getKategoriIdByNama_(kategoriNama) || kategoriNama) : '';

    // PERBAIKAN AkunID: kolom ini SEHARUSNYA berisi Akun.ID asli, sama seperti perbaikan
    // KategoriID (lihat database.md). Lookup nama->ID, fallback simpan nama apa adanya
    // kalau gagal (mis. akun sudah dihapus) -- tidak melempar error, CRUD tetap jalan.
    const akunID = sumber ? (getAkunIdByNama_(sumber) || sumber) : '';

    const id = generatePrimaryKey_('TX');
    const sheet = getTransaksiSheet_();
    const tglTx = parseUserDate_(formData.tanggal, true);
    sheet.appendRow([
      id,
      tglTx,
      jenis,
      kategoriID,
      akunID,
      '', // AkunTujuanID
      formData.utangID || '',
      formData.keterangan || '',
      nominal
    ]);

    invalidateTransaksiCache_();
    applyDeltaSaldoAkun_(sumber, jenis.toLowerCase() === 'pengeluaran' ? -nominal : nominal, jenis, id, tglTx);
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock(); // aman walau lock tidak sempat didapat (no-op)
  }

  // DI LUAR lock: rebuild riwayat & dompet (baca fisik sheet setelah cache
  // di-invalidate) tidak lagi memegang kunci -> eksekusi paralel berikutnya
  // tidak menunggu lama. Data tetap akurat karena appendRow sudah committed.
  const riwayat = getRiwayatKasServer(page, limit, filterParams);
  return { status: 'success', riwayat: riwayat, dompet: getDompetServer() };
}

function updateTransaksiServer(formData, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getTransaksiSheet_();
    const targetRow = findRowIndexById_(sheet, formData.id, 2, TRANSAKSI_COL.ID);
    if (targetRow === -1) throw new Error('Transaksi tidak ditemukan.');

    const dataLama = sheet.getRange(targetRow, 3, 1, 7).getValues()[0];
    // dataLama: [jenis, kategori, sumber, akunTujuan, utang, ket, nominal]
    const jenisLama = String(dataLama[0]).trim();
    const sumberLama = String(dataLama[2]).trim();
    const nominalLama = Number(dataLama[6]) || 0;

    const jenisBaru = String(formData.jenis || '').trim();
    const sumberBaru = String(formData.sumber || '').trim();
    const nominalBaru = Number(formData.nominal) || 0;

    // PERBAIKAN KategoriID: sama seperti simpanTransaksiServer() — lihat catatan lengkap
    // di sana. Lookup nama->ID, fallback simpan nama apa adanya kalau gagal.
    const kategoriNamaBaru = String(formData.kategori || '').trim();
    const kategoriIDBaru = kategoriNamaBaru ? (getKategoriIdByNama_(kategoriNamaBaru) || kategoriNamaBaru) : '';

    // PERBAIKAN AkunID: sama seperti simpanTransaksiServer() -- lihat catatan di sana.
    const akunIDBaru = sumberBaru ? (getAkunIdByNama_(sumberBaru) || sumberBaru) : '';

    if (nominalBaru <= 0) throw new Error('Nominal transaksi harus lebih dari 0.');

    const deltaLama = jenisLama.toLowerCase() === 'pengeluaran' ? -nominalLama : nominalLama;
    const deltaBaru = jenisBaru.toLowerCase() === 'pengeluaran' ? -nominalBaru : nominalBaru;

    // PERBAIKAN BUG REGRESI: kolom AkunID di sheet sekarang berisi Akun.ID (bukan nama).
    // sumberLama yang dibaca dari sheet (ID) tidak bisa langsung dibandingkan dgn sumberBaru
    // (nama mentah dari form) -> ID vs nama nyaris tidak pernah cocok, jadi sumberSama selalu
    // false walau user tidak mengganti akun. Normalisasi sumberLama ke ID dulu, lalu bandingkan
    // ID vs ID (akunIDBaru sudah berupa ID dari getAkunIdByNama_()).
    const sumberLamaID = getAkunIdByNama_(sumberLama) || sumberLama;
    const sumberSama = String(sumberLamaID).toLowerCase() === String(akunIDBaru).toLowerCase();
    const deltaBersih = sumberSama ? (deltaBaru - deltaLama) : deltaBaru;

    if (jenisBaru.toLowerCase() === 'pengeluaran' && deltaBersih < 0) {
      const saldo = getSaldoAkun_(sumberBaru);
      if (saldo !== null && saldo + deltaBersih < 0) {
        throw new Error(`Saldo "${sumberBaru}" tidak cukup.`);
      }
    }

    sheet.getRange(targetRow, 2, 1, 8).setValues([[
      parseUserDate_(formData.tanggal), jenisBaru, kategoriIDBaru, akunIDBaru, '', formData.utangID || '', formData.keterangan || '', nominalBaru
    ]]);

    invalidateTransaksiCache_();

    const tglTxUpd = parseUserDate_(formData.tanggal, true);
    if (sumberSama) {
      applyDeltaSaldoAkun_(akunIDBaru, deltaBaru - deltaLama, 'Update Transaksi', formData.id, tglTxUpd);
    } else {
      applyDeltaSaldoAkun_(sumberLamaID, -deltaLama, 'Update Transaksi (Akun Lama)', formData.id, tglTxUpd);
      applyDeltaSaldoAkun_(akunIDBaru, deltaBaru, 'Update Transaksi (Akun Baru)', formData.id, tglTxUpd);
    }
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }

  // DI LUAR lock — pola sama dengan simpanTransaksiServer() (fix input cepat)
  const riwayat = getRiwayatKasServer(page, limit, filterParams);
  return { status: 'success', riwayat: riwayat, dompet: getDompetServer() };
}

function hapusTransaksiServer(id, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getTransaksiSheet_();
    const targetRow = findRowIndexById_(sheet, id, 2, TRANSAKSI_COL.ID);
    if (targetRow === -1) throw new Error('Transaksi sudah terhapus.');

    const data = sheet.getRange(targetRow, 3, 1, 7).getValues()[0];
    const jenis = String(data[0]).trim();
    const sumber = String(data[2]).trim();
    const nominal = Number(data[6]) || 0;

    const tanggalTx = sheet.getRange(targetRow, TRANSAKSI_COL.TANGGAL, 1, 1).getValue();
    const logDate = (tanggalTx instanceof Date && !isNaN(tanggalTx.getTime())) ? tanggalTx : new Date();

    sheet.deleteRow(targetRow);
    invalidateTransaksiCache_();

    if (jenis.toLowerCase() === 'pindah saldo') {
      const akunTujuan = String(data[3] || '').trim();
      applyDeltaSaldoAkun_(sumber, nominal, 'Hapus Pindah Saldo', id, logDate);
      applyDeltaSaldoAkun_(akunTujuan, -nominal, 'Hapus Pindah Saldo', id, logDate);
    } else if (jenis.toLowerCase() === 'pengeluaran') {
      applyDeltaSaldoAkun_(sumber, nominal, 'Hapus Transaksi', id, logDate);
    } else {
      applyDeltaSaldoAkun_(sumber, -nominal, 'Hapus Transaksi', id, logDate);
    }
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }

  // DI LUAR lock — pola sama dengan simpanTransaksiServer() (fix input cepat)
  const riwayat = getRiwayatKasServer(page, limit, filterParams);
  return { status: 'success', riwayat: riwayat, dompet: getDompetServer() };
}

/**
 * Hapus banyak transaksi sekaligus dalam 1 lock (bulk delete).
 * ids: array/string daftar Transaksi.ID yang dipisah koma.
 * Mengembalikan riwayat & dompet terbaru seperti hapusTransaksiServer.
 */
function hapusTransaksiMassalServer(ids, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  let jumlahDihapus = 0;
  try {
    lock.waitLock(10000);
    let idList = Array.isArray(ids) ? ids : String(ids || '').split(',');
    idList = idList.map(function (s) { return String(s).trim(); }).filter(Boolean);
    if (!idList.length) throw new Error('Tidak ada transaksi yang dipilih.');
    // Unik + cegah duplikat
    idList = idList.filter(function (v, i, a) { return a.indexOf(v) === i; });

    const sheet = getTransaksiSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) throw new Error('Tidak ada transaksi untuk dihapus.');

    // Baca seluruh baris sekali, petakan ID -> row index
    const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
    const rowById = {};
    for (let i = 0; i < data.length; i++) {
      rowById[String(data[i][0]).trim()] = i + 2; // index baris sheet (2-based)
    }

    const deleted = [];

    idList.forEach(function (id) {
      const rowIdx = rowById[id];
      if (rowIdx === undefined) return; // sudah terhapus/skip
      const r = data[rowIdx - 2];
      const jenis = String(r[2] || '').trim();
      const sumber = String(r[4] || '').trim(); // Akun.ID
      const akunTujuan = String(r[5] || '').trim();
      const nominal = Number(r[8]) || 0;
      const tanggalTx = r[1] instanceof Date && !isNaN(r[1].getTime()) ? r[1] : new Date();

      deleted.push({ rowIdx: rowIdx, tanggal: tanggalTx, id: id, jenis: jenis, sumber: sumber, akunTujuan: akunTujuan, nominal: nominal });
    });

    if (!deleted.length) throw new Error('Tidak ada transaksi yang cocok untuk dihapus.');

    // Hapus baris dari paling bawah ke atas (agar index sheet tidak bergeser)
    deleted.sort(function (a, b) { return b.rowIdx - a.rowIdx; });
    deleted.forEach(function (d) {
      sheet.deleteRow(d.rowIdx);
    });

    invalidateTransaksiCache_();

    // Terapkan delta saldo & catat MutasiLog PER TRANSaksi dengan TransaksiID asli
    // (bukan akumulasi 'MASSAL') supaya foreign key ke Transaksi tetap akurat.
    deleted.forEach(function (d) {
      const jenis = d.jenis;
      if (jenis.toLowerCase() === 'pindah saldo') {
        // Hapus pindah saldo: sumber +nominal, tujuan -nominal
        applyDeltaSaldoAkun_(d.sumber, d.nominal, 'Hapus Pindah Saldo', d.id, d.tanggal);
        if (d.akunTujuan) applyDeltaSaldoAkun_(d.akunTujuan, -d.nominal, 'Hapus Pindah Saldo', d.id, d.tanggal);
      } else if (jenis.toLowerCase() === 'pengeluaran') {
        applyDeltaSaldoAkun_(d.sumber, d.nominal, 'Hapus Transaksi', d.id, d.tanggal);
      } else {
        // Pemasukan: hapus → saldo berkurang
        applyDeltaSaldoAkun_(d.sumber, -d.nominal, 'Hapus Transaksi', d.id, d.tanggal);
      }
    });

    jumlahDihapus = deleted.length;
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }

  // DI LUAR lock — pola sama dengan simpanTransaksiServer() (fix input cepat)
  const riwayat = getRiwayatKasServer(page, limit, filterParams);
  return { status: 'success', jumlahDihapus: jumlahDihapus, riwayat: riwayat, dompet: getDompetServer() };
}

function pindahSaldoServer(formData, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sumber = String(formData.sumberRekening || '').trim();
    const tujuan = String(formData.rekeningTujuan || '').trim();
    const nominal = Number(formData.nominal) || 0;
    const catatan = String(formData.catatan || '').trim();
    const tanggal = parseUserDate_(formData.tanggal, true) || new Date();

    if (!sumber || !tujuan) throw new Error('Sumber dan tujuan wajib dipilih.');
    if (sumber === tujuan) throw new Error('Sumber dan tujuan tidak boleh sama.');
    if (nominal <= 0) throw new Error('Nominal transfer harus lebih dari 0.');

    const saldoSumber = getSaldoAkun_(sumber);
    if (saldoSumber === null || saldoSumber - nominal < 0) {
      throw new Error(`Saldo "${sumber}" tidak cukup untuk transfer.`);
    }

    const id = generatePrimaryKey_('TX');
    let ket = `Pindah saldo : dari "${sumber}" -> "${tujuan}"`;
    if (catatan) ket += ` — ${catatan}`;

    // PERBAIKAN AkunID: sama seperti simpanTransaksiServer() -- simpan Akun.ID, bukan nama.
    const sumberID = getAkunIdByNama_(sumber) || sumber;
    const tujuanID = getAkunIdByNama_(tujuan) || tujuan;

    const sheet = getTransaksiSheet_();
    sheet.appendRow([id, tanggal, 'Pindah Saldo', 'Pindah Saldo', sumberID, tujuanID, '', ket, nominal]);

    invalidateTransaksiCache_();
    applyDeltaSaldoAkun_(sumber, -nominal, 'Pindah Saldo Keluar', id, tanggal);
    applyDeltaSaldoAkun_(tujuan, nominal, 'Pindah Saldo Masuk', id, tanggal);
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }

  // DI LUAR lock — pola sama dengan simpanTransaksiServer() (fix input cepat)
  const dompet = getDompetServer();
  const riwayat = (page && limit) ? getRiwayatKasServer(page, limit, filterParams) : null;
  return { status: 'success', dompet, riwayat };
}

function updatePindahSaldoServer(formData, page, limit, filterParams) {
  // Delegate ke hapus + simpan baru agar aman & konsisten
  const hapus = hapusTransaksiServer(formData.id);
  if (hapus.status !== 'success') return hapus;
  return pindahSaldoServer(formData, page, limit, filterParams);
}

function hapusPindahSaldoServer(id, page, limit, filterParams) {
  return hapusTransaksiServer(id, page, limit, filterParams);
}
