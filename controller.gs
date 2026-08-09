/*******************************************************
 * MyDuit — controller.gs (FULL AUTO-HEALING PRIMARY KEY)
 * Backend Apps Script - Ultra Fast CRUD & Sync
 *******************************************************/

const CONFIG = {
  SHEET_NAME: "in/out",
  START_ROW: 6
};

const SHEET_DOMPET = 'Dompet';
// PERBAIKAN: Timestamp "Total Semua Saldo" ternyata ada di D4 (bukan C4) di sheet asli
// (lihat hasil debugDompetLayout: Baris 4 -> col4/D berisi ISO date, col5/E berisi angka total).
const CELL_LAST_UPDATED = 'D4';

// Konfigurasi Dompet (Baris 7, sesuai hasil debugDompetLayout: PK justru di Kolom A, bukan F)
// Header asli sheet: A=Primary Key, B=Nama Akun, C=Saldo Saat ini, D=Perubahan Terakhir, E=Tipe, F=Catatan
const DOMPET_START_ROW = 7;
const DOMPET_COL = {
  ID: 1,          // Kolom A (Primary Key)
  NAMA: 2,        // Kolom B (Nama Akun)
  SALDO: 3,       // Kolom C (Saldo Saat ini / Saldo Akhir hasil kalkulasi)
  UPDATED_AT: 4,  // Kolom D (Perubahan Terakhir)
  TIPE: 5,        // Kolom E (Tipe akun, mis. Rekening Utama/Tabungan/E-Wallet/Dana Darurat)
  CATATAN: 6      // Kolom F (Audit log "Last Updated" otomatis, BUKAN input manual)
};
const BULAN_NAMA = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// ============ CACHE (OPTIMASI BACA/TULIS SHEET) ============
// Tujuan: dalam window singkat (60 detik), ganti halaman/filter riwayat berkali-kali
// atau bolak-balik ke tab Budget TIDAK perlu baca fisik ke Sheet lagi -> pakai
// CacheService.getScriptCache() (dibagi semua user Web App ini, sesuai kebutuhan kita
// krn data keuangan sama utk semua pengakses). Cache di-invalidate LANGSUNG begitu ada
// CRUD (bukan menunggu TTL habis), jadi data yg ditampilkan tetap selalu benar/terbaru.
const CACHE_TTL_SECONDS = 60;
const CACHE_KEY_RAW_TRANSAKSI = 'rawTransaksiInOut_v1';
const CACHE_KEY_DOMPET_PAYLOAD = 'dompetPayload_v1';

function invalidateTransaksiCache_() {
  CacheService.getScriptCache().remove(CACHE_KEY_RAW_TRANSAKSI);
}
function invalidateDompetCache_() {
  CacheService.getScriptCache().remove(CACHE_KEY_DOMPET_PAYLOAD);
}

// Baca seluruh baris Sheet 'in/out' (kolom A:G), pakai cache 60 detik. getRiwayatKasServer()
// WAJIB lewat sini (bukan getRange() sendiri), supaya ganti halaman/filter yg sering terjadi
// dalam waktu singkat cukup 1x baca fisik ke sheet, sisanya difilter dari cache di memory.
function getRawTransaksiCached_(sheet) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEY_RAW_TRANSAKSI);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      // Revive kolom tanggal (index 1) balik jadi Date object (JSON menyimpannya sbg string ISO)
      return parsed.map(row => {
        row[1] = row[1] ? new Date(row[1]) : row[1];
        return row;
      });
    } catch (e) {
      // Cache korup/format tak terduga -> abaikan, lanjut baca sheet asli di bawah
    }
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.START_ROW) return [];
  let rawData = sheet.getRange(CONFIG.START_ROW, 1, lastRow - CONFIG.START_ROW + 1, 7).getValues(); // satu-satunya baca fisik
  rawData = maybeRunCleanup(sheet, rawData);

  try {
    cache.put(CACHE_KEY_RAW_TRANSAKSI, JSON.stringify(rawData), CACHE_TTL_SECONDS);
  } catch (e) {
    // Data terlalu besar utk cache (limit 100KB/key) -> lewati caching, tetap lanjut tanpa cache
  }
  return rawData;
}

// ============ ENTRY POINT ============
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('View_Index');
  const initialFilter = { tipe: 'semua', startDate: '', endDate: '', jenis: 'Semua', search: '' };

  template.initialKategori = fetchKategoriServer();
  template.initialRiwayat = getRiwayatKasServer(1, 10, initialFilter);
  template.initialDompet = getDompetServer(); // OPTIMASI: inline sekali di awal, switchTab('budget') 0 round-trip

  return template.evaluate()
    .setTitle('MyDuit Laporan Keuangan')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${CONFIG.SHEET_NAME}" tidak ditemukan.`);
  return sheet;
}

// PERBAIKAN BUG "Gagal mengambil data Dompet":
// getSheetByName() Apps Script itu EXACT MATCH (case-sensitive & tidak trim spasi).
// Kalau nama tab sebenarnya "Dompet " (ada spasi nyasar), "dompet", atau "DOMPET",
// getSheetByName('Dompet') akan return null walau tab-nya kelihatan sama di mata manusia.
// Helper ini fallback ke pencocokan case-insensitive + trim supaya tidak gagal diam-diam.
function getDompetSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_DOMPET);
  if (sheet) return sheet;

  const target = SHEET_DOMPET.trim().toLowerCase();
  const allSheets = ss.getSheets();
  for (let i = 0; i < allSheets.length; i++) {
    if (allSheets[i].getName().trim().toLowerCase() === target) return allSheets[i];
  }
  return null; // benar-benar tidak ada tab yang cocok
}

// DIAGNOSTIK: jalankan fungsi ini manual dari Apps Script Editor (pilih nama fungsi
// di dropdown atas > tombol Run), lalu buka menu "Executions"/"Eksekusi" atau
// View > Logs (Ctrl+Enter) untuk melihat hasilnya.
// Tujuannya: menunjukkan PERSIS isi baris 1-15 Sheet 'Dompet' apa adanya, dibandingkan
// dengan asumsi CONFIG saat ini (DOMPET_START_ROW & DOMPET_COL), supaya kalau ada
// pergeseran baris/kolom (mis. header nambah baris, kolom PK disisipkan di posisi lain)
// langsung ketahuan tanpa tebak-tebakan.
function debugDompetLayout() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const allNames = ss.getSheets().map(s => s.getName());
  Logger.log('Semua nama tab di spreadsheet ini: ' + JSON.stringify(allNames));

  const sheet = getDompetSheet_();
  if (!sheet) {
    Logger.log('>>> Sheet "Dompet" TIDAK DITEMUKAN (exact maupun case-insensitive). Cek nama tab di atas.');
    return;
  }

  Logger.log('Sheet Dompet ditemukan dengan nama tab: "' + sheet.getName() + '" | lastRow=' + sheet.getLastRow() + ' | lastColumn=' + sheet.getLastColumn());
  Logger.log('CONFIG saat ini -> DOMPET_START_ROW=' + DOMPET_START_ROW + ', DOMPET_COL=' + JSON.stringify(DOMPET_COL));

  const lastRow = sheet.getLastRow();
  if (lastRow < 1) { Logger.log('Sheet Dompet kosong total.'); return; }

  const maxRow = Math.min(lastRow, 15);
  const maxCol = Math.max(sheet.getLastColumn(), 6);
  const data = sheet.getRange(1, 1, maxRow, maxCol).getValues();
  data.forEach((row, i) => {
    Logger.log('Baris ' + (i + 1) + ': ' + JSON.stringify(row));
  });
  Logger.log('>>> Bandingkan baris keberapa yang benar-benar berisi NAMA AKUN pertama dengan DOMPET_START_ROW=' + DOMPET_START_ROW + ' di atas.');
}

// OPSIONAL: Kolom F di Sheet 'Dompet' sudah tidak punya header/fungsi (peninggalan
// versi script lama yang salah kolom, isinya timestamp basi). Jalankan manual dari
// Apps Script Editor kalau mau membersihkannya. TIDAK dipanggil otomatis oleh sistem
// manapun, supaya tidak menghapus data tanpa sepengetahuan Anda.
function cleanupKolomFDompet() {
  const sheet = getDompetSheet_();
  if (!sheet) { Logger.log('Sheet Dompet tidak ditemukan.'); return; }
  const lastRow = sheet.getLastRow();
  if (lastRow < DOMPET_START_ROW) { Logger.log('Tidak ada baris data untuk dibersihkan.'); return; }
  const numRows = lastRow - DOMPET_START_ROW + 1;
  const kolomF = sheet.getRange(DOMPET_START_ROW, 6, numRows, 1);
  const before = kolomF.getValues().flat();
  kolomF.clearContent();
  Logger.log('Kolom F dibersihkan untuk ' + numRows + ' baris. Isi sebelumnya: ' + JSON.stringify(before));
}

// ============ HELPER: PRIMARY KEY & GENERATOR ============
function generatePrimaryKey_(prefix) {
  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const todayStr = Utilities.formatDate(new Date(), timeZone, 'yyyyMMdd');
  const randomHex = Math.floor(Math.random() * 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
  return `${prefix}-${todayStr}-${randomHex}`;
}

// PENCARIAN CEPAT BERDASARKAN ID UNIK (O(N) 1 Kolom)
function findRowIndexById_(sheet, id, startRow, idColIndex) {
  if (!id) return -1;
  const lastRow = sheet.getLastRow();
  if (lastRow < startRow) return -1;

  const idColumnValues = sheet.getRange(startRow, idColIndex, lastRow - startRow + 1, 1).getValues();
  for (let i = 0; i < idColumnValues.length; i++) {
    if (String(idColumnValues[i][0]).trim() === String(id).trim()) {
      return startRow + i;
    }
  }
  return -1;
}

// BACKFILL MANUAL (OPSIONAL - Sistem kini sudah Auto-Healing)
function backfillAllPrimaryKeys() {
  const sheetTx = getSheet();
  const lastRowTx = sheetTx.getLastRow();
  if (lastRowTx >= CONFIG.START_ROW) {
    const rangeTx = sheetTx.getRange(CONFIG.START_ROW, 1, lastRowTx - CONFIG.START_ROW + 1, 1);
    const valsTx = rangeTx.getValues();
    let changedTx = false;
    for (let i = 0; i < valsTx.length; i++) {
      if (!valsTx[i][0] || String(valsTx[i][0]).trim() === "") { valsTx[i][0] = generatePrimaryKey_('TX'); changedTx = true; }
    }
    if (changedTx) rangeTx.setValues(valsTx);
  }

  const sheetDompet = getDompetSheet_();
  if (sheetDompet) {
    const lastRowDompet = sheetDompet.getLastRow();
    if (lastRowDompet >= DOMPET_START_ROW) {
      const rangeD = sheetDompet.getRange(DOMPET_START_ROW, DOMPET_COL.ID, lastRowDompet - DOMPET_START_ROW + 1, 1);
      const valsD = rangeD.getValues();
      let changedD = false;
      for (let i = 0; i < valsD.length; i++) {
        if (!valsD[i][0] || String(valsD[i][0]).trim() === "") { valsD[i][0] = generatePrimaryKey_('ACC'); changedD = true; }
      }
      if (changedD) rangeD.setValues(valsD);
    }
  }
}

// ============ DATE PARSER & CLEANUP ============
function parseSheetDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'string') {
    let d = new Date(val.trim());
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function maybeRunCleanup(sheet, rawData) {
  const props = PropertiesService.getScriptProperties();
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (props.getProperty('lastCleanupDate') === todayStr) return rawData;

  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  twoYearsAgo.setHours(0, 0, 0, 0);

  const validRows = [];
  let changed = false;
  rawData.forEach(row => {
    const parsedDate = parseSheetDate(row[1]);
    if (parsedDate) {
      parsedDate.setHours(0, 0, 0, 0);
      if (parsedDate >= twoYearsAgo) validRows.push(row); else changed = true;
    } else if (row.some(cell => cell !== "")) {
      validRows.push(row);
    }
  });

  if (changed) {
    sheet.getRange(CONFIG.START_ROW, 1, rawData.length, 7).clearContent();
    if (validRows.length > 0) sheet.getRange(CONFIG.START_ROW, 1, validRows.length, 7).setValues(validRows);
  }
  props.setProperty('lastCleanupDate', todayStr);
  return validRows;
}

// ============ READ DATA TRANSAKSI ============
function getRiwayatKasServer(page, limit, filterParams) {
  try {
    const pageNum = page || 1;
    const limitNum = limit || 10;
    const sheet = getSheet();
    const lastRow = sheet.getLastRow();

    if (lastRow < CONFIG.START_ROW) return { status: "success", data: [], totalPages: 0, currentPage: 1 };

    // OPTIMASI: lewat cache 60 detik drpd getRange() langsung, supaya ganti halaman/filter
    // berkali-kali dalam waktu singkat tidak baca fisik sheet berkali-kali.
    let rawData = getRawTransaksiCached_(sheet);

    const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    const now = new Date(); now.setHours(0, 0, 0, 0);

    let formattedList = [];
    let needFlush = false;

    rawData.forEach((row, idx) => {
      let id = row[0];
      const parsedDate = parseSheetDate(row[1]);

      // AUTO-HEALING: Jika ID belum ada di Kolom A, langsung generate ID baru!
      if (!id && (parsedDate || row[2] || row[6])) {
        id = generatePrimaryKey_('TX');
        row[0] = id;
        sheet.getRange(CONFIG.START_ROW + idx, 1).setValue(id);
        needFlush = true;
      }

      if (!id || !parsedDate) return;
      parsedDate.setHours(0, 0, 0, 0);

      // Filtering
      if (filterParams) {
        if (filterParams.tipe === '7hari' && Math.floor((now - parsedDate) / 86400000) > 7) return;
        if (filterParams.tipe === '30hari' && Math.floor((now - parsedDate) / 86400000) > 30) return;
        if (filterParams.tipe === 'custom' && filterParams.startDate && filterParams.endDate) {
          const start = parseSheetDate(filterParams.startDate);
          const end = parseSheetDate(filterParams.endDate);
          if (start && end) { start.setHours(0, 0, 0, 0); end.setHours(0, 0, 0, 0); if (parsedDate < start || parsedDate > end) return; }
        }

        const jenisLower = String(row[2] || '').toLowerCase();
        const isIncome = (jenisLower === 'pemasukan' || jenisLower === 'pendapatan');
        if (filterParams.jenis === 'Pemasukan' && !isIncome) return;
        if (filterParams.jenis === 'Pengeluaran' && isIncome) return;

        if (filterParams.search) {
          const q = filterParams.search.toLowerCase();
          const match = String(row[3]).toLowerCase().includes(q) || String(row[5]).toLowerCase().includes(q) || String(row[4]).toLowerCase().includes(q);
          if (!match) return;
        }
      }

      formattedList.push({
        id: id,
        tanggal: Utilities.formatDate(parsedDate, timeZone, "dd/MM/yyyy"),
        tanggalRaw: Utilities.formatDate(parsedDate, timeZone, "yyyy-MM-dd"),
        jenis: row[2] || "",
        kategori: row[3] || "",
        sumber: row[4] || "",
        keterangan: row[5] || "",
        nominal: Number(row[6]) || 0
      });
    });

    if (needFlush) { SpreadsheetApp.flush(); invalidateTransaksiCache_(); } // ID auto-healed -> cache lama sudah stale

    formattedList.sort((a, b) => new Date(b.tanggalRaw) - new Date(a.tanggalRaw));
    const totalPages = Math.ceil(formattedList.length / limitNum) || 1;
    const startIndex = (pageNum - 1) * limitNum;

    return { status: "success", data: formattedList.slice(startIndex, startIndex + limitNum), totalPages, currentPage: pageNum };
  } catch (err) {
    return { status: "error", message: err.message };
  }
}

function fetchKategoriServer() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('kategoriList');
  if (cached) return JSON.parse(cached);
  try {
    const sheet = getSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < CONFIG.START_ROW) return [];
    const data = sheet.getRange(CONFIG.START_ROW, 4, lastRow - CONFIG.START_ROW + 1, 1).getValues();
    const unique = [...new Set(data.map(r => String(r[0]).trim()).filter(k => k !== ""))].sort();
    cache.put('kategoriList', JSON.stringify(unique), 300); // PERBAIKAN: 6 jam -> 5 menit, supaya perubahan tidak nyangkut lama di cache
    return unique;
  } catch (e) { return []; }
}

function fetchSumberAkunServer() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('sumberAkunList');
  if (cached) return JSON.parse(cached);
  try {
    const sheet = getDompetSheet_();
    if (!sheet) return [];
    const lastRow = sheet.getLastRow();
    if (lastRow < DOMPET_START_ROW) return [];
    const data = sheet.getRange(DOMPET_START_ROW, DOMPET_COL.NAMA, lastRow - DOMPET_START_ROW + 1, 1).getValues();
    const list = data.map(r => String(r[0]).trim()).filter(v => v !== "");
    cache.put('sumberAkunList', JSON.stringify(list), 300); // PERBAIKAN: 6 jam -> 5 menit
    return list;
  } catch (e) { return []; }
}

// PERBAIKAN BUG "Dropdown Sumber/Akun kosong": cache 'sumberAkunList'/'kategoriList' lama
// (TTL 6 jam) sempat kesimpan KOSONG karena dibaca saat DOMPET_COL masih salah mapping.
// Jalankan fungsi ini SEKALI dari Apps Script Editor (dropdown fungsi di atas > Run)
// untuk langsung membuang cache basi tsb tanpa perlu menunggu kedaluwarsa.
function clearAppCache() {
  CacheService.getScriptCache().removeAll(['kategoriList', 'sumberAkunList']);
  Logger.log('Cache kategoriList & sumberAkunList sudah dibersihkan. Reload halaman aplikasi untuk ambil data terbaru dari Sheet.');
}

// ============ CRUD TRANSAKSI ============
function simpanTransaksiServer(formData, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const id = generatePrimaryKey_('TX');

    getSheet().appendRow([id, new Date(formData.tanggal), formData.jenis, formData.kategori, formData.sumber, formData.keterangan, Number(formData.nominal)]);
    invalidateTransaksiCache_(); // OPTIMASI: cache raw lama pasti stale setelah insert

    // OPTIMASI: delta ke 1 akun saja (bukan scan ulang seluruh sheet 'in/out' + rewrite seluruh Dompet)
    applyDeltaSaldoDompet_(formData.sumber, hitungDeltaTransaksi_(formData.jenis, formData.nominal));

    const riwayat = getRiwayatKasServer(page, limit, filterParams);
    CacheService.getScriptCache().removeAll(['kategoriList', 'sumberAkunList']);
    return { status: "success", riwayat: riwayat, dompet: getDompetServer() };
  } catch (err) {
    return { status: "error", message: err.message };
  } finally { lock.releaseLock(); }
}

function updateTransaksiServer(formData, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getSheet();
    const targetRow = findRowIndexById_(sheet, formData.id, CONFIG.START_ROW, 1);
    if (targetRow === -1) throw new Error("Data tidak ditemukan di database.");

    // Baca data LAMA dulu (perlu untuk balikkan delta saldo sebelum ditimpa nilai baru)
    const dataLama = sheet.getRange(targetRow, 3, 1, 5).getValues()[0]; // C:G -> [jenis, kategori, sumber, keterangan, nominal]
    const jenisLama = dataLama[0], sumberLama = dataLama[2], nominalLama = dataLama[4];

    sheet.getRange(targetRow, 2, 1, 6).setValues([[new Date(formData.tanggal), formData.jenis, formData.kategori, formData.sumber, formData.keterangan, Number(formData.nominal)]]);
    invalidateTransaksiCache_(); // OPTIMASI: cache raw lama pasti stale setelah update

    // OPTIMASI I/O: kalau akun sumber TIDAK berubah (kasus paling umum saat edit), gabung jadi
    // 1x panggilan delta bersih (net) -> 1x read+write ke Dompet, bukan 2x round-trip terpisah.
    const deltaLama = hitungDeltaTransaksi_(jenisLama, nominalLama);
    const deltaBaru = hitungDeltaTransaksi_(formData.jenis, formData.nominal);
    if (String(sumberLama).trim() === String(formData.sumber).trim()) {
      applyDeltaSaldoDompet_(formData.sumber, deltaBaru - deltaLama);
    } else {
      applyDeltaSaldoDompet_(sumberLama, -deltaLama);
      applyDeltaSaldoDompet_(formData.sumber, deltaBaru);
    }

    const riwayat = getRiwayatKasServer(page, limit, filterParams);
    CacheService.getScriptCache().removeAll(['kategoriList', 'sumberAkunList']);
    return { status: "success", riwayat: riwayat, dompet: getDompetServer() };
  } catch (err) {
    return { status: "error", message: err.message };
  } finally { lock.releaseLock(); }
}

function hapusTransaksiServer(id, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getSheet();
    const targetRow = findRowIndexById_(sheet, id, CONFIG.START_ROW, 1);
    if (targetRow === -1) throw new Error("Data transaksi sudah terhapus.");

    // Baca dulu sebelum baris dihapus, untuk balikkan efek saldo-nya
    const dataLama = sheet.getRange(targetRow, 3, 1, 5).getValues()[0];
    const jenisLama = dataLama[0], sumberLama = dataLama[2], nominalLama = dataLama[4];

    sheet.deleteRow(targetRow);
    invalidateTransaksiCache_(); // OPTIMASI: cache raw lama pasti stale setelah hapus

    // OPTIMASI: balikkan delta ke 1 akun saja, tanpa scan ulang seluruh sheet
    applyDeltaSaldoDompet_(sumberLama, -hitungDeltaTransaksi_(jenisLama, nominalLama));

    const riwayat = getRiwayatKasServer(page, limit, filterParams);
    CacheService.getScriptCache().removeAll(['kategoriList', 'sumberAkunList']);
    return { status: "success", riwayat: riwayat, dompet: getDompetServer() };
  } catch (err) {
    return { status: "error", message: err.message };
  } finally { lock.releaseLock(); }
}

// ===== SINKRONISASI SALDO BERBASIS DELTA (ganti full-recalculation demi kecepatan CRUD) =====
// +nominal untuk Pemasukan, -nominal untuk Pengeluaran.
function hitungDeltaTransaksi_(jenis, nominal) {
  const n = Number(nominal) || 0;
  return String(jenis).trim().toLowerCase() === 'pengeluaran' ? -n : n;
}

// Update SATU baris akun saja (1x getValue + 1x setValue per kolom yang berubah) —
// jauh lebih cepat dari recalculateSaldoDompet_() yang scan ULANG seluruh sheet 'in/out'
// dan rewrite SEMUA baris Dompet di setiap aksi CRUD. recalculateSaldoDompet_() masih
// disimpan di bawah untuk reconciliation manual saja (tidak dipanggil di alur CRUD normal).
function applyDeltaSaldoDompet_(namaAkun, delta) {
  namaAkun = String(namaAkun || '').trim();
  if (!namaAkun || !delta) return;

  const sheet = getDompetSheet_();
  if (!sheet) { Logger.log('applyDeltaSaldoDompet_: Sheet Dompet tidak ditemukan.'); return; }

  const lastRow = sheet.getLastRow();
  if (lastRow < DOMPET_START_ROW) return;

  const numAkun = lastRow - DOMPET_START_ROW + 1;
  // OPTIMASI I/O: 1x getValues() gabungan NAMA+SALDO+UPDATED_AT (kolom 2-4, berurutan),
  // bukan getValues() cari nama lalu getValue() saldo terpisah (dulu 2 read call).
  const data = sheet.getRange(DOMPET_START_ROW, DOMPET_COL.NAMA, numAkun, 3).getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === namaAkun) {
      const rowIdx = DOMPET_START_ROW + i;
      const saldoBaru = (Number(data[i][1]) || 0) + delta;
      // OPTIMASI I/O: 1x setValues() gabungan SALDO+UPDATED_AT (kolom 3-4), bukan 2 setValue() terpisah.
      sheet.getRange(rowIdx, DOMPET_COL.SALDO, 1, 2).setValues([[saldoBaru, new Date()]]);
      invalidateDompetCache_();
      const dompet = getDompetServer();
      CacheService.getScriptCache().put(CACHE_KEY_DOMPET_PAYLOAD, JSON.stringify(dompet), CACHE_TTL_SECONDS);
      saveLastUpdatedDompet_();
      return;
    }
  }
  Logger.log('applyDeltaSaldoDompet_: akun "' + namaAkun + '" tidak ditemukan di Sheet Dompet.');
}

// ============ SINKRONISASI DOMPET (AUTO-HEALING PK) ============
function getDompetServer() {
  // OPTIMASI: cache 60 detik utk seluruh payload Dompet (total saldo + daftar rekening).
  // switchTab('budget') berkali-kali / buka-tutup app dlm window singkat = 0 baca fisik sheet.
  const cache = CacheService.getScriptCache();
  const cachedPayload = cache.get(CACHE_KEY_DOMPET_PAYLOAD);
  if (cachedPayload) {
    try { return JSON.parse(cachedPayload); } catch (e) { /* cache korup, lanjut hitung ulang di bawah */ }
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getDompetSheet_();
    if (!sheet) {
      const allNames = ss.getSheets().map(s => s.getName()).join(', ');
      return { status: "error", message: `Sheet "Dompet" tidak ditemukan. Tab yang ada: ${allNames}` };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < DOMPET_START_ROW) {
      const emptyResult = { status: "success", totalSaldo: 0, rekening: [], lastUpdated: readLastUpdatedDompet_() };
      try { cache.put(CACHE_KEY_DOMPET_PAYLOAD, JSON.stringify(emptyResult), CACHE_TTL_SECONDS); } catch (e) { }
      return emptyResult;
    }

    const numRows = lastRow - DOMPET_START_ROW + 1;
    const data = sheet.getRange(DOMPET_START_ROW, 1, numRows, 6).getValues(); // A:F (Tipe & Catatan ikut terbaca)
    const timeZone = ss.getSpreadsheetTimeZone();

    let totalSaldo = 0;
    const rekening = [];
    let needFlush = false;

    data.forEach((row, idx) => {
      const nama = String(row[DOMPET_COL.NAMA - 1] || '').trim();
      if (!nama) return; // Lewati jika nama akun kosong

      let id = String(row[DOMPET_COL.ID - 1] || '').trim();

      // AUTO-HEALING: Jika Primary Key di Kolom A belum terisi, buatkan otomatis & simpan ke Google Sheet!
      if (!id) {
        id = generatePrimaryKey_('ACC');
        data[idx][DOMPET_COL.ID - 1] = id;
        sheet.getRange(DOMPET_START_ROW + idx, DOMPET_COL.ID).setValue(id);
        needFlush = true;
      }

      const saldo = Number(row[DOMPET_COL.SALDO - 1]) || 0;
      totalSaldo += saldo;

      let lastUpd = "-";
      if (row[DOMPET_COL.UPDATED_AT - 1]) {
        const d = new Date(row[DOMPET_COL.UPDATED_AT - 1]);
        if (!isNaN(d.getTime())) {
          lastUpd = Utilities.formatDate(d, timeZone, "dd/MM/yyyy HH:mm");
        }
      }

      rekening.push({
        id: id,
        nama: nama,
        saldo: saldo,
        tipe: String(row[DOMPET_COL.TIPE - 1] || '').trim(),
        catatan: row[DOMPET_COL.CATATAN - 1] || "", // audit log "Last Updated", bukan input manual
        terakhirDiperbarui: lastUpd
      });
    });

    if (needFlush) SpreadsheetApp.flush();

    const result = { status: 'success', totalSaldo: totalSaldo, rekening: rekening, lastUpdated: readLastUpdatedDompet_() };
    try { cache.put(CACHE_KEY_DOMPET_PAYLOAD, JSON.stringify(result), CACHE_TTL_SECONDS); } catch (e) {
      // Jumlah rekening terlalu banyak utk 1 cache key (>100KB) -> lewati caching, tetap kembalikan hasil
    }
    return result;
  } catch (err) {
    Logger.log('getDompetServer ERROR: ' + (err.stack || err.message)); // cek di Executions/Logs kalau error lagi
    return { status: "error", message: err.message };
  }
}

// TAMBAH REKENING BARU LANGSUNG DARI SISTEM (tidak perlu lagi tulis manual di Sheet Dompet)
function simpanRekeningServer(nama, saldoAwal, tipe) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    nama = String(nama || '').trim();
    tipe = String(tipe || '').trim();
    if (!nama) throw new Error('Nama akun tidak boleh kosong.');
    if (!tipe) throw new Error('Tipe rekening wajib diisi.');

    const sheet = getDompetSheet_();
    if (!sheet) throw new Error('Sheet "Dompet" tidak ditemukan.');

    const lastRow = sheet.getLastRow();
    // Cegah nama akun duplikat (case-insensitive) -> nama akun dipakai sebagai referensi "Sumber" di transaksi
    if (lastRow >= DOMPET_START_ROW) {
      const namaSudahAda = sheet.getRange(DOMPET_START_ROW, DOMPET_COL.NAMA, lastRow - DOMPET_START_ROW + 1, 1)
        .getValues()
        .some(r => String(r[0] || '').trim().toLowerCase() === nama.toLowerCase());
      if (namaSudahAda) throw new Error(`Akun "${nama}" sudah ada.`);
    }

    const id = generatePrimaryKey_('ACC');
    // A=ID, B=NAMA, C=SALDO, D=UPDATED_AT, E=TIPE, F=CATATAN
    // Tipe diisi dari input wajib user; Catatan default kosong -> hanya terisi otomatis via updateRekeningServer()
    sheet.appendRow([id, nama, Number(saldoAwal) || 0, new Date(), tipe, '']);
    invalidateDompetCache_(); // OPTIMASI: cache payload Dompet lama pasti stale setelah rekening baru dibuat
    const dompet = getDompetServer();
    CacheService.getScriptCache().put(CACHE_KEY_DOMPET_PAYLOAD, JSON.stringify(dompet), CACHE_TTL_SECONDS);
    CacheService.getScriptCache().removeAll(['sumberAkunList']); // biar dropdown "Sumber" di form transaksi langsung update

    return { status: 'success', dompet };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

// EDIT REKENING (triple-tap dari UI) — Catatan TIDAK bisa diisi manual, hanya audit log otomatis.
function updateRekeningServer(formData) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getDompetSheet_();
    if (!sheet) throw new Error('Sheet "Dompet" tidak ditemukan.');

    const targetRow = findRowIndexById_(sheet, formData.id, DOMPET_START_ROW, DOMPET_COL.ID);
    if (targetRow === -1) throw new Error('Rekening tidak ditemukan (mungkin sudah dihapus).');

    const dataLama = sheet.getRange(targetRow, 1, 1, 6).getValues()[0];
    const namaLama = String(dataLama[DOMPET_COL.NAMA - 1] || '').trim();
    const saldoLama = Number(dataLama[DOMPET_COL.SALDO - 1]) || 0;
    const tipeLama = String(dataLama[DOMPET_COL.TIPE - 1] || '').trim();
    const catatanLama = String(dataLama[DOMPET_COL.CATATAN - 1] || ''); // hasil log audit sebelumnya, dipertahankan

    const namaBaru = String(formData.nama || '').trim();
    const saldoBaru = Number(formData.saldo) || 0;
    const tipeBaru = String(formData.tipe || '').trim();
    if (!namaBaru) throw new Error('Nama akun tidak boleh kosong.');

    // AUDIT LOG: bandingkan data lama vs baru, 1 baris log per field yang berubah.
    // Catatan TIDAK lagi bisa diisi manual dari form (readonly di frontend) -> formData.catatan diabaikan.
    const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    const now = new Date();
    const ts = Utilities.formatDate(now, timeZone, "dd/MM/yyyy HH:mm");

    const perubahan = [];
    if (namaLama !== namaBaru) perubahan.push({ field: 'nama', lama: namaLama || '-', baru: namaBaru || '-' });
    if (saldoLama !== saldoBaru) perubahan.push({ field: 'saldo', lama: saldoLama.toLocaleString('id-ID'), baru: saldoBaru.toLocaleString('id-ID') });
    if (tipeLama !== tipeBaru) perubahan.push({ field: 'tipe', lama: tipeLama || '-', baru: tipeBaru || '-' });

    const logBaru = perubahan
      .map(p => `Last Updated - [${ts}] Perubahan: ${p.field} "${p.lama}" -> "${p.baru}"`)
      .join('\n');

    // Audit log bersifat kumulatif (riwayat), log baru ditambahkan di bawah log lama.
    const catatanFinal = logBaru ? (catatanLama ? `${catatanLama}\n${logBaru}` : logBaru) : catatanLama;

    // B:F -> NAMA, SALDO, UPDATED_AT, TIPE, CATATAN (ID di kolom A tidak diubah)
    sheet.getRange(targetRow, DOMPET_COL.NAMA, 1, 5).setValues([[namaBaru, saldoBaru, now, tipeBaru, catatanFinal]]);
    invalidateDompetCache_(); // OPTIMASI: cache payload Dompet lama pasti stale setelah update
    const dompet = getDompetServer();
    CacheService.getScriptCache().put(CACHE_KEY_DOMPET_PAYLOAD, JSON.stringify(dompet), CACHE_TTL_SECONDS);

    if (namaLama !== namaBaru) CacheService.getScriptCache().removeAll(['sumberAkunList']); // nama akun dipakai sbg "Sumber" transaksi
    saveLastUpdatedDompet_();

    return { status: 'success', dompet };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

// HAPUS REKENING (dari UI: tap card -> tombol hapus merah -> modal konfirmasi)
function hapusRekeningServer(id) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getDompetSheet_();
    if (!sheet) throw new Error('Sheet "Dompet" tidak ditemukan.');

    const targetRow = findRowIndexById_(sheet, id, DOMPET_START_ROW, DOMPET_COL.ID);
    if (targetRow === -1) throw new Error('Rekening sudah terhapus.');

    sheet.deleteRow(targetRow);
    invalidateDompetCache_(); // OPTIMASI: cache payload Dompet lama pasti stale setelah rekening dihapus
    const dompet = getDompetServer();
    CacheService.getScriptCache().put(CACHE_KEY_DOMPET_PAYLOAD, JSON.stringify(dompet), CACHE_TTL_SECONDS);
    CacheService.getScriptCache().removeAll(['sumberAkunList']);
    saveLastUpdatedDompet_();

    return { status: 'success', dompet };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

// CATATAN: fungsi ini TIDAK lagi dipanggil otomatis di alur CRUD (diganti applyDeltaSaldoDompet_
// di atas demi kecepatan). Simpan sebagai alat reconciliation manual kalau saldo pernah "drift"
// (mis. edit langsung di Sheet) -> jalankan manual dari Apps Script Editor kalau perlu.
function recalculateSaldoDompet_() {
  const dompetSheet = getDompetSheet_();
  if (!dompetSheet) {
    Logger.log('recalculateSaldoDompet_: Sheet "Dompet" tidak ditemukan, saldo TIDAK disinkronkan.');
    return;
  }

  const lastDompetRow = dompetSheet.getLastRow();
  if (lastDompetRow < DOMPET_START_ROW) return;

  const numAkun = lastDompetRow - DOMPET_START_ROW + 1;
  const dompetData = dompetSheet.getRange(DOMPET_START_ROW, 1, numAkun, 5).getValues(); // A:E

  const totals = hitungTotalPerAkun_();
  let adaPerubahan = false;
  const now = new Date();

  const newSaldoValues = [];
  const newUpdateValues = [];
  const newIdValues = [];

  dompetData.forEach((row) => {
    const nama = String(row[DOMPET_COL.NAMA - 1] || '').trim();
    const saldoLama = Number(row[DOMPET_COL.SALDO - 1]) || 0;
    const timestampLama = row[DOMPET_COL.UPDATED_AT - 1] || '';
    let id = String(row[DOMPET_COL.ID - 1] || '').trim();

    if (!nama) {
      newSaldoValues.push([saldoLama]);
      newUpdateValues.push([timestampLama]);
      newIdValues.push([id]);
      return;
    }

    if (!id) {
      id = generatePrimaryKey_('ACC');
    }

    const t = totals[nama] || { masuk: 0, keluar: 0 };
    // TIDAK ADA lagi "Saldo Awal" (kolom itu sudah dihapus dari sheet) -> mulai dari 0,
    // sesuai keputusan: Saldo Akhir = 0 + Total Pemasukan - Total Pengeluaran.
    const saldoAkhir = 0 + t.masuk - t.keluar;

    newSaldoValues.push([saldoAkhir]);
    newIdValues.push([id]);

    if (saldoAkhir !== saldoLama) {
      adaPerubahan = true;
      newUpdateValues.push([now]);
    } else {
      newUpdateValues.push([timestampLama]);
    }
  });

  dompetSheet.getRange(DOMPET_START_ROW, DOMPET_COL.SALDO, numAkun, 1).setValues(newSaldoValues);
  dompetSheet.getRange(DOMPET_START_ROW, DOMPET_COL.UPDATED_AT, numAkun, 1).setValues(newUpdateValues);
  dompetSheet.getRange(DOMPET_START_ROW, DOMPET_COL.ID, numAkun, 1).setValues(newIdValues);

  if (adaPerubahan) saveLastUpdatedDompet_();
}

function hitungTotalPerAkun_() {
  const totals = {};
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.START_ROW) return totals;

  const data = sheet.getRange(CONFIG.START_ROW, 1, lastRow - CONFIG.START_ROW + 1, 7).getValues();
  data.forEach(row => {
    const sumber = String(row[4] || '').trim(); // Kolom E (Sumber)
    if (!sumber) return;
    const jenis = String(row[2] || '').toLowerCase(); // Kolom C (Jenis)
    const nominal = Number(row[6]) || 0; // Kolom G (Nominal)
    const isIncome = (jenis === 'pemasukan' || jenis === 'pendapatan');

    if (!totals[sumber]) totals[sumber] = { masuk: 0, keluar: 0 };
    if (isIncome) totals[sumber].masuk += nominal; else totals[sumber].keluar += nominal;
  });
  return totals;
}

function saveLastUpdatedDompet_() {
  const sh = getDompetSheet_();
  if (!sh) return null;
  const now = new Date();
  sh.getRange(CELL_LAST_UPDATED).setValue(now);
  return now.toISOString();
}

function readLastUpdatedDompet_() {
  const sh = getDompetSheet_();
  if (!sh) return null;
  const val = sh.getRange(CELL_LAST_UPDATED).getValue();
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  const d = new Date(val);
  return isNaN(d) ? null : d.toISOString();
}

// ============ EXPORT LAPORAN PDF ============
function getSemuaTransaksiBulanServer(bulan, tahun) {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.START_ROW) return [];

  const rawData = sheet.getRange(CONFIG.START_ROW, 1, lastRow - CONFIG.START_ROW + 1, 7).getValues();
  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();

  const list = [];
  rawData.forEach(row => {
    if (!row[0]) return;
    const parsedDate = parseSheetDate(row[1]);
    if (!parsedDate) return;
    if (parsedDate.getMonth() !== bulan || parsedDate.getFullYear() !== tahun) return;

    list.push({
      tanggalRaw: parsedDate,
      tanggal: Utilities.formatDate(parsedDate, timeZone, "dd/MM/yyyy"),
      jenis: row[2] || "",
      kategori: row[3] || "",
      sumber: row[4] || "",
      keterangan: row[5] || "",
      nominal: Number(row[6]) || 0
    });
  });

  list.sort((a, b) => a.tanggalRaw - b.tanggalRaw);
  return list;
}

function formatRupiahServer(num) {
  return (num < 0 ? '-Rp ' : 'Rp ') + Math.round(Math.abs(num || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function buildLaporanHTML(items, bulan, tahun) {
  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const tanggalCetak = Utilities.formatDate(new Date(), timeZone, "dd MMMM yyyy, HH:mm");

  let totalPemasukan = 0, totalPengeluaran = 0;
  const rowsHtml = items.map(it => {
    const isIncome = ['pemasukan', 'pendapatan'].includes(String(it.jenis).toLowerCase());
    if (isIncome) totalPemasukan += it.nominal; else totalPengeluaran += it.nominal;
    const warna = isIncome ? '#10b981' : '#e53e3e';
    const tanda = isIncome ? '+' : '-';
    return `<tr><td>${it.tanggal}</td><td>${it.kategori}</td><td>${it.sumber || '-'}</td><td>${it.keterangan || '-'}</td><td class="nominal" style="color:${warna};">${tanda} ${formatRupiahServer(it.nominal)}</td></tr>`;
  }).join('');

  const saldoBersih = totalPemasukan - totalPengeluaran;
  const emptyState = items.length === 0 ? `<tr><td colspan="5" style="text-align:center; color:#6c757d; padding:24px;">Tidak ada transaksi pada periode ini.</td></tr>` : '';

  return `
  <html>
  <head>
    <style>
      @page { margin: 28px 32px; }
      body { font-family: 'Helvetica', Arial, sans-serif; color: #1a1b1e; font-size: 11px; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #2D6A4F; padding-bottom: 12px; margin-bottom: 16px; }
      .header h1 { font-size: 18px; color: #2D6A4F; margin: 0 0 4px 0; }
      .header p { margin: 2px 0; color: #6c757d; }
      .header .periode { text-align: right; }
      .header .periode strong { font-size: 13px; color: #1a1b1e; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th { background: #2D6A4F; color: #fff; text-align: left; padding: 8px 10px; font-size: 10px; text-transform: uppercase; }
      td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; }
      tr:nth-child(even) td { background: #f4f7f6; }
      .nominal { text-align: right; font-weight: bold; white-space: nowrap; }
      .summary { margin-top: 18px; width: 260px; margin-left: auto; }
      .summary div { display: flex; justify-content: space-between; padding: 6px 10px; font-size: 11px; }
      .summary .saldo { background: #2D6A4F; color: #fff; font-weight: bold; border-radius: 6px; margin-top: 4px; }
    </style>
  </head>
  <body>
    <div class="header"><div><h1>MyDuit</h1><p>Laporan Keuangan Bulanan</p></div><div class="periode"><strong>${BULAN_NAMA[bulan]} ${tahun}</strong><p>Dicetak: ${tanggalCetak}</p></div></div>
    <table><thead><tr><th>Tanggal</th><th>Kategori</th><th>Sumber</th><th>Keterangan</th><th style="text-align:right;">Nominal</th></tr></thead><tbody>${rowsHtml || emptyState}</tbody></table>
    <div class="summary">
      <div style="color: #10b981;"><span>Total Pemasukan</span><span>${formatRupiahServer(totalPemasukan)}</span></div>
      <div style="color: #e53e3e;"><span>Total Pengeluaran</span><span>${formatRupiahServer(totalPengeluaran)}</span></div>
      <div class="saldo"><span>Saldo Bersih</span><span>${formatRupiahServer(saldoBersih)}</span></div>
    </div>
  </body>
  </html>`;
}

function generateLaporanPDFServer(bulan, tahun) {
  try {
    const items = getSemuaTransaksiBulanServer(bulan, tahun);
    const html = buildLaporanHTML(items, bulan, tahun);
    const pdfBlob = Utilities.newBlob(html, 'text/html', 'laporan.html').getAs('application/pdf');
    const fileName = `Laporan-MyDuit-${BULAN_NAMA[bulan]}-${tahun}.pdf`;
    pdfBlob.setName(fileName);
    return { status: "success", fileName: fileName, base64: Utilities.base64Encode(pdfBlob.getBytes()) };
  } catch (err) { return { status: "error", message: err.message }; }
}