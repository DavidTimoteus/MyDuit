import { useEffect, useState } from 'react'

export const EVENT_BAHASA = 'myduit:bahasa-update'
const LS_BAHASA = 'myduit:bahasa'

export const BAHASAS = [
  { code: 'id', label: 'Indonesia', flag: '🇮🇩' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
]

export const KAMUS = {
  id: {
    tagline: 'Catat · Pantau · Kendalikan',
    nav_transaksi: 'Transaksi',
    nav_statistik: 'Statistik',
    nav_budget: 'Budget',
    nav_utang: 'Utang',
    backup: 'Backup',
    backup_restore: 'Backup & Pulihkan',
    keluar: 'Keluar',
    tutup: 'Tutup',
    batal: 'Batal',
    atau: 'atau',
    mode_offline: 'Mode offline — perubahan tersimpan di perangkat & otomatis tersinkron saat daring.',
    ubah_lokasi: 'Ubah lokasi, mata uang & bahasa',

    // Lokasi, Bahasa & Money Changer
    judul_lokasi_bahasa: 'Bahasa, Lokasi & Money Changer',
    bahasa_sistem: 'Bahasa Aplikasi',
    subjudul_otomatis: 'Deteksi otomatis perangkat · Nilai terkonversi langsung',
    subjudul_manual: 'Diatur manual · Basis data akun: {basis}',
    kurs_memuat: 'Memperbarui kurs global…',
    kurs_cadangan: 'Kurs cadangan offline',
    kurs_live: 'Kurs live · {source}',
    perbarui_kurs: 'Kurs',
    perbarui_kurs_title: 'Perbarui kurs terbaru',
    deteksi_otomatis: 'Deteksi otomatis',
    akun_kosong_info: 'Akun masih kosong — negara yang Anda pilih di sini akan menjadi Mata Uang Dasar awal sebelum pencatatan pertama.',
    lensa_penjelasan: 'Basis database: {basis} (terkunci) · Tampilan & PDF memakai {aktif} dengan kurs terkini tanpa mengubah data database.',

    // Onboarding Mata Uang Awal
    onboard_judul: 'Pilih Mata Uang Dasar Awal',
    onboard_desc: 'Menentukan standar pencatatan akun sebelum transaksi pertama. Tampilan & laporan PDF tetap dapat diubah kapan saja layaknya money changer tanpa mengubah data database.',
    onboard_idr_desc: 'Rupiah Indonesia',
    onboard_usd_desc: 'Dolar Amerika Serikat',
    onboard_lainnya: 'Negara Lain…',
    onboard_tetapkan: 'Gunakan {currency} sebagai Basis',
    onboard_tersimpan: 'Basis {currency} siap dipakai',

    // Info Lensa Kurs pada Form & PDF
    lensa_badge: 'Mode Lensa {aktif}',
    lensa_info_basis: 'Disimpan ke basis database ({basis}) sebagai ≈ {perkiraan} · Kurs: {kurs}. Pencatatan baru memakai kurs terbaru.',
    lensa_info_historis: 'Edit menjaga kurs historis saat transaksi ini dicatat ({basis} ≈ {perkiraan}).',
    lensa_info_pdf: 'Laporan PDF akan dicetak dalam {aktif} (konversi dari basis {basis} · histori memakai kurs saat dicatat, saldo memakai kurs terbaru).',

    // Backup & Hapus Akun / Data
    backup_desc: 'Ekspor semua data ke berkas JSON di perangkatmu. Pemulihan membawa kembali data beserta mata uang dasarnya.',
    ekspor_sekarang: 'Ekspor Data Sekarang',
    pilih_berkas: 'Pilih Berkas Backup',
    pulihkan_data: 'Pulihkan Data Ini',
    hapus_total_btn: 'Hapus Total Data / Akun…',
    hapus_permanen_judul: 'Hapus Data / Akun Permanen',
    hapus_permanen_desc: 'Seluruh transaksi, rekening, kategori, budget, utang, pembayaran, dan log mutasi pada akun ini akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.',
    hapus_akun_label: 'Juga hapus permanen akun login Google saya dari MyDuit',
    ekspor_dulu: 'Ekspor Backup Dulu (Disarankan)',
    konfirm_label: 'Ketik {kata} untuk konfirmasi:',
    hapus_total_submit: 'Hapus Data',
    hapus_akun_submit: 'Hapus Akun & Data',
    offline_hapus_note: 'Anda sedang offline: penghapusan akan mengantre dan diterapkan ke server begitu koneksi kembali.',

    // Export PDF
    pdf_judul: 'Export Laporan PDF',
    pdf_subjudul: 'Pilih periode laporan yang ingin diexport',
    bulan: 'Bulan',
    tahun: 'Tahun',
    pdf_ai_judul: 'Sertakan Catatan & Analisis',
    pdf_ai_desc: 'Ringkasan rasio tabungan, pengeluaran terbesar, dan utang di akhir laporan.',
    cetak_pdf: 'Unduh Laporan PDF',

    // App Lock (PIN Keamanan)
    pin_label: 'Keamanan · Kunci PIN',
    pin_status_aktif: 'Aktif',
    pin_status_nonaktif: 'Nonaktif',
    pin_atur: 'Pasang PIN',
    pin_matikan: 'Matikan',
    pin_judul_setup: 'Buat PIN 6 Digit',
    pin_judul_konfirm: 'Ulangi PIN 6 Digit',
    pin_judul_matikan: 'Masukkan PIN Saat Ini',
    pin_judul_buka: 'MyDuit Terkunci',
    pin_desc_buka: 'Masukkan 6 digit PIN keamanan perangkat untuk melanjutkan.',
    pin_tidak_cocok: 'PIN konfirmasi tidak cocok. Coba lagi.',
    pin_salah: 'PIN salah. Sisa {sisa} percobaan.',
    pin_cooldown: 'Terlalu banyak percobaan. Tunggu {detik} detik.',
    pin_lupa_keluar: 'Lupa PIN? Keluar Akun',
  },
  en: {
    tagline: 'Track · Monitor · Control',
    nav_transaksi: 'Transactions',
    nav_statistik: 'Analytics',
    nav_budget: 'Budgets',
    nav_utang: 'Debts',
    backup: 'Backup',
    backup_restore: 'Backup & Restore',
    keluar: 'Sign Out',
    tutup: 'Close',
    batal: 'Cancel',
    atau: 'or',
    mode_offline: 'Offline mode — changes are saved locally & automatically synced when online.',
    ubah_lokasi: 'Change language, currency & region',

    // Language, Region & Money Changer
    judul_lokasi_bahasa: 'Language, Region & Money Changer',
    bahasa_sistem: 'App Language',
    subjudul_otomatis: 'Auto device detection · Live converted values',
    subjudul_manual: 'Set manually · Account base currency: {basis}',
    kurs_memuat: 'Updating global FX rates…',
    kurs_cadangan: 'Offline fallback FX rates',
    kurs_live: 'Live rates · {source}',
    perbarui_kurs: 'Rates',
    perbarui_kurs_title: 'Refresh latest FX rates',
    deteksi_otomatis: 'Auto-detect',
    akun_kosong_info: 'Your account is empty — selecting a currency here sets your initial Base Currency before your first entry.',
    lensa_penjelasan: 'Database base: {basis} (locked) · Screen & PDF use {aktif} with live FX without altering stored database numbers.',

    // Initial Currency Onboarding
    onboard_judul: 'Choose Initial Base Currency',
    onboard_desc: 'Sets your ledger canonical currency before the first entry. You can still convert screen display and PDF reports anytime like a money changer without rewriting the database.',
    onboard_idr_desc: 'Indonesian Rupiah',
    onboard_usd_desc: 'US Dollar',
    onboard_lainnya: 'More…',
    onboard_tetapkan: 'Use {currency} as Base',
    onboard_tersimpan: '{currency} base currency ready',

    // FX Lens Info on Forms & PDF
    lensa_badge: 'Display Lens {aktif}',
    lensa_info_basis: 'Saved to base ledger ({basis}) as ≈ {perkiraan} · Rate: {kurs}. New records capture current global FX.',
    lensa_info_historis: 'Editing preserves the historical rate captured when this entry was recorded ({basis} ≈ {perkiraan}).',
    lensa_info_pdf: 'PDF report will export in {aktif} (from {basis} base · transactions use historical FX, balances use live FX).',

    // Backup & Account Deletion
    backup_desc: 'Export all records to a JSON file on your device. Restore recovers your data along with its original base currency.',
    ekspor_sekarang: 'Export Data Now',
    pilih_berkas: 'Choose Backup File',
    pulihkan_data: 'Restore This Data',
    hapus_total_btn: 'Delete All Data / Account…',
    hapus_permanen_judul: 'Permanently Delete Data / Account',
    hapus_permanen_desc: 'All transactions, accounts, categories, budgets, debts, payments, and balance logs under this user will be permanently deleted. This action cannot be undone.',
    hapus_akun_label: 'Also permanently delete my Google login account from MyDuit',
    ekspor_dulu: 'Export Backup First (Recommended)',
    konfirm_label: 'Type {kata} to confirm:',
    hapus_total_submit: 'Delete Data',
    hapus_akun_submit: 'Delete Account & Data',
    offline_hapus_note: 'You are offline: deletion will queue locally and sync to the server once reconnected.',

    // Export PDF
    pdf_judul: 'Export PDF Report',
    pdf_subjudul: 'Choose the report period to export',
    bulan: 'Month',
    tahun: 'Year',
    pdf_ai_judul: 'Include Notes & Insights',
    pdf_ai_desc: 'Summary of savings ratio, top expenses, and debts at the end of the report.',
    cetak_pdf: 'Download PDF Report',

    // App Lock (Security PIN)
    pin_label: 'Security · App PIN',
    pin_status_aktif: 'Enabled',
    pin_status_nonaktif: 'Off',
    pin_atur: 'Set PIN',
    pin_matikan: 'Turn Off',
    pin_judul_setup: 'Create 6-Digit PIN',
    pin_judul_konfirm: 'Confirm 6-Digit PIN',
    pin_judul_matikan: 'Enter Current PIN',
    pin_judul_buka: 'MyDuit Locked',
    pin_desc_buka: 'Enter your 6-digit device security PIN to continue.',
    pin_tidak_cocok: 'Confirmation PIN does not match. Try again.',
    pin_salah: 'Incorrect PIN. {sisa} attempts left.',
    pin_cooldown: 'Too many attempts. Wait {detik}s.',
    pin_lupa_keluar: 'Forgot PIN? Sign Out',
  },
}

export function bacaBahasaAktif() {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(LS_BAHASA)
      if (saved === 'id' || saved === 'en') return saved
    }
    if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
      const loc = navigator.language.toLowerCase()
      if (loc.startsWith('id') || loc.startsWith('in')) return 'id'
      if (loc.startsWith('en')) return 'en'
    }
  } catch {
    // Abaikan di mode terisolasi
  }
  return 'id'
}

export function simpanBahasa(code) {
  const next = code === 'en' ? 'en' : 'id'
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_BAHASA, next)
    }
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = next
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(EVENT_BAHASA, { detail: { code: next } }))
    }
  } catch {
    // Abaikan error storage/non-DOM
  }
  return next
}

export function t(key, params = null, lang = null) {
  const b = lang === 'en' || lang === 'id' ? lang : bacaBahasaAktif()
  const tpl = KAMUS[b]?.[key] ?? KAMUS.id[key] ?? key
  if (!params || typeof tpl !== 'string') return tpl
  return tpl.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`))
}

export function useBahasa() {
  const [bahasa, setBahasaState] = useState(() => bacaBahasaAktif())
  useEffect(() => {
    const sync = () => setBahasaState(bacaBahasaAktif())
    if (typeof window !== 'undefined') {
      window.addEventListener(EVENT_BAHASA, sync)
      return () => window.removeEventListener(EVENT_BAHASA, sync)
    }
    return undefined
  }, [])
  return {
    bahasa,
    setBahasa: (code) => {
      const next = simpanBahasa(code)
      setBahasaState(next)
      return next
    },
    t: (key, params = null) => t(key, params, bahasa),
  }
}

