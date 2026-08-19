/*******************************************************
 * MyDuit — mutasi-log.gs
 * Domain: Tabel MutasiLog (log audit perubahan saldo Akun) — Fase 5
 * BARU — pengganti kolom `Catatan` (teks bebas) di sheet Dompet versi lama.
 *
 * Skema MutasiLog (schema.gs -> SCHEMA_DEFINITION.MutasiLog):
 * - ID (PK): LOG-yyyyMMdd-HEX4
 * - AkunID: string (FK -> Akun.ID)
 * - Timestamp: datetime
 * - Aksi: string, mis. "Pemasukan", "Pengeluaran", "Pindah Saldo Masuk",
 *         "Pindah Saldo Keluar", "Hapus Transaksi", "Update Transaksi",
 *         "Bayar Cicilan", "Pelunasan Utang", "Koreksi Manual", "Rebuild Saldo"
 * - Delta: number (+/- terhadap saldo akun)
 * - TransaksiID: string (FK -> Transaksi.ID, nullable — kosong kalau bukan
 *   dari transaksi, mis. hasil koreksi manual/rebuild)
 *
 * Dipanggil dari:
 * - applyDeltaSaldoAkun_() (akun.gs) — titik tunggal semua perubahan saldo
 *   berbasis delta (Transaksi, Pindah Saldo, Bayar Cicilan/Pelunasan Utang).
 * - updateRekeningServer() (akun.gs) — saat saldo diedit manual langsung
 *   (bukan lewat delta transaksi) -> Aksi "Koreksi Manual".
 * - (nanti) rebuildSaldoAkun_() (Fase 6, belum dibangun) -> Aksi "Rebuild Saldo".
 *
 * Dependency: core.gs (generatePrimaryKey_), database-init.gs (getUserDatabase_).
 * `akun.gs` sekarang bergantung ke file ini (catatMutasiLog_()) — lihat catatan
 * dependency di database.md.
 *******************************************************/

const MUTASILOG_COL = {
  ID: 1,
  AKUNID: 2,
  TIMESTAMP: 3,
  AKSI: 4,
  DELTA: 5,
  TRANSAKSIID: 6
};

function getMutasiLogSheet_() {
  const ss = getUserDatabase_();
  let sheet = ss.getSheetByName('MutasiLog');
  if (!sheet) {
    sheet = ss.insertSheet('MutasiLog');
    const headers = ['ID', 'AkunID', 'Timestamp', 'Aksi', 'Delta', 'TransaksiID'];
    sheet.getRange(1, 1, 1, 6).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Catat 1 baris MutasiLog. `akunID` WAJIB Akun.ID asli (bukan nama) — pemanggil
 * (applyDeltaSaldoAkun_() dkk di akun.gs) yang bertanggung jawab resolve nama
 * -> ID sebelum memanggil ini, supaya FK ke Akun selalu akurat sesuai Prinsip
 * Desain #2 (relasi pakai ID, bukan nama).
 *
 * Sengaja TIDAK melempar error kalau gagal (mis. sheet penuh/kena lock
 * bentrok) — logging ini bersifat pelengkap/audit, kegagalannya tidak boleh
 * membatalkan transaksi utama yang saldo-nya sudah kadung berubah.
 */
function catatMutasiLog_(akunID, aksi, delta, transaksiID) {
  const id = String(akunID || '').trim();
  if (!id || !delta) return;
  try {
    const sheet = getMutasiLogSheet_();
    const logID = generatePrimaryKey_('LOG');
    sheet.appendRow([logID, id, new Date(), String(aksi || '').trim(), delta, String(transaksiID || '').trim()]);
  } catch (e) {
    // Sengaja diabaikan — lihat catatan di atas.
  }
}

/**
 * Baca riwayat MutasiLog, terbaru dulu. `akunID` opsional (kosongkan untuk
 * semua akun). Belum dipakai frontend manapun (belum ada UI) — disiapkan
 * untuk fitur "Riwayat Perubahan Rekening" yang komentarnya sudah ada di
 * ViewBudget.html (`modalDetailLogRekening`), yang saat ini masih mengacu ke
 * kolom `Catatan` lama yang sudah dihapus di skema baru.
 */
function getMutasiLogServer(akunID, limit) {
  try {
    const sheet = getMutasiLogSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { status: 'success', list: [] };

    const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
    const timeZone = sheet.getParent().getSpreadsheetTimeZone();
    const limitNum = Number(limit) || 50;
    const filterAkunID = String(akunID || '').trim();

    const list = data
      .filter(function (row) {
        return !filterAkunID || String(row[1]).trim() === filterAkunID;
      })
      .map(function (row) {
        const ts = row[2] instanceof Date ? row[2] : new Date(row[2]);
        return {
          id: String(row[0]),
          akunID: String(row[1]),
          timestamp: Utilities.formatDate(ts, timeZone, 'dd/MM/yyyy HH:mm'),
          timestampRaw: ts.toISOString(),
          aksi: String(row[3] || ''),
          delta: Number(row[4]) || 0,
          transaksiID: String(row[5] || '')
        };
      })
      .sort(function (a, b) { return new Date(b.timestampRaw) - new Date(a.timestampRaw); })
      .slice(0, limitNum);

    return { status: 'success', list: list };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}
