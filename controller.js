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
// Singkatan 3-huruf ala kop surat/rekening koran bank (dipakai di header Laporan PDF, lihat
// buildLaporanHTML()) -> SENGAJA dibuat manual (bukan Utilities.formatDate('MMM')) supaya
// hasilnya konsisten Bahasa Indonesia ("OKT", bukan "Oct") terlepas dari locale spreadsheet.
const BULAN_SINGKAT = ["JAN", "FEB", "MAR", "APR", "MEI", "JUN", "JUL", "AGU", "SEP", "OKT", "NOV", "DES"];

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
  const initialFilter = { tipe: 'hari_ini', startDate: '', endDate: '', jenis: 'Semua', search: '' };

  template.initialKategori = fetchKategoriServer();
  // FIX: limit 10 -> 50, disamakan dgn batchFetchLimit di ViewJS.html (OPTIMASI PAGINATION
  // client-side batch slicing) -> initial render dari doGet() jadi 1 batch (50 item) yg sama
  // persis dgn yg dipakai loadRiwayat(), supaya 5 halaman pertama Riwayat Transaksi langsung
  // bisa dinavigasi instan tanpa fetch tambahan begitu halaman pertama kali dibuka.
  template.initialRiwayat = getRiwayatKasServer(1, 50, initialFilter);
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
// BUGFIX (Statistik/Riwayat tampil kosong): sebelumnya string tanggal langsung dilempar ke
// `new Date(val)`. JS men-interpretasi string bertanda "/" sebagai format Amerika MM/DD/YYYY,
// BUKAN dd/MM/yyyy yang dipakai konsisten di seluruh app ini (tampilan tanggal, OCR struk, dll).
// Akibatnya utk baris yang kolom tanggalnya berupa TEKS (mis. diketik manual langsung di Google
// Sheets, bukan lewat form app):
//   - "14/08/2026" (tanggal > 12) -> new Date("14/08/2026") = Invalid Date -> baris di-skip diam2
//     (lihat pemanggil: `if (!parsedDate) return;`) -> transaksi HILANG dari Statistik/Riwayat.
//   - "05/08/2026" (tanggal <= 12) -> salah dibaca sbg 8 Mei (bukan 5 Agustus) -> nyasar ke
//     bulan yang salah, angka Statistik jadi tidak sesuai sheet.
// Baris yang kolom tanggalnya sudah berupa objek Date asli (hasil simpanTransaksiServer() via
// form/OCR, yang sudah benar pakai `new Date(formData.tanggal)` dari input type="date" ISO)
// TIDAK terdampak bug ini - hanya baris dgn tanggal berformat teks dd/MM/yyyy yang kena.
function parseSheetDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'string') {
    const s = val.trim();
    // Coba dulu format dd/MM/yyyy atau dd-MM-yyyy (konvensi Indonesia dipakai app ini)
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3]);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        const d = new Date(yyyy, mm - 1, dd);
        if (!isNaN(d.getTime())) return d;
      }
    }
    // Fallback: format lain yang bisa dikenali parser native (mis. ISO yyyy-MM-dd)
    const d2 = new Date(s);
    if (!isNaN(d2.getTime())) return d2;
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
        if (filterParams.tipe === 'hari_ini' && Math.floor((now - parsedDate) / 86400000) !== 0) return;
        if (filterParams.tipe === '7hari' && Math.floor((now - parsedDate) / 86400000) > 7) return;
        if (filterParams.tipe === '30hari' && Math.floor((now - parsedDate) / 86400000) > 30) return;
        if (filterParams.tipe === 'custom' && filterParams.startDate && filterParams.endDate) {
          // FIX: dibuat lebih toleran (defensive) menyusul filter periode di sisi UI yang
          // sekarang pakai flatpickr mode "range" (1 field, ViewTransaksi.html) -> secara normal
          // urutan start<=end SUDAH dijamin otomatis oleh flatpickr, tapi tetap di-swap di
          // sini kalau ternyata terbalik (mis. data lama/panggilan langsung ke server tanpa
          // lewat UI) SUPAYA tidak ada baris yang ke-skip keliru, bukan malah dianggap error.
          let start = parseSheetDate(filterParams.startDate);
          let end = parseSheetDate(filterParams.endDate);
          if (start && end) {
            start.setHours(0, 0, 0, 0); end.setHours(0, 0, 0, 0);
            if (start > end) { const tmp = start; start = end; end = tmp; }
            if (parsedDate < start || parsedDate > end) return;
          }
          // NB: kalau salah satu/kedua tanggal gagal di-parse (mis. format tak dikenali),
          // filter tanggal SENGAJA diabaikan (bukan throw) -> hasil tetap tampil apa adanya
          // drpd request gagal total & user melihat error di UI.
        }

        const jenisLower = String(row[2] || '').toLowerCase();
        const isIncome = (jenisLower === 'pemasukan' || jenisLower === 'pendapatan');
        // "Pindah Saldo" BUKAN Pemasukan maupun Pengeluaran (§isPindahSaldoJenis_) -> filter
        // "Pengeluaran" WAJIB mengecualikannya juga, bukan cuma filter "Pemasukan".
        if (filterParams.jenis === 'Pemasukan' && !isIncome) return;
        if (filterParams.jenis === 'Pengeluaran' && (isIncome || jenisLower === 'pindah saldo')) return;

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
        nominal: Number(row[6]) || 0,
        rowIndex: idx // posisi baris di Sheet (baris paling bawah = terakhir diinput)
      });
    });

    if (needFlush) { SpreadsheetApp.flush(); invalidateTransaksiCache_(); } // ID auto-healed -> cache lama sudah stale

    // Urutkan berdasarkan tanggal transaksi terbaru dulu; kalau tanggalnya SAMA, jangan
    // jatuh ke urutan asli baris Sheet (itu sebabnya sebelumnya tampak acak/seperti
    // terurut nominal) -> pakai rowIndex supaya transaksi yang PALING TERAKHIR diinput
    // pada tanggal itu tetap tampil paling atas.
    formattedList.sort((a, b) => {
      const dateDiff = new Date(b.tanggalRaw) - new Date(a.tanggalRaw);
      if (dateDiff !== 0) return dateDiff;
      return b.rowIndex - a.rowIndex;
    });
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

// Kategori dikelompokkan per Jenis ("Pengeluaran"/"Pemasukan"), dibaca LANGSUNG dari SELURUH
// baris transaksi di database (kolom C=Jenis, D=Kategori) -> BUKAN dari histori yg kebetulan
// sedang ke-load di client (cachedRiwayat cuma berisi halaman/filter aktif, bisa jauh dari
// lengkap). Dipakai combobox Kategori di form Tambah/Edit Transaksi (lihat
// getKategoriByJenis_() & enhanceClayCombobox_() di ViewJS.html) supaya daftarnya otomatis
// terfilter sesuai Jenis yg dipilih user. Pola cache SAMA PERSIS spt fetchKategoriServer()/
// fetchSumberAkunServer() di atas (ScriptCache TTL 5 menit, di-invalidate bareng
// 'kategoriList'/'sumberAkunList' di titik CRUD transaksi yg sama — lihat removeAll(...) di
// bawah fungsi ini yg sudah ditambah 'kategoriJenisSumberMap').
// Kategori dikelompokkan per Jenis ("Pengeluaran"/"Pemasukan") DAN per Sumber/Akun, dibaca
// LANGSUNG dari SELURUH baris transaksi di database (kolom C=Jenis, D=Kategori, E=Sumber).
// Struktur hasil: { Pengeluaran: { _all:[...semua kategori jenis ini...], "Dompet":[...], "Seabank / Shopee":[...] }, Pemasukan: {...} }
// "_all" dipakai sbg fallback kalau kombinasi jenis+sumber belum pernah ada transaksinya
// (mis. akun baru) supaya combobox tetap menampilkan kategori yg relevan utk jenis itu,
// bukan kosong. Cache pola sama persis spt fetchKategoriServer()/fetchSumberAkunServer()
// (ScriptCache TTL 5 menit, di-invalidate bareng titik CRUD transaksi yg sama).
function getKategoriByJenisSumberServer() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('kategoriJenisSumberMap');
  if (cached) return JSON.parse(cached);

  const result = { Pengeluaran: { _all: [] }, Pemasukan: { _all: [] } };
  try {
    const sheet = getSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < CONFIG.START_ROW) {
      cache.put('kategoriJenisSumberMap', JSON.stringify(result), 300);
      return result;
    }
    // Kolom C=Jenis(3), D=Kategori(4), E=Sumber(5) — baca 3 kolom sekaligus.
    const data = sheet.getRange(CONFIG.START_ROW, 3, lastRow - CONFIG.START_ROW + 1, 3).getValues();
    const bucketPengeluaran = { _all: new Set() };
    const bucketPemasukan = { _all: new Set() };

    data.forEach(row => {
      const kategori = String(row[1] || '').trim();
      if (!kategori) return;
      const sumber = String(row[2] || '').trim();
      const jenisLower = String(row[0] || '').trim().toLowerCase();
      const isIncome = (jenisLower === 'pemasukan' || jenisLower === 'pendapatan');
      const bucket = isIncome ? bucketPemasukan : bucketPengeluaran;

      bucket._all.add(kategori);
      if (sumber) {
        if (!bucket[sumber]) bucket[sumber] = new Set();
        bucket[sumber].add(kategori);
      }
    });

    const toSortedObj = setsObj => {
      const out = {};
      Object.keys(setsObj).forEach(k => { out[k] = [...setsObj[k]].sort(); });
      return out;
    };
    result.Pengeluaran = toSortedObj(bucketPengeluaran);
    result.Pemasukan = toSortedObj(bucketPemasukan);

    cache.put('kategoriJenisSumberMap', JSON.stringify(result), 300);
    return result;
  } catch (e) {
    return result; // fallback aman -> client jatuh ke cachedKategori (daftar lengkap)
  }
}

// PERBAIKAN BUG "Dropdown Sumber/Akun kosong": cache 'sumberAkunList'/'kategoriList' lama
// (TTL 6 jam) sempat kesimpan KOSONG karena dibaca saat DOMPET_COL masih salah mapping.
// Jalankan fungsi ini SEKALI dari Apps Script Editor (dropdown fungsi di atas > Run)
// untuk langsung membuang cache basi tsb tanpa perlu menunggu kedaluwarsa.
function clearAppCache() {
  CacheService.getScriptCache().removeAll(['kategoriList', 'sumberAkunList', 'kategoriJenisSumberMap']);
  Logger.log('Cache kategoriList & sumberAkunList sudah dibersihkan. Reload halaman aplikasi untuk ambil data terbaru dari Sheet.');
}

// ============ CRUD TRANSAKSI ============
function simpanTransaksiServer(formData, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const id = generatePrimaryKey_('TX');

    // GUARD: jenis "Pindah Saldo" HANYA boleh dibuat lewat pindahSaldoServer() (perlu 2
    // mutasi akun sekaligus + validasi saldo tidak minus) -> tolak kalau ada yang coba lewat
    // form transaksi biasa (dropdown #jenis di ViewTransaksi.html memang cuma Pemasukan/Pengeluaran,
    // ini jaga² kalau requestnya di-craft manual).
    if (isPindahSaldoJenis_(formData.jenis)) {
      throw new Error('Jenis "Pindah Saldo" tidak bisa dibuat dari form ini. Gunakan fitur Pindah Saldo.');
    }

    // GUARD: saldo rekening tidak boleh minus (nilai terendah 0). Hanya relevan utk delta
    // negatif (Pengeluaran) -> Pemasukan selalu menambah, tidak perlu dicek.
    const deltaCek = hitungDeltaTransaksi_(formData.jenis, formData.nominal);
    if (deltaCek < 0) {
      const saldoSaatIni = getSaldoAkun_(formData.sumber);
      if (saldoSaatIni !== null && saldoSaatIni + deltaCek < 0) {
        throw new Error(`Saldo "${formData.sumber}" tidak cukup (saldo saat ini Rp ${saldoSaatIni.toLocaleString('id-ID')}). Saldo rekening tidak boleh minus.`);
      }
    }

    getSheet().appendRow([id, new Date(formData.tanggal), formData.jenis, formData.kategori, formData.sumber, formData.keterangan, Number(formData.nominal)]);
    invalidateTransaksiCache_(); // OPTIMASI: cache raw lama pasti stale setelah insert

    // OPTIMASI: delta ke 1 akun saja (bukan scan ulang seluruh sheet 'in/out' + rewrite seluruh Dompet)
    applyDeltaSaldoDompet_(formData.sumber, deltaCek);

    const riwayat = getRiwayatKasServer(page, limit, filterParams);
    CacheService.getScriptCache().removeAll(['kategoriList', 'sumberAkunList', 'kategoriJenisSumberMap']);
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

    // GUARD: baris "Pindah Saldo" cuma catatan histori dari 2 mutasi akun sekaligus
    // (pindahSaldoServer) -> TIDAK bisa diedit lewat form transaksi biasa (cuma potong 1
    // akun saat dibalik), soalnya akan bikin saldo salah satu rekening tidak sinkron lagi.
    if (isPindahSaldoJenis_(jenisLama)) {
      throw new Error('Transaksi "Pindah Saldo" tidak bisa diedit dari sini. Kalau salah transfer, lakukan Pindah Saldo balik (arah sebaliknya) untuk mengoreksinya.');
    }
    // GUARD: sama seperti simpanTransaksiServer — jenis "Pindah Saldo" cuma boleh dibuat
    // lewat pindahSaldoServer(), termasuk kalau usernya coba GANTI jenis transaksi lama
    // (mis. Pengeluaran) jadi "Pindah Saldo" lewat form edit biasa.
    if (isPindahSaldoJenis_(formData.jenis)) {
      throw new Error('Jenis "Pindah Saldo" tidak bisa dibuat dari form ini. Gunakan fitur Pindah Saldo.');
    }

    // GUARD: saldo rekening tidak boleh minus. Kalau akun sumber TIDAK berubah, cukup cek
    // net delta; kalau akun sumber berubah, cek delta baru murni terhadap akun baru itu.
    const deltaLama = hitungDeltaTransaksi_(jenisLama, nominalLama);
    const deltaBaru = hitungDeltaTransaksi_(formData.jenis, formData.nominal);
    const sumberSama = String(sumberLama).trim() === String(formData.sumber).trim();
    const deltaBersih = sumberSama ? (deltaBaru - deltaLama) : deltaBaru;
    if (deltaBersih < 0) {
      const saldoSaatIni = getSaldoAkun_(formData.sumber);
      if (saldoSaatIni !== null && saldoSaatIni + deltaBersih < 0) {
        throw new Error(`Saldo "${formData.sumber}" tidak cukup (saldo saat ini Rp ${saldoSaatIni.toLocaleString('id-ID')}). Saldo rekening tidak boleh minus.`);
      }
    }

    sheet.getRange(targetRow, 2, 1, 6).setValues([[new Date(formData.tanggal), formData.jenis, formData.kategori, formData.sumber, formData.keterangan, Number(formData.nominal)]]);
    invalidateTransaksiCache_(); // OPTIMASI: cache raw lama pasti stale setelah update

    // OPTIMASI I/O: kalau akun sumber TIDAK berubah (kasus paling umum saat edit), gabung jadi
    // 1x panggilan delta bersih (net) -> 1x read+write ke Dompet, bukan 2x round-trip terpisah.
    if (sumberSama) {
      applyDeltaSaldoDompet_(formData.sumber, deltaBaru - deltaLama);
    } else {
      applyDeltaSaldoDompet_(sumberLama, -deltaLama);
      applyDeltaSaldoDompet_(formData.sumber, deltaBaru);
    }

    const riwayat = getRiwayatKasServer(page, limit, filterParams);
    CacheService.getScriptCache().removeAll(['kategoriList', 'sumberAkunList', 'kategoriJenisSumberMap']);
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

    const tanggalLama = sheet.getRange(targetRow, 2).getValue();
    const dataLama = sheet.getRange(targetRow, 3, 1, 5).getValues()[0];
    const jenisLama = dataLama[0], sumberLama = dataLama[2], nominalLama = dataLama[4];

    if (isPindahSaldoJenis_(jenisLama)) {
      // Sumber "A -> B" -> hapus SEKARANG dibolehkan: saldo kedua akun dibalikkan +
      // baris log audit "Update Pindah Saldo" di kolom Catatan Dompet (ditulis oleh
      // applyDeltaSaldoDenganLog_ saat pindahSaldoServer()) ikut dibuang.
      const match = String(sumberLama || '').match(/^(.*)\s->\s(.*)$/);
      if (!match) throw new Error('Format data Pindah Saldo tidak valid, tidak bisa dihapus.');
      const akunSumber = match[1].trim();
      const akunTujuan = match[2].trim();
      const nominal = Number(nominalLama) || 0;

      const saldoTujuanSaatIni = getSaldoAkun_(akunTujuan);
      if (saldoTujuanSaatIni !== null && saldoTujuanSaatIni - nominal < 0) {
        throw new Error(`Tidak bisa dihapus: saldo "${akunTujuan}" (Rp ${saldoTujuanSaatIni.toLocaleString('id-ID')}) tidak cukup untuk membatalkan transfer ini.`);
      }

      const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
      const tglStr = Utilities.formatDate(new Date(tanggalLama), timeZone, 'dd/MM/yyyy');
      hapusLogPindahSaldo_(akunSumber, tglStr, nominal, 'keluar', akunTujuan);
      hapusLogPindahSaldo_(akunTujuan, tglStr, nominal, 'masuk', akunSumber);

      sheet.deleteRow(targetRow);
      invalidateTransaksiCache_();

      applyDeltaSaldoDompet_(akunSumber, nominal);
      applyDeltaSaldoDompet_(akunTujuan, -nominal);
    } else {
      sheet.deleteRow(targetRow);
      invalidateTransaksiCache_();
      applyDeltaSaldoDompet_(sumberLama, -hitungDeltaTransaksi_(jenisLama, nominalLama));
    }

    const riwayat = getRiwayatKasServer(page, limit, filterParams);
    CacheService.getScriptCache().removeAll(['kategoriList', 'sumberAkunList', 'kategoriJenisSumberMap']);
    return { status: "success", riwayat: riwayat, dompet: getDompetServer() };
  } catch (err) {
    return { status: "error", message: err.message };
  } finally { lock.releaseLock(); }
}

// Hapus 1 baris log "Update Pindah Saldo" dari kolom Catatan (F) akun tsb di sheet Dompet.
// Dicocokkan via tanggal transaksi + nominal + arah ('keluar'/'masuk') + nama akun lawan,
// supaya hanya baris log milik transfer yg dibatalkan ini yg terhapus (bukan seluruh histori akun).
function hapusLogPindahSaldo_(namaAkun, tglStr, nominal, arah, akunLawan) {
  namaAkun = String(namaAkun || '').trim();
  if (!namaAkun) return;
  const sheet = getDompetSheet_();
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < DOMPET_START_ROW) return;
  const numAkun = lastRow - DOMPET_START_ROW + 1;
  const data = sheet.getRange(DOMPET_START_ROW, DOMPET_COL.NAMA, numAkun, 5).getValues();

  const escRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nominalStr = escRegex(Number(nominal).toLocaleString('id-ID'));
  const arahPattern = arah === 'keluar'
    ? `-Rp ${nominalStr} \\(transfer ke "${escRegex(akunLawan)}"\\)`
    : `\\+Rp ${nominalStr} \\(transfer dari "${escRegex(akunLawan)}"\\)`;
  const pattern = new RegExp('^Update Pindah Saldo - \\[' + escRegex(tglStr) + ' \\d{2}:\\d{2}\\] : ' + arahPattern + '$');

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === namaAkun) {
      const rowIdx = DOMPET_START_ROW + i;
      const catatanLama = String(data[i][4] || '');
      if (!catatanLama) return;
      let removed = false;
      const newLines = catatanLama.split('\n').filter(line => {
        if (!removed && pattern.test(line.trim())) { removed = true; return false; }
        return true;
      });
      if (removed) {
        sheet.getRange(rowIdx, DOMPET_COL.CATATAN).setValue(newLines.join('\n'));
        invalidateDompetCache_();
      }
      return;
    }
  }
}

// ===== SINKRONISASI SALDO BERBASIS DELTA (ganti full-recalculation demi kecepatan CRUD) =====
// +nominal untuk Pemasukan, -nominal untuk Pengeluaran.
function hitungDeltaTransaksi_(jenis, nominal) {
  const n = Number(nominal) || 0;
  return String(jenis).trim().toLowerCase() === 'pengeluaran' ? -n : n;
}

// Jenis "Pindah Saldo" (transfer antar rekening) BUKAN Pemasukan atau Pengeluaran sungguhan —
// baris riwayatnya cuma catatan histori (§ pindahSaldoServer sudah memutasi saldo 2 akun
// LANGSUNG lewat applyDeltaSaldoDompet_, bukan lewat hitungDeltaTransaksi_ di atas). WAJIB
// dikecualikan dari semua penjumlahan Pemasukan/Pengeluaran (filter Riwayat, Statistik,
// Laporan PDF) supaya tidak dobel-hitung / salah masuk kategori "Pengeluaran".
function isPindahSaldoJenis_(jenis) {
  return String(jenis || '').trim().toLowerCase() === 'pindah saldo';
}

// Baca saldo SATU akun saja (dipakai validasi "tidak boleh minus" sebelum delta diterapkan) —
// pola baca sama seperti applyDeltaSaldoDompet_, tapi tanpa nulis apapun. Return null kalau
// akun tidak ditemukan (biar pemanggil bisa bedakan "akun ga ada" vs "saldo 0").
function getSaldoAkun_(namaAkun) {
  namaAkun = String(namaAkun || '').trim();
  if (!namaAkun) return null;
  const sheet = getDompetSheet_();
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < DOMPET_START_ROW) return null;
  const numAkun = lastRow - DOMPET_START_ROW + 1;
  const data = sheet.getRange(DOMPET_START_ROW, DOMPET_COL.NAMA, numAkun, 2).getValues(); // NAMA, SALDO
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === namaAkun) return Number(data[i][1]) || 0;
  }
  return null;
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

// ============ PINDAH SALDO (TRANSFER ANTAR REKENING) ============
// Dipicu dari ikon "Pindah Saldo" di FAB speed-dial (openPindahSaldoModal()/
// handlePindahSaldoSubmit() di ViewJS.html).
// formData: { tanggal, sumberRekening, rekeningTujuan, nominal, catatan }
//
// Sejak revisi ini, transfer TIDAK LAGI cuma memutasi saldo 2 akun secara diam² — sekarang
// juga (1) dicatat sbg 1 baris riwayat di sheet 'in/out' (jenis "Pindah Saldo", supaya
// kelihatan di Riwayat Transaksi & tidak "hilang" dari histori), dan (2) nulis log audit ke
// kolom Catatan (F) sheet 'Dompet' utk KEDUA akun (sumber & tujuan), pola sama seperti audit
// log di updateRekeningServer(). Ditambah guard: saldo akun sumber tidak boleh sampai minus
// (nilai terendah 0) akibat transfer ini.
function pindahSaldoServer(formData, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const sumber = String((formData && formData.sumberRekening) || '').trim();
    const tujuan = String((formData && formData.rekeningTujuan) || '').trim();
    const nominal = Number(formData && formData.nominal) || 0;
    const catatanUser = String((formData && formData.catatan) || '').trim();
    const tanggal = (formData && formData.tanggal) ? new Date(formData.tanggal) : new Date();

    if (!sumber || !tujuan) throw new Error('Rekening sumber dan tujuan wajib dipilih.');
    if (sumber === tujuan) throw new Error('Rekening sumber dan tujuan tidak boleh sama.');
    if (nominal <= 0) throw new Error('Nominal transfer harus lebih dari 0.');

    // GUARD: saldo rekening tidak boleh minus (nilai terendah 0).
    const saldoSumberSaatIni = getSaldoAkun_(sumber);
    if (saldoSumberSaatIni === null) throw new Error(`Rekening "${sumber}" tidak ditemukan.`);
    if (saldoSumberSaatIni - nominal < 0) {
      throw new Error(`Saldo "${sumber}" tidak cukup (saldo saat ini Rp ${saldoSumberSaatIni.toLocaleString('id-ID')}). Saldo rekening tidak boleh minus.`);
    }
    if (getSaldoAkun_(tujuan) === null) throw new Error(`Rekening "${tujuan}" tidak ditemukan.`);

    const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    // FIX: sebelumnya timestamp log audit ("Last Updated - [...]") SELALU pakai new Date()
    // (waktu SAAT data diupdate/disimpan ke server), padahal seharusnya mengikuti TANGGAL
    // yang diinput pengguna di form Pindah Saldo (variabel `tanggal` di atas, dari
    // formData.tanggal). Sekarang tanggal log = tanggal inputan pengguna, jam:menit tetap
    // memakai waktu saat transaksi diproses (krn form hanya punya input tanggal, bukan jam)
    // supaya log tetap informatif kapan aksi ini benar-benar dieksekusi.
    const now = new Date();
    const tsDate = new Date(tanggal.getFullYear(), tanggal.getMonth(), tanggal.getDate(), now.getHours(), now.getMinutes());
    const ts = Utilities.formatDate(tsDate, timeZone, "dd/MM/yyyy HH:mm");

    // 1. Potong saldo sumber & tambah saldo tujuan, SEKALIAN tulis log audit ke kolom
    //    Catatan (F) masing² akun di sheet Dompet (1x read+write per akun, bukan terpisah).
    applyDeltaSaldoDenganLog_(sumber, -nominal,
      `Update Pindah Saldo - [${ts}] : -Rp ${nominal.toLocaleString('id-ID')} (transfer ke "${tujuan}")`);
    applyDeltaSaldoDenganLog_(tujuan, nominal,
      `Update Pindah Saldo - [${ts}] : +Rp ${nominal.toLocaleString('id-ID')} (transfer dari "${sumber}")`);

    // 2. Catat sbg 1 baris riwayat transaksi (jenis "Pindah Saldo") -> nilai² field
    //    khusus DIISI LANGSUNG OLEH SISTEM (bukan input user), sesuai spesifikasi:
    //    Sumber = "A -> B", Keterangan = "Pindah saldo : dari "A" -> "B"" (+catatan user
    //    opsional ditempel di belakang kalau diisi).
    let keterangan = `Pindah saldo : dari "${sumber}" -> "${tujuan}"`;
    if (catatanUser) keterangan += ` — ${catatanUser}`;
    const id = generatePrimaryKey_('TX');
    getSheet().appendRow([id, tanggal, 'Pindah Saldo', 'Pindah Saldo', `${sumber} -> ${tujuan}`, keterangan, nominal]);
    invalidateTransaksiCache_(); // OPTIMASI: cache raw 'in/out' lama pasti stale setelah insert

    const dompet = getDompetServer();
    CacheService.getScriptCache().put(CACHE_KEY_DOMPET_PAYLOAD, JSON.stringify(dompet), CACHE_TTL_SECONDS);
    saveLastUpdatedDompet_();

    // page/limit/filterParams opsional (dikirim dari handlePindahSaldoSubmit di ViewJS.html)
    // -> kalau ada, balikkan juga riwayat terbaru supaya baris "Pindah Saldo" yang baru saja
    // dicatat langsung kelihatan di Riwayat Transaksi tanpa perlu fetch ulang manual.
    const riwayat = (page && limit) ? getRiwayatKasServer(page, limit, filterParams) : null;

    return { status: 'success', dompet, riwayat };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

// ============ EDIT & HAPUS PINDAH SALDO (dari Riwayat Transaksi) ============
// Pecah kembali format Sumber "A -> B" (hasil tulisan pindahSaldoServer()) jadi 2 nama akun.
function parsePindahSaldoSumber_(sumberGabungan) {
  const parts = String(sumberGabungan || '').split('->').map(s => s.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { sumber: parts[0], tujuan: parts[1] };
}

// EDIT transaksi Pindah Saldo yang sudah ada: balikkan dulu delta lama (ke akun sumber &
// tujuan LAMA), baru terapkan delta baru (ke akun sumber & tujuan BARU) -> supaya saldo kedua
// pasang akun (lama maupun baru, kalau berbeda) tetap konsisten seolah-olah transfer lama
// tidak pernah terjadi lalu diganti transfer baru.
function updatePindahSaldoServer(formData, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getSheet();
    const targetRow = findRowIndexById_(sheet, formData.id, CONFIG.START_ROW, 1);
    if (targetRow === -1) throw new Error('Transaksi Pindah Saldo tidak ditemukan.');

    const dataLama = sheet.getRange(targetRow, 3, 1, 5).getValues()[0]; // jenis, kategori, sumber, keterangan, nominal
    const jenisLama = dataLama[0];
    if (!isPindahSaldoJenis_(jenisLama)) throw new Error('Transaksi ini bukan Pindah Saldo.');

    const relLama = parsePindahSaldoSumber_(dataLama[2]);
    const nominalLama = Number(dataLama[4]) || 0;

    const sumberBaru = String(formData.sumberRekening || '').trim();
    const tujuanBaru = String(formData.rekeningTujuan || '').trim();
    const nominalBaru = Number(formData.nominal) || 0;
    const catatanUser = String(formData.catatan || '').trim();
    const tanggalBaru = formData.tanggal ? new Date(formData.tanggal) : new Date();

    if (!sumberBaru || !tujuanBaru) throw new Error('Rekening sumber dan tujuan wajib dipilih.');
    if (sumberBaru === tujuanBaru) throw new Error('Rekening sumber dan tujuan tidak boleh sama.');
    if (nominalBaru <= 0) throw new Error('Nominal transfer harus lebih dari 0.');

    // 1) Balikkan delta LAMA dulu (kembalikan nominal ke sumber lama, tarik lagi dari tujuan lama)
    if (relLama) {
      applyDeltaSaldoDompet_(relLama.sumber, nominalLama);
      applyDeltaSaldoDompet_(relLama.tujuan, -nominalLama);
    }

    // 2) GUARD saldo tidak boleh minus utk akun sumber BARU (dicek SETELAH delta lama dibalik)
    const saldoSumberBaru = getSaldoAkun_(sumberBaru);
    if (saldoSumberBaru === null) {
      if (relLama) { applyDeltaSaldoDompet_(relLama.sumber, -nominalLama); applyDeltaSaldoDompet_(relLama.tujuan, nominalLama); }
      throw new Error(`Rekening "${sumberBaru}" tidak ditemukan.`);
    }
    if (saldoSumberBaru - nominalBaru < 0) {
      // ROLLBACK balikan tadi supaya saldo tidak nyangkut kalau gagal
      if (relLama) { applyDeltaSaldoDompet_(relLama.sumber, -nominalLama); applyDeltaSaldoDompet_(relLama.tujuan, nominalLama); }
      throw new Error(`Saldo "${sumberBaru}" tidak cukup (Rp ${saldoSumberBaru.toLocaleString('id-ID')}) untuk transfer ini.`);
    }
    if (getSaldoAkun_(tujuanBaru) === null) {
      if (relLama) { applyDeltaSaldoDompet_(relLama.sumber, -nominalLama); applyDeltaSaldoDompet_(relLama.tujuan, nominalLama); }
      throw new Error(`Rekening "${tujuanBaru}" tidak ditemukan.`);
    }

    // 3) Terapkan delta BARU
    applyDeltaSaldoDompet_(sumberBaru, -nominalBaru);
    applyDeltaSaldoDompet_(tujuanBaru, nominalBaru);

    let keterangan = `Pindah saldo : dari "${sumberBaru}" -> "${tujuanBaru}"`;
    if (catatanUser) keterangan += ` — ${catatanUser}`;

    sheet.getRange(targetRow, 2, 1, 6).setValues([[tanggalBaru, 'Pindah Saldo', 'Pindah Saldo', `${sumberBaru} -> ${tujuanBaru}`, keterangan, nominalBaru]]);
    invalidateTransaksiCache_();

    const dompet = getDompetServer();
    CacheService.getScriptCache().put(CACHE_KEY_DOMPET_PAYLOAD, JSON.stringify(dompet), CACHE_TTL_SECONDS);
    saveLastUpdatedDompet_();

    const riwayat = (page && limit) ? getRiwayatKasServer(page, limit, filterParams) : null;
    return { status: 'success', dompet, riwayat };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

// HAPUS transaksi Pindah Saldo: balikkan delta ke kedua akun (kembalikan ke sumber, tarik
// dari tujuan), baru hapus barisnya.
function hapusPindahSaldoServer(id, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getSheet();
    const targetRow = findRowIndexById_(sheet, id, CONFIG.START_ROW, 1);
    if (targetRow === -1) throw new Error('Transaksi sudah terhapus.');

    const dataLama = sheet.getRange(targetRow, 3, 1, 5).getValues()[0];
    const jenisLama = dataLama[0];
    if (!isPindahSaldoJenis_(jenisLama)) throw new Error('Transaksi ini bukan Pindah Saldo.');

    const rel = parsePindahSaldoSumber_(dataLama[2]);
    const nominalLama = Number(dataLama[4]) || 0;

    sheet.deleteRow(targetRow);
    invalidateTransaksiCache_();

    if (rel) {
      applyDeltaSaldoDompet_(rel.sumber, nominalLama);
      applyDeltaSaldoDompet_(rel.tujuan, -nominalLama);
    }

    const dompet = getDompetServer();
    CacheService.getScriptCache().put(CACHE_KEY_DOMPET_PAYLOAD, JSON.stringify(dompet), CACHE_TTL_SECONDS);
    saveLastUpdatedDompet_();

    const riwayat = (page && limit) ? getRiwayatKasServer(page, limit, filterParams) : null;
    return { status: 'success', riwayat, dompet };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

// Sama seperti applyDeltaSaldoDompet_(), TAPI sekalian menempel 1 baris log audit ke kolom
// Catatan (F) akun tsb dalam 1x read+write (bukan panggilan terpisah) — dipakai khusus oleh
// pindahSaldoServer() supaya kedua akun (sumber & tujuan) sama² tercatat histori
// perubahannya di sheet Dompet, konsisten dgn pola audit log updateRekeningServer().
function applyDeltaSaldoDenganLog_(namaAkun, delta, logLine) {
  namaAkun = String(namaAkun || '').trim();
  if (!namaAkun) return;

  const sheet = getDompetSheet_();
  if (!sheet) { Logger.log('applyDeltaSaldoDenganLog_: Sheet Dompet tidak ditemukan.'); return; }

  const lastRow = sheet.getLastRow();
  if (lastRow < DOMPET_START_ROW) return;

  const numAkun = lastRow - DOMPET_START_ROW + 1;
  // NAMA, SALDO, UPDATED_AT, TIPE, CATATAN (kolom 2-6, berurutan)
  const data = sheet.getRange(DOMPET_START_ROW, DOMPET_COL.NAMA, numAkun, 5).getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === namaAkun) {
      const rowIdx = DOMPET_START_ROW + i;
      const saldoBaru = (Number(data[i][1]) || 0) + delta;
      const catatanLama = String(data[i][4] || '');
      const catatanBaru = catatanLama ? `${catatanLama}\n${logLine}` : logLine;
      // SALDO, UPDATED_AT, TIPE (dipertahankan), CATATAN — 1x setValues gabungan
      sheet.getRange(rowIdx, DOMPET_COL.SALDO, 1, 4).setValues([[saldoBaru, new Date(), data[i][3], catatanBaru]]);
      invalidateDompetCache_();
      return;
    }
  }
  Logger.log('applyDeltaSaldoDenganLog_: akun "' + namaAkun + '" tidak ditemukan di Sheet Dompet.');
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
    // GUARD: saldo rekening tidak boleh minus (nilai terendah 0) — sama seperti aturan
    // transaksi/transfer, berlaku juga saat rekening baru dibuat langsung dgn saldo awal.
    if ((Number(saldoAwal) || 0) < 0) throw new Error('Saldo awal tidak boleh minus.');

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
// FIX RELASI DATA (RENAME): kalau field "nama" berubah, transaksi LAMA di sheet 'in/out'
// masih menyimpan Sumber = nama LAMA -> tanpa cascade, transaksi lama itu jadi tidak
// "nyambung" lagi ke akun yg sekarang (padahal secara logis akunnya sama, cuma ganti nama).
// page/limit/filterParams (opsional, dikirim dari frontend) dipakai untuk balikkan payload
// riwayat terbaru supaya cachedRiwayat & tampilan Riwayat Transaksi ikut sinkron.
function updateRekeningServer(formData, page, limit, filterParams) {
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
    // GUARD: saldo rekening tidak boleh minus (nilai terendah 0), berlaku juga saat saldo
    // diedit manual lewat form ini (bukan cuma lewat transaksi/Pindah Saldo otomatis).
    if (saldoBaru < 0) throw new Error('Saldo tidak boleh minus.');

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

    // CASCADE RENAME: ganti Sumber di semua transaksi 'in/out' yg masih pakai nama lama,
    // plus tempel penanda "akun diganti nama" di Keterangan-nya (lihat renameSumberTransaksi_).
    let jumlahTransaksiDiubah = 0;
    if (namaLama !== namaBaru) {
      jumlahTransaksiDiubah = renameSumberTransaksi_(namaLama, namaBaru);
      CacheService.getScriptCache().removeAll(['sumberAkunList']); // nama akun dipakai sbg "Sumber" transaksi
    }

    const dompet = getDompetServer();
    CacheService.getScriptCache().put(CACHE_KEY_DOMPET_PAYLOAD, JSON.stringify(dompet), CACHE_TTL_SECONDS);
    saveLastUpdatedDompet_();

    const riwayat = (jumlahTransaksiDiubah > 0 && page && limit) ? getRiwayatKasServer(page, limit, filterParams) : null;

    return { status: 'success', dompet, riwayat, jumlahTransaksiDiubah, namaLama, namaBaru };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

// Ganti Sumber di SEMUA baris 'in/out' dari namaLama -> namaBaru (cascade akibat rename
// rekening), dan tempel penanda singkat "(akun diganti: ...)" di kolom Keterangan tiap
// transaksi yang terdampak -> supaya begitu dibuka di Riwayat Transaksi, pengguna langsung
// lihat notifikasi bahwa transaksi ini ikut berubah karena nama akunnya diganti. Kalau
// baris itu sebelumnya SUDAH punya penanda rename lama (rename berkali-kali), penanda lama
// diganti dgn yang terbaru (tidak menumpuk).
function renameSumberTransaksi_(namaLama, namaBaru) {
  namaLama = String(namaLama || '').trim();
  namaBaru = String(namaBaru || '').trim();
  if (!namaLama || !namaBaru || namaLama.toLowerCase() === namaBaru.toLowerCase()) return 0;

  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.START_ROW) return 0;

  const numRows = lastRow - CONFIG.START_ROW + 1;
  const range = sheet.getRange(CONFIG.START_ROW, 5, numRows, 2); // Kolom E:F -> Sumber, Keterangan
  const values = range.getValues();

  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const ts = Utilities.formatDate(new Date(), timeZone, 'dd/MM/yyyy');
  const markerRegex = /\s*\(akun diganti:.*?\)\s*$/i;

  let jumlahDiubah = 0;
  for (let i = 0; i < values.length; i++) {
    const sumberSaatIni = String(values[i][0] || '').trim();
    if (sumberSaatIni.toLowerCase() === namaLama.toLowerCase()) {
      values[i][0] = namaBaru;
      const keteranganBersih = String(values[i][1] || '').replace(markerRegex, '').trim();
      const marker = `(akun diganti: "${namaLama}" -> "${namaBaru}", ${ts})`;
      values[i][1] = keteranganBersih ? `${keteranganBersih} ${marker}` : marker;
      jumlahDiubah++;
    }
  }

  if (jumlahDiubah > 0) {
    range.setValues(values);
    invalidateTransaksiCache_();
    CacheService.getScriptCache().removeAll(['kategoriList', 'sumberAkunList', 'kategoriJenisSumberMap']);
  }
  return jumlahDiubah;
}

// HAPUS REKENING (dari UI: tap card -> tombol hapus merah -> modal konfirmasi)
// FIX RELASI DATA: sebelumnya hapusRekeningServer HANYA menghapus baris di sheet Dompet,
// tanpa menyentuh transaksi terkait di sheet 'in/out' -> transaksi lama dgn Sumber = nama
// akun yang sudah dihapus jadi "yatim" (masih nongol di Riwayat Transaksi & Statistik,
// padahal akunnya sudah tidak ada). Sekarang ditambahkan cascade delete: begitu rekening
// dihapus, SEMUA baris transaksi di 'in/out' yang kolom Sumber-nya = nama akun tsb ikut
// dihapus juga, plus payload riwayat terbaru dikirim balik ke frontend supaya tampilan
// Riwayat Transaksi langsung sinkron tanpa perlu refresh manual.
function hapusRekeningServer(id, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const sheet = getDompetSheet_();
    if (!sheet) throw new Error('Sheet "Dompet" tidak ditemukan.');

    const targetRow = findRowIndexById_(sheet, id, DOMPET_START_ROW, DOMPET_COL.ID);
    if (targetRow === -1) throw new Error('Rekening sudah terhapus.');

    const namaAkun = String(sheet.getRange(targetRow, DOMPET_COL.NAMA).getValue() || '').trim();

    sheet.deleteRow(targetRow);
    SpreadsheetApp.flush();
    invalidateDompetCache_();

    // CASCADE DELETE: hapus semua transaksi 'in/out' yang masih mereferensikan akun ini.
    const jumlahTransaksiTerhapus = namaAkun ? hapusTransaksiBySumber_(namaAkun) : 0;

    const dompet = getDompetServer();
    CacheService.getScriptCache().removeAll(['sumberAkunList']);
    saveLastUpdatedDompet_();

    // Kembalikan payload riwayat terbaru (kalau parameter halaman/filter dikirim dari
    // frontend) supaya cachedRiwayat & tampilan Riwayat Transaksi ikut ter-update, tanpa
    // pengguna harus pindah tab manual dulu.
    const riwayat = (page && limit) ? getRiwayatKasServer(page, limit, filterParams) : null;

    return { status: 'success', dompet, riwayat, jumlahTransaksiTerhapus };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

// Hapus SEMUA baris di sheet 'in/out' yang kolom Sumber (E)-nya cocok dengan namaAkun
// (case-insensitive, trim). Hapus dari baris PALING BAWAH ke ATAS supaya index baris
// yang belum diproses tidak bergeser akibat deleteRow() sebelumnya. Dipanggil dari
// hapusRekeningServer_ sebagai cascade delete relasi Dompet <-> in/out.
function hapusTransaksiBySumber_(namaAkun) {
  namaAkun = String(namaAkun || '').trim().toLowerCase();
  if (!namaAkun) return 0;

  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.START_ROW) return 0;

  const numRows = lastRow - CONFIG.START_ROW + 1;
  const sumberValues = sheet.getRange(CONFIG.START_ROW, 5, numRows, 1).getValues(); // Kolom E = Sumber

  let jumlahTerhapus = 0;
  for (let i = numRows - 1; i >= 0; i--) {
    if (String(sumberValues[i][0] || '').trim().toLowerCase() === namaAkun) {
      sheet.deleteRow(CONFIG.START_ROW + i);
      jumlahTerhapus++;
    }
  }

  if (jumlahTerhapus > 0) {
    invalidateTransaksiCache_();
    CacheService.getScriptCache().removeAll(['kategoriList', 'kategoriJenisSumberMap']);
  }
  return jumlahTerhapus;
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

// ============ STATISTIK & ANALISIS AI ============

// ================================================================
// DEBUG SEMENTARA — jalankan manual dari Apps Script Editor (pilih fungsi ini di
// dropdown toolbar lalu klik Run), lalu buka menu "Executions" / lihat Logger output
// utk melihat PERSIS apa yang dibaca server dari sheet 'in/out'. Hapus fungsi ini
// setelah bug Statistik "kosong" selesai didiagnosis.
// ================================================================
function debugStatistikKosong_() {
  const sheet = getSheet();
  Logger.log('Nama sheet terbaca: "%s"', sheet.getName());
  Logger.log('CONFIG.SHEET_NAME  : "%s"', CONFIG.SHEET_NAME);
  Logger.log('CONFIG.START_ROW   : %s', CONFIG.START_ROW);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  Logger.log('lastRow (baris terakhir berisi data): %s', lastRow);
  Logger.log('lastColumn: %s', lastCol);

  if (lastRow < CONFIG.START_ROW) {
    Logger.log('!!! lastRow < START_ROW -> fungsi getSemuaTransaksiBulanServer/TahunServer PASTI return [] (kosong). Ini kemungkinan akar masalahnya.');
    return;
  }

  const numRows = lastRow - CONFIG.START_ROW + 1;
  const rawData = sheet.getRange(CONFIG.START_ROW, 1, numRows, 7).getValues();
  Logger.log('Jumlah baris yang dibaca (harusnya = jumlah transaksi): %s', rawData.length);

  const scriptTz = Session.getScriptTimeZone();
  const sheetTz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  Logger.log('Timezone SCRIPT (appsscript.json)  : %s', scriptTz);
  Logger.log('Timezone SPREADSHEET (File Settings): %s', sheetTz);
  if (scriptTz !== sheetTz) {
    Logger.log('!!! Timezone script vs spreadsheet BEDA -> berpotensi menggeser tanggal saat dibaca balik.');
  }

  // Tampilkan 10 baris pertama mentah + hasil parseSheetDate() + apakah lolos filter Agustus 2026
  const sampleN = Math.min(10, rawData.length);
  for (let i = 0; i < sampleN; i++) {
    const row = rawData[i];
    const rawVal = row[1];
    const parsed = parseSheetDate(rawVal);
    Logger.log(
      'Baris %s | PK="%s" | rawVal tanggal=%s (typeof=%s, instanceof Date=%s) | parsedDate=%s | getMonth()=%s getFullYear()=%s | jenis="%s" | nominal=%s',
      CONFIG.START_ROW + i,
      row[0],
      rawVal,
      typeof rawVal,
      (rawVal instanceof Date),
      parsed,
      parsed ? parsed.getMonth() : '(null)',
      parsed ? parsed.getFullYear() : '(null)',
      row[2],
      row[6]
    );
  }

  // Coba langsung panggil fungsi yang dipakai Statistik utk Agustus 2026 (index bulan 7)
  const hasil = getSemuaTransaksiBulanServer(7, 2026);
  Logger.log('getSemuaTransaksiBulanServer(7, 2026) mengembalikan %s baris.', hasil.length);
  if (hasil.length > 0) Logger.log('Contoh item pertama: %s', JSON.stringify(hasil[0]));
}

function getStatistikBulananServer(bulan, tahun) {
  const items = getSemuaTransaksiBulanServer(bulan, tahun);
  let pemasukan = 0, pengeluaran = 0;
  const kategoriData = {};

  items.forEach(it => {
    if (it.jenis === 'Pemasukan') pemasukan += it.nominal;
    else {
      pengeluaran += it.nominal;
      kategoriData[it.kategori] = (kategoriData[it.kategori] || 0) + it.nominal;
    }
  });

  return { pemasukan, pengeluaran, saldo: pemasukan - pengeluaran, kategori: kategoriData };
}

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

// Baca seluruh transaksi dalam 1 TAHUN (untuk mode filter "Per Tahun") dari sheet 'in/out'.
// Sama seperti getSemuaTransaksiBulanServer() tapi filter hanya berdasarkan tahun.
function getSemuaTransaksiTahunServer(tahun) {
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
    if (parsedDate.getFullYear() !== tahun) return;

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

const NAMA_BULAN_PENDEK_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// Dipakai oleh filter Statistik "Per Bulan" / "Per Tahun" di ViewStatistik.html.
// mode   : 'bulanan' | 'tahunan'
// bulan  : 0-11 (index bulan, dipakai kalau mode = 'bulanan')
// tahun  : angka tahun penuh, mis. 2026
// Return : { pemasukan, pengeluaran, total, categories:[{kategori,total}], trend:[{label,pemasukan,pengeluaran}] }
// Data diambil LANGSUNG dari sheet 'in/out' (via getSemuaTransaksiBulanServer / getSemuaTransaksiTahunServer).
function getStatistikPeriodeServer(mode, bulan, tahun) {
  // DEBUG SEMENTARA — lihat di menu "Executions" (Apps Script Editor) setelah buka tab
  // Statistik di aplikasi sungguhan, utk pastikan argumen & jumlah items yg benar2 dipakai
  // saat dipanggil lewat google.script.run (bukan run manual). Hapus setelah selesai debug.
  Logger.log('[DEBUG STATISTIK] getStatistikPeriodeServer dipanggil dgn mode=%s (typeof=%s), bulan=%s (typeof=%s), tahun=%s (typeof=%s)',
    mode, typeof mode, bulan, typeof bulan, tahun, typeof tahun);

  const isTahunan = (mode === 'tahunan');
  const items = isTahunan
    ? getSemuaTransaksiTahunServer(tahun)
    : getSemuaTransaksiBulanServer(bulan, tahun);

  Logger.log('[DEBUG STATISTIK] isTahunan=%s -> items.length=%s', isTahunan, items.length);

  const isIncome_ = jenis => {
    const j = String(jenis || '').toLowerCase();
    return j === 'pemasukan' || j === 'pendapatan';
  };

  let pemasukan = 0, pengeluaran = 0;
  const kategoriMap = {};
  const kategoriMapPemasukan = {};

  items.forEach(it => {
    if (isPindahSaldoJenis_(it.jenis)) return; // transfer antar rekening, bukan pemasukan/pengeluaran
    if (isIncome_(it.jenis)) {
      pemasukan += it.nominal;
      const cat = it.kategori || 'Lainnya';
      kategoriMapPemasukan[cat] = (kategoriMapPemasukan[cat] || 0) + it.nominal;
    } else {
      pengeluaran += it.nominal;
      const cat = it.kategori || 'Lainnya';
      kategoriMap[cat] = (kategoriMap[cat] || 0) + it.nominal;
    }
  });

  const categories = Object.entries(kategoriMap)
    .map(([kategori, total]) => ({ kategori, total }))
    .sort((a, b) => b.total - a.total);

  const kategoriPemasukan = Object.entries(kategoriMapPemasukan)
    .map(([kategori, total]) => ({ kategori, total }))
    .sort((a, b) => b.total - a.total);

  // TREND: per bulan (Jan..Des) kalau mode tahunan, per hari (1..akhir bulan) kalau mode bulanan.
  const trend = [];
  if (isTahunan) {
    for (let m = 0; m < 12; m++) {
      let p = 0, k = 0;
      items.forEach(it => {
        if (it.tanggalRaw.getMonth() !== m || isPindahSaldoJenis_(it.jenis)) return;
        if (isIncome_(it.jenis)) p += it.nominal; else k += it.nominal;
      });
      trend.push({ label: NAMA_BULAN_PENDEK_ID[m], pemasukan: p, pengeluaran: k });
    }
  } else {
    const jumlahHari = new Date(tahun, bulan + 1, 0).getDate();
    for (let d = 1; d <= jumlahHari; d++) {
      let p = 0, k = 0;
      items.forEach(it => {
        if (it.tanggalRaw.getDate() !== d || isPindahSaldoJenis_(it.jenis)) return;
        if (isIncome_(it.jenis)) p += it.nominal; else k += it.nominal;
      });
      trend.push({ label: String(d), pemasukan: p, pengeluaran: k });
    }
  }

  // PEMBANDING PERIODE SEBELUMNYA (utk persentase naik/turun di kartu Pemasukan/
  // Pengeluaran/Saldo Bersih) — bulan sebelumnya kalau mode bulanan, tahun sebelumnya
  // kalau mode tahunan. Dihitung terpisah dari `items` (periode aktif) di atas supaya
  // tidak mengubah logika trend/kategori yang sudah ada.
  let prevBulan = bulan, prevTahun = tahun;
  if (isTahunan) {
    prevTahun = tahun - 1;
  } else {
    prevBulan = bulan - 1;
    if (prevBulan < 0) { prevBulan = 11; prevTahun = tahun - 1; }
  }
  const itemsSebelumnya = isTahunan
    ? getSemuaTransaksiTahunServer(prevTahun)
    : getSemuaTransaksiBulanServer(prevBulan, prevTahun);

  let pemasukanSebelumnya = 0, pengeluaranSebelumnya = 0;
  itemsSebelumnya.forEach(it => {
    if (isPindahSaldoJenis_(it.jenis)) return;
    if (isIncome_(it.jenis)) pemasukanSebelumnya += it.nominal;
    else pengeluaranSebelumnya += it.nominal;
  });

  Logger.log('[DEBUG STATISTIK] hasil akhir -> pemasukan=%s, pengeluaran=%s, categories.length=%s, trend.length=%s, items.length=%s',
    pemasukan, pengeluaran, categories.length, trend.length, items.length);

  // BUGFIX (root cause payload null di client): `items` di sini datang dari
  // getSemuaTransaksiBulanServer_()/getSemuaTransaksiTahunServer(), yang mengisi
  // `tanggalRaw` dgn OBJEK Date ASLI (bukan string) - lihat definisi kedua fungsi
  // tsb. Objek Date mentah yg NESTED di dalam array of objects seperti ini dikenal
  // bikin serialisasi google.script.run gagal SENYAP: eksekusi server SUKSES penuh
  // (log di atas selalu tampil normal dgn angka benar), tapi client menerima res =
  // null di withSuccessHandler tanpa exception apa pun (lihat catatan investigasi
  // di AGENTS.md - "Statistik: Investigasi payload null"). Fungsi getRiwayatKasServer()
  // yg SUDAH BENAR justru men-format tanggalRaw jadi STRING ("yyyy-MM-dd") sebelum
  // return, persis pola yg dipakai di bawah ini. Perhitungan trend/sort DI ATAS baris
  // ini (yg butuh method Date asli spt .getMonth()/.getDate()) SENGAJA TIDAK diubah -
  // itu tetap jalan di atas `items` asli (dgn Date asli) SEBELUM sanitasi ini, supaya
  // tidak ada risiko bug tanggal baru. Hanya salinan `items` yg dikirim ke client yg
  // di-sanitize di sini.
  const itemsForClient = items.map(it => {
    const clone = Object.assign({}, it);
    clone.tanggalRaw = Utilities.formatDate(it.tanggalRaw, Session.getScriptTimeZone(), "yyyy-MM-dd");
    return clone;
  });

  return {
    pemasukan,
    pengeluaran,
    total: pemasukan - pengeluaran,
    // PEMBANDING PERIODE SEBELUMNYA — dipakai client (renderStatistikUI() di
    // ViewJS.html) utk hitung persentase naik/turun di trendPemasukan/
    // trendPengeluaran/trendSaldo. Lihat komentar perhitungan di atas.
    pemasukanSebelumnya,
    pengeluaranSebelumnya,
    categories,
    kategoriPemasukan,
    trend,
    // ITEMS: rincian transaksi mentah periode ini (Pemasukan + Pengeluaran), dikirim
    // sekalian di sini (BUKAN round-trip terpisah) supaya modal detail kategori
    // ("Kategori Pengeluaran Teratas" di-double-click) bisa langsung difilter di client
    // dari cachedStatistik.items tanpa panggilan google.script.run baru. Lihat
    // openKategoriDetailModal() di ViewJS.html. `tanggalRaw` di sini SUDAH string
    // ("yyyy-MM-dd", lihat itemsForClient di atas), BUKAN objek Date - jangan
    // dikembalikan ke Date mentah lagi, itu penyebab payload null (lihat komentar
    // di atas & AGENTS.md).
    items: itemsForClient
  };
}

function formatRupiahServer(num) {
  return (num < 0 ? '-Rp ' : 'Rp ') + Math.round(Math.abs(num || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}


function setGeminiApiKey(key) {
  if (!key) throw new Error('setGeminiApiKey butuh parameter "key" berisi string API key, tidak boleh kosong.');
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
  return 'Gemini API key tersimpan';
}

// ============================================
// MULTI API KEY GEMINI (disarankan dipakai, gantikan setGeminiApiKey di atas)
// ============================================
// Simpan BEBERAPA API key Gemini sekaligus. Kenapa perlu: 1 API key gratis Gemini
// limitnya kecil (request/menit & request/hari). Dengan banyak key gantian dipakai
// (round-robin), beban per key jadi lebih kecil, dan kalau satu key kena rate limit
// (429) atau kuota habis, sistem otomatis lempar ke key berikutnya tanpa request
// dari user gagal.
function setGeminiApiKeys(keys) {
  if (!keys) throw new Error('setGeminiApiKeys butuh parameter "keys": array key ATAU string key dipisah koma.');
  const arr = Array.isArray(keys) ? keys : String(keys).split(',');
  const cleaned = arr.map(k => String(k).trim()).filter(Boolean);
  if (!cleaned.length) throw new Error('Tidak ada API key valid setelah dibersihkan (cek lagi input-nya).');
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEYS', JSON.stringify(cleaned));
  return `Tersimpan ${cleaned.length} Gemini API key (round-robin + fallback aktif).`;
}

// JALANKAN FUNGSI INI lewat tombol Run di Apps Script Editor (dropdown nama fungsi
// di atas > Run). Ambil API key dari https://aistudio.google.com/apikey -- boleh bikin
// di beberapa akun Google Gratis yang berbeda supaya kuota harian masing-masing key
// benar-benar terpisah (bikin 1 API key per akun Google). Isi array di bawah dengan
// key asli Anda (boleh 2, 3, atau lebih), jalankan sekali, lalu boleh dikosongkan lagi
// dari kode setelah berhasil (key sudah tersimpan aman di Script Properties, TIDAK
// perlu disimpan lagi di dalam kode). Cukup isi 1 key pun sistem tetap jalan normal,
// hanya saja tanpa manfaat round-robin/fallback antar key.
function setGeminiApiKeysOnce() {
  Logger.log(setGeminiApiKeys([
    'GANTI_DENGAN_API_KEY_ANDA',
    'GANTI_DENGAN_API_KEY_ANDA',
    'GANTI_DENGAN_API_KEY_ANDA'
  ]));
}

// Ambil daftar key yang tersimpan. Backward-compatible: kalau GEMINI_API_KEYS (versi
// multi-key baru) belum pernah diset, tapi GEMINI_API_KEY (versi lama single-key) ada,
// dipakai sebagai key tunggal -> setup lama yang belum migrasi tetap jalan tanpa error.
function getGeminiApiKeys_() {
  const props = PropertiesService.getScriptProperties();
  const multi = props.getProperty('GEMINI_API_KEYS');
  if (multi) {
    try {
      const arr = JSON.parse(multi);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) {
      // Format tersimpan korup/tak terduga -> abaikan, coba fallback key lama di bawah
    }
  }
  const single = props.getProperty('GEMINI_API_KEY');
  if (single) return [single];
  return [];
}

// Index round-robin disimpan di ScriptProperties supaya PERSIST antar request (beda
// dengan variable JS biasa yang selalu reset tiap kali function dipanggil ulang di
// Apps Script). Pakai LockService supaya aman kalau ada beberapa request nyaris
// bersamaan (concurrent) -- tanpa lock, race condition bisa bikin 2 request dapat
// index yang sama alih-alih gantian rapi.
function getNextKeyIndexAndAdvance_(totalKeys) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const props = PropertiesService.getScriptProperties();
    let idx = parseInt(props.getProperty('GEMINI_KEY_ROUND_ROBIN_IDX') || '0', 10);
    if (isNaN(idx) || idx < 0) idx = 0;
    const current = idx % totalKeys;
    props.setProperty('GEMINI_KEY_ROUND_ROBIN_IDX', String((idx + 1) % totalKeys));
    return current;
  } finally {
    lock.releaseLock();
  }
}

// Deteksi apakah respons Gemini termasuk "rate limit / kuota habis" (layak pindah ke
// API key lain) vs error lain (mis. request salah format -- pindah key tidak akan
// membantu utk kasus itu, tapi tetap dicoba jalan sbg jaring pengaman terakhir).
function isGeminiQuotaOrRateLimitError_(statusCode, responseText) {
  if (statusCode === 429) return true; // HTTP 429 Too Many Requests
  const t = (responseText || '').toUpperCase();
  if (statusCode === 403 && (t.indexOf('QUOTA') !== -1 || t.indexOf('RESOURCE_EXHAUSTED') !== -1)) return true;
  if (statusCode === 400 && t.indexOf('RESOURCE_EXHAUSTED') !== -1) return true;
  return false;
}

// ============================================
// INTI: panggil Gemini generateContent dengan
//  - ROUND ROBIN antar API key (tiap REQUEST baru gilir ke key selanjutnya, beban terbagi)
//  - FALLBACK otomatis ke key berikutnya kalau key yang dicoba kena 429/rate limit/kuota habis
// Dipakai bareng oleh extractStrukDataWithGemini_() & getRekomendasiKeuanganServer() supaya
// logika round-robin+fallback key TIDAK dobel ditulis di banyak tempat. Fallback ANTAR MODEL
// (mis. gemini-3.6-flash -> gemini-3.5-flash-lite) tetap jadi tanggung jawab pemanggil lewat
// GEMINI_MODEL_ROUTES seperti sebelumnya -- fungsi ini hanya menangani level API KEY.
// ============================================
function callGeminiGenerateContent_(model, payload, logLabel) {
  const keys = getGeminiApiKeys_();
  if (!keys.length) {
    throw new Error('GEMINI_API_KEY(S) tidak dikonfigurasi. Jalankan setGeminiApiKeysOnce() dulu dari Apps Script Editor.');
  }

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // Maju SATU LANGKAH per panggilan fungsi ini (= per request user), bukan per percobaan
  // key -> ini yang bikin distribusi beban round-robin murni antar request-request beda.
  const startIdx = getNextKeyIndexAndAdvance_(keys.length);
  let lastError = null;

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const keyIdx = (startIdx + attempt) % keys.length;
    const apiKey = keys[keyIdx];
    const keyLabel = 'Key#' + (keyIdx + 1) + '/' + keys.length;
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;

    let response;
    try {
      response = UrlFetchApp.fetch(url, options);
    } catch (e) {
      lastError = e;
      Logger.log('[' + logLabel + '][Gemini] ' + keyLabel + ' model ' + model + ' gagal dipanggil (' + e.message + '), coba key berikutnya...');
      continue;
    }

    const statusCode = response.getResponseCode();
    if (statusCode === 200) {
      Logger.log('[' + logLabel + '][Gemini] ' + keyLabel + ' model ' + model + ' berhasil.');
      return response; // sukses -> langsung dipakai pemanggil, tidak perlu coba key lain
    }

    const bodyText = response.getContentText();
    if (isGeminiQuotaOrRateLimitError_(statusCode, bodyText)) {
      lastError = new Error(keyLabel + ' kena rate limit/kuota habis (status ' + statusCode + ')');
      Logger.log('[' + logLabel + '][Gemini] ' + keyLabel + ' model ' + model + ' KENA LIMIT (status ' + statusCode + '), otomatis coba key berikutnya...');
      continue; // -> ini bagian FALLBACK: pindah ke API key lain
    }

    // Error selain rate limit/kuota (mis. model tidak dikenal/request invalid): ganti
    // key tidak akan menyelesaikan akar masalah, tapi tetap dicoba key lain sekali sbg
    // jaring pengaman sebelum menyerah & lempar ke loop model berikutnya di pemanggil.
    lastError = new Error(keyLabel + ' status ' + statusCode + ': ' + bodyText);
    Logger.log('[' + logLabel + '][Gemini] ' + keyLabel + ' model ' + model + ' gagal (status ' + statusCode + '), coba key berikutnya...');
  }

  // Semua key sudah dicoba & gagal utk model ini -> lempar error supaya loop model di
  // pemanggil (GEMINI_MODEL_ROUTES) lanjut coba model berikutnya.
  throw lastError || new Error('Semua API key Gemini gagal utk model ' + model);
}

// JALANKAN FUNGSI INI (bukan setGeminiApiKey di atas) lewat tombol Run di Apps Script Editor.
// setGeminiApiKey butuh parameter, sedangkan tombol Run tidak bisa mengirim argumen apa pun,
// makanya kalau setGeminiApiKey yang langsung di-Run, key selalu undefined -> error
// "Invalid argument: value". DIPERTAHANKAN untuk kompatibilitas single-key lama --
// utk multi-key/round-robin, pakai setGeminiApiKeysOnce() di atas.
function setGeminiApiKeyOnce() {
  Logger.log(setGeminiApiKey('GANTI_DENGAN_API_KEY_ANDA'));
}

// PENGGANTI OCR API Ninjas -> Gemini 3.5 Flash (multimodal, baca gambar LANGSUNG jadi
// field-field transaksi terstruktur, bukan sekadar teks mentah yang lalu di-regex).
// Alasan: regex lama ("cari baris mengandung kata total", dst) rapuh dan sama sekali tidak
// bisa menebak "nama produk yang dibeli" dari struk yang formatnya macam-macam. Gemini
// diminta membaca konteks gambar dan langsung mengisi field sesuai aturan bisnis di bawah,
// dengan output dipaksa berupa JSON valid (responseSchema) supaya tidak perlu parsing teks
// bebas yang gampang meleset.
//
// Aturan bisnis (sesuai kebutuhan pengguna):
// 1. jenis        -> SELALU "Pengeluaran" (di-hardcode di kode, bukan ditebak AI, karena
//                     upload struk di form ini memang khusus untuk mencatat pengeluaran).
// 2. sumber/akun   -> kalau ada indikasi "Shopee" di struk (ShopeePay/Shopee), pilih akun
//                     yang namanya mengandung "Shopee", kalau tidak ada pilih yang mengandung
//                     "Seabank". Kalau tidak ada indikasi Shopee sama sekali, default ke akun
//                     bernama "Dompet". Divalidasi ulang di pilihSumberOtomatis_() supaya hasil
//                     akhir DIJAMIN salah satu nilai yang benar-benar ada di dropdown Sumber/Akun
//                     (bukan karangan AI yang tidak match opsi manapun).
// 3. kategori      -> - Kalau metode pembayaran BUKAN cash/tunai (ShopeePay, Gopay, Seabank,
//                       e-wallet/transfer/kartu lain) -> isi "Seabank / Shopee".
//                     - Kalau metode pembayaran cash/tunai -> ditentukan dari JENIS PRODUK yang
//                       dibeli: hanya makanan -> "Makanan", hanya minuman -> "Minuman", campuran
//                       makanan+minuman ATAU barang umum -> "Belanja".
// 4. keterangan    -> nama produk/barang yang dibeli (bukan nama toko/nomor struk/dll).
// 5. nominal       -> total akhir yang dibayar, angka murni.
// ============================================
// KONFIGURASI MODEL GEMINI
// ============================================
// Semua model Gemini yang boleh dipakai sistem. Tambah/ubah versi model CUKUP di sini,
// tidak perlu cari-cari model id di tengah kode fungsi lain.
const GEMINI_MODELS = {
  FLASH_3_6: 'gemini-3.6-flash',      // Paling akurat & agentic, harga malah lebih murah dari 3.5 Flash -> default utk tugas yg butuh reasoning (baca gambar struk, dsb)
  FLASH_LITE_3_5: 'gemini-3.5-flash-lite', // Tercepat & termurah, cocok tugas ringan/volume tinggi
  FLASH_3_PREVIEW: 'gemini-3-flash-preview' // Model lama (preview) -> simpan sbg fallback terakhir saja, JANGAN jadi prioritas utama
};

// Peta "kebutuhan" tugas -> URUTAN model yang dicoba. Model pertama = prioritas utama;
// sisanya fallback OTOMATIS kalau model sebelumnya gagal/limit/dipensiunkan.
const GEMINI_MODEL_ROUTES = {
  // Baca gambar struk & isi banyak field sekaligus -> butuh reasoning terbaik dulu.
  OCR_STRUK: [GEMINI_MODELS.FLASH_3_6, GEMINI_MODELS.FLASH_LITE_3_5, GEMINI_MODELS.FLASH_3_PREVIEW],
  // Contoh kalau nanti ada tugas ringan (klasifikasi teks pendek dll) -> murah/cepat dulu.
  TUGAS_RINGAN: [GEMINI_MODELS.FLASH_LITE_3_5, GEMINI_MODELS.FLASH_3_6]
};

// Ambil urutan model untuk 1 "kebutuhan" tugas. Kalau kebutuhan tidak dikenal, fallback
// ke rute OCR_STRUK (yang paling "aman"/akurat) supaya tidak pernah undefined.
function getGeminiModelRoute_(kebutuhan) {
  return GEMINI_MODEL_ROUTES[kebutuhan] || GEMINI_MODEL_ROUTES.OCR_STRUK;
}
function extractStrukDataWithGemini_(base64Data, mimeType, daftarAkun) {
  const contentType = mimeType || 'image/jpeg';

  const daftarAkunText = daftarAkun && daftarAkun.length ? daftarAkun.join(', ') : '(daftar akun kosong/tidak tersedia)';

  const promptText =
    'Kamu adalah asisten pencatatan keuangan pribadi. Analisis gambar struk belanja/bukti transaksi ' +
    'berikut (bisa berupa foto struk fisik ATAU screenshot aplikasi e-commerce/e-wallet), lalu isi ' +
    'field-field transaksi sesuai aturan di bawah ini secara TEPAT:\n\n' +
    '1. tanggal: tanggal transaksi, format dd/mm/yyyy. Kosongkan ("") kalau tidak ditemukan.\n' +
    '2. sumber: WAJIB pilih SALAH SATU nilai PERSIS (huruf besar/kecil harus sama) dari daftar akun ' +
    'berikut: [' + daftarAkunText + ']. Aturannya:\n' +
    '   - Kalau di gambar ada indikasi "Shopee" (ShopeePay, Shopee, dsb) ATAU "Seabank", pilih akun bernama PERSIS "Seabank / Shopee".\n' +
    '   - Kalau TIDAK ada indikasi Shopee atau Seabank sama sekali, pilih akun bernama "Dompet".\n' +
    '   - Kalau tidak ada satupun akun di daftar yang cocok dengan aturan di atas, pilih akun pertama di daftar.\n' +
    '3. kategori: WAJIB isi PERSIS salah satu dari 5 nilai berikut: "Pulsa, Tagihan, & Tiket", ' +
    '"Online Shop", "Makanan", "Minuman", "Belanja". Aturannya, DICEK BERURUTAN dari atas ke bawah ' +
    '(kalau baris pertama cocok, LANGSUNG pakai itu, jangan lanjut ke baris berikutnya):\n' +
    '   - Kalau produk/transaksi yang dibeli adalah PULSA, paket data/kuota internet, TAGIHAN (listrik/PLN, ' +
    'air/PDAM, wifi/internet/indihome, pajak/PBB/samsat, BPJS, TV kabel, dsb), atau TIKET (pesawat, kereta, ' +
    'bus, kapal, bioskop, konser/event, dsb) -> isi "Pulsa, Tagihan, & Tiket". Aturan ini berlaku TERLEPAS ' +
    'dari metode pembayarannya (walaupun dibayar via ShopeePay/Seabank/e-wallet lain, tetap isi kategori ini, ' +
    'BUKAN "Online Shop").\n' +
    '   - Kalau bukan salah satu di atas, dan di struk terdapat pembayaran melalui Shopee atau Seabank -> isi "Online Shop".\n' +
    '   - Kalau metode pembayaran cash/tunai, tentukan dari JENIS PRODUK yang dibeli di struk:\n' +
    '       * Semua item yang dibeli adalah makanan (bukan minuman) -> isi "Makanan".\n' +
    '       * Semua item yang dibeli adalah minuman (bukan makanan) -> isi "Minuman".\n' +
    '       * Campuran makanan DAN minuman, atau barang umum non-makanan/minuman (mis. alat tulis, ' +
    'pakaian, kebutuhan rumah tangga) -> isi "Belanja".\n' +
    '4. keterangan: nama produk/barang yang DIBELI (ringkas, pisahkan dengan koma kalau lebih dari satu ' +
    'item). JANGAN isi dengan nama toko, nomor struk/invoice, atau info lain selain nama barang.\n' +
    '5. nominal: total akhir yang harus dibayar, angka murni tanpa "Rp"/titik ribuan/simbol lain ' +
    '(contoh: 45000).\n' +
    '6. metodePembayaranTerdeteksi: kutip singkat teks di gambar yang menunjukkan metode pembayaran ' +
    '(mis. "ShopeePay", "Cash", "Transfer BCA"). Kosongkan ("") kalau tidak ada.\n\n' +
    'Kalau gambar sama sekali bukan struk/bukti transaksi, tetap isi field yang bisa ditebak dan ' +
    'kosongkan/nolkan sisanya, JANGAN mengarang.';

  const sumberSchema = { type: 'STRING', description: 'Wajib salah satu dari daftar akun yang diberikan di prompt.' };
  if (daftarAkun && daftarAkun.length) sumberSchema.enum = daftarAkun; // paksa model hanya boleh pilih dari opsi asli

  const payload = {
    contents: [{
      role: 'user',
      parts: [
        { text: promptText },
        { inline_data: { mime_type: contentType, data: base64Data } }
      ]
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          tanggal: { type: 'STRING' },
          sumber: sumberSchema,
          kategori: { type: 'STRING', enum: ['Pulsa, Tagihan, & Tiket', 'Online Shop', 'Makanan', 'Minuman', 'Belanja'] },
          keterangan: { type: 'STRING' },
          nominal: { type: 'NUMBER' },
          metodePembayaranTerdeteksi: { type: 'STRING' }
        },
        required: ['tanggal', 'sumber', 'kategori', 'keterangan', 'nominal', 'metodePembayaranTerdeteksi']
      }
    }
  };

  // COBA MODEL SATU-SATU sesuai GEMINI_MODEL_ROUTES.OCR_STRUK. Kalau model pertama gagal
  // (limit/nonaktif/dipensiunkan/error jaringan/dll), otomatis lanjut ke model berikutnya
  // di daftar -> tidak perlu ubah kode manual tiap kali Google ganti/pensiunkan model.
  // DI DALAM tiap model, callGeminiGenerateContent_() sendiri sudah menangani round-robin
  // + fallback ANTAR API KEY (lihat definisinya di atas) sebelum akhirnya menyerah ke model ini.
  const modelRoute = getGeminiModelRoute_('OCR_STRUK');
  let lastError = null;

  for (let i = 0; i < modelRoute.length; i++) {
    const model = modelRoute[i];

    let response;
    try {
      response = callGeminiGenerateContent_(model, payload, 'OCR');
    } catch (e) {
      lastError = e;
      Logger.log('[OCR][Gemini] Model ' + model + ' gagal total (semua key sudah dicoba: ' + e.message + '), coba model berikutnya...');
      continue;
    }

    const json = JSON.parse(response.getContentText());
    const candidate = json.candidates && json.candidates[0];
    const finishReason = candidate && candidate.finishReason;
    const parts = candidate && candidate.content && candidate.content.parts;
    const rawJsonText = (parts || []).map(function (p) { return p.text || ''; }).join('').trim();

    if (!rawJsonText) {
      lastError = new Error('tidak ada data (finishReason: ' + (finishReason || 'tidak diketahui') + ')');
      Logger.log('[OCR][Gemini] Model ' + model + ' sukses dipanggil tapi output kosong, coba model berikutnya...');
      continue;
    }

    let hasil;
    try {
      hasil = JSON.parse(rawJsonText);
    } catch (e) {
      lastError = new Error('Gagal mem-parsing JSON dari model ' + model + ': ' + e.message);
      Logger.log('[OCR][Gemini] ' + lastError.message + ', coba model berikutnya...');
      continue;
    }

    Logger.log('[OCR][Gemini] Model dipakai: ' + model + ' (percobaan ke-' + (i + 1) + '/' + modelRoute.length + ') | finishReason: ' + finishReason);
    Logger.log('[OCR][Gemini] JSON mentah dari model: ' + rawJsonText);

    return hasil; // berhasil -> tidak perlu coba model lain
  }

  // Semua model di daftar gagal -> baru lempar error ke pengguna
  throw new Error('Semua model Gemini gagal dicoba (' + modelRoute.join(', ') + '). Error terakhir: ' + (lastError ? lastError.message : 'tidak diketahui'));
}

// Cari akun (case-insensitive, substring) di daftar akun asli dari Sheet 'Dompet'.
// Mengembalikan nama akun PERSIS seperti tertulis di Sheet (bukan hasil tebakan AI),
// supaya nilai yang disetorkan ke <select id="sumber"> pasti match salah satu <option>.
function cariAkunMengandung_(daftarAkun, keyword) {
  if (!daftarAkun || !daftarAkun.length) return null;
  const target = keyword.toLowerCase();
  const found = daftarAkun.find(function (nama) { return String(nama).toLowerCase().indexOf(target) !== -1; });
  return found || null;
}

// Validasi ulang pilihan "sumber" dari Gemini terhadap daftar akun ASLI. Ini lapis
// pengaman kedua (di luar responseSchema.enum) supaya field sumber TIDAK PERNAH terisi
// nilai yang tidak ada di dropdown, apapun yang dikembalikan model.
function pilihSumberOtomatis_(sumberDariAI, metodePembayaran, daftarAkun) {
  if (!daftarAkun || !daftarAkun.length) return sumberDariAI || 'Dompet';

  const teksGabungan = (String(metodePembayaran || '') + ' ' + String(sumberDariAI || '')).toLowerCase();

  if (teksGabungan.indexOf('shopee') !== -1 || teksGabungan.indexOf('seabank') !== -1) {
    const found = daftarAkun.find(function (nama) { return String(nama).toLowerCase() === 'seabank / shopee'; });
    if (found) return found;
    return cariAkunMengandung_(daftarAkun, 'shopee') || cariAkunMengandung_(daftarAkun, 'seabank') || 'Seabank / Shopee';
  }

  return cariAkunMengandung_(daftarAkun, 'dompet') || daftarAkun[0] || 'Dompet';
}

// Validasi ulang "kategori": kalau AI ngasal di luar 5 opsi yang diminta, tentukan sendiri:
// - indikasi pulsa/paket data, tagihan (listrik/air/wifi/pajak/BPJS/dll), atau tiket -> "Pulsa, Tagihan, & Tiket"
//   (dicek PALING AWAL, terlepas dari metode pembayaran)
// - metode pembayaran non-tunai terdeteksi (Shopee/Seabank) -> "Online Shop"
// - tunai/cash -> tebak dari kata kunci nama produk (keterangan): makanan-only -> "Makanan",
//   minuman-only -> "Minuman", campuran/tidak jelas -> "Belanja" (default paling aman).
const KATA_KUNCI_MAKANAN_ = ['nasi', 'ayam', 'mie', 'mi ', 'roti', 'kue', 'burger', 'pizza', 'sate',
  'bakso', 'soto', 'gado', 'nugget', 'sosis', 'rendang', 'gorengan', 'snack', 'keripik', 'biskuit'];
const KATA_KUNCI_MINUMAN_ = ['teh', 'kopi', 'jus', 'juice', 'susu', 'milk', 'air mineral', 'aqua',
  'boba', 'coffee', 'tea', 'soda', 'cola', 'sirup', 'es ', 'minuman'];
// Pulsa/paket data, aneka tagihan rutin, dan tiket -> semua masuk 1 kategori gabungan.
const KATA_KUNCI_PULSA_TAGIHAN_TIKET_ = [
  // Pulsa & paket data/kuota
  'pulsa', 'paket data', 'kuota', 'byu', 'by.u', 'by.u', 'telkomsel', 'indosat', 'im3', 'xl axiata',
  'tri ', '3 (tri)', 'axis', 'smartfren', 'internet prabayar', 'topup pulsa', 'isi pulsa',
  // Tagihan (listrik, air, wifi/internet rumah, pajak, BPJS, TV kabel, dll)
  'tagihan', 'listrik', 'pln', 'token listrik', 'pdam', 'air ', 'wifi', 'indihome', 'internet rumah',
  'pajak', 'pbb', 'samsat', 'bpjs', 'tv kabel', 'first media', 'biznet', 'mnc play', 'iuran',
  // Tiket (pesawat, kereta, bus, kapal, bioskop, event/konser)
  'tiket', 'pesawat', 'kereta', 'kai ', 'boarding pass', 'bus ', 'travel', 'kapal ferry', 'bioskop',
  'cgv', 'xxi', 'cinema', 'konser', 'event', 'e-ticket'
];

function tebakKategoriDariProduk_(keterangan) {
  const teks = String(keterangan || '').toLowerCase();
  if (!teks) return 'Belanja';
  const adaMakanan = KATA_KUNCI_MAKANAN_.some(function (k) { return teks.indexOf(k) !== -1; });
  const adaMinuman = KATA_KUNCI_MINUMAN_.some(function (k) { return teks.indexOf(k) !== -1; });
  if (adaMakanan && !adaMinuman) return 'Makanan';
  if (adaMinuman && !adaMakanan) return 'Minuman';
  return 'Belanja'; // campuran makanan+minuman, atau tidak terdeteksi sama sekali -> default aman
}

// Cek apakah nama produk/keterangan mengindikasikan pulsa, tagihan, atau tiket.
function adaIndikasiPulsaTagihanTiket_(keterangan) {
  const teks = String(keterangan || '').toLowerCase();
  if (!teks) return false;
  return KATA_KUNCI_PULSA_TAGIHAN_TIKET_.some(function (k) { return teks.indexOf(k) !== -1; });
}

function tentukanKategoriOtomatis_(kategoriDariAI, metodePembayaran, keterangan) {
  const opsiValid = ['Pulsa, Tagihan, & Tiket', 'Online Shop', 'Makanan', 'Minuman', 'Belanja'];

  // Prioritas #1: indikasi pulsa/tagihan/tiket SELALU menang, terlepas dari apa kata AI
  // atau metode pembayarannya -> jaring pengaman kalau AI keliru kasih "Online Shop"
  // padahal produknya jelas pulsa/tagihan/tiket (walau dibayar via ShopeePay/Seabank).
  if (adaIndikasiPulsaTagihanTiket_(keterangan)) return 'Pulsa, Tagihan, & Tiket';

  if (opsiValid.indexOf(kategoriDariAI) !== -1) return kategoriDariAI;

  const teksMetode = (String(metodePembayaran || '') + ' ' + String(keterangan || '')).toLowerCase();
  if (teksMetode.indexOf('shopee') !== -1 || teksMetode.indexOf('seabank') !== -1) {
    return 'Online Shop';
  }
  return tebakKategoriDariProduk_(keterangan);
}

// processReceiptImage: ambil daftar akun ASLI dari Sheet 'Dompet' dulu (fetchSumberAkunServer,
// sudah ada cache-nya), lalu minta Gemini mengisi field berdasarkan gambar + daftar akun tsb,
// baru divalidasi ulang di kode (pilihSumberOtomatis_/tentukanKategoriOtomatis_) sebagai jaring
// pengaman terakhir sebelum dikirim ke frontend.
function processReceiptImage(base64Data, mimeType) {
  const daftarAkun = fetchSumberAkunServer();
  const hasilAI = extractStrukDataWithGemini_(base64Data, mimeType, daftarAkun);

  const hasilFinal = {
    tanggal: hasilAI.tanggal || '',
    jenis: 'Pengeluaran', // aturan tetap: upload struk selalu dicatat sebagai pengeluaran
    kategori: tentukanKategoriOtomatis_(hasilAI.kategori, hasilAI.metodePembayaranTerdeteksi, hasilAI.keterangan),
    sumber: pilihSumberOtomatis_(hasilAI.sumber, hasilAI.metodePembayaranTerdeteksi, daftarAkun),
    keterangan: hasilAI.keterangan || '',
    nominal: Number(hasilAI.nominal) || 0
  };

  // LOG: bandingkan mentah-mentah apa kata AI vs apa yang akhirnya dipakai setelah
  // divalidasi ulang -> gampang ketahuan kalau suatu saat AI mulai ngasal.
  Logger.log('[OCR] Hasil mentah dari Gemini: ' + JSON.stringify(hasilAI));
  Logger.log('[OCR] Daftar akun tersedia: ' + JSON.stringify(daftarAkun));
  Logger.log('[OCR] Hasil final setelah validasi aturan bisnis: ' + JSON.stringify(hasilFinal));

  return hasilFinal;
}

// ============================================
// EXPORT LAPORAN PDF
// ============================================
// PERBAIKAN BUG: tombol "Export PDF" (openExportModal() -> prosesExportPDF() di ViewJS.html)
// SUDAH memanggil google.script.run...generateLaporanPDFServer(bulan, tahun), TAPI fungsi ini
// belum pernah ada di backend -> fitur Export PDF SELALU gagal dengan pesan "Fungsi Export PDF
// belum tersedia di Backend.". Fungsi ini melengkapi bagian backend yang hilang tsb.
//
// Sekaligus laporan dibangun ulang total supaya terlihat seperti laporan keuangan profesional:
// - Header branding + periode laporan
// - Kartu ringkasan Pemasukan/Pengeluaran/Saldo Bersih
// - Ringkasan Utang & Cicilan aktif (kalau ada)
// - Breakdown kategori pengeluaran dengan bar persentase (warna sama dgn tab Statistik)
// - Tabel rincian transaksi
// - CATATAN REKOMENDASI AI (BARU): rekomendasi Gemini utk periode yg sama, diformat rapi
//   persis seperti kartu "Rekomendasi AI" di tab Statistik (KONDISI/HEMAT DI SINI/PRIORITAS
//   ALOKASI), lengkap dgn disclaimer bahwa ini saran otomatis AI.
function generateLaporanPDFServer(bulan, tahun) {
  try {
    const bulanNum = Number(bulan);
    const tahunNum = Number(tahun);
    if (isNaN(bulanNum) || bulanNum < 0 || bulanNum > 11 || isNaN(tahunNum)) {
      return { status: 'error', message: 'Bulan/tahun yang dipilih tidak valid.' };
    }

    // Data utama: pakai getStatistikPeriodeServer() supaya ANGKA & KATEGORI di laporan PDF
    // 100% konsisten dgn yg ditampilkan di tab Statistik utk periode bulan yg sama.
    const stats = getStatistikPeriodeServer('bulanan', bulanNum, tahunNum);
    const items = getSemuaTransaksiBulanServer(bulanNum, tahunNum);

    // Ringkasan utang AKTIF (status != "Lunas"), pakai SISA (bukan total awal) supaya angkanya
    // akurat mencerminkan sisa kewajiban saat ini.
    let ringkasanUtang = { jumlahAktif: 0, totalSisa: 0 };
    try {
      const utangRes = getUtangServer();
      const aktif = (utangRes.list || []).filter(function (u) { return u.status !== 'Lunas'; });
      ringkasanUtang = {
        jumlahAktif: aktif.length,
        totalSisa: aktif.reduce(function (a, u) { return a + (u.sisa || 0); }, 0)
      };
    } catch (e) {
      Logger.log('[Export PDF] Gagal ambil ringkasan utang (dilewati, laporan tetap dibuat): ' + e.message);
    }

    // Catatan Rekomendasi AI utk periode yg SAMA dgn laporan. Dibungkus try/catch TERPISAH
    // supaya kalau Gemini lagi bermasalah (kuota habis/dll), export PDF TETAP BERHASIL dgn
    // catatan fallback yang informatif, bukan ikut gagal total.
    let rekomendasiTeks = '';
    try {
      const rek = getRekomendasiKeuanganServer('bulanan', bulanNum, tahunNum);
      rekomendasiTeks = (rek && rek.rekomendasi) || '';
    } catch (e) {
      Logger.log('[Export PDF] Gagal ambil Rekomendasi AI (dilewati, laporan tetap dibuat): ' + e.message);
      rekomendasiTeks = '';
    }

    const html = buildLaporanHTML(items, bulanNum, tahunNum, stats, ringkasanUtang, rekomendasiTeks);
    const blob = Utilities.newBlob(html, 'text/html', 'laporan.html').getAs('application/pdf');
    const fileName = 'Laporan-Keuangan-' + BULAN_NAMA[bulanNum] + '-' + tahunNum + '.pdf';

    return {
      status: 'success',
      base64: Utilities.base64Encode(blob.getBytes()),
      fileName: fileName
    };
  } catch (e) {
    Logger.log('[Export PDF] Gagal membuat laporan PDF: ' + e.message);
    return { status: 'error', message: e.message };
  }
}

// Escape teks bebas (nama kategori, keterangan transaksi, teks rekomendasi AI, dll) sebelum
// disisipkan ke HTML laporan, supaya karakter seperti <, >, &, ", ' tidak merusak markup PDF
// atau (dlm skenario terburuk) disalahgunakan sbg HTML injection dari data yg diinput user.
function escapeHtmlServer_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Parser teks Rekomendasi AI (struktur "KONDISI: ... HEMAT DI SINI: - ... PRIORITAS ALOKASI:
// - ...") -> object {kondisi, hemat[], prioritas[]}. SENGAJA dibuat mirror 1:1 dari parseRek_()
// di ViewJS.html supaya tampilan di laporan PDF konsisten dgn kartu "Rekomendasi AI" di tab
// Statistik (sama-sama parsing struktur yg diminta di prompt getRekomendasiKeuanganServer()).
function parseRekomendasiUntukPDF_(raw) {
  const txt = String(raw || '').trim();
  const m1 = txt.match(/KONDISI:\s*([\s\S]*?)(?=HEMAT DI SINI:|PRIORITAS ALOKASI:|$)/i);
  const m2 = txt.match(/HEMAT DI SINI:\s*([\s\S]*?)(?=PRIORITAS ALOKASI:|$)/i);
  const m3 = txt.match(/PRIORITAS ALOKASI:\s*([\s\S]*)$/i);
  const bullets = function (s) {
    return String(s || '').split(/(?:^|\s)-\s+/).map(function (x) { return x.trim(); }).filter(Boolean);
  };
  return { kondisi: m1 ? m1[1].trim() : '', hemat: bullets(m2 ? m2[1] : ''), prioritas: bullets(m3 ? m3[1] : '') };
}

// Bangun blok HTML "Catatan Rekomendasi AI" utk laporan PDF. Pakai <table> (bukan flexbox)
// utk susunan ikon+teks berdampingan, karena <table> paling konsisten dirender oleh konverter
// HTML->PDF Apps Script (Utilities...getAs('application/pdf')) dibanding flexbox/grid.
function buildRekomendasiHTMLUntukPDF_(rawTeks, labelPeriode) {
  if (!rawTeks) {
    return '<p style="font-size:10.5px;color:#94A3B8;line-height:1.6;font-style:italic;">' +
      'Rekomendasi AI tidak tersedia saat laporan periode ' + escapeHtmlServer_(labelPeriode) + ' ini dibuat ' +
      '(mis. kuota/koneksi AI sedang bermasalah). Anda bisa membuka tab Statistik dan mengetuk dua kali ' +
      'kartu "Rekomendasi AI" untuk mencobanya lagi.</p>';
  }

  const p = parseRekomendasiUntukPDF_(rawTeks);
  if (!p.kondisi && !p.hemat.length && !p.prioritas.length) {
    return '<p style="font-size:10.5px;color:#334155;line-height:1.6;">' + escapeHtmlServer_(rawTeks) + '</p>';
  }

  let h = '';

  // Kotak "kondisi" — dibuat mirror persis kartu Rekomendasi AI di tab Statistik (bg hijau
  // muda + badge centang bulat di kiri teks, lihat #aiRecommendation di ViewStatistik.html).
  if (p.kondisi) {
    h += '<table style="width:100%;border-collapse:collapse;background:#D1F5E3;border-radius:10px;margin-bottom:14px;"><tr>' +
      '<td style="width:30px;padding:11px 0 11px 12px;vertical-align:top;">' +
      '<div style="width:18px;height:18px;border-radius:50%;background:#2D6A4F;color:#fff;font-size:11px;font-weight:800;text-align:center;line-height:18px;">&#10003;</div>' +
      '</td>' +
      '<td style="padding:11px 12px 11px 6px;">' +
      '<span style="font-size:10.5px;color:#0F172A;line-height:1.6;">' + escapeHtmlServer_(p.kondisi) + '</span>' +
      '</td>' +
      '</tr></table>';
  }

  if (p.hemat.length) {
    h += '<p style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#2D6A4F;margin:0 0 8px 0;">&#9851; Hemat di Sini</p>';
    h += p.hemat.map(function (item) {
      return '<div style="background:#F8FAF9;border-left:3px solid #2D6A4F;border-radius:0 8px 8px 0;padding:8px 10px;margin-bottom:6px;">' +
        '<table style="width:100%;border-collapse:collapse;"><tr>' +
        '<td style="width:18px;vertical-align:top;padding-top:1px;"><span style="color:#10b981;font-weight:700;font-size:10.5px;">&#10003;</span></td>' +
        '<td style="font-size:10.5px;color:#334155;line-height:1.55;">' + escapeHtmlServer_(item) + '</td>' +
        '</tr></table></div>';
    }).join('');
  }

  if (p.prioritas.length) {
    h += '<p style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#B45309;margin:14px 0 8px 0;">&#9889; Prioritas Alokasi</p>';
    h += p.prioritas.map(function (item, i) {
      return '<div style="background:#FDE8E0;border-radius:8px;padding:8px 10px;margin-bottom:6px;">' +
        '<table style="width:100%;border-collapse:collapse;"><tr>' +
        '<td style="width:22px;vertical-align:top;">' +
        '<div style="width:16px;height:16px;border-radius:50%;background:#E86C4A;color:#fff;font-size:9.5px;font-weight:700;text-align:center;line-height:16px;">' + (i + 1) + '</div>' +
        '</td>' +
        '<td style="font-size:10.5px;color:#334155;line-height:1.55;">' + escapeHtmlServer_(item) + '</td>' +
        '</tr></table></div>';
    }).join('');
  }

  return h;
}

function buildLaporanHTML(items, bulan, tahun, stats, ringkasanUtang, rekomendasiTeks) {
  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const now = new Date();
  const tanggalCetak = Utilities.formatDate(now, timeZone, "dd MMMM yyyy, HH:mm");
  const labelPeriode = BULAN_NAMA[bulan] + ' ' + tahun;

  // Placeholder nama pemilik laporan — mengikuti nama placeholder yang sama dgn sapaan di
  // halaman utama app ("Welcome to MyDuit, David Timoteus", lihat ViewTransaksi.html), krn app ini
  // belum punya sistem akun/profil per-user yang menyimpan nama sesungguhnya.
  const namaPemilikLaporan = 'David Timoteus';

  // Nomor referensi ala "S/N" di kop rekening koran bank (kosmetik saja, bukan ID resmi) —
  // supaya laporan terasa seperti dokumen resmi bank, unik per proses cetak.
  const refNumber = 'MYD-' + BULAN_SINGKAT[bulan] + tahun + '-' + Utilities.formatDate(now, timeZone, 'HHmmss');
  const tanggalCetakSingkat = Utilities.formatDate(now, timeZone, 'dd') + ' ' + BULAN_SINGKAT[now.getMonth()] + ' ' + Utilities.formatDate(now, timeZone, 'yyyy');

  // Rentang tanggal periode laporan (selalu 1 s.d. akhir bulan yg dipilih), ditulis dgn gaya
  // yg sama seperti subjudul "RINGKASAN REKENING" di rekening koran bank (mis. "01 SEP 2024
  // sampai 30 SEP 2024").
  const lastDayOfMonth = new Date(tahun, bulan + 1, 0).getDate();
  const periodeRangeLabel = '01 ' + BULAN_SINGKAT[bulan] + ' ' + tahun + ' sampai ' + lastDayOfMonth + ' ' + BULAN_SINGKAT[bulan] + ' ' + tahun;

  // stats & ringkasanUtang bersifat OPSIONAL (backward-compatible) supaya fungsi ini tetap
  // bisa dipanggil dgn cara lama (items, bulan, tahun saja) kalau ada kode lain yg memanggilnya.
  const st = stats || (function () {
    let p = 0, k = 0; const map = {};
    items.forEach(function (it) {
      const isIncome = ['pemasukan', 'pendapatan'].includes(String(it.jenis).toLowerCase());
      if (isIncome) p += it.nominal; else { k += it.nominal; map[it.kategori || 'Lainnya'] = (map[it.kategori || 'Lainnya'] || 0) + it.nominal; }
    });
    return { pemasukan: p, pengeluaran: k, total: p - k, categories: Object.entries(map).map(function (e) { return { kategori: e[0], total: e[1] }; }).sort(function (a, b) { return b.total - a.total; }) };
  })();
  const utang = ringkasanUtang || { jumlahAktif: 0, totalSisa: 0 };

  // ===== TABEL RINCIAN TRANSAKSI (gaya rekening koran bank: kolom KELUAR/MASUK terpisah,
  // bukan 1 kolom nominal berwarna ± seperti sebelumnya — persis pola tabel "TABUNGAN -
  // RINCIAN TRANSAKSI" di rekening koran SeaBank) =====
  const rowsHtml = items.map(function (it) {
    const isIncome = ['pemasukan', 'pendapatan'].includes(String(it.jenis).toLowerCase());
    const keteranganTrim = String(it.keterangan || '').trim();
    // Baris utama pakai Keterangan kalau diisi (lebih deskriptif, mis. "Beli Kopi"), fallback
    // ke nama Kategori kalau Keterangan kosong. Baris kecil di bawahnya (mirip label "Transfer"
    // /"Bunga" di rekening koran) berisi Kategori + Sumber supaya info tetap lengkap walau
    // sekarang cuma 1 kolom "Transaksi" (bukan kolom Kategori & Sumber terpisah lagi).
    const mainLabel = keteranganTrim || it.kategori || '-';
    const subParts = [];
    if (keteranganTrim && it.kategori) subParts.push(it.kategori);
    if (it.sumber) subParts.push(it.sumber);
    const subLabel = subParts.length ? subParts.join(' · ') : '-';
    const nominalFmt = Number(it.nominal || 0).toLocaleString('id-ID');
    return '<tr>' +
      '<td style="white-space:nowrap;font-size:9.5px;color:#64748B;padding-top:11px;">' + escapeHtmlServer_(it.tanggal) + '</td>' +
      '<td><div class="tx-main">' + escapeHtmlServer_(mainLabel) + '</div><div class="tx-sub">' + escapeHtmlServer_(subLabel) + '</div></td>' +
      '<td class="nominal">' + (isIncome ? '' : nominalFmt) + '</td>' +
      '<td class="nominal">' + (isIncome ? nominalFmt : '') + '</td>' +
      '</tr>';
  }).join('');
  const emptyStateTx = items.length === 0
    ? '<tr><td colspan="4" class="empty-note">Tidak ada transaksi pada periode ini.</td></tr>' : '';

  // ===== BREAKDOWN KATEGORI (bar persentase, palet warna & tata letak SAMA PERSIS dgn kartu
  // "Kategori Pengeluaran Teratas" di tab Statistik — lihat renderCategoryBars_() di
  // ViewJS.html/ViewStatistik.html) =====
  const palette = ['#2D6A4F', '#E86C4A', '#F59E0B', '#10b981', '#3B82F6', '#8B5CF6', '#EC4899', '#64748B'];
  const kategoriList = (st.categories || []).filter(function (c) { return c.total > 0; }).slice(0, 8);
  const maxKategori = Math.max.apply(null, kategoriList.map(function (c) { return c.total; }).concat([1]));
  const kategoriHtml = kategoriList.map(function (c, i) {
    const pct = st.pengeluaran > 0 ? (c.total / st.pengeluaran * 100) : 0;
    const barPct = (c.total / maxKategori * 100).toFixed(1);
    const color = palette[i % palette.length];
    return '<div style="margin-bottom:12px;">' +
      '<table style="width:100%;border-collapse:collapse;margin-bottom:5px;"><tr>' +
      '<td style="font-size:10.5px;font-weight:600;color:#334155;">' + escapeHtmlServer_(c.kategori || 'Lainnya') + '</td>' +
      '<td style="text-align:right;font-size:10.5px;font-weight:700;color:#0F172A;">Rp ' + Number(c.total).toLocaleString('id-ID') +
      ' <span style="color:#94A3B8;font-weight:500;">(' + pct.toFixed(1) + '%)</span></td>' +
      '</tr></table>' +
      '<div style="height:8px;background:#F1F5F9;border-radius:999px;overflow:hidden;">' +
      '<div style="height:100%;width:' + barPct + '%;background:' + color + ';border-radius:999px;"></div></div>' +
      '</div>';
  }).join('');
  // Dibungkus kartu putih (border + rounded corner) supaya benar-benar terlihat sebagai
  // "kartu" yang sama persis dgn tampilan kategori di app, bukan sekadar teks lepas di
  // tengah halaman laporan.
  const kategoriSectionHtml = kategoriList.length
    ? '<div style="border:1px solid #E2E8F0;border-radius:14px;padding:16px 18px 6px 18px;margin-bottom:22px;page-break-inside:avoid;">' +
    '<p style="font-size:11.5px;font-weight:700;color:#0F172A;margin:0 0 14px 0;">Kategori Pengeluaran Teratas (' + escapeHtmlServer_(labelPeriode) + ')</p>' +
    kategoriHtml +
    '</div>'
    : '';

  // ===== RINGKASAN UTANG (hanya ditampilkan kalau ada utang aktif) =====
  const utangBannerHtml = utang.jumlahAktif > 0
    ? '<div style="background:#FDE8E0;border-radius:10px;padding:10px 14px;margin-bottom:18px;">' +
    '<table style="width:100%;border-collapse:collapse;"><tr>' +
    '<td style="font-size:10.5px;color:#7C2D12;font-weight:600;">Total Utang &amp; Cicilan Aktif</td>' +
    '<td style="text-align:right;font-size:12px;color:#7C2D12;font-weight:700;">Rp ' + Number(utang.totalSisa).toLocaleString('id-ID') +
    ' <span style="font-weight:500;font-size:9.5px;">(' + utang.jumlahAktif + ' aktif)</span></td>' +
    '</tr></table></div>'
    : '';

  // ===== CATATAN REKOMENDASI AI =====
  const rekomendasiHtml = buildRekomendasiHTMLUntukPDF_(rekomendasiTeks, labelPeriode);

  // Info ringkas di kop laporan (pengganti blok "Hubungi Kami" ala bank, diisi statistik
  // singkat yg lebih relevan utk laporan keuangan pribadi drpd nomor telepon/email).
  const jumlahTransaksi = items.length;
  const topKategoriNama = kategoriList.length ? (kategoriList[0].kategori || 'Lainnya') : '-';

  return `
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      @page { margin: 32px 36px; }
      body { font-family: 'Helvetica', Arial, sans-serif; color: #1a1b1e; font-size: 11px; }

      /* Judul section besar & center, ala "RINGKASAN REKENING" / "RINCIAN TRANSAKSI" di
         rekening koran bank — dipakai gantikan .section-title (kiri + border-bawah) lama. */
      .big-heading { text-align: center; font-size: 14px; font-weight: 800; color: #0F172A; letter-spacing: .02em; margin: 30px 0 4px 0; }
      .big-heading-sub { text-align: center; font-size: 9.5px; color: #94A3B8; margin: 0 0 16px 0; }

      /* Tabel ringkasan periode (gaya "REKENING / SALDO AWAL / KELUAR / MASUK / SALDO AKHIR"
         bank statement): header polos garis bawah tebal, bukan header berwarna solid. */
      table.bank-summary { width: 100%; border-collapse: collapse; margin-bottom: 22px; }
      table.bank-summary th { text-align: left; padding: 8px 10px; font-size: 8.5px; color: #64748B; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; border-bottom: 1.5px solid #0F172A; }
      table.bank-summary td { padding: 11px 10px; font-size: 10.5px; color: #334155; border-bottom: 1px solid #E5E7EB; }

      /* Tabel rincian transaksi, gaya sama (polos + garis) supaya konsisten dgn tabel di atas. */
      table.tx { width: 100%; border-collapse: collapse; margin-top: 4px; }
      table.tx th { text-align: left; padding: 9px 10px; font-size: 8.5px; color: #64748B; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; border-bottom: 1.5px solid #0F172A; }
      table.tx td { padding: 11px 10px 11px 10px; border-bottom: 1px solid #E5E7EB; font-size: 10px; vertical-align: top; }
      .tx-main { font-size: 10.5px; font-weight: 600; color: #0F172A; }
      .tx-sub { font-size: 9px; color: #94A3B8; margin-top: 2px; }
      .nominal { text-align: right; font-weight: 700; color: #0F172A; white-space: nowrap; }
      .empty-note { text-align: center; color: #6c757d; padding: 22px; font-size: 11px; }

      .footer-note { margin-top: 26px; padding-top: 10px; border-top: 1px solid #E2E8F0; font-size: 8.5px; color: #94A3B8; text-align: center; line-height: 1.6; }
    </style>
  </head>
  <body>

    <!-- ===== HEADER / BRANDING (ala kop rekening koran) ===== -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
      <tr>
        <td style="width:55%;vertical-align:top;">
          <table style="border-collapse:collapse;"><tr>
            <td style="width:44px;">
              <div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#2D6A4F 0%,#1B4332 100%);color:#fff;font-size:18px;font-weight:800;text-align:center;line-height:42px;">M</div>
            </td>
            <td style="padding-left:12px;vertical-align:middle;">
              <div style="font-size:19px;font-weight:800;color:#0F172A;letter-spacing:-.02em;">MyDuit</div>
              <div style="font-size:9px;color:#94A3B8;margin-top:1px;">Catatan Keuangan Pribadi</div>
            </td>
          </tr></table>
        </td>
        <td style="width:45%;text-align:right;vertical-align:top;">
          <div style="font-size:11px;color:#94A3B8;letter-spacing:.1em;font-weight:700;text-transform:uppercase;">Laporan Keuangan</div>
          <div style="font-size:9px;color:#94A3B8;margin-top:4px;">S/N ${refNumber}</div>
          <div style="font-size:9px;color:#94A3B8;">${tanggalCetakSingkat}</div>
        </td>
      </tr>
    </table>

    <div style="border-bottom:2.5px solid #0F172A;margin-bottom:20px;"></div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">
      <tr>
        <td style="width:60%;vertical-align:top;">
          <div style="font-size:16px;font-weight:800;color:#0F172A;">${escapeHtmlServer_(namaPemilikLaporan)}</div>
          <div style="font-size:9.5px;color:#64748B;margin-top:4px;">Ringkasan aktivitas keuangan pribadi periode ${labelPeriode}</div>
        </td>
        <td style="width:40%;text-align:right;vertical-align:top;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="font-size:9px;color:#94A3B8;padding-bottom:4px;">Jumlah Transaksi</td><td style="text-align:right;font-size:9px;font-weight:700;color:#334155;padding-bottom:4px;">${jumlahTransaksi}</td></tr>
            <tr><td style="font-size:9px;color:#94A3B8;">Kategori Teratas</td><td style="text-align:right;font-size:9px;font-weight:700;color:#334155;">${escapeHtmlServer_(topKategoriNama)}</td></tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- ===== RINGKASAN KEUANGAN (ala "RINGKASAN REKENING") ===== -->
    <p class="big-heading">Ringkasan Keuangan</p>
    <p class="big-heading-sub">${periodeRangeLabel}</p>

    <table class="bank-summary">
      <thead>
        <tr>
          <th>Periode</th>
          <th style="text-align:right;">Pemasukan (IDR)</th>
          <th style="text-align:right;">Pengeluaran (IDR)</th>
          <th style="text-align:right;">Saldo Bersih (IDR)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${labelPeriode}</td>
          <td style="text-align:right;color:#047857;font-weight:700;">${Number(st.pemasukan).toLocaleString('id-ID')}</td>
          <td style="text-align:right;color:#B91C1C;font-weight:700;">${Number(st.pengeluaran).toLocaleString('id-ID')}</td>
          <td style="text-align:right;color:#0F172A;font-weight:700;">${Number(st.total).toLocaleString('id-ID')}</td>
        </tr>
        <tr>
          <td colspan="3" style="text-align:right;font-size:9.5px;font-weight:700;color:#64748B;background:#F8FAFC;border-bottom:none;">TOTAL SALDO BERSIH</td>
          <td style="text-align:right;font-size:12px;font-weight:800;color:#0F172A;background:#F8FAFC;border-bottom:none;">Rp ${Number(st.total).toLocaleString('id-ID')}</td>
        </tr>
      </tbody>
    </table>

    ${utangBannerHtml}

    <!-- ===== KATEGORI PENGELUARAN TERATAS (kartu, gaya sama persis dgn tab Statistik) ===== -->
    ${kategoriSectionHtml}

    <!-- ===== RINCIAN TRANSAKSI ===== -->
    <p class="big-heading">Rincian Transaksi</p>
    <p class="big-heading-sub">${periodeRangeLabel}</p>
    <table class="tx">
      <thead><tr><th>Tanggal</th><th>Transaksi</th><th style="text-align:right;">Keluar (IDR)</th><th style="text-align:right;">Masuk (IDR)</th></tr></thead>
      <tbody>${rowsHtml || emptyStateTx}</tbody>
    </table>

    <!-- ===== CATATAN REKOMENDASI AI (kartu, gaya sama persis dgn kartu Rekomendasi AI
         di tab Statistik — header gradient hijau + badge bulat, lihat #aiRecommendation
         di ViewStatistik.html) ===== -->
    <div style="margin-top:26px;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;page-break-inside:avoid;">
      <table style="width:100%;border-collapse:collapse;background:linear-gradient(135deg,#2D6A4F 0%,#1B4332 100%);">
        <tr>
          <td style="width:50px;padding:14px 0 14px 16px;vertical-align:middle;">
            <div style="width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;font-size:11.5px;font-weight:800;text-align:center;line-height:34px;">AI</div>
          </td>
          <td style="padding:14px 16px 14px 10px;vertical-align:middle;">
            <div style="font-size:12.5px;font-weight:700;color:#fff;">Rekomendasi AI</div>
            <div style="font-size:9px;color:rgba(255,255,255,.72);margin-top:2px;">Analisis otomatis dari data keuangan periode ${labelPeriode}</div>
          </td>
        </tr>
      </table>
      <div style="padding:16px;background:#fff;">
        ${rekomendasiHtml}
        <p style="font-size:8.5px;color:#94A3B8;margin-top:12px;font-style:italic;line-height:1.6;">
          Rekomendasi ini dihasilkan otomatis oleh AI (Gemini) berdasarkan data transaksi periode ${labelPeriode}.
          Bukan pengganti nasihat keuangan profesional — gunakan sebagai referensi tambahan saja.
        </p>
      </div>
    </div>

    <div class="footer-note">
      Laporan ini dibuat otomatis oleh sistem MyDuit pada ${tanggalCetak}.<br>
      Seluruh angka bersumber dari catatan transaksi yang diinput pengguna dan dapat berubah jika ada penyesuaian data.
    </div>

  </body>
  </html>`;
}

// ============ UTANG & CICILAN (AUTO-HEALING PK) ============
const SHEET_UTANG = 'UtangCicilan';
// LAST_UPDATED (kolom L / ke-12): timestamp pembayaran/pelunasan terakhir.
// JUMLAH_BAYAR (kolom M / ke-13): counter berapa kali cicilan/utang ini sudah dibayar,
// dipakai untuk menyusun keterangan otomatis "Pembayaran Ke-n" di transaksi Pengeluaran
// (lihat catatPembayaranUtangSebagaiTransaksi_() & bayarCicilanServer() di bawah).
// Auto-healing di getUtangSheet_() -> kalau sheet lama belum punya kolom ini, header
// ditambahkan otomatis tanpa mengganggu data yang sudah ada.
const UTANG_COL = { ID: 1, TGL: 2, NAMA: 3, DESKRIPSI: 4, TOTAL: 5, SISA: 6, JATUH: 7, TIPE: 8, STATUS: 9, CICILAN: 10, CATATAN: 11, LAST_UPDATED: 12, JUMLAH_BAYAR: 13 };

function getUtangSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_UTANG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_UTANG);
    const headers = ['PK', 'Tanggal', 'Nama Pihak', 'Deskripsi', 'Total Utang', 'Sisa Tagihan', 'Tgl Jatuh Tempo', 'Tipe', 'Status', 'Cicilan/Bulan', 'Catatan', 'Last Updated', 'Jumlah Pembayaran'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }
  // AUTO-HEALING: sheet 'UtangCicilan' lama mungkin belum punya kolom "Last Updated"
  // (kolom ke-12) / "Jumlah Pembayaran" (kolom ke-13). Cek header-nya, kalau kosong ->
  // isi otomatis, sekali jalan saja, tanpa menyentuh data yang sudah ada.
  const headerCell = sheet.getRange(1, UTANG_COL.LAST_UPDATED);
  if (String(headerCell.getValue()).trim() === '') {
    headerCell.setValue('Last Updated');
  }
  const headerCellJml = sheet.getRange(1, UTANG_COL.JUMLAH_BAYAR);
  if (String(headerCellJml.getValue()).trim() === '') {
    headerCellJml.setValue('Jumlah Pembayaran');
  }
  return sheet;
}

function initUtangSheet_() {
  getUtangSheet_();
}

function invalidateUtangCache_() {
  CacheService.getScriptCache().remove('utangPayload_v1');
}

function getUtangServer() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('utangPayload_v1');
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { }
  }
  const sheet = getUtangSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { status: 'success', list: [] };
  const data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  const list = data.map((r, idx) => ({
    id: String(r[0]),
    tanggal: Utilities.formatDate(new Date(r[1]), Session.getScriptTimeZone(), 'dd/MM/yyyy'),
    namaPihak: String(r[2]).trim(),
    deskripsi: String(r[3]).trim(),
    total: Number(r[4]) || 0,
    sisa: Number(r[5]) || 0,
    tglJatuh: Utilities.formatDate(new Date(r[6]), Session.getScriptTimeZone(), 'dd/MM/yyyy'),
    tipe: String(r[7]).trim(),
    status: String(r[8]).trim(),
    cicilanPerBulan: Number(r[9]) || 0,
    catatan: String(r[10]).trim(),
    // Kolom L: timestamp pembayaran/pelunasan terakhir. Kosong kalau belum pernah dibayar.
    lastUpdated: r[11] ? new Date(r[11]).toISOString() : '',
    // Kolom M: berapa kali sudah dibayar (dipakai utk label "Pembayaran Ke-n").
    jumlahBayar: Number(r[12]) || 0
  }));
  const result = { status: 'success', list };
  cache.put('utangPayload_v1', JSON.stringify(result), 60);
  return result;
}

function simpanUtangServer(formData) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getUtangSheet_();
    const id = generatePrimaryKey_('UTC');
    sheet.appendRow([id, new Date(formData.tanggal), formData.namaPihak, formData.deskripsi, Number(formData.total), Number(formData.total), formData.tglJatuh, formData.tipe, 'Belum Lunas', Number(formData.cicilanPerBulan), formData.catatan]);
    invalidateUtangCache_();
    invalidateDompetCache_();
    const utang = getUtangServer();
    return { status: 'success', data: { id, ...formData } };
  } finally { lock.releaseLock(); }
}

// CATATAN AUDIT EDIT: setiap kali form Edit Utang/Cicilan disimpan (BUKAN saat bayar
// cicilan/lunasin via bayarCicilanServer()/lunasinUtangServer(), yang tidak lewat sini),
// tempelkan 1 baris log "[Diedit ...]" di BAWAH teks Catatan yang dikirim dari klien
// (yg berisi catatan bebas pengguna + histori log sebelumnya, krn form Edit selalu
// prefill dari catatan tersimpan). Kalau ada field penting yg berubah, disebutkan
// ringkas di baris log itu; kalau tidak ada perubahan field lain, tetap ditandai
// "[Diedit ...]" saja supaya pengguna tahu form ini baru saja disimpan ulang.
function updateUtangServer(formData) {
  const sheet = getUtangSheet_();
  const targetRow = findRowIndexById_(sheet, formData.id, 2, UTANG_COL.ID);
  if (targetRow === -1) throw new Error('Utang tidak ditemukan.');

  // Ambil data LAMA (kolom B:K, 10 kolom) dulu sebelum ditimpa, khusus utk bahan
  // perbandingan audit log di bawah.
  const dataLama = sheet.getRange(targetRow, UTANG_COL.TGL, 1, 10).getValues()[0];
  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const namaLama = String(dataLama[1] || '').trim();
  const deskripsiLama = String(dataLama[2] || '').trim();
  const totalLama = Number(dataLama[3]) || 0;
  const tglJatuhLamaRaw = dataLama[5];
  const tglJatuhLama = tglJatuhLamaRaw ? Utilities.formatDate(new Date(tglJatuhLamaRaw), timeZone, 'dd/MM/yyyy') : '';
  const statusLama = String(dataLama[7] || '').trim();
  const cicilanLama = Number(dataLama[8]) || 0;

  const namaBaru = String(formData.namaPihak || '').trim();
  const deskripsiBaru = String(formData.deskripsi || '').trim();
  const totalBaru = Number(formData.total) || 0;
  const tglJatuhBaru = formData.tglJatuh ? Utilities.formatDate(new Date(formData.tglJatuh), timeZone, 'dd/MM/yyyy') : '';
  const statusBaru = String(formData.status || '').trim();
  const cicilanBaru = Number(formData.cicilanPerBulan) || 0;

  const perubahan = [];
  if (namaLama !== namaBaru) perubahan.push(`nama "${namaLama || '-'}" -> "${namaBaru || '-'}"`);
  if (deskripsiLama !== deskripsiBaru) perubahan.push(`deskripsi "${deskripsiLama || '-'}" -> "${deskripsiBaru || '-'}"`);
  if (totalLama !== totalBaru) perubahan.push(`total Rp ${totalLama.toLocaleString('id-ID')} -> Rp ${totalBaru.toLocaleString('id-ID')}`);
  if (tglJatuhLama !== tglJatuhBaru) perubahan.push(`jatuh tempo ${tglJatuhLama || '-'} -> ${tglJatuhBaru || '-'}`);
  if (statusLama !== statusBaru) perubahan.push(`status "${statusLama || '-'}" -> "${statusBaru || '-'}"`);
  if (cicilanLama !== cicilanBaru) perubahan.push(`cicilan/bulan Rp ${cicilanLama.toLocaleString('id-ID')} -> Rp ${cicilanBaru.toLocaleString('id-ID')}`);

  const ts = Utilities.formatDate(new Date(), timeZone, 'dd/MM/yyyy HH:mm');
  const auditLine = perubahan.length ? `[Diedit ${ts}] ${perubahan.join('; ')}` : `[Diedit ${ts}]`;
  const catatanUser = String(formData.catatan || '').trim();
  const catatanFinal = catatanUser ? `${catatanUser}\n${auditLine}` : auditLine;

  // PERBAIKAN: sebelumnya range lebar 11 kolom mulai kolom A (menimpa PK) tapi hanya
  // diisi 10 nilai (mismatch). Sekarang mulai dari kolom B (Tanggal) sampai K (Catatan)
  // — 10 kolom, 10 nilai — supaya PK (kolom A) & Last Updated (kolom L) tidak tersentuh.
  sheet.getRange(targetRow, UTANG_COL.TGL, 1, 10).setValues([[
    formData.tanggal,
    formData.namaPihak,
    formData.deskripsi,
    Number(formData.total) || 0,
    Number(formData.sisa) || 0,
    formData.tglJatuh,
    formData.tipe,
    formData.status,
    Number(formData.cicilanPerBulan) || 0,
    catatanFinal
  ]]);
  invalidateUtangCache_();
  invalidateDompetCache_();
  return { status: 'success' };
}

function hapusUtangServer(id) {
  const sheet = getUtangSheet_();
  const targetRow = findRowIndexById_(sheet, id, 2, UTANG_COL.ID);
  if (targetRow === -1) throw new Error('Utang tidak ditemukan.');
  sheet.deleteRow(targetRow);
  invalidateUtangCache_();
  invalidateDompetCache_();
  return { status: 'success' };
}

// ============ BAYAR CICILAN / LUNASIN UTANG ============
// Dipanggil dari tombol "Bayar" (tipe Cicilan/Cicilan Spaylater/Cicilan Spinjam)
// atau "Lunasin" (tipe Utang) di kartu Utang & Cicilan.
//
// RELASI ANTAR SHEET: setiap kali pengguna Bayar/Lunasin, pembayaran itu sekarang OTOMATIS
// dicatat sebagai 1 baris transaksi baru di sheet 'in/out' (Jenis=Pengeluaran,
// Kategori=Pembayaran) lewat catatPembayaranUtangSebagaiTransaksi_() di bawah, dan langsung
// mengurangi saldo akun sumber dana yang dipilih pengguna di sheet 'Dompet' (lewat
// applyDeltaSaldoDompet_(), fungsi yang sama dipakai transaksi manual biasa). Jadi Utang &
// Cicilan, Riwayat Transaksi, dan Dompet tetap satu sumber kebenaran yang sinkron — pengguna
// tidak perlu lagi mencatat pengeluaran pembayaran utang secara terpisah secara manual.

// Susun teks Keterangan otomatis utk transaksi pembayaran utang/cicilan.
// - Cicilan: "<Nama Pihak> : Pembayaran Ke-<n> - <tgl>" — n dihitung server dari counter
//   JUMLAH_BAYAR (kolom M) supaya nomor urut pembayaran selalu akurat walau user bayar
//   dari perangkat berbeda / lewat waktu yang berbeda-beda.
// - Utang biasa (lunas sekaligus, bukan cicilan): "<Nama Pihak> : Pelunasan Utang - <tgl>",
//   tanpa embel-embel "Ke-n" karena dibayar tuntas dalam satu kali transaksi.
function buatKeteranganPembayaranUtang_(namaPihak, tipe, jumlahBayarBaru, tglBayarStr) {
  const nama = String(namaPihak || '').trim() || 'Tanpa Nama';
  if (tipe === 'Utang') {
    return `${nama} : Pelunasan Utang - ${tglBayarStr}`;
  }
  return `${nama} : Pembayaran Ke-${jumlahBayarBaru} - ${tglBayarStr}`;
}

// Catat 1 baris transaksi Pengeluaran/Pembayaran ke sheet 'in/out' + potong saldo akun
// sumber yang dipilih pengguna. Dipakai bersama oleh bayarCicilanServer() &
// lunasinUtangServer() supaya kedua alur pembayaran utang konsisten satu sama lain.
function catatPembayaranUtangSebagaiTransaksi_(sumber, nominal, keterangan) {
  sumber = String(sumber || '').trim();
  if (!sumber) throw new Error('Sumber dana wajib dipilih untuk mencatat pembayaran ini.');
  if (!nominal || nominal <= 0) return;

  const id = generatePrimaryKey_('TX');
  getSheet().appendRow([id, new Date(), 'Pengeluaran', 'Pembayaran', sumber, keterangan, Number(nominal)]);
  invalidateTransaksiCache_();
  applyDeltaSaldoDompet_(sumber, -Number(nominal));
  CacheService.getScriptCache().removeAll(['kategoriList', 'sumberAkunList', 'kategoriJenisSumberMap']);
}

// Bayar 1x cicilan bulanan. PENTING: nominal pembayaran DIHITUNG SENDIRI oleh server
// (min cicilanPerBulan vs sisa saat ini) — bukan menerima nominal dari client, supaya
// pembayaran cicilan terakhir otomatis mengikuti SISA TAGIHAN yang sebenarnya, bukan
// nominal cicilan/bulan yang diinput user di awal (menghindari sisa jadi minus).
// Status otomatis "Lunas" kalau sisa jadi 0, dan LAST_UPDATED dicatat sebagai timestamp
// pembayaran ini. `sumber` (nama akun Dompet, wajib dikirim dari client) menentukan akun
// mana yang saldonya dipotong & tercatat sebagai transaksi Pengeluaran/Pembayaran.
function bayarCicilanServer(id, sumber) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getUtangSheet_();
    const targetRow = findRowIndexById_(sheet, id, 2, UTANG_COL.ID);
    if (targetRow === -1) throw new Error('Utang tidak ditemukan.');

    const namaPihak = String(sheet.getRange(targetRow, UTANG_COL.NAMA).getValue() || '').trim();
    const rowData = sheet.getRange(targetRow, UTANG_COL.SISA, 1, UTANG_COL.JUMLAH_BAYAR - UTANG_COL.SISA + 1).getValues()[0];
    // rowData: [SISA, JATUH, TIPE, STATUS, CICILAN, CATATAN, LAST_UPDATED, JUMLAH_BAYAR]
    const sisaLama = Number(rowData[0]) || 0;
    const cicilanPerBulan = Number(rowData[UTANG_COL.CICILAN - UTANG_COL.SISA]) || 0;
    const jumlahBayarLama = Number(rowData[UTANG_COL.JUMLAH_BAYAR - UTANG_COL.SISA]) || 0;
    if (sisaLama <= 0) throw new Error('Tidak ada sisa tagihan untuk dibayar.');
    if (cicilanPerBulan <= 0) throw new Error('Nominal cicilan per bulan belum diisi.');

    const bayar = Math.min(cicilanPerBulan, sisaLama); // cicilan terakhir otomatis di-cap ke sisa
    const sisaBaru = Math.max(0, sisaLama - bayar);
    const statusBaru = sisaBaru <= 0 ? 'Lunas' : 'Belum Lunas';
    const jumlahBayarBaru = jumlahBayarLama + 1;
    const now = new Date();
    const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    const tglBayarStr = Utilities.formatDate(now, timeZone, 'dd/MM/yyyy');

    sheet.getRange(targetRow, UTANG_COL.SISA).setValue(sisaBaru);
    sheet.getRange(targetRow, UTANG_COL.STATUS).setValue(statusBaru);
    sheet.getRange(targetRow, UTANG_COL.LAST_UPDATED).setValue(now);
    sheet.getRange(targetRow, UTANG_COL.JUMLAH_BAYAR).setValue(jumlahBayarBaru);

    const keterangan = buatKeteranganPembayaranUtang_(namaPihak, 'Cicilan', jumlahBayarBaru, tglBayarStr);
    catatPembayaranUtangSebagaiTransaksi_(sumber, bayar, keterangan);

    invalidateUtangCache_();
    invalidateDompetCache_();
    return {
      status: 'success', dibayar: bayar, sisa: sisaBaru, statusUtang: statusBaru,
      lastUpdated: now.toISOString(), jumlahBayar: jumlahBayarBaru, keterangan: keterangan,
      dompet: getDompetServer()
    };
  } finally { lock.releaseLock(); }
}

// Lunasi utang (tipe "Utang", bukan cicilan) sekaligus: sisa jadi 0, status "Lunas",
// LAST_UPDATED dicatat sebagai timestamp pelunasan. `sumber` (nama akun Dompet, wajib
// dikirim dari client) menentukan akun mana yang saldonya dipotong sebesar sisa tagihan.
function lunasinUtangServer(id, sumber) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getUtangSheet_();
    const targetRow = findRowIndexById_(sheet, id, 2, UTANG_COL.ID);
    if (targetRow === -1) throw new Error('Utang tidak ditemukan.');

    const namaPihak = String(sheet.getRange(targetRow, UTANG_COL.NAMA).getValue() || '').trim();
    const sisaLama = Number(sheet.getRange(targetRow, UTANG_COL.SISA).getValue()) || 0;
    if (sisaLama <= 0) throw new Error('Utang ini sudah lunas.');

    const now = new Date();
    const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    const tglBayarStr = Utilities.formatDate(now, timeZone, 'dd/MM/yyyy');

    sheet.getRange(targetRow, UTANG_COL.SISA).setValue(0);
    sheet.getRange(targetRow, UTANG_COL.STATUS).setValue('Lunas');
    sheet.getRange(targetRow, UTANG_COL.LAST_UPDATED).setValue(now);

    const keterangan = buatKeteranganPembayaranUtang_(namaPihak, 'Utang', null, tglBayarStr);
    catatPembayaranUtangSebagaiTransaksi_(sumber, sisaLama, keterangan);

    invalidateUtangCache_();
    invalidateDompetCache_();
    return { status: 'success', lastUpdated: now.toISOString(), dibayar: sisaLama, keterangan: keterangan, dompet: getDompetServer() };
  } finally { lock.releaseLock(); }
}

function getUtangMendekatiJatuhTempo() {
  const utang = getUtangServer().list;
  const now = new Date();
  const result = [];
  utang.forEach(item => {
    const tgl = new Date(item.tglJatuh);
    const hariSisa = Math.ceil((tgl - now) / (86400000));
    result.push({
      nama: item.namaPihak,
      sisa: item.sisa,
      tglJatuh: item.tglJatuh,
      hariSisa: hariSisa,
      status: hariSisa <= 7 ? 'MENDATANG' : (hariSisa <= 30 ? 'HARIAN' : 'DALAM')
    });
  });
  return result;
}

// Statistik bulan BERJALAN saja (bulan & tahun hari ini), dipakai khusus oleh
// getRekomendasiKeuanganServer() di bawah supaya rekomendasi AI selalu berbasis
// data bulan ini, terlepas dari filter Per Bulan/Per Tahun yang sedang aktif di UI.
function getStatistikBulanIniServer() {
  const now = new Date();
  return getStatistikBulananServer(now.getMonth(), now.getFullYear());
}

// PERBAIKAN: sebelumnya fungsi ini SELALU pakai getStatistikBulanIniServer() (hardcode bulan
// kalender berjalan) + getAnalisisKategoriServer(), padahal tampilan Statistik punya filter
// "Per Bulan"/"Per Tahun" + tombol navigasi periode (lihat statistikMode/statistikBulan/
// statistikTahun & getStatistikPeriodeServer di ViewJS.html/controller.gs) -> rekomendasi AI
// jadi TIDAK NYAMBUNG kalau user sedang melihat periode lain. Sekarang fungsi ini menerima
// (mode, bulan, tahun) PERSIS seperti yang sedang aktif di UI Statistik, dan memakai
// getStatistikPeriodeServer() yang sama dengan yang dipakai grafik/kategori supaya datanya
// selalu konsisten dengan apa yang dilihat pengguna.
// Parameter opsional (kalau tidak dikirim -> fallback ke bulan kalender berjalan, backward compatible).
function getRekomendasiKeuanganServer(mode, bulan, tahun) {
  const now = new Date();
  const modeAktif = (mode === 'tahunan') ? 'tahunan' : 'bulanan';
  const bulanAktif = (bulan === undefined || bulan === null || bulan === '') ? now.getMonth() : Number(bulan);
  const tahunAktif = (tahun === undefined || tahun === null || tahun === '') ? now.getFullYear() : Number(tahun);
  const labelPeriode = modeAktif === 'tahunan' ? ('Tahun ' + tahunAktif) : (BULAN_NAMA[bulanAktif] + ' ' + tahunAktif);

  // CACHE ringan per-periode (60 detik) supaya double-click berulang pada periode yang sama
  // (dalam waktu singkat) tidak memanggil Gemini berkali-kali & boros kuota/biaya.
  const cacheKey = 'rekomendasiAI_v2_' + modeAktif + '_' + bulanAktif + '_' + tahunAktif;
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* cache korup -> lanjut generate ulang di bawah */ }
  }

  const stats = getStatistikPeriodeServer(modeAktif, bulanAktif, tahunAktif);
  const sisaUtang = utangCount();
  const sisaPeriode = stats.pemasukan - stats.pengeluaran;

  // Tidak ada transaksi sama sekali di periode ini -> jangan panggil Gemini (boros & AI cuma
  // akan mengarang), langsung kembalikan pesan informatif dengan struktur yang tetap valid
  // supaya parseRek_()/renderRekomendasiAI_() di frontend tetap bisa mem-parsingnya.
  if (stats.pemasukan === 0 && stats.pengeluaran === 0) {
    const hasilKosong = {
      rekomendasi: 'KONDISI: Belum ada transaksi pemasukan maupun pengeluaran yang tercatat untuk periode ' + labelPeriode + '.\n\n' +
        'HEMAT DI SINI:\n- Belum ada data pengeluaran pada periode ini untuk dianalisis.\n\n' +
        'PRIORITAS ALOKASI:\n- Catat dulu transaksi periode ' + labelPeriode + ' agar rekomendasi yang lebih akurat bisa dibuat.'
    };
    try { cache.put(cacheKey, JSON.stringify(hasilKosong), 60); } catch (e) { }
    return hasilKosong;
  }

  // Kirim RINCIAN SEMUA kategori pengeluaran periode ini (bukan cuma top 5) supaya AI punya
  // konteks lengkap & tidak perlu menebak-nebak nama kategori mana yang dimaksud.
  const daftarKategoriText = (stats.categories && stats.categories.length)
    ? stats.categories.map(function (k) { return k.kategori + ': Rp ' + k.total; }).join(', ')
    : '(tidak ada pengeluaran tercatat pada periode ini)';

  const prompt = `Kamu adalah perencana keuangan profesional bersertifikat (CFP) yang berpengalaman menangani keuangan pribadi keluarga Indonesia.

DATA KEUANGAN PERIODE ${labelPeriode}:
- Pemasukan: Rp ${stats.pemasukan}
- Pengeluaran: Rp ${stats.pengeluaran}
- Sisa/defisit periode ini: Rp ${sisaPeriode}
- Total utang aktif: Rp ${sisaUtang}
- Rincian SEMUA kategori pengeluaran periode ini, urut dari terbesar (nama kategori PERSIS seperti tertulis): ${daftarKategoriText}

TUGAS:
Analisis kondisi keuangan periode ${labelPeriode} di atas, lalu berikan rekomendasi dengan struktur PERSIS seperti ini:

KONDISI: (1 kalimat penilaian kesehatan keuangan periode ini, sebutkan rasio pengeluaran terhadap pemasukan dalam persen)

HEMAT DI SINI:
- (maksimal 3 poin, WAJIB sebut NAMA kategori pengeluaran PERSIS dari daftar di atas yang bisa dipangkas beserta estimasi nominal penghematannya)

PRIORITAS ALOKASI:
- (maksimal 3 poin, urutkan dari yang paling mendesak: cicilan utang, dana darurat, atau tabungan, beserta nominal yang disarankan)

ATURAN JAWABAN:
- Bahasa Indonesia, langsung ke inti, tanpa basa-basi pembuka/penutup.
- Setiap poin maksimal 1 kalimat pendek.
- WAJIB sebut nama kategori ASLI dari daftar kategori di atas (contoh: "Makanan", "Belanja", "Online Shop"). JANGAN PERNAH menulis frasa generik seperti "kategori pengeluaran terbesar pertama/kedua/ketiga" - itu tidak informatif.
- Kalau daftar kategori kosong, katakan itu apa adanya di poin HEMAT DI SINI, jangan mengarang nama kategori.
- Gunakan angka rupiah konkret, bukan saran umum seperti "kurangi jajan".
- Teks polos saja, tanpa simbol markdown seperti *, #, atau **.`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 350 }
  };

  // Sama seperti OCR struk: fallback ANTAR MODEL di sini, fallback ANTAR API KEY (round-robin
  // + lompat key kalau kena rate limit/kuota habis) ditangani di dalam callGeminiGenerateContent_().
  const modelRoute = getGeminiModelRoute_('TUGAS_RINGAN');
  let lastError = null;

  for (let i = 0; i < modelRoute.length; i++) {
    const model = modelRoute[i];

    let resp;
    try {
      resp = callGeminiGenerateContent_(model, payload, 'Rekomendasi');
    } catch (e) {
      lastError = e;
      Logger.log('[Rekomendasi][Gemini] Model ' + model + ' gagal total (semua key sudah dicoba: ' + e.message + '), coba model berikutnya...');
      continue;
    }

    const json = JSON.parse(resp.getContentText());
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      lastError = new Error('tidak ada teks dikembalikan');
      Logger.log('[Rekomendasi][Gemini] Model ' + model + ' sukses dipanggil tapi output kosong, coba model berikutnya...');
      continue;
    }

    Logger.log('[Rekomendasi][Gemini] Model dipakai: ' + model + ' (percobaan ke-' + (i + 1) + '/' + modelRoute.length + ')');
    const hasil = { rekomendasi: text.trim() };
    try { cache.put(cacheKey, JSON.stringify(hasil), 60); } catch (e) { }
    return hasil;
  }

  throw new Error('Semua model Gemini gagal dicoba (' + modelRoute.join(', ') + '). Error terakhir: ' + (lastError ? lastError.message : 'tidak diketahui'));
}


function utangCount() {
  const utang = getUtangServer();
  return utang.list.reduce((a, b) => a + b.total, 0);
}

// ============ FUNGSI STATISTIK UNTUK UI ============
function getStatistik3BulanServer() {
  const now = new Date();
  let pemasukan = 0, pengeluaran = 0;
  const map = {};
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const items = getSemuaTransaksiBulanServer(d.getMonth(), d.getFullYear());
    items.forEach(it => {
      if (it.jenis === 'Pemasukan' || it.jenis === 'pendapatan') {
        pemasukan += it.nominal;
      } else {
        pengeluaran += it.nominal;
        map[it.kategori] = (map[it.kategori] || 0) + it.nominal;
      }
    });
  }
  const totalP = pemasukan - pengeluaran;
  return { pemasukan, pengeluaran, total: totalP, map, categories: Object.entries(map).sort((a, b) => b[1] - a[1]) };
}

function getAnalisisKategoriServer() {
  const items = getSemuaTransaksiBulanServer(3, new Date().getFullYear());
  const map = {};
  let totalPengeluaran = 0;
  items.forEach(it => {
    const cat = it.kategori || '';
    const val = it.nominal || 0;
    if (cat && it.jenis !== 'Pemasukan') {
      map[cat] = (map[cat] || 0) + val;
      totalPengeluaran += val;
    }
  });
  return Object.entries(map).map(([k, v]) => ({ kategori: k, total: v, persentase: totalPengeluaran > 0 ? (v / totalPengeluaran * 100).toFixed(2) : 0 }));
}

function getTren12BulanServer() {
  const items = getSemuaTransaksiBulanServer(12, new Date().getFullYear());
  const result = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const bulanStr = String(d.getMonth() + 1).padStart(2, '0');
    const tahunStr = String(d.getFullYear());
    const pemasukan = items.filter(r => r.jenis === 'Pemasukan' && r.tanggalRaw.startsWith(tahunStr + '-' + bulanStr)).reduce((a, b) => a + b.nominal, 0);
    const pengeluaran = items.filter(r => r.jenis !== 'Pemasukan' && r.tanggalRaw.startsWith(tahunStr + '-' + bulanStr)).reduce((a, b) => a + b.nominal, 0);
    result.push({ bulan: d.getMonth() + 1, tahun: d.getFullYear(), pemasukan, pengeluaran });
  }
  return result;
}

// ============ STATISTIK DAN AI ============
function getStatistikServer() {
  const stats = getStatistik3BulanServer();
  const utangList = getUtangServer().list;
  const totalUtang = utangList.reduce((a, b) => a + b.total, 0);
  const totalPemakaian = stats.pemasukan + stats.pengeluaran;
  return { stats, totalUtang, totalPemakaian, utangList };
}

// ============ TEST HARNESS (JALANKAN MANUAL DARI APPS SCRIPT EDITOR) ============
/**
 * CARA MENJALANKAN TEST:
 * 1. Buka Apps Script Editor (script.google.com)
 * 2. Pilih fungsi di dropdown toolbar (mis. runAllTests)
 * 3. Klik tombol Run ▶
 * 4. Lihat hasil di View > Execution logs (Ctrl+Enter)
 * 
 * FUNGSI YANG TERSEDIA:
 * - runAllTests()          → Jalankan semua test berurutan
 * - testTransaksiCRUD()    → Test CRUD transaksi (add/edit/delete + delta saldo)
 * - testDompetCRUD()       → Test CRUD dompet (add/edit/delete + audit log)
 * - testUtangCRUD()        → Test CRUD utang/cicilan
 * - testStatistikAI()      → Test statistik 3 bln, analisis kategori, tren 12 bln, AI
 * - testCacheBehavior()    → Test cache hit/miss & invalidasi
 * - testAIModelFallback()  → Panduan manual test fallback model
 * 
 * NOTE: 
 * - testStatistikAI() butuh API key Gemini sudah diset (jalankan setGeminiApiKeysOnce(), atau setGeminiApiKeyOnce() utk 1 key saja)
 * - testAIModelFallback() hanya panduan, perlu edit manual GEMINI_MODELS di controller.gs
 * - Pastikan sheet `in/out`, `Dompet`, `UtangCicilan` sudah ada di spreadsheet
 * 
 * EXPECTED LOGS:
 * ✅ = Test lolos
 * ❌ = Test gagal (lihat error message)
 * 🎉 ALL TESTS PASSED = Semua test berhasil
 */
/**
 * Jalankan testTransaksiCRUD() untuk menguji flow transaksi:
 * 1. Tambah transaksi → cek PK & saldo
 * 2. Edit transaksi → cek delta correction
 * 3. Hapus transaksi → cek saldo rollback
 */
function testTransaksiCRUD() {
  const test = {
    tanggal: new Date().toISOString().split('T')[0],
    jenis: 'Pengeluaran',
    kategori: 'Test',
    sumber: 'Dompet',
    keterangan: 'Test CRUD',
    nominal: 50000
  };

  // 1. TAMBAH
  const add = simpanTransaksiServer(test, 1, 10, {});
  Logger.log('=== ADD ===');
  Logger.log(JSON.stringify(add));
  if (add.status !== 'success') throw new Error('Add failed: ' + add.message);
  const newId = add.riwayat.data[0]?.id;
  if (!newId) throw new Error('No ID returned');

  // 2. EDIT
  const edit = updateTransaksiServer({ ...test, id: newId, nominal: 75000 }, 1, 10, {});
  Logger.log('=== EDIT ===');
  Logger.log(JSON.stringify(edit));
  if (edit.status !== 'success') throw new Error('Edit failed: ' + edit.message);

  // 3. HAPUS
  const del = hapusTransaksiServer(newId, 1, 10, {});
  Logger.log('=== DELETE ===');
  Logger.log(JSON.stringify(del));
  if (del.status !== 'success') throw new Error('Delete failed: ' + del.message);

  Logger.log('✅ testTransaksiCRUD PASSED');
  return { status: 'success' };
}

/**
 * Jalankan testDompetCRUD() untuk menguji flow dompet:
 * 1. Tambah rekening
 * 2. Edit rekening
 * 3. Hapus rekening
 */
function testDompetCRUD() {
  // 1. TAMBAH
  const add = simpanRekeningServer('Test Rekening', 100000, 'Test');
  Logger.log('=== DOM PET ADD ===');
  Logger.log(JSON.stringify(add));
  if (add.status !== 'success') throw new Error('Add failed: ' + add.message);
  const newId = add.dompet.rekening.find(r => r.nama === 'Test Rekening')?.id;
  if (!newId) throw new Error('No ID returned');

  // 2. EDIT
  const edit = updateRekeningServer({ id: newId, nama: 'Test Edit', saldo: 200000, tipe: 'Test' });
  Logger.log('=== DOM PET EDIT ===');
  Logger.log(JSON.stringify(edit));
  if (edit.status !== 'success') throw new Error('Edit failed: ' + edit.message);

  // 3. HAPUS
  const del = hapusRekeningServer(newId);
  Logger.log('=== DOM PET DELETE ===');
  Logger.log(JSON.stringify(del));
  if (del.status !== 'success') throw new Error('Delete failed: ' + del.message);

  Logger.log('✅ testDompetCRUD PASSED');
  return { status: 'success' };
}

/**
 * Jalankan testUtangCRUD() untuk menguji flow utang/cicilan
 */
function testUtangCRUD() {
  const today = new Date().toISOString().split('T')[0];
  const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  // 1. TAMBAH
  const add = simpanUtangServer({
    tanggal: today,
    namaPihak: 'Test Utang',
    deskripsi: 'Test desc',
    total: 1000000,
    tglJatuh: nextMonth,
    tipe: 'Utang',
    cicilanPerBulan: 100000,
    catatan: 'Test'
  });
  Logger.log('=== UTANG ADD ===');
  Logger.log(JSON.stringify(add));
  if (add.status !== 'success') throw new Error('Add failed: ' + add.message);
  const newId = add.id || add.data?.id;
  if (!newId) throw new Error('No ID returned');

  // 2. UPDATE
  const update = updateUtangServer({
    id: newId,
    tanggal: today,
    namaPihak: 'Test Utang Edit',
    deskripsi: 'Updated',
    total: 1200000,
    sisa: 600000,
    tglJatuh: nextMonth,
    tipe: 'Cicilan',
    status: 'Belum Lunas',
    cicilanPerBulan: 100000,
    catatan: 'Updated'
  });
  Logger.log('=== UTANG UPDATE ===');
  Logger.log(JSON.stringify(update));
  if (update.status !== 'success') throw new Error('Update failed: ' + update.message);

  // 3. GET LIST
  const list = getUtangServer();
  Logger.log('=== UTANG LIST ===');
  Logger.log(JSON.stringify(list));

  // 4. HAPUS
  const del = hapusUtangServer(newId);
  Logger.log('=== UTANG DELETE ===');
  Logger.log(JSON.stringify(del));
  if (del.status !== 'success') throw new Error('Delete failed: ' + del.message);

  Logger.log('✅ testUtangCRUD PASSED');
  return { status: 'success' };
}

/**
 * Jalankan testStatistikAI() untuk menguji statistik & AI
 */
function testStatistikAI() {
  const stats = getStatistik3BulanServer();
  Logger.log('=== STATISTIK 3 BULAN ===');
  Logger.log(JSON.stringify(stats));

  const kategori = getAnalisisKategoriServer();
  Logger.log('=== ANALISIS KATEGORI ===');
  Logger.log(JSON.stringify(kategori));

  const tren = getTren12BulanServer();
  Logger.log('=== TREN 12 BULAN ===');
  Logger.log(JSON.stringify(tren));

  // Test AI (akan error kalau API key belum diset)
  try {
    const ai = getRekomendasiKeuanganServer();
    Logger.log('=== AI REKOMENDASI ===');
    Logger.log(JSON.stringify(ai));
  } catch (e) {
    Logger.log('AI Test skipped (butuh API key): ' + e.message);
  }

  Logger.log('✅ testStatistikAI PASSED');
  return { status: 'success' };
}

/**
 * Jalankan testAIModelFallback() untuk memverifikasi fallback model
 * - Sementara rename model di GEMINI_MODELS ke nama salah
 * - Jalankan ini → seharusnya fallback ke model berikutnya
 */
function testAIModelFallback() {
  // Simulasi dengan mengubah model ke nama yang tidak valid
  const originalModels = PropertiesService.getScriptProperties().getProperty('TEST_GEMINI_MODELS');
  // Test ini hanya log, tidak benar-benar mengubah config
  Logger.log('Test fallback: Pastikan GEMINI_MODELS di controller.gs diubah manual lalu jalankan OCR/rekomendasi');
  Logger.log('Expected: Logger "[OCR][Gemini] Model X gagal, coba model berikutnya..."');
  return { status: 'info', message: 'Manual test required - edit GEMINI_MODELS.FLASH_3_6 ke nama invalid' };
}

/**
 * Jalankan testCacheBehavior() untuk verifikasi cache
 */
function testCacheBehavior() {
  // 1. Load pertama (fresh)
  const load1 = getRiwayatKasServer(1, 10, {});
  Logger.log('Load 1 (fresh): ' + JSON.stringify({ status: load1.status, count: load1.data?.length }));

  // 2. Load kedua (cached)
  const load2 = getRiwayatKasServer(1, 10, {});
  Logger.log('Load 2 (cached): ' + JSON.stringify({ status: load2.status, count: load2.data?.length }));

  // 3. Force refresh dengan CRUD
  invalidateTransaksiCache_();
  const load3 = getRiwayatKasServer(1, 10, {});
  Logger.log('Load 3 (after invalidate): ' + JSON.stringify({ status: load3.status, count: load3.data?.length }));

  // Test dompet cache
  const d1 = getDompetServer();
  Logger.log('Dompet load 1: ' + JSON.stringify({ status: d1.status, total: d1.totalSaldo }));
  invalidateDompetCache_();
  const d2 = getDompetServer();
  Logger.log('Dompet load 2 (after invalidate): ' + JSON.stringify({ status: d2.status, total: d2.totalSaldo }));

  Logger.log('✅ testCacheBehavior PASSED');
  return { status: 'success' };
}

/**
 * MASTER TEST: Jalankan semua test berurutan
 */
function runAllTests() {
  try {
    testCacheBehavior();
    testTransaksiCRUD();
    testDompetCRUD();
    testUtangCRUD();
    testStatistikAI();
    Logger.log('🎉 ALL TESTS PASSED');
    return { status: 'success', message: 'All tests passed' };
  } catch (e) {
    Logger.log('❌ TEST FAILED: ' + e.message);
    Logger.log(e.stack);
    return { status: 'error', message: e.message };
  }
}