/*******************************************************
 * MyDuit — kategori.gs
 * Domain: Tabel Kategori (skema baru 7 tabel)
 * 
 * Kompatibel dengan controller.js/ViewJS.html:
 * - fetchKategoriServer() -> flat array string unique (dipakai populateKategori)
 * - getKategoriByJenisSumberServer() -> peta kategori per jenis & sumber
 * - CRUD Kategori (simpan, update, hapus/soft-delete)
 *******************************************************/

const KATEGORI_COL = {
  ID: 1,
  NAMA: 2,
  JENIS: 3,
  AKTIF: 4
};

function invalidateKategoriCache_() {
  CacheService.getUserCache().removeAll([
    'kategoriList',
    'kategoriJenisSumberMap',
    'kategoriMaps_v1'
  ]);
}

function getKategoriSheet_() {
  const ss = getUserDatabase_();
  let sheet = ss.getSheetByName('Kategori');
  if (!sheet) {
    sheet = ss.insertSheet('Kategori');
    const headers = ['ID', 'Nama', 'Jenis', 'Aktif'];
    sheet.getRange(1, 1, 1, 4).setValues([headers]);
    sheet.setFrozenRows(1);

    // Seed default kategori supaya tidak kosong saat pertama kali dibuat
    const defaultKategori = [
      ['KAT-20260819-0001', 'Makanan', 'Pengeluaran', true],
      ['KAT-20260819-0002', 'Minuman', 'Pengeluaran', true],
      ['KAT-20260819-0003', 'Belanja', 'Pengeluaran', true],
      ['KAT-20260819-0004', 'Online Shop', 'Pengeluaran', true],
      ['KAT-20260819-0005', 'Pulsa, Tagihan, & Tiket', 'Pengeluaran', true],
      ['KAT-20260819-0006', 'Gaji', 'Pemasukan', true],
      ['KAT-20260819-0007', 'Bonus', 'Pemasukan', true],
      ['KAT-20260819-0008', 'Lainnya', 'Pemasukan', true]
    ];
    sheet.getRange(2, 1, defaultKategori.length, 4).setValues(defaultKategori);
  }
  return sheet;
}

/**
 * Kompatibel ViewJS.html: mengembalikan flat array string nama kategori unik.
 */
function fetchKategoriServer() {
  const cache = CacheService.getUserCache();
  const cached = cache.get('kategoriList');
  if (cached) return JSON.parse(cached);

  try {
    const sheet = getKategoriSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    const unique = [];
    data.forEach(function (row) {
      const aktif = String(row[3] || '').toLowerCase() === 'true' || row[3] === true || row[3] === 1;
      if (!aktif) return;
      const nama = String(row[1] || '').trim();
      if (nama && unique.indexOf(nama) === -1) {
        unique.push(nama);
      }
    });

    unique.sort();
    cache.put('kategoriList', JSON.stringify(unique), 300);
    return unique;
  } catch (e) {
    return ['Makanan', 'Minuman', 'Belanja', 'Gaji']; // fallback aman
  }
}

/**
 * Kompatibel ViewJS.html: peta kategori per jenis & sumber akun.
 */
function getKategoriByJenisSumberServer() {
  const cache = CacheService.getUserCache();
  const cached = cache.get('kategoriJenisSumberMap');
  if (cached) return JSON.parse(cached);

  const result = { Pengeluaran: { _all: [] }, Pemasukan: { _all: [] } };
  try {
    const sheet = getKategoriSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      cache.put('kategoriJenisSumberMap', JSON.stringify(result), 300);
      return result;
    }

    const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    const bucketPengeluaran = new Set();
    const bucketPemasukan = new Set();

    data.forEach(function (row) {
      const aktif = String(row[3] || '').toLowerCase() === 'true' || row[3] === true || row[3] === 1;
      if (!aktif) return;

      const nama = String(row[1] || '').trim();
      if (!nama) return;

      const jenis = String(row[2] || '').trim().toLowerCase();
      if (jenis === 'pemasukan') {
        bucketPemasukan.add(nama);
      } else {
        bucketPengeluaran.add(nama);
      }
    });

    result.Pengeluaran._all = [...bucketPengeluaran].sort();
    result.Pemasukan._all = [...bucketPemasukan].sort();

    cache.put('kategoriJenisSumberMap', JSON.stringify(result), 300);
    return result;
  } catch (e) {
    return result;
  }
}

function simpanKategoriServer(formData) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const nama = String(formData.nama || '').trim();
    const jenis = String(formData.jenis || '').trim();
    if (!nama) throw new Error('Nama kategori wajib diisi.');

    const sheet = getKategoriSheet_();
    const id = generatePrimaryKey_('KAT');
    sheet.appendRow([id, nama, jenis || 'Pengeluaran', true]);
    invalidateKategoriCache_();

    return { status: 'success', data: { id, nama, jenis } };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ============ HELPER LOOKUP NAMA <-> ID (prasyarat perbaikan Transaksi.KategoriID) ============
 * Dipakai transaksi.gs & statistik.gs supaya kolom Transaksi.KategoriID bisa diisi ID
 * asli (bukan nama lagi), sambil frontend tetap menerima/mengirim NAMA seperti biasa
 * (kontrak field ke ViewJS.html tidak berubah).
 */

// Bulk lookup 1x baca sheet -> { byId: {ID: Nama}, byNama: {namaLowerCase: ID} }.
// Di-cache 60 detik (pola sama dgn cache lain di app ini), di-invalidate lewat
// invalidateKategoriCache_() begitu ada CRUD Kategori.
function getKategoriMaps_() {
  const cache = CacheService.getUserCache();
  const cached = cache.get('kategoriMaps_v1');
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* cache korup -> lanjut baca ulang di bawah */ }
  }

  const maps = { byId: {}, byNama: {} };
  try {
    const sheet = getKategoriSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
      data.forEach(function (row) {
        const id = String(row[0] || '').trim();
        const nama = String(row[1] || '').trim();
        if (!id || !nama) return;

        const aktif = String(row[3] || '').toLowerCase() === 'true' || row[3] === true || row[3] === 1;

        // byId: simpan SEMUA (termasuk yg soft-deleted/Aktif=false), supaya transaksi LAMA
        // yang masih merujuk kategori yg sudah dinonaktifkan tetap bisa ditampilkan namanya.
        maps.byId[id] = nama;

        // byNama: kalau ada nama kembar (mis. kategori lama dinonaktifkan lalu dibuat ulang
        // dgn nama sama), prioritaskan entri yang AKTIF supaya transaksi baru selalu nyambung
        // ke ID yang aktif, bukan ID lama yang sudah nonaktif.
        const key = nama.toLowerCase();
        if (!maps.byNama[key] || aktif) {
          maps.byNama[key] = id;
        }
      });
    }
  } catch (e) {
    // biarkan maps kosong -> pemanggil fallback ke null (lihat catatan di
    // getKategoriIdByNama_/getKategoriNamaById_)
  }

  try { cache.put('kategoriMaps_v1', JSON.stringify(maps), CACHE_TTL_SECONDS); } catch (e) { /* payload terlalu besar -> lewati cache */ }
  return maps;
}

// Cari Kategori.ID dari nama (case-insensitive). Return null kalau tidak ketemu
// (BUKAN throw) -- pemanggil (transaksi.gs) yang memutuskan fallback-nya, supaya
// data lama yang formatnya belum tentu konsisten tidak membuat CRUD gagal total.
function getKategoriIdByNama_(nama) {
  const key = String(nama || '').trim().toLowerCase();
  if (!key) return null;
  const maps = getKategoriMaps_();
  return maps.byNama[key] || null;
}

// Cari nama kategori dari ID. Return null kalau tidak ketemu (mis. ID sudah tidak
// valid/terhapus manual dari sheet) -- pemanggil yang memutuskan fallback tampilan.
function getKategoriNamaById_(id) {
  const key = String(id || '').trim();
  if (!key) return null;
  const maps = getKategoriMaps_();
  return maps.byId[key] || null;
}

// Langkah C: konversi nilai mentah kolom Transaksi.KategoriID (bisa berupa Kategori.ID hasil
// Langkah B, ATAU nama lama/pseudo spt "Pindah Saldo"/"Pembayaran" yg ditulis langsung tanpa
// lookup -- Langkah D) menjadi NAMA yang dikonsumsi frontend. Kalau lookup ID gagal, anggap
// value yang tersimpan memang sudah nama apa adanya (fallback aman, bukan throw).
function getKategoriTampilFromStored_(stored) {
  const val = String(stored || '').trim();
  if (!val) return '';
  const namaById = getKategoriNamaById_(val);
  return namaById !== null ? namaById : val;
}
