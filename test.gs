/*******************************************************
 * MyDuit — test.gs
 * Domain: Test Harness — dijalankan manual dari Apps Script
 * Editor (pilih fungsi di dropdown toolbar > Run), lihat hasil
 * di View > Execution logs.
 * Hasil pemecahan controller.gs (lihat database.md, bagian
 * "Pemisahan File per Domain") — isi & logic TIDAK diubah,
 * murni dipindah apa adanya.
 *
 * Isi:
 * - testTransaksiCRUD()   -> test.gs dites lewat transaksi.gs
 * - testDompetCRUD()      -> test.gs dites lewat dompet.gs
 * - testUtangCRUD()       -> test.gs dites lewat utang.gs
 * - testBudgetCRUD()      -> test.gs dites lewat budget.gs (termasuk validasi keras
 *                            KategoriID & validasi duplikat kategori+periode)
 * - testStatistikAI()     -> test.gs dites lewat statistik.gs + ai-model.gs
 * - testCacheBehavior()   -> test.gs dites lewat core.gs (cache raw transaksi/dompet)
 * - testAIModelFallback() -> panduan manual (bukan test otomatis)
 * - runAllTests()         -> jalankan semua test berurutan
 *
 * NB: butuh SEMUA domain file lain sudah ada di project yang sama
 * (transaksi.gs, dompet.gs, utang.gs, statistik.gs, ai-model.gs)
 * karena fungsi test di sini memanggil fungsi CRUD dari domain2
 * tsb secara langsung.
 *******************************************************/

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

function testBudgetCRUD() {
  // Pakai kategori seed default (lihat getKategoriSheet_() di kategori.gs, selalu ada
  // "Makanan" sejak sheet Kategori pertama kali dibuat) supaya validasi keras
  // KategoriID di simpanBudgetServer() pasti lolos tanpa perlu bikin kategori dulu.
  const now = new Date();
  const bulan = now.getMonth();
  const tahun = now.getFullYear();

  // 1. TAMBAH
  const add = simpanBudgetServer({ kategori: 'Makanan', bulan: bulan, tahun: tahun, limitNominal: 500000 });
  Logger.log('=== BUDGET ADD ===');
  Logger.log(JSON.stringify(add));
  if (add.status !== 'success') throw new Error('Add failed: ' + add.message);
  const newId = add.budget.list.find(b => b.kategori === 'Makanan')?.id;
  if (!newId) throw new Error('No ID returned');

  // 1b. VALIDASI KERAS: kategori tidak valid harus DITOLAK (throw dalam try/catch server,
  // bukan fallback simpan nama apa adanya spt Transaksi/Akun -- lihat catatan di budget.gs).
  const addInvalid = simpanBudgetServer({ kategori: 'Kategori Tidak Ada Sama Sekali', bulan: bulan, tahun: tahun, limitNominal: 100000 });
  Logger.log('=== BUDGET ADD (kategori invalid, harus gagal) ===');
  Logger.log(JSON.stringify(addInvalid));
  if (addInvalid.status === 'success') throw new Error('Validasi keras KategoriID gagal: kategori invalid seharusnya ditolak');

  // 1c. VALIDASI DUPLIKAT: kategori+bulan+tahun yang sama harus DITOLAK.
  const addDup = simpanBudgetServer({ kategori: 'Makanan', bulan: bulan, tahun: tahun, limitNominal: 200000 });
  Logger.log('=== BUDGET ADD (duplikat periode, harus gagal) ===');
  Logger.log(JSON.stringify(addDup));
  if (addDup.status === 'success') throw new Error('Validasi duplikat gagal: budget kategori+periode sama seharusnya ditolak');

  // 2. UPDATE
  const update = updateBudgetServer({ id: newId, kategori: 'Makanan', bulan: bulan, tahun: tahun, limitNominal: 750000 });
  Logger.log('=== BUDGET UPDATE ===');
  Logger.log(JSON.stringify(update));
  if (update.status !== 'success') throw new Error('Update failed: ' + update.message);

  // 3. GET (cek field turunan terpakai/sisa/persentase/melebihiLimit ada)
  const list = getBudgetServer(bulan, tahun);
  Logger.log('=== BUDGET LIST ===');
  Logger.log(JSON.stringify(list));
  const item = list.list.find(b => b.id === newId);
  if (!item) throw new Error('Budget hasil update tidak ditemukan di getBudgetServer()');
  if (item.limitNominal !== 750000) throw new Error('limitNominal tidak ter-update dgn benar');
  if (typeof item.terpakai !== 'number' || typeof item.sisa !== 'number' || typeof item.persentase !== 'number' || typeof item.melebihiLimit !== 'boolean') {
    throw new Error('Field turunan (terpakai/sisa/persentase/melebihiLimit) tidak lengkap');
  }

  // 4. HAPUS
  const del = hapusBudgetServer(newId);
  Logger.log('=== BUDGET DELETE ===');
  Logger.log(JSON.stringify(del));
  if (del.status !== 'success') throw new Error('Delete failed: ' + del.message);

  Logger.log('✅ testBudgetCRUD PASSED');
  return { status: 'success' };
}

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

function testAIModelFallback() {
  // Simulasi dengan mengubah model ke nama yang tidak valid
  // Test ini hanya log, tidak benar-benar mengubah config
  Logger.log('Test fallback: edit AI_MODEL_CATALOG di ai-model.gs model id ke nama invalid, lalu jalankan OCR/rekomendasi');
  Logger.log('Expected: model aktif dideteksi otomatis → model yang error dilewati → lanjut model berikutnya (round-robin mulai index berbeda tiap panggilan)');
  return { status: 'info', message: 'Manual test required - edit AI_MODEL_CATALOG model id ke nama invalid' };
}

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

function runAllTests() {
  try {
    testCacheBehavior();
    testTransaksiCRUD();
    testDompetCRUD();
    testUtangCRUD();
    testBudgetCRUD();
    testStatistikAI();
    Logger.log('🎉 ALL TESTS PASSED');
    return { status: 'success', message: 'All tests passed' };
  } catch (e) {
    Logger.log('❌ TEST FAILED: ' + e.message);
    Logger.log(e.stack);
    return { status: 'error', message: e.message };
  }
}
