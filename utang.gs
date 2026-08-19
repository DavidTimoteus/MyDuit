/*******************************************************
 * MyDuit — utang.gs
 * Domain: Tabel Utang + PembayaranUtang (skema baru 7 tabel)
 * 
 * Kompatibel dengan ViewJS.html:
 * - getUtangServer()
 * - simpanUtangServer(formData)
 * - updateUtangServer(formData)
 * - hapusUtangServer(id)
 * - bayarCicilanServer(id, sumber)
 * - lunasinUtangServer(id, sumber)
 *******************************************************/

const UTANG_COL = {
  ID: 1, TANGGAL: 2, NAMAPIHAK: 3, DESKRIPSI: 4, TOTAL: 5,
  TGLJATUHTEMPO: 6, TIPE: 7, STATUS: 8, CICILANPERBULAN: 9
};

const BAYAR_COL = {
  ID: 1, UTANGID: 2, TRANSAKSIID: 3, TANGGAL: 4, NOMINAL: 5
};

const CACHE_KEY_UTANG = 'utangPayload_v1';

function invalidateUtangCache_() {
  CacheService.getUserCache().remove(CACHE_KEY_UTANG);
}

function getUtangSheet_() {
  const ss = getUserDatabase_();
  let sheet = ss.getSheetByName('Utang');
  if (!sheet) {
    sheet = ss.insertSheet('Utang');
    const headers = ['ID', 'Tanggal', 'NamaPihak', 'Deskripsi', 'Total', 'TglJatuhTempo', 'Tipe', 'Status', 'CicilanPerBulan'];
    sheet.getRange(1, 1, 1, 9).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getPembayaranUtangSheet_() {
  const ss = getUserDatabase_();
  let sheet = ss.getSheetByName('PembayaranUtang');
  if (!sheet) {
    sheet = ss.insertSheet('PembayaranUtang');
    const headers = ['ID', 'UtangID', 'TransaksiID', 'Tanggal', 'Nominal'];
    sheet.getRange(1, 1, 1, 5).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getPembayaranByUtangID_(utangID) {
  const sheet = getPembayaranUtangSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  const list = [];
  data.forEach(function (row) {
    if (String(row[1] || '').trim() === utangID) {
      list.push({
        id: String(row[0]),
        utangID: String(row[1]),
        transaksiID: String(row[2]),
        tanggalRaw: new Date(row[3]),
        nominal: Number(row[4]) || 0
      });
    }
  });
  return list;
}

function getUtangServer() {
  const cache = CacheService.getUserCache();
  const cached = cache.get(CACHE_KEY_UTANG);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const sheet = getUtangSheet_();
  const lastRow = sheet.getLastRow();
  const timeZone = sheet.getParent().getSpreadsheetTimeZone();
  if (lastRow < 2) {
    const empty = { status: 'success', list: [] };
    cache.put(CACHE_KEY_UTANG, JSON.stringify(empty), CACHE_TTL_SECONDS);
    return empty;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  const list = data.map(function (row) {
    const id = String(row[0] || '').trim();
    const nama = String(row[2] || '').trim();
    if (!id || !nama) return null;

    const total = Number(row[4]) || 0;
    const pembayaran = getPembayaranByUtangID_(id);
    const totalBayar = pembayaran.reduce(function (s, p) { return s + p.nominal; }, 0);
    const sisa = total - totalBayar;
    const status = sisa <= 0 ? 'Lunas' : 'Belum Lunas';
    const tglJatuhRaw = row[5];
    const tglJatuhStr = tglJatuhRaw ? Utilities.formatDate(new Date(tglJatuhRaw), timeZone, 'dd/MM/yyyy') : '';

    return {
      id: id,
      tanggal: Utilities.formatDate(new Date(row[1]), timeZone, 'dd/MM/yyyy'),
      namaPihak: nama,
      deskripsi: String(row[3] || '').trim(),
      total: total,
      sisa: sisa,
      tglJatuh: tglJatuhStr,
      tipe: String(row[6] || '').trim(),
      status: status,
      cicilanPerBulan: Number(row[8] || 0),
      jumlahBayar: pembayaran.length,
      lastUpdated: pembayaran.length > 0 ? pembayaran[pembayaran.length - 1].tanggalRaw.toISOString() : '',
      pembayaranList: pembayaran.map(p => ({
        id: p.id, tanggal: Utilities.formatDate(p.tanggalRaw, timeZone, 'dd/MM/yyyy HH:mm'),
        nominal: p.nominal
      }))
    };
  }).filter(Boolean);

  const result = { status: 'success', list: list };
  cache.put(CACHE_KEY_UTANG, JSON.stringify(result), CACHE_TTL_SECONDS);
  return result;
}

function simpanUtangServer(formData) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const namaPihak = String(formData.namaPihak || '').trim();
    const total = Number(formData.total) || 0;
    const tipe = String(formData.tipe || 'Utang').trim();

    if (!namaPihak) throw new Error('Nama pihak wajib diisi.');
    if (total <= 0) throw new Error('Total utang harus lebih dari 0.');

    const id = generatePrimaryKey_('UTG');
    const sheet = getUtangSheet_();
    sheet.appendRow([
      id,
      new Date(formData.tanggal || new Date()),
      namaPihak,
      formData.deskripsi || '',
      total,
      new Date(formData.tglJatuh),
      tipe,
      'Belum Lunas',
      Number(formData.cicilanPerBulan) || 0
    ]);
    invalidateUtangCache_();

    return { status: 'success', data: { id, ...formData } };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

function updateUtangServer(formData) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getUtangSheet_();
    const targetRow = findRowIndexById_(sheet, formData.id, 2, UTANG_COL.ID);
    if (targetRow === -1) throw new Error('Utang tidak ditemukan.');

    sheet.getRange(targetRow, 2, 1, 8).setValues([[
      new Date(formData.tanggal || new Date()),
      formData.namaPihak || '',
      formData.deskripsi || '',
      Number(formData.total) || 0,
      new Date(formData.tglJatuh),
      formData.tipe || 'Utang',
      formData.status || 'Belum Lunas',
      Number(formData.cicilanPerBulan) || 0
    ]]);
    invalidateUtangCache_();

    return { status: 'success', data: { id: formData.id, ...formData } };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

function hapusUtangServer(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getUtangSheet_();
    const targetRow = findRowIndexById_(sheet, id, 2, UTANG_COL.ID);
    if (targetRow === -1) throw new Error('Utang tidak ditemukan.');

    sheet.deleteRow(targetRow);
    invalidateUtangCache_();
    return { status: 'success' };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

function bayarCicilanServer(id, sumber) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getUtangSheet_();
    const targetRow = findRowIndexById_(sheet, id, 2, UTANG_COL.ID);
    if (targetRow === -1) throw new Error('Utang tidak ditemukan.');

    const data = sheet.getRange(targetRow, 1, 1, 9).getValues()[0];
    const nama = String(data[UTANG_COL.NAMAPIHAK - 1]);
    const total = Number(data[UTANG_COL.TOTAL - 1]) || 0;
    const cicilan = Number(data[UTANG_COL.CICILANPERBULAN - 1]) || 0;
    if (cicilan <= 0) throw new Error('Cicilan per bulan belum diisi.');

    const pembayaran = getPembayaranByUtangID_(id);
    const totalBayar = pembayaran.reduce(function (s, p) { return s + p.nominal; }, 0);
    const sisa = total - totalBayar;
    if (sisa <= 0) throw new Error('Utang ini sudah lunas.');

    const bayar = Math.min(cicilan, sisa);
    const sisaBaru = sisa - bayar;
    const statusBaru = sisaBaru <= 0 ? 'Lunas' : 'Belum Lunas';
    const jumlahBayarBaru = pembayaran.length + 1;
    const now = new Date();
    const timeZone = sheet.getParent().getSpreadsheetTimeZone();
    const tglStr = Utilities.formatDate(now, timeZone, 'dd/MM/yyyy HH:mm');
    const ket = `${nama} : Pembayaran Ke-${jumlahBayarBaru} - ${tglStr}`;

    // PERBAIKAN: txID dibuat DULU supaya baris PembayaranUtang bisa langsung tertaut ke
    // Transaksi.ID yang benar (sebelumnya TransaksiID selalu ditulis kosong karena baris
    // PembayaranUtang disisipkan sebelum txID ada). AkunID juga disimpan sbg Akun.ID asli
    // (bukan nama), sama seperti perbaikan di transaksi.gs.
    const txID = generatePrimaryKey_('TX');
    const akunID = getAkunIdByNama_(sumber) || sumber;

    const bayarID = generatePrimaryKey_('BAY');
    getPembayaranUtangSheet_().appendRow([bayarID, id, txID, now, bayar]);
    getTransaksiSheet_().appendRow([txID, now, 'Pengeluaran', 'Pembayaran', akunID, '', id, ket, bayar]);

    invalidateUtangCache_();
    invalidateTransaksiCache_();
    applyDeltaSaldoAkun_(sumber, -bayar, 'Bayar Cicilan', txID);

    return {
      status: 'success',
      dibayar: bayar,
      sisa: sisaBaru,
      statusUtang: statusBaru,
      lastUpdated: now.toISOString(),
      jumlahBayar: jumlahBayarBaru,
      keterangan: ket,
      dompet: getDompetServer()
    };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

function lunasinUtangServer(id, sumber) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getUtangSheet_();
    const targetRow = findRowIndexById_(sheet, id, 2, UTANG_COL.ID);
    if (targetRow === -1) throw new Error('Utang tidak ditemukan.');

    const data = sheet.getRange(targetRow, 1, 1, 9).getValues()[0];
    const nama = String(data[UTANG_COL.NAMAPIHAK - 1]);
    const pembayaran = getPembayaranByUtangID_(id);
    const totalBayar = pembayaran.reduce(function (s, p) { return s + p.nominal; }, 0);
    const total = Number(data[UTANG_COL.TOTAL - 1]) || 0;
    const sisa = total - totalBayar;
    if (sisa <= 0) throw new Error('Utang ini sudah lunas.');

    const now = new Date();
    const timeZone = sheet.getParent().getSpreadsheetTimeZone();
    const tglStr = Utilities.formatDate(now, timeZone, 'dd/MM/yyyy');
    const ket = `${nama} : Pelunasan Utang - ${tglStr}`;

    // PERBAIKAN: sama seperti bayarCicilanServer() -- txID dibuat dulu supaya PembayaranUtang
    // tertaut benar, AkunID disimpan sbg Akun.ID asli.
    const txID = generatePrimaryKey_('TX');
    const akunID = getAkunIdByNama_(sumber) || sumber;

    const bayarID = generatePrimaryKey_('BAY');
    getPembayaranUtangSheet_().appendRow([bayarID, id, txID, now, sisa]);
    getTransaksiSheet_().appendRow([txID, now, 'Pengeluaran', 'Pembayaran', akunID, '', id, ket, sisa]);

    invalidateUtangCache_();
    invalidateTransaksiCache_();
    applyDeltaSaldoAkun_(sumber, -sisa, 'Pelunasan Utang', txID);

    return {
      status: 'success',
      dibayar: sisa,
      lastUpdated: now.toISOString(),
      keterangan: ket,
      dompet: getDompetServer()
    };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}