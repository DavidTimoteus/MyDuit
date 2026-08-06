const CONFIG = {
  SHEET_NAME: "in/out",
  START_ROW: 6
};

function doGet(e) {
  return HtmlService.createTemplateFromFile('View_Index')
    .evaluate()
    .setTitle('MyDuit Laporan Keuangan')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${CONFIG.SHEET_NAME}" tidak ditemukan.`);
  return sheet;
}

// Fitur: Safe Date Parser
function parseSheetDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;
    let d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;

    const parts = trimmed.split(/[\/\-\s]+/);
    if (parts.length >= 3) {
      const months = {
        jan: 0, januari: 0, feb: 1, februari: 1, mar: 2, maret: 2, apr: 3, april: 3,
        mei: 4, jun: 5, juni: 5, jul: 6, juli: 6, agu: 7, agustus: 7,
        sep: 8, september: 8, okt: 9, oktober: 9, nov: 10, november: 10, des: 11, desember: 11
      };
      let day = parseInt(parts[0], 10), monthStr = parts[1].toLowerCase(), year = parseInt(parts[2], 10);
      let month = months[monthStr] !== undefined ? months[monthStr] : (parseInt(monthStr, 10) - 1);
      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        if (year < 100) year += 2000;
        return new Date(year, month, day);
      }
    }
  }
  return null;
}

// Fitur: Pembersihan Data 2 Tahun (Retention)
// Cleanup HANYA jalan 1x per hari (throttle), bukan tiap request
function maybeRunCleanup(sheet, rawData) {
  const props = PropertiesService.getScriptProperties();
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (props.getProperty('lastCleanupDate') === todayStr) return rawData; // sudah jalan hari ini, skip total

  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  twoYearsAgo.setHours(0, 0, 0, 0);

  const validRows = [];
  let changed = false;
  rawData.forEach(row => {
    const parsedDate = parseSheetDate(row[0]);
    if (parsedDate) {
      parsedDate.setHours(0, 0, 0, 0);
      if (parsedDate >= twoYearsAgo) validRows.push(row); else changed = true;
    } else if (row.some(cell => cell !== "")) {
      validRows.push(row);
    }
  });

  if (changed) {
    sheet.getRange(CONFIG.START_ROW, 1, rawData.length, 6).clearContent();
    if (validRows.length > 0) sheet.getRange(CONFIG.START_ROW, 1, validRows.length, 6).setValues(validRows);

  }
  props.setProperty('lastCleanupDate', todayStr);
  return validRows;
}

// Fitur: Ambil & Filter Data dari Frontend
function getRiwayatKasServer(page, limit, filterParams) {
  try {
    const pageNum = page || 1;
    const limitNum = limit || 10;
    const sheet = getSheet();
    const lastRow = sheet.getLastRow();

    if (lastRow < CONFIG.START_ROW) return { status: "success", data: [], totalPages: 0, currentPage: 1 };

    const totalRows = lastRow - CONFIG.START_ROW + 1;
    let rawData = sheet.getRange(CONFIG.START_ROW, 1, totalRows, 6).getValues(); // satu-satunya full read
    rawData = maybeRunCleanup(sheet, rawData); // pakai data yg sudah di-read, bukan read ulang

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const timeZone = ss.getSpreadsheetTimeZone();
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    let formattedList = [];

    rawData.forEach((row, idx) => {
      if (row.every(cell => cell === "")) return;
      const parsedDate = parseSheetDate(row[0]);
      if (!parsedDate) return;
      parsedDate.setHours(0, 0, 0, 0);

      // --- LOGIKA FILTER SERVER ---
      if (filterParams) {
        // 1. Filter Tipe & Waktu
        if (filterParams.tipe === '7hari') {
          const diffDays = Math.floor((now.getTime() - parsedDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays < 0 || diffDays > 7) return;
        } else if (filterParams.tipe === '30hari') {
          const diffDays = Math.floor((now.getTime() - parsedDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays < 0 || diffDays > 30) return;
        } else if (filterParams.tipe === 'bulanan') {
          if (parsedDate.getMonth() !== filterParams.bulan || parsedDate.getFullYear() !== filterParams.tahun) return;
        }

        // 2. Filter Jenis
        const jenisLower = String(row[1] || '').toLowerCase();
        const isIncome = (jenisLower === 'pemasukan' || jenisLower === 'pendapatan');
        if (filterParams.jenis === 'Pemasukan' && !isIncome) return;
        if (filterParams.jenis === 'Pengeluaran' && isIncome) return;

        // 3. Filter Search (Text)
        if (filterParams.search) {
          const q = filterParams.search;
          const match = String(row[2] || '').toLowerCase().includes(q) ||
            String(row[4] || '').toLowerCase().includes(q) ||
            String(row[3] || '').toLowerCase().includes(q) ||
            String(row[5] || '').toLowerCase().includes(q);
          if (!match) return;
        }
      }

      formattedList.push({
        rowIndex: CONFIG.START_ROW + idx,
        tanggal: Utilities.formatDate(parsedDate, timeZone, "dd/MM/yyyy"),
        tanggalRaw: Utilities.formatDate(parsedDate, timeZone, "yyyy-MM-dd"),
        jenis: row[1] || "",
        kategori: row[2] || "",
        sumber: row[3] || "",
        keterangan: row[4] || "",
        nominal: Number(row[5]) || 0
      });
    });

    formattedList.sort((a, b) => new Date(b.tanggalRaw) - new Date(a.tanggalRaw));
    const totalItems = formattedList.length;
    const totalPages = Math.ceil(totalItems / limitNum) || 1;
    const startIndex = (pageNum - 1) * limitNum;

    return { status: "success", data: formattedList.slice(startIndex, startIndex + limitNum), totalPages, currentPage: pageNum };
  } catch (err) {
    return { status: "error", message: err.message || "Gagal memproses data server." };
  }
}

// Fitur: CRUD Database
function fetchKategoriServer() {
  try {
    const sheet = getSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < CONFIG.START_ROW) return [];
    const data = sheet.getRange(CONFIG.START_ROW, 3, lastRow - CONFIG.START_ROW + 1, 1).getValues();
    return [...new Set(data.map(r => String(r[0]).trim()).filter(k => k !== ""))].sort();
  } catch (e) { return []; }
}

// CATATAN PERBAIKAN DELAY:
// Sebelumnya, setiap simpan/update/hapus melakukan 1 round-trip google.script.run
// untuk CRUD, lalu frontend memanggil loadRiwayat() yang memicu round-trip KEDUA
// (baca ulang seluruh sheet + filter + sort) hanya untuk me-refresh daftar.
// Di Apps Script, setiap round-trip client<->server punya overhead jaringan yang
// nyata (umumnya 1-3 detik), jadi 2 round-trip berurutan = delay dobel yang terasa.
// Fix: gabungkan CRUD + pengambilan ulang data riwayat menjadi SATU panggilan
// server (fungsi ini langsung memanggil getRiwayatKasServer sebelum return),
// sehingga frontend cukup 1x google.script.run per aksi CRUD.
// LockService dipakai agar tidak ada race condition saat 2 request nulis nyaris bersamaan.

function simpanTransaksiServer(formData, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    getSheet().appendRow([new Date(formData.tanggal), formData.jenis, formData.kategori, formData.sumber, formData.keterangan, Number(formData.nominal)]);
    const riwayat = getRiwayatKasServer(page, limit, filterParams);
    return { status: "success", riwayat: riwayat };
  } catch (err) {
    return { status: "error", message: err.message };
  } finally {
    lock.releaseLock();
  }
}

function updateTransaksiServer(formData, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const row = formData.rowIndex;
    if (row < CONFIG.START_ROW) throw new Error("Baris tidak valid.");
    getSheet().getRange(row, 1, 1, 6).setValues([[new Date(formData.tanggal), formData.jenis, formData.kategori, formData.sumber, formData.keterangan, Number(formData.nominal)]]);
    const riwayat = getRiwayatKasServer(page, limit, filterParams);
    return { status: "success", riwayat: riwayat };
  } catch (err) {
    return { status: "error", message: err.message };
  } finally {
    lock.releaseLock();
  }
}

function hapusTransaksiServer(rowIndex, page, limit, filterParams) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    if (rowIndex < CONFIG.START_ROW) throw new Error("Baris tidak valid.");
    getSheet().deleteRow(rowIndex);
    const riwayat = getRiwayatKasServer(page, limit, filterParams);
    return { status: "success", riwayat: riwayat };
  } catch (err) {
    return { status: "error", message: err.message };
  } finally {
    lock.releaseLock();
  }
}