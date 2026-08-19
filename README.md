# MyDuit: Catatan Keuangan Pribadi

Aplikasi pencatat keuangan pribadi berbasis Google Apps Script, berjalan sebagai Web App. Antarmuka Tailwind CSS (claymorphism), analisis AI Google Gemini untuk rekomendasi dan OCR struk.

## Fitur

### Transaksi
- Catat pemasukan dan pengeluaran lengkap dengan tanggal, kategori, sumber/akun, dan keterangan.
- Filter riwayat: hari ini, minggu ini, bulan ini, tahun ini, semua, rentang tanggal kustom, jenis, dan kata kunci.
- Pagination client-side (batch 50 item) biar tidak fetch berulang.
- Salin transaksi dan pindah saldo antar akun (otomatis tercatat sebagai transaksi keluar + masuk).

### Rekening & Budget
- Kelola beberapa akun (Rekening Utama, Tabungan, E-Wallet, dll.) dengan saldo real-time yang tersinkron tiap ada transaksi.
- Riwayat perubahan saldo per akun (audit log "Perubahan Terakhir").
- Sub-tab Budget: atur limit pengeluaran per kategori per periode, lihat terpakai vs sisa, dan badge merah saat melebihi limit.
- Formulir rekening memakai desain card stack slider.

### Statistik
- Grafik bulanan/tahunan (Chart.js): pemasukan vs pengeluaran, tren 12 bulan, dan breakdown kategori.
- Breakdown kategori 2 kolom (Pemasukan hijau / Pengeluaran merah) dengan progress bar dan persentase.

### Rekomendasi AI (Google Gemini)
- Analisis kesehatan keuangan per periode: KONDISI, HEMAT DI SINI, dan PRIORITAS ALOKASI.
- OCR Struk: upload foto struk, AI mengekstrak tanggal, nominal, kategori, dan sumber otomatis (selalu dicatat sebagai Pengeluaran).
- Multi-model dan multi-API-key dengan fallback otomatis saat kuota/rate-limit habis.

### Utang & Cicilan
- Catat utang/kredit/tagihan dengan jangka waktu, tanggal jatuh tempo, dan cicilan per bulan.
- Bayar cicilan dan lunasi utang langsung dari kartu, otomatis tercatat sebagai transaksi pengeluaran dari sumber dana terpilih (dengan validasi saldo).
- Status Lunas / Belum Lunas, badge otomatis, dan penanda utang mendekati jatuh tempo.

### Laporan PDF
- Ekspor laporan keuangan bulanan: header branding, ringkasan pemasukan/pengeluaran/saldo bersih, ringkasan utang aktif, breakdown kategori, tabel rincian transaksi, dan catatan rekomendasi AI.

## Database

Skema dibangun otomatis saat pertama kali dipakai (`initSchema`). Tujuh tabel, tiap baris ber-ID primary key (format `PREFIX-yyyyMMdd-HEX4`):

| Tabel | Prefix | Isi |
|-------|--------|-----|
| `Akun` | AKN | Rekening / dompet |
| `Kategori` | KAT | Kategori pemasukan & pengeluaran |
| `Transaksi` | TX | Catatan transaksi |
| `Utang` | UTG | Utang, cicilan, tagihan |
| `PembayaranUtang` | BAY | Riwayat pembayaran utang |
| `Budget` | BGT | Limit pengeluaran per kategori per periode |
| `MutasiLog` | LOG | Audit perubahan saldo akun |

Detail kolom dan relasi ada di `database.md`. Kalau user memakai skema lama (sheet `in/out`, `Dompet`, dll.), `migrasi.gs` memindahkan datanya ke tabel baru saat pertama kali menjalankan.

## Teknologi

| Bagian | Teknologi |
|--------|-----------|
| Backend | Google Apps Script (satu file `.gs` per modul) |
| Frontend | HTML, Tailwind CSS (CDN), JavaScript vanilla |
| Grafik | Chart.js |
| Date picker | flatpickr |
| Ikon | Material Symbols Outlined |
| Font | Manrope, Inter, Plus Jakarta Sans |
| AI | Google Gemini (multi-key, auto-fallback) |

## Arsitektur File

| File | Peran |
|------|-------|
| `core.gs` | Inti backend: routing, primary key, cache |
| `schema.gs`, `database-init.gs` | Definisi & pembuatan skema 7 tabel |
| `transaksi.gs`, `akun.gs`, `kategori.gs`, `budget.gs`, `utang.gs`, `statistik.gs`, `laporan-pdf.gs`, `ai-gemini.gs`, `mutasi-log.gs` | CRUD per modul |
| `migrasi.gs` | Migrasi data dari skema lama ke tabel baru |
| `ViewTransaksi.html` | Tab Transaksi/Riwayat (entry point utama via `doGet`) |
| `ViewBudget.html` | Tab Budget/Dompet (sub-tab Rekening & Budget) |
| `ViewStatistik.html` | Tab Statistik (Chart.js) |
| `ViewUtang.html` | Tab Utang & Cicilan |
| `ViewJS.html` | Client-side JavaScript |
| `ViewCSS.html` | Custom Tailwind styles (claymorphism/neumorphism) |
| `ViewIndex.html` | Shell template yang meng-include semua tab |

## Performa

- Caching 60 detik via `CacheService.getScriptCache()` untuk transaksi, rekening, statistik, dan rekomendasi AI. Pindah tab/filter berulang tidak membaca ulang sheet fisik.
- Cache di-invalidate instan setiap ada operasi CRUD.
- Data awal disuntikkan langsung dari `doGet()` (zero round-trip saat render pertama dan buka tab Budget).

## Cara Menggunakan

Aplikasi ini dijalankan sebagai Web App. Cukup buka URL deployment-nya:

1. Buka URL Web App.
2. Saat pertama kali dibuka, aplikasi membuat database 7 tabel secara otomatis. Kalau data lama (sheet `in/out`, `Dompet`, dll.) terdeteksi, aplikasi menawarkan migrasi ke tabel baru.
3. Catat pemasukan dan pengeluaran di tab Transaksi, atur rekening dan limit budget di tab Budget, dan pantau grafiknya di tab Statistik.
4. Fitur AI (OCR struk dan rekomendasi) butuh API key Google Gemini. Isi lewat menu pengaturan di aplikasi sebelum fitur AI dipakai.

## Pengembangan Lokal

1. Clone repo dan buka project-nya di [Google Apps Script](https://script.google.com) (backed by Google Sheets).
2. Sinkronkan kode dengan `clasp`:
   ```bash
   npx @google/clasp push
   ```
3. Deploy sebagai Web App dengan akses eksekusi sesuai kebutuhan.
4. Terapkan perubahan lewat `clasp push`, lalu uji di URL deployment.
