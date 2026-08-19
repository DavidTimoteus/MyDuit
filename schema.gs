/*******************************************************
 * MyDuit — schema.gs (SKEMA DATABASE REDESIGN)
 * Fase 0: initSchema() — membuat 7 sheet (tabel) sekaligus
 * beserta header-nya. Idempotent: aman dipanggil berkali-kali,
 * tidak akan menimpa data yang sudah ada.
 *
 * Referensi lengkap kolom & relasi ada di database.md
 *******************************************************/

// Definisi header per tabel. Urutan array = urutan kolom di sheet.
// Kolom pertama SELALU ID (Primary Key).
const SCHEMA_DEFINITION = {
  Akun: ['ID', 'Nama', 'Tipe', 'SaldoAwal', 'Saldo', 'UpdatedAt', 'CreatedAt'],
  Kategori: ['ID', 'Nama', 'Jenis', 'Aktif'],
  Transaksi: ['ID', 'Tanggal', 'Jenis', 'KategoriID', 'AkunID', 'AkunTujuanID', 'UtangID', 'Keterangan', 'Nominal'],
  Utang: ['ID', 'Tanggal', 'NamaPihak', 'Deskripsi', 'Total', 'TglJatuhTempo', 'Tipe', 'Status', 'CicilanPerBulan'],
  PembayaranUtang: ['ID', 'UtangID', 'TransaksiID', 'Tanggal', 'Nominal'],
  Budget: ['ID', 'KategoriID', 'Bulan', 'Tahun', 'LimitNominal'],
  MutasiLog: ['ID', 'AkunID', 'Timestamp', 'Aksi', 'Delta', 'TransaksiID']
};

// Prefix Primary Key per tabel, dipakai bersama generatePrimaryKey_(prefix)
// yang sudah ada di controller.gs (format: PREFIX-yyyyMMdd-HEX4).
const SCHEMA_PK_PREFIX = {
  Akun: 'AKN',
  Kategori: 'KAT',
  Transaksi: 'TX',
  Utang: 'UTG',
  PembayaranUtang: 'BAY',
  Budget: 'BGT',
  MutasiLog: 'LOG'
};

/**
 * ENTRY POINT Fase 0.
 * Jalankan manual sekali dari Apps Script Editor (pilih initSchema di
 * dropdown > Run), atau panggil dari doGet()/onOpen() kalau mau otomatis
 * saat pertama kali dibuka.
 *
 * Idempotent by design:
 * - Sheet yang belum ada -> dibuat + header ditulis.
 * - Sheet yang sudah ada -> HANYA divalidasi/dilengkapi header yang kurang
 *   (auto-healing, mengikuti pola getUtangSheet_() versi lama), TIDAK
 *   pernah menghapus/menimpa baris data yang sudah ada.
 *
 * @param {Spreadsheet} [targetSs] Opsional. Spreadsheet tujuan skema.
 *   Kalau tidak diisi, default ke SpreadsheetApp.getActiveSpreadsheet()
 *   (dipakai saat dites manual dari editor). Untuk alur per-user (lihat
 *   database-init.gs), selalu dipanggil dengan Spreadsheet milik user
 *   yang baru dibuat: initSchema(ss).
 */
function initSchema(targetSs) {
  const ss = targetSs || SpreadsheetApp.getActiveSpreadsheet();
  const summary = [];

  Object.keys(SCHEMA_DEFINITION).forEach(function (sheetName) {
    const headers = SCHEMA_DEFINITION[sheetName];
    const result = ensureSheetSchema_(ss, sheetName, headers);
    summary.push(result);
  });

  // Bersihkan "Sheet1" default kalau masih ada dan belum dipakai (kosong).
  removeDefaultEmptySheet_(ss);

  Logger.log('=== initSchema selesai ===');
  summary.forEach(function (s) {
    Logger.log(s.sheetName + ' -> ' + s.action + (s.headersAdded.length ? ' | header ditambahkan: ' + s.headersAdded.join(', ') : ''));
  });

  return { status: 'success', tables: summary };
}

/**
 * Pastikan 1 sheet ada dan header-nya lengkap sesuai skema.
 * - Sheet belum ada -> insertSheet + tulis semua header.
 * - Sheet sudah ada -> cek header row 1, lengkapi kolom yang hilang di
 *   posisi yang benar TANPA menggeser/menghapus data yang sudah ada.
 */
function ensureSheetSchema_(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  const result = { sheetName: sheetName, action: '', headersAdded: [] };

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    result.action = 'dibuat baru';
    result.headersAdded = headers;
    return result;
  }

  // Sheet sudah ada -> auto-healing header (mengikuti pola getUtangSheet_()
  // versi lama: cek tiap kolom, isi kalau kosong, tanpa menyentuh data).
  const existingLastCol = Math.max(sheet.getLastColumn(), 1);
  const existingHeaders = sheet.getRange(1, 1, 1, existingLastCol).getValues()[0];

  headers.forEach(function (headerName, idx) {
    const col = idx + 1;
    const current = col <= existingHeaders.length ? String(existingHeaders[col - 1]).trim() : '';
    if (current === '') {
      sheet.getRange(1, col).setValue(headerName);
      result.headersAdded.push(headerName);
    }
  });

  sheet.setFrozenRows(1);
  result.action = result.headersAdded.length ? 'header dilengkapi' : 'sudah lengkap';
  return result;
}

/**
 * Hapus "Sheet1" bawaan Google Spreadsheet HANYA kalau masih benar-benar
 * kosong (tidak ada isi sama sekali) dan bukan salah satu dari 7 tabel
 * skema. Tidak pernah menghapus sheet yang sudah berisi data.
 */
function removeDefaultEmptySheet_(ss) {
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (!defaultSheet) return;
  if (SCHEMA_DEFINITION.hasOwnProperty('Sheet1')) return;

  const isEmpty = defaultSheet.getLastRow() === 0 && defaultSheet.getLastColumn() === 0;
  if (isEmpty && ss.getSheets().length > 1) {
    ss.deleteSheet(defaultSheet);
  }
}

/**
 * DIAGNOSTIK: jalankan manual untuk melihat status semua tabel skema
 * (ada/tidak, jumlah baris data, header lengkap/tidak) tanpa mengubah
 * apa pun. Berguna sebelum mulai Fase 1 (Akun & Kategori) untuk
 * memastikan initSchema() sudah berjalan benar.
 */
function debugSchemaStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SCHEMA_DEFINITION).forEach(function (sheetName) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(sheetName + ' -> TIDAK ADA (jalankan initSchema() dulu)');
      return;
    }
    const lastRow = sheet.getLastRow();
    const headerRow = lastRow > 0 ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
    const expected = SCHEMA_DEFINITION[sheetName];
    const missing = expected.filter(function (h) { return headerRow.indexOf(h) === -1; });
    Logger.log(
      sheetName + ' -> baris data: ' + Math.max(0, lastRow - 1) +
      ' | header: ' + (missing.length === 0 ? 'lengkap' : 'KURANG (' + missing.join(', ') + ')')
    );
  });
}
