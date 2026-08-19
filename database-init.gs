/*******************************************************
 * MyDuit — database-init.gs
 * Provisioning database per-user: cek apakah user sudah punya
 * Spreadsheet database di Drive-nya, dan buatkan baru kalau belum.
 *
 * Dipakai bersama schema.gs (initSchema) dan DatabaseSetupModal.html.
 *******************************************************/

const DB_PROP_KEY = 'MYDUIT_DB_ID';
const DB_NAME_PREFIX = 'MyDuit Database';

/**
 * Dipanggil dari frontend saat halaman pertama kali dimuat (lihat
 * integrasi doGet() di bawah). Mengecek apakah user sudah punya
 * database:
 * 1. Cek PropertiesService.getUserProperties() -> ada ID tersimpan?
 * 2. Kalau ada, verifikasi filenya BENAR-BENAR masih ada di Drive
 *    (bukan dihapus/dipindah ke trash) -> supaya tidak salah asumsi
 *    kalau user tidak sengaja menghapus filenya dari Drive.
 *
 * @return {status, exists, ssId?, url?, warning?}
 */
function getUserDatabaseStatusServer() {
  try {
    const props = PropertiesService.getUserProperties();
    const dbId = props.getProperty(DB_PROP_KEY);

    if (!dbId) {
      return { status: 'success', exists: false };
    }

    try {
      const file = DriveApp.getFileById(dbId);
      if (file.isTrashed()) {
        throw new Error('File berada di trash Drive');
      }
      const ss = SpreadsheetApp.openById(dbId);
      return { status: 'success', exists: true, ssId: dbId, url: ss.getUrl() };
    } catch (e) {
      // ID tersimpan tapi file sudah tidak bisa diakses (terhapus,
      // dipindah ke trash, atau akses dicabut). Reset supaya user
      // diminta membuat database baru, bukan stuck error terus-menerus.
      props.deleteProperty(DB_PROP_KEY);
      return {
        status: 'success',
        exists: false,
        warning: 'Database sebelumnya tidak ditemukan di Google Drive Anda (kemungkinan terhapus atau dipindahkan). Silakan buat database baru.'
      };
    }
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

/**
 * Dipanggil saat user menekan tombol "Buat Database" di popup.
 * Membuat 1 Spreadsheet baru di Drive user, inisialisasi skema
 * (7 sheet via initSchema), lalu simpan ID-nya ke UserProperties
 * supaya sesi berikutnya langsung terdeteksi via
 * getUserDatabaseStatusServer().
 *
 * @return {status, alreadyExists, ssId, url}
 */
function createUserDatabaseServer() {
  try {
    const props = PropertiesService.getUserProperties();
    const existing = props.getProperty(DB_PROP_KEY);

    // Guard: cegah user tidak sengaja membuat 2 database (mis. klik ganda,
    // atau modal sempat muncul dua kali sebelum reload pertama selesai).
    if (existing) {
      try {
        const ss = SpreadsheetApp.openById(existing);
        return { status: 'success', alreadyExists: true, ssId: existing, url: ss.getUrl() };
      } catch (e) {
        props.deleteProperty(DB_PROP_KEY); // stale ID, lanjut buat baru di bawah
      }
    }

    const email = Session.getActiveUser().getEmail() || 'user';
    const ss = SpreadsheetApp.create(DB_NAME_PREFIX + ' - ' + email);

    initSchema(ss); // dari schema.gs — buat 7 sheet + header

    props.setProperty(DB_PROP_KEY, ss.getId());

    return { status: 'success', alreadyExists: false, ssId: ss.getId(), url: ss.getUrl() };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

/**
 * Helper internal: ambil Spreadsheet database milik user yang sedang
 * login. WAJIB dipanggil oleh semua fungsi CRUD (getSheet(), dst di
 * controller.gs) sebagai pengganti SpreadsheetApp.getActiveSpreadsheet(),
 * supaya tiap user membaca/menulis ke Spreadsheet miliknya sendiri.
 *
 * Melempar error yang jelas kalau database belum dibuat atau sudah
 * tidak bisa diakses -> ditangkap di sisi UI untuk memicu popup lagi.
 */
// Cache per-eksekusi (bukan per-user global) -- variabel scope script di
// Apps Script hidup selama 1 eksekusi request berjalan, jadi ini cukup
// untuk menghindari SpreadsheetApp.openById() dipanggil berkali-kali
// (mis. 15-20x) dalam 1 request yang sama, tanpa perlu CacheService.
let _cachedUserDb_ = null;

function getUserDatabase_() {
  if (_cachedUserDb_) return _cachedUserDb_;

  const dbId = PropertiesService.getUserProperties().getProperty(DB_PROP_KEY);
  if (!dbId) {
    throw new Error('DATABASE_BELUM_ADA: Database belum dibuat. Silakan buat database terlebih dahulu.');
  }
  try {
    _cachedUserDb_ = SpreadsheetApp.openById(dbId);
    return _cachedUserDb_;
  } catch (e) {
    throw new Error('DATABASE_TIDAK_DITEMUKAN: Database tidak ditemukan di Drive. Mungkin file terhapus atau dipindahkan.');
  }
}
