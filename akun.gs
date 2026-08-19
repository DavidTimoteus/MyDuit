/*******************************************************
 * MyDuit — akun.gs
 * Domain: Tabel Akun (dulu Dompet) — skema baru 7 tabel
 * 
 * Skema Akun:
 * - ID (PK): AKN-yyyyMMdd-HEX4
 * - Nama: string
 * - Tipe: enum (Rekening Utama/Tabungan/E-Wallet/Dana Darurat)
 * - SaldoAwal: number (tidak berubah setelah akun dibuat)
 * - Saldo: number (CACHE: SaldoAwal + SUM(mutasi))
 * - UpdatedAt: datetime (CACHE: kapan Saldo terakhir di-update)
 * - CreatedAt: datetime
 * 
 * Catatan Kompatibilitas:
 * Memiliki alias fungsi lama (getDompetServer, simpanRekeningServer,
 * updateRekeningServer, hapusRekeningServer, fetchSumberAkunServer)
 * agar ViewJS.html/frontend tetap jalan 100% tanpa error.
 *******************************************************/

const AKUN_COL = {
  ID: 1,
  NAMA: 2,
  TIPE: 3,
  SALDOAWAL: 4,
  SALDO: 5,
  UPDATED_AT: 6,
  CREATED_AT: 7
};

const CACHE_KEY_AKUN_PAYLOAD = 'akunPayload_v1';

function invalidateAkunCache_() {
  const cache = CacheService.getUserCache();
  cache.remove(CACHE_KEY_AKUN_PAYLOAD);
  cache.remove('akunMaps_v1');
}

/**
 * Alias nama lama (kompatibel controller.js/test.gs).
 */
function invalidateDompetCache_() {
  invalidateAkunCache_();
}

/**
 * Helper: ambil sheet 'Akun', buat kalau belum ada.
 */
function getAkunSheet_() {
  const ss = getUserDatabase_();
  let sheet = ss.getSheetByName('Akun');
  if (!sheet) {
    sheet = ss.insertSheet('Akun');
    const headers = ['ID', 'Nama', 'Tipe', 'SaldoAwal', 'Saldo', 'UpdatedAt', 'CreatedAt'];
    sheet.getRange(1, 1, 1, 7).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  // Auto-healing header
  const existingHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 7)).getValues()[0];
  const expectedHeaders = ['ID', 'Nama', 'Tipe', 'SaldoAwal', 'Saldo', 'UpdatedAt', 'CreatedAt'];
  expectedHeaders.forEach(function (h, idx) {
    if (!existingHeaders[idx]) {
      sheet.getRange(1, idx + 1).setValue(h);
    }
  });
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * Baca semua akun dengan format lama/kompatibel.
 * Dipanggil frontend via getDompetServer().
 */
function getDompetServer() {
  const cache = CacheService.getUserCache();
  const cached = cache.get(CACHE_KEY_AKUN_PAYLOAD);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  try {
    const sheet = getAkunSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      const emptyResult = { status: 'success', totalSaldo: 0, rekening: [], lastUpdated: null };
      cache.put(CACHE_KEY_AKUN_PAYLOAD, JSON.stringify(emptyResult), CACHE_TTL_SECONDS);
      return emptyResult;
    }

    const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    const timeZone = sheet.getParent().getSpreadsheetTimeZone();
    let totalSaldo = 0;
    let lastUpdatedMax = null;

    const rekening = data.map(function (row) {
      const nama = String(row[1] || '').trim();
      if (!nama) return null;

      let id = String(row[0] || '').trim();
      if (!id) {
        id = generatePrimaryKey_('AKN');
      }

      const saldo = Number(row[4]) || 0;
      totalSaldo += saldo;

      const upd = row[5] ? new Date(row[5]) : null;
      if (upd && (!lastUpdatedMax || upd > lastUpdatedMax)) {
        lastUpdatedMax = upd;
      }

      return {
        id: id,
        nama: nama,
        saldo: saldo,
        tipe: String(row[2] || '').trim(),
        catatan: '', // Log teks bebas dihapus di skema baru
        terakhirDiperbarui: upd ? Utilities.formatDate(upd, timeZone, 'dd/MM/yyyy HH:mm') : '-'
      };
    }).filter(Boolean);

    const result = {
      status: 'success',
      totalSaldo: totalSaldo,
      rekening: rekening,
      lastUpdated: lastUpdatedMax ? lastUpdatedMax.toISOString() : null
    };

    cache.put(CACHE_KEY_AKUN_PAYLOAD, JSON.stringify(result), CACHE_TTL_SECONDS);
    return result;
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

/**
 * Alias baru: getAkunServer
 */
function getAkunServer() {
  return getDompetServer();
}

/**
 * Fetch daftar nama akun untuk dropdown/combobox di frontend.
 */
function fetchSumberAkunServer() {
  const cache = CacheService.getUserCache();
  const cached = cache.get('sumberAkunList');
  if (cached) return JSON.parse(cached);

  try {
    const dompet = getDompetServer();
    if (dompet.status !== 'success') return [];
    const list = dompet.rekening.map(r => r.nama).filter(Boolean);
    cache.put('sumberAkunList', JSON.stringify(list), 300);
    return list;
  } catch (e) {
    return [];
  }
}

/**
 * Simpan rekening baru (kompatibel frontend).
 */
function simpanRekeningServer(nama, saldoAwal, tipe) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    nama = String(nama || '').trim();
    tipe = String(tipe || '').trim();
    saldoAwal = Number(saldoAwal) || 0;

    if (!nama) throw new Error('Nama akun tidak boleh kosong.');
    if (!tipe) throw new Error('Tipe rekening wajib diisi.');
    if (saldoAwal < 0) throw new Error('Saldo awal tidak boleh minus.');

    const sheet = getAkunSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const namaSudahAda = sheet.getRange(2, 2, lastRow - 1, 1).getValues()
        .some(r => String(r[0] || '').trim().toLowerCase() === nama.toLowerCase());
      if (namaSudahAda) throw new Error(`Akun "${nama}" sudah ada.`);
    }

    const id = generatePrimaryKey_('AKN');
    const now = new Date();
    sheet.appendRow([id, nama, tipe, saldoAwal, saldoAwal, now, now]);

    invalidateAkunCache_();
    CacheService.getUserCache().removeAll(['sumberAkunList']);

    return { status: 'success', dompet: getDompetServer() };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Alias baru: simpanAkunServer
 */
function simpanAkunServer(formData) {
  return simpanRekeningServer(formData.nama, formData.saldoAwal, formData.tipe);
}

/**
 * Update rekening (kompatibel frontend).
 */
function updateRekeningServer(formData, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getAkunSheet_();
    const targetRow = findRowIndexById_(sheet, formData.id, 2, AKUN_COL.ID);
    if (targetRow === -1) throw new Error('Rekening tidak ditemukan.');

    const dataLama = sheet.getRange(targetRow, 1, 1, 7).getValues()[0];
    const namaLama = String(dataLama[AKUN_COL.NAMA - 1]).trim();
    const namaBaru = String(formData.nama || '').trim();
    const saldoBaru = Number(formData.saldo) || 0;
    const tipeBaru = String(formData.tipe || '').trim();

    if (!namaBaru) throw new Error('Nama akun tidak boleh kosong.');
    if (saldoBaru < 0) throw new Error('Saldo tidak boleh minus.');

    if (namaLama.toLowerCase() !== namaBaru.toLowerCase()) {
      const lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        const namaSudahAda = sheet.getRange(2, 2, lastRow - 1, 1).getValues()
          .some(r => String(r[0] || '').trim().toLowerCase() === namaBaru.toLowerCase() &&
                     String(r[0]).trim().toLowerCase() !== namaLama.toLowerCase());
        if (namaSudahAda) throw new Error(`Akun "${namaBaru}" sudah ada.`);
      }
    }

    const now = new Date();
    // Update Nama, Tipe, Saldo, UpdatedAt
    sheet.getRange(targetRow, AKUN_COL.NAMA, 1, 5).setValues([[namaBaru, tipeBaru, dataLama[AKUN_COL.SALDOAWAL - 1], saldoBaru, now]]);

    invalidateAkunCache_();
    CacheService.getUserCache().removeAll(['sumberAkunList']);

    // Fase 5 (MutasiLog): edit saldo di sini TIDAK lewat applyDeltaSaldoAkun_()
    // (nilai baru ditulis langsung, bukan delta), jadi dicatat manual di sini
    // supaya tetap ke-log — beda Aksi ("Koreksi Manual") dari perubahan saldo
    // akibat CRUD Transaksi/Pindah Saldo/Bayar Cicilan.
    const saldoLama = Number(dataLama[AKUN_COL.SALDO - 1]) || 0;
    const deltaKoreksi = saldoBaru - saldoLama;
    if (deltaKoreksi !== 0) {
      catatMutasiLog_(String(dataLama[AKUN_COL.ID - 1]).trim(), 'Koreksi Manual', deltaKoreksi, '');
    }

    const dompet = getDompetServer();
    const riwayat = (typeof getRiwayatKasServer === 'function' && page && limit) ? getRiwayatKasServer(page, limit, filterParams) : null;

    return { status: 'success', dompet: dompet, riwayat: riwayat, jumlahTransaksiDiubah: 0, namaLama: namaLama, namaBaru: namaBaru };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Hapus rekening (kompatibel frontend).
 */
function hapusRekeningServer(id, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getAkunSheet_();
    const targetRow = findRowIndexById_(sheet, id, 2, AKUN_COL.ID);
    if (targetRow === -1) throw new Error('Rekening sudah terhapus.');

    sheet.deleteRow(targetRow);
    SpreadsheetApp.flush();

    invalidateAkunCache_();
    CacheService.getUserCache().removeAll(['sumberAkunList']);

    const dompet = getDompetServer();
    const riwayat = (typeof getRiwayatKasServer === 'function' && page && limit) ? getRiwayatKasServer(page, limit, filterParams) : null;

    return { status: 'success', dompet: dompet, riwayat: riwayat, jumlahTransaksiTerhapus: 0 };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Helper: cari saldo 1 akun berdasarkan nama/ID.
 * Return number saldo, atau null kalau akun tidak ditemukan.
 */
function getSaldoAkun_(namaOrId) {
  const identifier = String(namaOrId || '').trim();
  if (!identifier) return null;

  const sheet = getAkunSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues(); // ID, NAMA, TIPE, SALDOAWAL, SALDO
  for (let i = 0; i < data.length; i++) {
    const id = String(data[i][0] || '').trim();
    const nama = String(data[i][1] || '').trim();
    if (id.toLowerCase() === identifier.toLowerCase() || nama.toLowerCase() === identifier.toLowerCase()) {
      return Number(data[i][4]) || 0;
    }
  }
  return null;
}

/**
 * Helper: update saldo 1 akun dengan delta (+/- nominal).
 * Dipanggil oleh transaksi.gs & utang.gs.
 *
 * Fase 5 (MutasiLog): sekarang juga mencatat 1 baris MutasiLog tiap kali saldo
 * berubah lewat sini — titik ini dipakai SEMUA alur CRUD Transaksi, Pindah
 * Saldo, Bayar Cicilan, dan Pelunasan Utang, jadi cukup diinstrumen di 1
 * tempat (bukan di tiap pemanggil). `aksi`/`transaksiID` opsional — pemanggil
 * lama yang belum mengirim keduanya tetap jalan (fallback aksi generik),
 * hanya saja Aksi di MutasiLog kurang deskriptif kalau tidak diisi.
 */
function applyDeltaSaldoAkun_(namaOrIdAkun, delta, aksi, transaksiID) {
  const identifier = String(namaOrIdAkun || '').trim();
  if (!identifier || !delta) return;

  const sheet = getAkunSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues(); // ID, NAMA, TIPE, SALDOAWAL, SALDO
  const now = new Date();

  for (let i = 0; i < data.length; i++) {
    const id = String(data[i][0] || '').trim();
    const nama = String(data[i][1] || '').trim();

    if (id.toLowerCase() === identifier.toLowerCase() || nama.toLowerCase() === identifier.toLowerCase()) {
      const rowIdx = 2 + i;
      const saldoBaru = (Number(data[i][4]) || 0) + delta;
      sheet.getRange(rowIdx, AKUN_COL.SALDO, 1, 2).setValues([[saldoBaru, now]]);
      invalidateAkunCache_();
      catatMutasiLog_(id, aksi || 'Mutasi Saldo', delta, transaksiID);
      return;
    }
  }
}

/**
 * Helper: cari ID akun berdasarkan nama (case-insensitive)
 */
function getAkunIdByNama_(nama) {
  if (!nama) return null;
  const sheet = getAkunSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][1] || '').trim().toLowerCase() === String(nama).trim().toLowerCase()) {
      return String(data[i][0]).trim();
    }
  }
  return null;
}

/**
 * Helper: cari Nama akun berdasarkan ID
 */
function getAkunNamaById_(id) {
  if (!id) return '';
  const maps = getAkunMaps_();
  return maps.byId[String(id).trim()] || '';
}

/**
 * Cache map { byId: { ID: Nama } } dari sheet Akun, pola SAMA persis dengan
 * getKategoriMaps_() di kategori.gs. TANPA ini, getAkunNamaById_() (yang
 * dipanggil per-baris lewat getAkunTampilFromStored_() di getRiwayatKasServer)
 * membaca seluruh sheet Akun SEKALI PER PANGGILAN -> dengan ribuan transaksi
 * hasil migrasi, doGet() bisa makan puluhan detik. Dgn cache, sheet Akun dibaca
 * cukup sekali tiap 60 detik.
 */
function getAkunMaps_() {
  const cache = CacheService.getUserCache();
  const cached = cache.get('akunMaps_v1');
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* cache korup -> baca ulang */ }
  }

  const maps = { byId: {}, byNama: {} };
  try {
    const sheet = getAkunSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      data.forEach(function (row) {
        const id = String(row[0] || '').trim();
        const nama = String(row[1] || '').trim();
        if (!id || !nama) return;
        maps.byId[id] = nama;
        maps.byNama[nama.toLowerCase()] = id;
      });
    }
  } catch (e) {
    // biarkan maps kosong -> pemanggil fallback ke nama apa adanya
  }

  try { cache.put('akunMaps_v1', JSON.stringify(maps), CACHE_TTL_SECONDS); } catch (e) { /* payload besar -> lewati cache */ }
  return maps;
}

/**
 * Konversi nilai mentah kolom Transaksi.AkunID/AkunTujuanID (bisa berupa Akun.ID kalau sudah
 * lewat perbaikan ini, ATAU nama akun langsung utk baris lama/belum sempat dikonversi) jadi
 * NAMA yang dikonsumsi frontend. Kalau lookup ID gagal, anggap value yang tersimpan memang
 * sudah nama apa adanya (fallback aman, bukan throw) -- pola sama dgn
 * getKategoriTampilFromStored_() di kategori.gs.
 */
function getAkunTampilFromStored_(stored) {
  const val = String(stored || '').trim();
  if (!val) return '';
  const namaById = getAkunNamaById_(val);
  return namaById || val;
}
