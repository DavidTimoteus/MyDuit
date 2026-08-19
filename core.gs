/*******************************************************
 * MyDuit — core.gs
 * Domain: Fondasi — tidak bergantung file domain lain.
 * Direkonstruksi dari controller.gs lama (isi & logic TIDAK diubah,
 * murni dipindah apa adanya) karena file hasil pemecahan sebelumnya
 * hilang. Lihat database.md, bagian "Pemisahan File per Domain".
 *
 * Isi:
 * - CONFIG, cache config transaksi
 * - invalidateTransaksiCache_(), getRawTransaksiCached_()
 * - doGet() (entry point Web App), include()
 * - getSheet()
 * - generatePrimaryKey_(), findRowIndexById_()
 * - parseSheetDate(), maybeRunCleanup()
 *
 * Dipakai oleh: dompet.gs, transaksi.gs, utang.gs, statistik.gs,
 * ai-model.gs, laporan-pdf.gs, test.gs.
 * Bergantung pada: database-init.gs (getUserDatabase_()),
 * transaksi.gs (fetchKategoriServer(), getRiwayatKasServer()),
 * dompet.gs (getDompetServer()) — dipanggil dari doGet().
 *******************************************************/

const CONFIG = {
  SHEET_NAME: "Transaksi",
  START_ROW: 2
};

// ============ CACHE (OPTIMASI BACA/TULIS SHEET) ============
// Tujuan: dalam window singkat (60 detik), ganti halaman/filter riwayat berkali-kali
// TIDAK perlu baca fisik ke Sheet lagi -> pakai CacheService.getUserCache().
// Cache di-invalidate LANGSUNG begitu ada CRUD (bukan menunggu TTL habis), jadi data
// yg ditampilkan tetap selalu benar/terbaru.
const CACHE_TTL_SECONDS = 60;
const CACHE_KEY_RAW_TRANSAKSI = 'rawTransaksiInOut_v1';

function invalidateTransaksiCache_() {
  CacheService.getUserCache().remove(CACHE_KEY_RAW_TRANSAKSI);
}

// Baca seluruh baris Sheet transaksi (kolom A:I, 9 kolom sesuai skema baru),
// pakai cache 60 detik. getRiwayatKasServer() WAJIB lewat sini (bukan getRange()
// sendiri), supaya ganti halaman/filter yg sering terjadi dalam waktu singkat
// cukup 1x baca fisik ke sheet, sisanya difilter dari cache di memory.
function getRawTransaksiCached_(sheet) {
  const cache = CacheService.getUserCache();
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
  let rawData = sheet.getRange(CONFIG.START_ROW, 1, lastRow - CONFIG.START_ROW + 1, 9).getValues(); // satu-satunya baca fisik
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
  if (e && e.parameter && e.parameter.debug === '1') {
    const lines = debugTestIncludes();
    return HtmlService.createHtmlOutput('<pre>' + lines.join('\n').replace(/</g, '&lt;') + '</pre>')
      .setTitle('Debug Includes');
  }
  const template = HtmlService.createTemplateFromFile('ViewIndex');
  const initialFilter = { tipe: 'hari_ini', startDate: '', endDate: '', jenis: 'Semua', search: '' };

  // Cek database SEBELUM fetch data apa pun. Kalau belum ada/gagal diakses
  // (belum dibuat, atau file terhapus dari Drive) -> SKIP total pemanggilan
  // fetchKategoriServer()/getRiwayatKasServer()/getDompetServer(), supaya
  // doGet() tidak error dan halaman tetap bisa render popup setup database
  // (lihat DatabaseSetupModal.html, yg mengecek ulang via
  // getUserDatabaseStatusServer() saat halaman dimuat).
  try {
    getUserDatabase_(); // hanya untuk verifikasi akses, hasilnya sudah di-cache
    template.hasDatabase = true;
    template.dbError = '';

    template.initialKategori = fetchKategoriServer();
    // FIX: limit 10 -> 50, disamakan dgn batchFetchLimit di ViewJS.html (OPTIMASI PAGINATION
    // client-side batch slicing) -> initial render dari doGet() jadi 1 batch (50 item) yg sama
    // persis dgn yg dipakai loadRiwayat(), supaya 5 halaman pertama Riwayat Transaksi langsung
    // bisa dinavigasi instan tanpa fetch tambahan begitu halaman pertama kali dibuka.
    template.initialRiwayat = getRiwayatKasServer(1, 50, initialFilter);
    template.initialDompet = getDompetServer(); // OPTIMASI: inline sekali di awal, switchTab('budget') 0 round-trip
  } catch (err) {
    // Database belum ada / tidak bisa diakses -> jangan fetch apa pun.
    // Notifikasi ke user ditangani di sisi client (DatabaseSetupModal.html)
    // begitu DOMContentLoaded, BUKAN di sini, supaya tidak dobel notifikasi
    // dgn popup setup database yg memang akan muncul otomatis.
    template.hasDatabase = false;
    template.dbError = err.message || 'Database belum tersedia.';
    template.initialKategori = [];
    template.initialRiwayat = { status: 'success', data: [], totalPages: 0, currentPage: 1 };
    template.initialDompet = { status: 'success', rekening: [], totalSaldo: 0 };
  }

  return template.evaluate()
    .setTitle('MyDuit Laporan Keuangan')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  const tpl = HtmlService.createTemplateFromFile(filename);
  if (!tpl || typeof tpl.evaluate !== 'function') {
    throw new Error('[include] createTemplateFromFile("' + filename + '") bukan HtmlTemplate (type=' + typeof tpl + ')');
  }
  return tpl.evaluate().getContent();
}

function debugTestIncludes() {
  const files = ['ViewCSS', 'ViewTransaksi', 'ViewBudget', 'ViewStatistik', 'ViewUtang', 'ViewJS', 'DatabaseSetupModal', 'AIOnboardingModal', 'ViewIndex'];
  const results = [];
  files.forEach(function (f) {
    try {
      const tpl = HtmlService.createTemplateFromFile(f);
      const isTpl = (tpl && typeof tpl.evaluate === 'function');
      if (!isTpl) {
        results.push(f + ' -> BUKAN HtmlTemplate (type: ' + typeof tpl + ', keys: ' + Object.keys(tpl || {}).join(',') + ')');
        return;
      }
      const out = tpl.evaluate();
      results.push(f + ' -> OK (' + out.getContent().length + ' chars)');
    } catch (e) {
      results.push(f + ' -> ERROR: ' + e.message);
    }
  });
  Logger.log(results.join('\n'));
  return results;
}

function getSheet() {
  const ss = getUserDatabase_();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${CONFIG.SHEET_NAME}" tidak ditemukan.`);
  return sheet;
}

// ============ HELPER: PRIMARY KEY & GENERATOR ============
function generatePrimaryKey_(prefix) {
  const timeZone = getUserDatabase_().getSpreadsheetTimeZone();
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
    sheet.getRange(CONFIG.START_ROW, 1, rawData.length, 9).clearContent();
    if (validRows.length > 0) sheet.getRange(CONFIG.START_ROW, 1, validRows.length, 9).setValues(validRows);
  }
  props.setProperty('lastCleanupDate', todayStr);
  return validRows;
}
