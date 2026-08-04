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
function autoCleanupOldTransactions() {
  try {
    const sheet = getSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < CONFIG.START_ROW) return;

    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    twoYearsAgo.setHours(0, 0, 0, 0);

    const totalRows = lastRow - CONFIG.START_ROW + 1;
    const rawData = sheet.getRange(CONFIG.START_ROW, 1, totalRows, 6).getValues();
    const validRows = [];

    rawData.forEach(row => {
      const parsedDate = parseSheetDate(row[0]);
      if (parsedDate) {
        parsedDate.setHours(0, 0, 0, 0);
        if (parsedDate >= twoYearsAgo) validRows.push(row);
      } else if (row.some(cell => cell !== "")) {
        validRows.push(row);
      }
    });

    if (validRows.length < rawData.length) {
      sheet.getRange(CONFIG.START_ROW, 1, totalRows, 6).clearContent();
      if (validRows.length > 0) {
        sheet.getRange(CONFIG.START_ROW, 1, validRows.length, 6).setValues(validRows);
      }
      SpreadsheetApp.flush();
    }
  } catch (err) {
    console.error("Warning autoCleanup:", err.message);
  }
}

// Fitur: Ambil & Filter Data dari Frontend
function getRiwayatKasServer(page, limit, filterParams) {
  try {
    autoCleanupOldTransactions();

    const pageNum = page || 1;
    const limitNum = limit || 10;
    const sheet = getSheet();
    const lastRow = sheet.getLastRow();

    if (lastRow < CONFIG.START_ROW) return { status: "success", data: [], totalPages: 0, currentPage: 1 };

    const totalRows = lastRow - CONFIG.START_ROW + 1;
    const rawData = sheet.getRange(CONFIG.START_ROW, 1, totalRows, 6).getValues();
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
        tanggalRaw: parsedDate.toISOString(),
        jenis: row[1] || "",
        kategori: row[2] || "",
        sumber: row[3] || "",
        keterangan: row[4] || "",
        nominal: Number(row[5]) || 0
      });
    });

    formattedList.reverse(); // Urutkan terbaru di atas
    const totalItems = formattedList.length;
    const totalPages = Math.ceil(totalItems / limitNum) || 1;
    const startIndex = (pageNum - 1) * limitNum;

    return { status: "success", data: formattedList.slice(startIndex, startIndex + limitNum), totalPages: totalPages, currentPage: pageNum };
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

function simpanTransaksiServer(formData) {
  try {
    getSheet().appendRow([new Date(formData.tanggal), formData.jenis, formData.kategori, formData.sumber, formData.keterangan, Number(formData.nominal)]);
    SpreadsheetApp.flush();
    return { status: "success" };
  } catch (err) { return { status: "error", message: err.message }; }
}

function updateTransaksiServer(formData) {
  try {
    const row = formData.rowIndex;
    if (row < CONFIG.START_ROW) throw new Error("Baris tidak valid.");
    getSheet().getRange(row, 1, 1, 6).setValues([[new Date(formData.tanggal), formData.jenis, formData.kategori, formData.sumber, formData.keterangan, Number(formData.nominal)]]);
    SpreadsheetApp.flush();
    return { status: "success" };
  } catch (err) { return { status: "error", message: err.message }; }
}

function hapusTransaksiServer(rowIndex) {
  try {
    if (rowIndex < CONFIG.START_ROW) throw new Error("Baris tidak valid.");
    getSheet().deleteRow(rowIndex);
    SpreadsheetApp.flush();
    return { status: "success" };
  } catch (err) { return { status: "error", message: err.message }; }
}