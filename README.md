# MyDuit — Catatan Keuangan Pribadi

Aplikasi pencatat keuangan pribadi berbasis **Google Apps Script** yang berjalan sebagai Web App, dengan antarmuka modern (Tailwind CSS, claymorphism/neumorphism) dan dukungan kecerdasan buatan **Google Gemini** untuk analisis otomatis.

> Kelola uangmu, kendalikan masa depanmu.

---

## Fitur Utama

### 1. Transaksi (Riwayat Kas)
- Catat **Pemasukan** & **Pengeluaran** lengkap dengan tanggal, kategori, sumber/akun, dan keterangan.
- Filter riwayat: **hari ini, minggu ini, bulan ini, tahun ini, semua**, rentang tanggal kustom, jenis (Pemasukan/Pengeluaran), dan pencarian kata kunci.
- Pagination client-side (batch 50 item) untuk navigasi cepat tanpa fetch berulang.
- Salin transaksi & **pindah saldo antar akun** (dicatat otomatis sebagai transaksi keluar + masuk).

### 2. Budget / Dompet (Rekening)
- Kelola beberapa akun (Rekening Utama, Tabungan, E-Wallet, Dana Darurat, dll.) dengan **saldo real-time** yang otomatis tersinkron setiap ada transaksi.
- Riwayat perubahan saldo per akun (audit log "Perubahan Terakhir").
- Formulir rekening memakai desain **card stack slider**.

### 3. Statistik & Analisis
- Grafik bulanan/tahunan (Chart.js): pemasukan vs pengeluaran, tren, dan breakdown kategori.
- **Breakdown kategori 2 kolom** (Pemasukan hijau / Pengeluaran merah) dengan progress bar & persentase.
- Tren 12 bulan, analisis kategori, dan statistik 3 bulan terakhir.

### 4. Rekomendasi AI (Google Gemini)
- Analisis kesehatan keuangan per periode: **KONDISI**, **HEMAT DI SINI**, dan **PRIORITAS ALOKASI**.
- **OCR Struk**: upload foto struk → AI mengekstrak tanggal, nominal, kategori, dan sumber otomatis (selalu dicatat sebagai Pengeluaran).
- Multi-model & multi-API-key dengan **fallback otomatis** saat kuota/rate-limit habis.

### 5. Utang & Cicilan
- Catat utang/kredit/tagihan dengan jangka waktu, tanggal jatuh tempo, dan cicilan per bulan.
- **Bayar cicilan** & **lunasi utang** langsung dari kartu — otomatis dicatat sebagai transaksi pengeluaran dari sumber dana terpilih (dengan validasi saldo).
- Status **Lunas / Belum Lunas**, badge otomatis, dan reminder utang mendekati jatuh tempo.

### 6. Laporan PDF
- Ekspor **laporan keuangan bulanan** bergaya profesional: header branding, ringkasan pemasukan/pengeluaran/saldo bersih, ringkasan utang aktif, breakdown kategori, tabel rincian transaksi, dan catatan rekomendasi AI.

---

## Teknologi

| Bagian | Teknologi |
|--------|-----------|
| Backend | Google Apps Script (`controller.js`) |
| Frontend | HTML, Tailwind CSS (CDN), JavaScript vanilla |
| Grafik | Chart.js |
| Date picker | flatpickr |
| Ikon | Material Symbols Outlined |
| Font | Manrope, Inter, Plus Jakarta Sans |
| AI | Google Gemini (multi-key, auto-fallback) |

## Arsitektur File

| File | Peran |
|------|-------|
| `controller.js` | Backend Google Apps Script — CRUD, caching, operasi sheet, integrasi Gemini, pembuatan PDF |
| `ViewTransaksi.html` | Tab Transaksi/Riwayat (entry point utama via `doGet`) |
| `ViewBudget.html` | Tab Budget/Dompet (card stack slider) |
| `ViewStatistik.html` | Tab Statistik (Chart.js) |
| `ViewUtang.html` | Tab Utang & Cicilan |
| `ViewJS.html` | Client-side JavaScript (4.000+ baris) |
| `ViewCSS.html` | Custom Tailwind styles (claymorphism/neumorphism) |
| `View_Index.html` | Shell template yang meng-include semua tab |

## Struktur Google Sheet

### Sheet `in/out` — Transaksi
- Kolom A–G, data mulai **baris 6**.
- Berisi ID, tanggal, jenis, kategori, sumber, keterangan, dan nominal.

### Sheet `Dompet` — Rekening Akun
- Data mulai **baris 7**, kolom A=ID, B=Nama, C=Saldo, D=Perubahan Terakhir, E=Tipe, F=Catatan.

### Sheet `Utang` — Utang & Cicilan
- Dibuat otomatis saat pertama kali digunakan (`initUtangSheet_`).

---

## Performa

- **Caching 60 detik** via `CacheService.getScriptCache()` untuk transaksi, dompet, statistik, dan rekomendasi AI — pindah tab/filter berulang tidak membaca ulang sheet fisik.
- Cache **di-invalidate instan** setiap ada operasi CRUD.
- Data awal disuntikkan langsung dari `doGet()` (zero round-trip saat render pertama & buka tab Budget).

---

## Cara Menjalankan

1. Buka project di [Google Apps Script](https://script.google.com) (backed by Google Sheets).
2. Pasang/atur dependensi via `clasp` (opsional, untuk pengembangan lokal):
   ```bash
   npx @google/clasp push
   ```
3. Deploy sebagai **Web App** dengan akses eksekusi sesuai kebutuhan.
4. Buka URL Web App → aplikasi siap digunakan.

> Fitur AI (OCR struk & rekomendasi) membutuhkan **API key Google Gemini** yang diatur lewat menu pengaturan pada aplikasi.