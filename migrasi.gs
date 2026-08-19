/*******************************************************
 * MyDuit — migrasi.gs
 * Domain: Migrasi data dari skema LAMA ke skema baru (7 tabel)
 * 
 * Sumber (spreadsheet lama MyDuit):
 * - Sheet "in/out"    : transaksi, baris mulai 6, kolom A=ID B=Tanggal
 *                       C=Jenis D=Kategori E=Sumber F=Keterangan G=Nominal
 * - Sheet "Dompet"    : akun, baris mulai 7, kolom A=ID B=Nama C=Saldo
 *                       D=Updated E=Tipe F=Catatan
 * - Sheet "UtangCicilan": utang, baris mulai 2, kolom A=ID B=Tanggal
 *                       C=NamaPihak D=Deskripsi E=Total F=Sisa G=Jatuh
 *                       H=Tipe I=Status J=Cicilan K=Catatan L=LastUpdated M=JumlahBayar
 * 
 * Target (database per-user baru, via getUserDatabase_()):
 * - Akun, Kategori, Transaksi, Utang, PembayaranUtang
 *******************************************************/

function migrateLegacyDataServer(ssIdSumber) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // 1. Buka spreadsheet sumber
    let sumber;
    if (ssIdSumber) {
      const urlMatch = String(ssIdSumber).match(/\/d\/([\w-]{15,})/);
      const id = urlMatch ? urlMatch[1] : String(ssIdSumber).trim();
      if (!id) throw new Error('ID/URL spreadsheet tidak valid.');
      sumber = SpreadsheetApp.openById(id);
    } else {
      sumber = SpreadsheetApp.getActiveSpreadsheet();
      if (!sumber) throw new Error('Spreadsheet sumber tidak ditemukan. Berikan ID/URL spreadsheet lama.');
    }

    const waktuMulai = Date.now();
    const hasil = {
      akun: 0,
      kategori: 0,
      transaksi: 0,
      utang: 0,
      pembayaranUtang: 0
    };

    Logger.log('=== MULAI MIGRASI ===');
    Logger.log('Source sheet: ' + sumber.getName() + ' (ID: ' + sumber.getId() + ')');

    // 2. Migrasi Akun (dari sheet Dompet) -> dapat mapping nama->ID utk dipakai Transaksi
    let resAkun = { count: 0, map: {} };
    try {
      Logger.log('Migrasi Akun...');
      resAkun = migrasiAkun_(sumber);
      hasil.akun = resAkun.count;
      Logger.log('Akun migrated: ' + hasil.akun);
    } catch (e) {
      Logger.log('ERROR migrasi Akun: ' + e.message);
      throw e;
    }
    // 3. Migrasi Kategori (dari kolom kategori transaksi) -> mapping nama->ID utk dipakai Transaksi
    let resKategori = { count: 0, map: {} };
    try {
      Logger.log('Migrasi Kategori...');
      resKategori = migrasiKategori_(sumber);
      hasil.kategori = resKategori.count;
      Logger.log('Kategori migrated: ' + hasil.kategori);
    } catch (e) {
      Logger.log('ERROR migrasi Kategori: ' + e.message);
      throw e;
    }
    // 4. Migrasi Transaksi (dari sheet in/out) — kolom KategoriID/AkunID/AkunTujuanID
    //    di-resolve ke ID hasil migrasi Akun & Kategori (bukan nama mentah lagi).
    try {
      Logger.log('Migrasi Transaksi...');
      hasil.transaksi = migrasiTransaksi_(sumber, resAkun.map, resKategori.map);
      Logger.log('Transaksi migrated: ' + hasil.transaksi);
    } catch (e) {
      Logger.log('ERROR migrasi Transaksi: ' + e.message);
      throw e;
    }
    // 5. Migrasi Utang + PembayaranUtang (dari sheet UtangCicilan)
    try {
      Logger.log('Migrasi Utang...');
      const resUtang = migrasiUtang_(sumber);
      hasil.utang = resUtang.utang;
      hasil.pembayaranUtang = resUtang.pembayaran;
      Logger.log('Utang migrated: ' + hasil.utang + ', PembayaranUtang: ' + hasil.pembayaranUtang);
    } catch (e) {
      Logger.log('ERROR migrasi Utang: ' + e.message);
      throw e;
    }

    // Invalidate semua cache supaya data baru langsung terlihat
    try { invalidateTransaksiCache_(); } catch (e) {}
    try { invalidateAkunCache_(); } catch (e) {}
    try { invalidateKategoriCache_(); } catch (e) {}
    try { invalidateUtangCache_(); } catch (e) {}

    const detik = Math.round((Date.now() - waktuMulai) / 1000);
    return {
      status: 'success',
      message: `Migrasi selesai dalam ${detik} detik.`,
      data: hasil
    };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

function getLegacySheet_(ss, nama) {
  let sheet = ss.getSheetByName(nama);
  if (!sheet) {
    // Fallback case-insensitive
    const found = ss.getSheets().find(s => s.getName().toLowerCase() === nama.toLowerCase());
    if (found) sheet = found;
  }
  return sheet;
}

// ============ MIGRASI AKUN ============
// Return { count, map } — map: { namaLowercase: ID } hasil migrasi, dipakai
// migrasiTransaksi_() untuk resolve Transaksi.AkunID/AkunTujuanID ke Akun.ID.
function migrasiAkun_(sumber) {
  const target = getUserDatabase_().getSheetByName('Akun');
  if (!target) return { count: 0, map: {} };

  // Sheet akun di database legacy bisa bernama 'Dompet' (nama yang didokumentasikan)
  // ATAU 'Budget' (nama sheet akun di database lama user yang ternyata memakai
  // nama itu). Keduanya dibaca & di-dedupe per nama akun (case-insensitive),
  // supaya akun di kedua sheet tetap masuk — kalau hanya cari 'Dompet', akun
  // di sheet 'Budget' legacy tidak pernah terbaca (root cause: tab Budget DB
  // baru kehilangan akun tersebut).
  const kandidatSheet = ['Dompet', 'Budget'];
  const rows = [];
  const map = {};
  const seen = {};
  let count = 0;

  kandidatSheet.forEach(function (namaSheet) {
    const sheet = getLegacySheet_(sumber, namaSheet);
    if (!sheet) return;

    const lastRow = sheet.getLastRow();
    if (lastRow < 7) return;

    const data = sheet.getRange(7, 1, lastRow - 6, 6).getValues(); // A:F
    data.forEach(function (row) {
      const nama = String(row[1] || '').trim();
      if (!nama) return;
      // Lewati baris header kalau strukturnya ternyata header ada di baris 7.
      const namaLower = nama.toLowerCase();
      if (namaLower === 'nama' || namaLower === 'nama akun') return;
      if (seen[namaLower]) return; // dedupe antar sheet (Dompet & Budget)
      seen[namaLower] = true;

      const idLama = String(row[0] || '').trim();
      const id = idLama || generatePrimaryKey_('AKN');
      const saldo = Number(row[2]) || 0;
      const updated = row[3] instanceof Date ? row[3] : (row[3] ? new Date(row[3]) : new Date());
      const created = updated;

      rows.push([id, nama, String(row[4] || '').trim(), saldo, saldo, updated, created]);
      map[namaLower] = id;
      count++;
    });
  });

  if (rows.length) {
    target.getRange(target.getLastRow() + 1, 1, rows.length, 7).setValues(rows);
  }
  return { count: count, map: map };
}

// ============ MIGRASI KATEGORI ============
// Return { count, map } — map: { namaLowercase: ID } hasil migrasi, dipakai
// migrasiTransaksi_() untuk resolve Transaksi.KategoriID ke Kategori.ID.
function migrasiKategori_(sumber) {
  const sheet = getLegacySheet_(sumber, 'in/out');
  const target = getUserDatabase_().getSheetByName('Kategori');
  if (!sheet || !target) return { count: 0, map: {} };

  const lastRow = sheet.getLastRow();
  if (lastRow < 6) return { count: 0, map: {} };

  const data = sheet.getRange(6, 3, lastRow - 5, 2).getValues(); // C=Jenis, D=Kategori
  const seen = {};
  const rows = [];
  const map = {};
  let count = 0;

  data.forEach(function (row) {
    const kategori = String(row[1] || '').trim();
    if (!kategori || seen[kategori]) return;

    const jenisRaw = String(row[0] || '').trim().toLowerCase();
    const jenis = (jenisRaw === 'pemasukan' || jenisRaw === 'pendapatan') ? 'Pemasukan' : 'Pengeluaran';

    seen[kategori] = true;
    const katID = generatePrimaryKey_('KAT');
    rows.push([katID, kategori, jenis, true]);
    map[kategori.toLowerCase()] = katID;
    count++;
  });

  if (rows.length) {
    target.getRange(target.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  }
  return { count: count, map: map };
}

// ============ MIGRASI TRANSAKSI ============
// Resolve kolom KategoriID/AkunID/AkunTujuanID ke ID hasil migrasi Akun & Kategori
// (bukan nama mentah) supaya relasi FK di skema baru konsisten — Prinsip Desain #2.
// `mapAkun` & `mapKategori` = hasil { map } dari migrasiAkun_()/migrasiKategori_().
function migrasiTransaksi_(sumber, mapAkun, mapKategori) {
  const sheet = getLegacySheet_(sumber, 'in/out');
  const target = getUserDatabase_().getSheetByName('Transaksi');
  if (!sheet || !target) return 0;

  const lastRow = sheet.getLastRow();
  if (lastRow < 6) return 0;

  const mapAkunSafe = mapAkun || {};
  const mapKategoriSafe = mapKategori || {};

  const data = sheet.getRange(6, 1, lastRow - 5, 7).getValues(); // A:G
  const rows = [];
  let count = 0;

  data.forEach(function (row) {
    if (!row[1] && !row[2] && !row[6]) return;

    const idLama = String(row[0] || '').trim();
    const id = idLama || generatePrimaryKey_('TX');
    const tgl = parseSheetDate(row[1]);
    if (!tgl) return;

    const jenis = String(row[2] || '').trim();
    const kategori = String(row[3] || '').trim();
    const sumberRaw = String(row[4] || '').trim();
    const keterangan = String(row[5] || '').trim();
    const nominal = Number(row[6]) || 0;

    // Resolve nama kategori -> Kategori.ID. Fallback: kalau tidak ketemu di map
    // (mis. kategori kosong), simpan nama apa adanya — konsisten dgn fallback
    // longgar di transaksi.gs (getKategoriTampilFromStored_()).
    const kategoriID = mapKategoriSafe[kategori.toLowerCase()] || kategori;

    // Pecah "A -> B" (format pindah saldo) jadi akun sumber & tujuan, lalu
    // resolve keduanya ke Akun.ID.
    let akunID = mapAkunSafe[sumberRaw.toLowerCase()] || sumberRaw;
    let akunTujuanID = '';
    if (jenis.toLowerCase() === 'pindah saldo' && sumberRaw.indexOf('->') !== -1) {
      const parts = sumberRaw.split('->').map(s => s.trim());
      const akunNamaSumber = parts[0] || '';
      const akunNamaTujuan = parts[1] || '';
      akunID = mapAkunSafe[akunNamaSumber.toLowerCase()] || akunNamaSumber;
      akunTujuanID = mapAkunSafe[akunNamaTujuan.toLowerCase()] || akunNamaTujuan;
    }

    rows.push([id, tgl, jenis, kategoriID, akunID, akunTujuanID, '', keterangan, nominal]);
    count++;
  });

  if (rows.length) {
    target.getRange(target.getLastRow() + 1, 1, rows.length, 9).setValues(rows);
  }
  return count;
}

// ============ MIGRASI UTANG & PEMBAYARAN ============
function migrasiUtang_(sumber) {
  const sheet = getLegacySheet_(sumber, 'UtangCicilan');
  const targetUtang = getUserDatabase_().getSheetByName('Utang');
  const targetBayar = getUserDatabase_().getSheetByName('PembayaranUtang');
  if (!sheet || !targetUtang || !targetBayar) return { utang: 0, pembayaran: 0 };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { utang: 0, pembayaran: 0 };

  const data = sheet.getRange(2, 1, lastRow - 1, 13).getValues(); // A:M
  let countUtang = 0;
  let countBayar = 0;

  data.forEach(function (row) {
    const nama = String(row[2] || '').trim();
    if (!nama) return;

    const idLama = String(row[0] || '').trim();
    const id = idLama || generatePrimaryKey_('UTG');
    const total = Number(row[4]) || 0;
    const sisa = Number(row[5]) || 0;
    const tgl = parseSheetDate(row[1]) || new Date();
    const jatuh = parseSheetDate(row[6]);

    targetUtang.appendRow([
      id,
      tgl,
      nama,
      String(row[3] || '').trim(),
      total,
      jatuh || new Date(),
      String(row[7] || '').trim(),
      String(row[8] || '').trim(),
      Number(row[9]) || 0
    ]);
    countUtang++;

    // Sisa lama < Total -> sudah pernah dibayar. Catat agregat di PembayaranUtang
    // supaya getUtangServer() baru menghitung sisa yang konsisten.
    const totalDibayar = total - sisa;
    if (totalDibayar > 0) {
      const lastUpdated = parseSheetDate(row[11]) || new Date();
      targetBayar.appendRow([
        generatePrimaryKey_('BAY'),
        id,
        '',
        lastUpdated,
        totalDibayar
      ]);
      countBayar++;
    }
  });

  return { utang: countUtang, pembayaran: countBayar };
}