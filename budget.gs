/*******************************************************
 * MyDuit — budget.gs
 * Domain: Tabel Budget (limit pengeluaran per kategori per periode) — Fase 4
 * BARU — belum pernah dibangun sebelumnya. Klaim "budget.gs SELESAI
 * dibangun" di database.md (versi sebelum sesi ini) TIDAK AKURAT — file ini
 * memang belum pernah ada sampai dikonfirmasi & dibangun di sesi lanjutan ini.
 *
 * Skema Budget (schema.gs -> SCHEMA_DEFINITION.Budget):
 * - ID (PK): BGT-yyyyMMdd-HEX4
 * - KategoriID: string (FK -> Kategori.ID, WAJIB valid — validasi keras,
 *   TANPA fallback ke nama seperti pola longgar di Transaksi/Akun, supaya
 *   join ke realisasi pengeluaran di getBudgetServer() selalu akurat --
 *   lihat database.md, Prinsip Desain #2)
 * - Bulan: number (0-11, konsisten dgn konvensi JS Date.getMonth() yg
 *   dipakai di seluruh app ini, mis. statistik.gs)
 * - Tahun: number (yyyy)
 * - LimitNominal: number
 *
 * ASUMSI (belum dikonfirmasi eksplisit oleh user — tandai di sini supaya
 * mudah direvisi kalau ternyata salah):
 * - 1 Kategori hanya boleh punya 1 Budget per kombinasi Bulan+Tahun yang
 *   sama (unique constraint, dicegah di simpanBudgetServer()/updateBudgetServer()).
 *
 * Kompatibel dgn (rencana) frontend:
 * - getBudgetServer(bulan, tahun)
 * - simpanBudgetServer(formData)   -- formData: {kategori, bulan, tahun, limitNominal}
 * - updateBudgetServer(formData)   -- formData: {id, kategori, bulan, tahun, limitNominal}
 * - hapusBudgetServer(id)
 *
 * Dependency: core.gs (generatePrimaryKey_, findRowIndexById_, CACHE_TTL_SECONDS),
 * database-init.gs (getUserDatabase_), kategori.gs (getKategoriIdByNama_,
 * getKategoriNamaById_), statistik.gs (getSemuaTransaksiBulanServer).
 *******************************************************/

const BUDGET_COL = {
  ID: 1,
  KATEGORIID: 2,
  BULAN: 3,
  TAHUN: 4,
  LIMITNOMINAL: 5
};

function invalidateBudgetCache_(bulan, tahun) {
  CacheService.getUserCache().remove('budgetPayload_v1_' + bulan + '_' + tahun);
}

function getBudgetSheet_() {
  const ss = getUserDatabase_();
  let sheet = ss.getSheetByName('Budget');
  if (!sheet) {
    sheet = ss.insertSheet('Budget');
    const headers = ['ID', 'KategoriID', 'Bulan', 'Tahun', 'LimitNominal'];
    sheet.getRange(1, 1, 1, 5).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  // Auto-healing header, pola sama dgn getAkunSheet_()/getKategoriSheet_().
  const existingHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 5)).getValues()[0];
  const expectedHeaders = ['ID', 'KategoriID', 'Bulan', 'Tahun', 'LimitNominal'];
  expectedHeaders.forEach(function (h, idx) {
    if (!existingHeaders[idx]) {
      sheet.getRange(1, idx + 1).setValue(h);
    }
  });
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * Baca semua Budget utk 1 periode (bulan+tahun), digabung dengan realisasi
 * pengeluaran aktual per kategori dari getSemuaTransaksiBulanServer()
 * (statistik.gs). Tiap baris hasil berisi limit + terpakai + sisa +
 * persentase + melebihiLimit.
 */
function getBudgetServer(bulan, tahun) {
  const bulanNum = Number(bulan);
  const tahunNum = Number(tahun);

  const cache = CacheService.getUserCache();
  const cacheKey = 'budgetPayload_v1_' + bulanNum + '_' + tahunNum;
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  try {
    const sheet = getBudgetSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      const empty = { status: 'success', list: [] };
      cache.put(cacheKey, JSON.stringify(empty), CACHE_TTL_SECONDS);
      return empty;
    }

    const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();

    // Realisasi pengeluaran per kategori (NAMA) periode ini — sumber Transaksi via statistik.gs.
    const transaksiBulan = getSemuaTransaksiBulanServer(bulanNum, tahunNum);
    const realisasiPerKategori = {};
    transaksiBulan.forEach(function (it) {
      if (String(it.jenis).trim().toLowerCase() !== 'pengeluaran') return;
      const kat = it.kategori || '';
      realisasiPerKategori[kat] = (realisasiPerKategori[kat] || 0) + it.nominal;
    });

    const list = [];
    data.forEach(function (row) {
      const id = String(row[0] || '').trim();
      const kategoriID = String(row[1] || '').trim();
      const rowBulan = Number(row[2]);
      const rowTahun = Number(row[3]);
      if (!id || !kategoriID) return;
      if (rowBulan !== bulanNum || rowTahun !== tahunNum) return;

      const limit = Number(row[4]) || 0;
      // KategoriID di sini SELALU Kategori.ID asli (validasi keras di simpan/updateBudgetServer()),
      // jadi lookup cukup 1 arah, tidak perlu fallback longgar seperti Transaksi/Akun.
      const kategoriNama = getKategoriNamaById_(kategoriID) || '(Kategori tidak ditemukan)';
      const terpakai = realisasiPerKategori[kategoriNama] || 0;
      const sisa = limit - terpakai;
      const persentase = limit > 0 ? Math.round((terpakai / limit) * 100) : 0;

      list.push({
        id: id,
        kategoriID: kategoriID,
        kategori: kategoriNama,
        bulan: rowBulan,
        tahun: rowTahun,
        limitNominal: limit,
        terpakai: terpakai,
        sisa: sisa,
        persentase: persentase,
        melebihiLimit: terpakai > limit
      });
    });

    const result = { status: 'success', list: list };
    cache.put(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS);
    return result;
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

/**
 * Simpan Budget baru. Budget.KategoriID WAJIB Kategori.ID valid — beda dgn
 * pola longgar di Transaksi (yg fallback simpan nama kalau lookup gagal),
 * di sini validasi KERAS (throw) supaya join ke realisasi pengeluaran di
 * getBudgetServer() selalu akurat (Prinsip Desain #2, database.md).
 */
function simpanBudgetServer(formData) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const kategoriNama = String(formData.kategori || '').trim();
    const bulan = Number(formData.bulan);
    const tahun = Number(formData.tahun);
    const limitNominal = Number(formData.limitNominal) || 0;

    if (!kategoriNama) throw new Error('Kategori wajib dipilih.');
    if (isNaN(bulan) || bulan < 0 || bulan > 11) throw new Error('Bulan tidak valid.');
    if (isNaN(tahun)) throw new Error('Tahun tidak valid.');
    if (limitNominal <= 0) throw new Error('Limit budget harus lebih dari 0.');

    const kategoriID = getKategoriIdByNama_(kategoriNama);
    if (!kategoriID) throw new Error(`Kategori "${kategoriNama}" tidak ditemukan/tidak valid.`);

    const sheet = getBudgetSheet_();
    const lastRow = sheet.getLastRow();

    // ASUMSI: 1 kategori hanya boleh 1 Budget per kombinasi Bulan+Tahun (lihat catatan
    // ASUMSI di header file) -- cegah duplikat di sini.
    if (lastRow >= 2) {
      const existing = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
      const sudahAda = existing.some(function (r) {
        return String(r[1]).trim() === kategoriID && Number(r[2]) === bulan && Number(r[3]) === tahun;
      });
      if (sudahAda) throw new Error(`Budget untuk kategori "${kategoriNama}" pada periode ini sudah ada.`);
    }

    const id = generatePrimaryKey_('BGT');
    sheet.appendRow([id, kategoriID, bulan, tahun, limitNominal]);
    invalidateBudgetCache_(bulan, tahun);

    return { status: 'success', budget: getBudgetServer(bulan, tahun) };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Update Budget. Validasi & aturan duplikat sama seperti simpanBudgetServer().
 */
function updateBudgetServer(formData) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getBudgetSheet_();
    const targetRow = findRowIndexById_(sheet, formData.id, 2, BUDGET_COL.ID);
    if (targetRow === -1) throw new Error('Budget tidak ditemukan.');

    const dataLama = sheet.getRange(targetRow, 1, 1, 5).getValues()[0];
    const bulanLama = Number(dataLama[BUDGET_COL.BULAN - 1]);
    const tahunLama = Number(dataLama[BUDGET_COL.TAHUN - 1]);

    const kategoriNama = String(formData.kategori || '').trim();
    const bulan = Number(formData.bulan);
    const tahun = Number(formData.tahun);
    const limitNominal = Number(formData.limitNominal) || 0;

    if (!kategoriNama) throw new Error('Kategori wajib dipilih.');
    if (isNaN(bulan) || bulan < 0 || bulan > 11) throw new Error('Bulan tidak valid.');
    if (isNaN(tahun)) throw new Error('Tahun tidak valid.');
    if (limitNominal <= 0) throw new Error('Limit budget harus lebih dari 0.');

    const kategoriID = getKategoriIdByNama_(kategoriNama);
    if (!kategoriID) throw new Error(`Kategori "${kategoriNama}" tidak ditemukan/tidak valid.`);

    // Cegah duplikat juga saat edit (kecuali baris ini sendiri).
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const existing = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
      const sudahAda = existing.some(function (r, idx) {
        const rowNum = idx + 2;
        if (rowNum === targetRow) return false;
        return String(r[1]).trim() === kategoriID && Number(r[2]) === bulan && Number(r[3]) === tahun;
      });
      if (sudahAda) throw new Error(`Budget untuk kategori "${kategoriNama}" pada periode ini sudah ada.`);
    }

    sheet.getRange(targetRow, 2, 1, 4).setValues([[kategoriID, bulan, tahun, limitNominal]]);

    invalidateBudgetCache_(bulanLama, tahunLama);
    invalidateBudgetCache_(bulan, tahun);

    return { status: 'success', budget: getBudgetServer(bulan, tahun) };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

function hapusBudgetServer(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getBudgetSheet_();
    const targetRow = findRowIndexById_(sheet, id, 2, BUDGET_COL.ID);
    if (targetRow === -1) throw new Error('Budget sudah terhapus.');

    const dataLama = sheet.getRange(targetRow, 1, 1, 5).getValues()[0];
    const bulan = Number(dataLama[BUDGET_COL.BULAN - 1]);
    const tahun = Number(dataLama[BUDGET_COL.TAHUN - 1]);

    sheet.deleteRow(targetRow);
    invalidateBudgetCache_(bulan, tahun);

    return { status: 'success', budget: getBudgetServer(bulan, tahun) };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}
