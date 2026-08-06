const CONFIG = {
  SHEET_NAME: "in/out",
  START_ROW: 6
};

const BULAN_NAMA = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('View_Index');

  // OPTIMASI CRITICAL PATH: inline kategori & riwayat halaman-1 langsung ke HTML
  // agar first render tidak menunggu 2x round-trip google.script.run berantai.
  const initialFilter = { tipe: 'semua', startDate: '', endDate: '', jenis: 'Semua', search: '' };
  template.initialKategori = fetchKategoriServer();
  template.initialRiwayat = getRiwayatKasServer(1, 10, initialFilter);

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
        } else if (filterParams.tipe === 'custom') {
          // Filter periode kustom dari modal "Pilih periode" (Dari/Hingga)
          if (filterParams.startDate) {
            const start = parseSheetDate(filterParams.startDate);
            if (start) { start.setHours(0, 0, 0, 0); if (parsedDate < start) return; }
          }
          if (filterParams.endDate) {
            const end = parseSheetDate(filterParams.endDate);
            if (end) { end.setHours(0, 0, 0, 0); if (parsedDate > end) return; }
          }
        }
        // tipe === 'semua' -> tidak ada filter tanggal, lanjut ke filter jenis/search

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
    CacheService.getScriptCache().remove('initialPayload');
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
    CacheService.getScriptCache().remove('initialPayload');
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
    CacheService.getScriptCache().remove('initialPayload');
    return { status: "success", riwayat: riwayat };
  } catch (err) {
    return { status: "error", message: err.message };
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// FITUR: EXPORT LAPORAN PDF PER BULAN
// ==========================================

// Format angka ke Rupiah, mis. 1250000 -> "Rp1.250.000"
function formatRupiah(num) {
  const angka = Math.round(Math.abs(num || 0));
  return (num < 0 ? '-Rp' : 'Rp') + angka.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Ambil SELURUH transaksi 1 bulan (tanpa pagination) utk keperluan laporan, urut tanggal naik
function getSemuaTransaksiBulanServer(bulan, tahun) {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.START_ROW) return [];

  const totalRows = lastRow - CONFIG.START_ROW + 1;
  const rawData = sheet.getRange(CONFIG.START_ROW, 1, totalRows, 6).getValues();
  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();

  const list = [];
  rawData.forEach(row => {
    if (row.every(cell => cell === "")) return;
    const parsedDate = parseSheetDate(row[0]);
    if (!parsedDate) return;
    if (parsedDate.getMonth() !== bulan || parsedDate.getFullYear() !== tahun) return;

    list.push({
      tanggalRaw: parsedDate,
      tanggal: Utilities.formatDate(parsedDate, timeZone, "dd/MM/yyyy"),
      jenis: row[1] || "",
      kategori: row[2] || "",
      sumber: row[3] || "",
      keterangan: row[4] || "",
      nominal: Number(row[5]) || 0
    });
  });

  list.sort((a, b) => a.tanggalRaw - b.tanggalRaw);
  return list;
}

// Susun HTML laporan (dipakai sbg sumber konversi ke PDF)
function buildLaporanHTML(items, bulan, tahun) {
  const timeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const tanggalCetak = Utilities.formatDate(new Date(), timeZone, "dd MMMM yyyy, HH:mm");

  let totalPemasukan = 0, totalPengeluaran = 0;
  const rowsHtml = items.map(it => {
    const isIncome = ['pemasukan', 'pendapatan'].includes(String(it.jenis).toLowerCase());
    if (isIncome) totalPemasukan += it.nominal; else totalPengeluaran += it.nominal;
    const warna = isIncome ? '#10b981' : '#e53e3e';
    const tanda = isIncome ? '+' : '-';
    return `
      <tr>
        <td>${it.tanggal}</td>
        <td>${it.kategori}</td>
        <td>${it.sumber || '-'}</td>
        <td>${it.keterangan || '-'}</td>
        <td class="nominal" style="color:${warna};">${tanda} ${formatRupiah(it.nominal)}</td>
      </tr>`;
  }).join('');

  const saldoBersih = totalPemasukan - totalPengeluaran;
  const emptyState = items.length === 0
    ? `<tr><td colspan="5" style="text-align:center; color:#6c757d; padding:24px;">Tidak ada transaksi pada periode ini.</td></tr>`
    : '';

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
      th { background: #2D6A4F; color: #fff; text-align: left; padding: 8px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: .3px; }
      td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; }
      tr:nth-child(even) td { background: #f4f7f6; }
      .nominal { text-align: right; font-weight: bold; white-space: nowrap; }
      .summary { margin-top: 18px; width: 260px; margin-left: auto; }
      .summary div { display: flex; justify-content: space-between; padding: 6px 10px; font-size: 11px; }
      .summary .pemasukan { color: #10b981; }
      .summary .pengeluaran { color: #e53e3e; }
      .summary .saldo { background: #2D6A4F; color: #fff; font-weight: bold; border-radius: 6px; margin-top: 4px; }
      .footer { margin-top: 24px; font-size: 9px; color: #9ca3af; text-align: center; }
    </style>
  </head>
  <body>
    <div class="header">
      <div>
        <h1>MyDuit</h1>
        <p>Laporan Keuangan Bulanan</p>
      </div>
      <div class="periode">
        <strong>${BULAN_NAMA[bulan]} ${tahun}</strong>
        <p>Dicetak: ${tanggalCetak}</p>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Tanggal</th>
          <th>Kategori</th>
          <th>Sumber</th>
          <th>Keterangan</th>
          <th style="text-align:right;">Nominal</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || emptyState}
      </tbody>
    </table>

    <div class="summary">
      <div class="pemasukan"><span>Total Pemasukan</span><span>${formatRupiah(totalPemasukan)}</span></div>
      <div class="pengeluaran"><span>Total Pengeluaran</span><span>${formatRupiah(totalPengeluaran)}</span></div>
      <div class="saldo"><span>Saldo Bersih</span><span>${formatRupiah(saldoBersih)}</span></div>
    </div>

    <p class="footer">Laporan ini dibuat otomatis oleh aplikasi MyDuit.</p>
  </body>
  </html>`;
}

// Entry point dipanggil dari frontend: generate laporan bulan tertentu -> PDF (base64)
function generateLaporanPDFServer(bulan, tahun) {
  try {
    const items = getSemuaTransaksiBulanServer(bulan, tahun);
    const html = buildLaporanHTML(items, bulan, tahun);

    const pdfBlob = Utilities.newBlob(html, 'text/html', 'laporan.html').getAs('application/pdf');
    const fileName = `Laporan-MyDuit-${BULAN_NAMA[bulan]}-${tahun}.pdf`;
    pdfBlob.setName(fileName);

    return {
      status: "success",
      fileName: fileName,
      base64: Utilities.base64Encode(pdfBlob.getBytes())
    };
  } catch (err) {
    return { status: "error", message: err.message };
  }
}

function getDompetServer() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Dompet");
    if (!sheet) return { status: "error", message: 'Sheet "Dompet" tidak ditemukan.' };
    const lastRow = sheet.getLastRow();
    if (lastRow < 5) return { status: "success", totalSaldo: 0, rekening: [], lastUpdated: readLastUpdatedDompet_() };
    const data = sheet.getRange(6, 1, lastRow - 4, 5).getValues(); // A:E
    const timeZone = ss.getSpreadsheetTimeZone();
    let totalSaldo = 0;
    const rekening = [];
    data.forEach(row => {
      if (!row[0]) return;
      const saldo = Number(row[1]) || 0;
      totalSaldo += saldo;
      rekening.push({
        nama: row[0],
        saldo,
        kategori: row[3] || "Umum",
        terakhirDiperbarui: row[4] ? Utilities.formatDate(new Date(row[4]), timeZone, "dd/MM/yyyy HH:mm") : "-"
      });
    });
    return {
      status: 'success',
      totalSaldo: totalSaldo,
      rekening: rekening,                     // ⬅ fix: sebelumnya "rekeningList" (undefined/ReferenceError)
      lastUpdated: readLastUpdatedDompet_()    // hanya BACA, tidak memanggil saveLastUpdatedDompet_()
    };
  } catch (err) {
    return { status: "error", message: err.message };
  }
}

// ============ HELPER: Last Updated Dompet (Sheet 'Dompet' cell C4) ============
const SHEET_DOMPET = 'Dompet';
const CELL_LAST_UPDATED = 'C4';

/**
 * Tulis timestamp saat ini ke Dompet!C4 (ISO string).
 * Dipanggil setelah setiap perubahan data rekening/dompet.
 */
function saveLastUpdatedDompet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_DOMPET);
  if (!sh) throw new Error('Sheet "Dompet" tidak ditemukan');
  const now = new Date();
  sh.getRange(CELL_LAST_UPDATED).setValue(now); // simpan sebagai Date, bukan string
  return now.toISOString();
}

/**
 * Baca timestamp terakhir dari Dompet!C4.
 * Kembalikan ISO string atau null jika kosong.
 */
function readLastUpdatedDompet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_DOMPET);
  if (!sh) return null;
  const val = sh.getRange(CELL_LAST_UPDATED).getValue();
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  // fallback: nilai string manual
  const d = new Date(val);
  return isNaN(d) ? null : d.toISOString();
}

/**
 * Endpoint publik untuk memperbarui Dompet!C4 dan mengembalikan ISO string baru.
 */
function touchLastUpdatedDompet() {
  try {
    const iso = saveLastUpdatedDompet_();
    return { status: 'success', lastUpdated: iso };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function updateSaldoRekeningServer(namaRekening, saldoBaru) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_DOMPET);
    if (!sheet) throw new Error('Sheet "Dompet" tidak ditemukan.');

    const lastRow = sheet.getLastRow();
    if (lastRow < 5) throw new Error('Rekening tidak ditemukan.');

    const data = sheet.getRange(5, 1, lastRow - 4, 2).getValues(); // A:B (nama, saldo)
    const rowOffset = data.findIndex(r => String(r[0]).trim() === String(namaRekening).trim());
    if (rowOffset === -1) throw new Error(`Rekening "${namaRekening}" tidak ditemukan.`);

    const rowIndex = 5 + rowOffset;
    const saldoLama = Number(data[rowOffset][1]) || 0;
    const saldoBaruNum = Number(saldoBaru) || 0;

    // Guard: hanya tulis & update timestamp jika nilai BENAR-BENAR berubah
    if (saldoLama !== saldoBaruNum) {
      const now = new Date();
      sheet.getRange(rowIndex, 2).setValue(saldoBaruNum);       // update saldo
      sheet.getRange(rowIndex, 5).setValue(now);                // update terakhirDiperbarui per-baris
      saveLastUpdatedDompet_();                                 // ⬅ HANYA di sini C4 ditulis ulang
    }

    return getDompetServer(); // refresh payload dlm 1 round-trip (pola sama dgn CRUD lain)
  } catch (err) {
    return { status: "error", message: err.message };
  } finally {
    lock.releaseLock();
  }
}