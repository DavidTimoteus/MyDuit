/**
 * File: Controller.gs
 * Versi: Web App Controller Rev 1.1
 * Deskripsi: Backend Controller dengan Parsing Data & Error Handling
 */

const CONFIG = {
  SHEET_NAME: "in/out",
  START_ROW: 6
};

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doGet(e) {
  return HtmlService.createTemplateFromFile('View_Index')
    .evaluate()
    .setTitle('Laporan Keuangan - Riwayat Kas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Mengambil data riwayat kas dengan paginasi & parsing data aman (Anti-Crash)
 */
function getRiwayatKasServer(page = 1, limit = 10) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) return { status: "success", data: [], totalPages: 1, currentPage: 1 };

    const lastRow = sheet.getLastRow();
    if (lastRow < CONFIG.START_ROW) return { status: "success", data: [], totalPages: 1, currentPage: 1 };

    const numRows = lastRow - CONFIG.START_ROW + 1;
    const range = sheet.getRange(CONFIG.START_ROW, 1, numRows, 6);
    const values = range.getValues();

    // Urutkan data dari yang terbaru (baris paling bawah)
    const reversedValues = values.reverse();
    const totalData = reversedValues.length;
    const totalPages = Math.ceil(totalData / limit);

    const startIndex = (page - 1) * limit;
    const paginatedData = reversedValues.slice(startIndex, startIndex + limit)
      .map((row, index) => {
        // 1. Hitung baris asli di Google Sheets untuk setiap item
        const originalRowIndex = CONFIG.START_ROW + (numRows - 1 - (startIndex + index));
        // 2. Return objek data transaksi
        return {
          rowIndex: originalRowIndex,
          tanggal: formatDateSafe(row[0]),
          jenis: row[1] ? String(row[1]).trim() : "",
          kategori: row[2] ? String(row[2]).trim() : "",
          sumber: row[3] ? String(row[3]).trim() : "",
          keterangan: row[4] ? String(row[4]).trim() : "",
          nominal: parseNominalSafe(row[5])
        };
      });

    return {
      status: "success",
      data: paginatedData,
      totalPages: totalPages || 1,
      currentPage: page
    };
  } catch (error) {
    return { status: "error", message: error.message };
  }
}

/**
 * Helper: Format Tanggal Aman
 */
function formatDateSafe(val) {
  if (!val) return "";
  try {
    if (val instanceof Date) {
      return Utilities.formatDate(val, Session.getScriptTimeZone(), "dd/MM/yyyy");
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd/MM/yyyy");
    }
    return String(val).split("T")[0];
  } catch (e) {
    return String(val);
  }
}

/**
 * Helper: Parse Nominal Angka Aman
 */
function parseNominalSafe(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  return parseFloat(cleaned) || 0;
}

function fetchKategoriServer() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return ["MAKANAN"];

  const maxRows = sheet.getMaxRows();
  if (maxRows < CONFIG.START_ROW) return ["MAKANAN"];

  const values = sheet.getRange(CONFIG.START_ROW, 3, maxRows - CONFIG.START_ROW + 1, 1).getValues();
  const listKategori = new Set(["MAKANAN"]);

  values.forEach(row => {
    if (row[0] && typeof row[0] === 'string') listKategori.add(row[0].trim().toUpperCase());
  });

  return Array.from(listKategori);
}

function simpanTransaksiServer(data) {
  try {
    if (!data.tanggal || !data.jenis || !data.kategori || !data.nominal) {
      throw new Error("Data tidak lengkap!");
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
    const formatKategori = String(data.kategori).trim().toUpperCase();

    const rowData = [
      data.tanggal,
      data.jenis,
      formatKategori,
      data.sumber,
      data.keterangan,
      Number(data.nominal)
    ];

    sheet.appendRow(rowData);
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 3).setFontWeight("bold").setHorizontalAlignment("center");

    SpreadsheetApp.flush();

    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error.message };
  }
}

/**
 * Menghapus baris transaksi dari database Google Sheets
 */
function hapusTransaksiServer(rowIndex) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) throw new Error("Sheet tidak ditemukan!");

    sheet.deleteRow(rowIndex);
    SpreadsheetApp.flush(); // Flush wajib agar sinkronisasi instan

    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error.message };
  }
}

/**
 * Memperbarui data transaksi pada baris tertentu
 */
function updateTransaksiServer(data) {
  try {
    if (!data.rowIndex || !data.tanggal || !data.jenis || !data.kategori || !data.nominal) {
      throw new Error("Data tidak lengkap untuk diperbarui!");
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) throw new Error("Sheet tidak ditemukan!");

    const formatKategori = String(data.kategori).trim().toUpperCase();
    const rowData = [
      data.tanggal, 
      data.jenis, 
      formatKategori, 
      data.sumber, 
      data.keterangan, 
      Number(data.nominal)
    ];

    // Timpa data pada baris target
    sheet.getRange(data.rowIndex, 1, 1, 6).setValues([rowData]);
    sheet.getRange(data.rowIndex, 3).setFontWeight("bold").setHorizontalAlignment("center");

    SpreadsheetApp.flush(); // Sinkronisasi instan database

    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error.message };
  }
}

/**
 * Server Controller: Memfilter transaksi dari sheet 'in/out' berdasarkan kriteria dashboard
 * @param {Object} params - Object berisi tipe filter, bulan, dan tahun
 * @return {Array} Array objek transaksi terfilter
 */
function getFilteredTransactionsServer(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("in/out");
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 6) return [];

  // Ambil data transaksi dari baris 6 (Kolom A-F)
  const rawData = sheet.getRange(6, 1, lastRow - 5, 6).getValues();
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const filtered = rawData.filter(row => {
    const rawDate = row[0];
    if (!(rawDate instanceof Date) || isNaN(rawDate.getTime())) return false;

    const cellDate = new Date(rawDate);
    cellDate.setHours(0, 0, 0, 0);

    switch (params.tipe) {
      case "7hari": {
        const diffDays = Math.floor((now.getTime() - cellDate.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays >= 0 && diffDays <= 7;
      }
      case "30hari": {
        const diffDays = Math.floor((now.getTime() - cellDate.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays >= 0 && diffDays <= 30;
      }
      case "bulanan": {
        return cellDate.getMonth() === params.bulan && cellDate.getFullYear() === params.tahun;
      }
      case "semua":
      default:
        return true;
    }
  });

  // Urutkan transaksi dari tanggal terbaru ke terlama
  filtered.sort((a, b) => new Date(b[0]) - new Date(a[0]));

  return filtered.map(row => {
    const dateObj = new Date(row[0]);
    const formattedDate = Utilities.formatDate(dateObj, ss.getSpreadsheetTimeZone(), "dd/MM/yyyy");
    const nominal = Number(row[5]) || 0;

    return {
      tanggal: formattedDate,
      tanggalRaw: dateObj.toISOString(),
      jenis: row[1],
      kategori: row[2],
      sumber: row[3],
      keterangan: row[4],
      nominal: nominal,
      nominalFormat: "Rp " + nominal.toLocaleString("id-ID")
    };
  });
}

/**
 * Menghapus transaksi yang berusia lebih dari 2 tahun secara otomatis (Retention Policy 2 Tahun)
 */
function autoCleanupOldTransactions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("in/out");
  if (!sheet) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 6) return; // Tidak ada data transaksi

  const now = new Date();
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(now.getFullYear() - 2);
  twoYearsAgo.setHours(0, 0, 0, 0);

  const rawData = sheet.getRange(6, 1, lastRow - 5, 6).getValues();
  const validRows = [];

  // Filter baris yang usianya masih <= 2 tahun
  rawData.forEach(row => {
    const rawDate = row[0];
    if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
      const cellDate = new Date(rawDate);
      cellDate.setHours(0, 0, 0, 0);
      if (cellDate >= twoYearsAgo) {
        validRows.push(row);
      }
    } else if (row.some(cell => cell !== "")) {
      // Pertahankan baris non-tanggal jika terisi
      validRows.push(row);
    }
  });

  // Jika ada baris kedaluwarsa yang terhapus, perbarui area data pada spreadsheet
  if (validRows.length < rawData.length) {
    sheet.getRange(6, 1, lastRow - 5, 6).clearContent();
    if (validRows.length > 0) {
      sheet.getRange(6, 1, validRows.length, 6).setValues(validRows);
    }
    SpreadsheetApp.flush();
  }
}

/**
 * Panggil pembersihan otomatis sebelum mengambil data transaksi
 */
function getFilteredTransactionsServer(params) {
  // Jalankan pembersihan otomatis data > 2 tahun
  autoCleanupOldTransactions();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("in/out");
  if (!sheet) return [];

  const lastRow = sheet.getLastRow();
  if (lastRow < 6) return [];

  const rawData = sheet.getRange(6, 1, lastRow - 5, 6).getValues();
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const filtered = rawData.filter(row => {
    const rawDate = row[0];
    if (!(rawDate instanceof Date) || isNaN(rawDate.getTime())) return false;

    const cellDate = new Date(rawDate);
    cellDate.setHours(0, 0, 0, 0);

    switch (params.tipe) {
      case "7hari": {
        const diffDays = Math.floor((now.getTime() - cellDate.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays >= 0 && diffDays <= 7;
      }
      case "30hari": {
        const diffDays = Math.floor((now.getTime() - cellDate.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays >= 0 && diffDays <= 30;
      }
      case "bulanan": {
        return cellDate.getMonth() === params.bulan && cellDate.getFullYear() === params.tahun;
      }
      case "semua":
      default:
        return true;
    }
  });

  filtered.sort((a, b) => new Date(b[0]) - new Date(a[0]));

  return filtered.map(row => {
    const dateObj = new Date(row[0]);
    const formattedDate = Utilities.formatDate(dateObj, ss.getSpreadsheetTimeZone(), "dd/MM/yyyy");
    const nominal = Number(row[5]) || 0;

    return {
      tanggal: formattedDate,
      tanggalRaw: dateObj.toISOString(),
      jenis: row[1],
      kategori: row[2],
      sumber: row[3],
      keterangan: row[4],
      nominal: nominal,
      nominalFormat: "Rp " + nominal.toLocaleString("id-ID")
    };
  });
}