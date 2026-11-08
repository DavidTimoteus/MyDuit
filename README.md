# MyDuit 💵

Aplikasi web progresif (PWA) untuk mencatat dan memantau keuangan harian dengan arsitektur **offline-first**, tampilan antarmuka **Neumorphism** yang taktil dan ramah mata, serta pemindaian struk belanja otomatis berbasis OCR.

Aplikasi ini dapat diakses langsung melalui browser di ponsel maupun komputer, serta dapat dipasang (*install*) ke layar utama tanpa memerlukan Google Play Store atau App Store.

🌐 **Aplikasi Live**: [https://myduit001.web.app](https://myduit001.web.app)

---

## 📱 Fitur Utama

- **Offline-First Tanpa Ribet**: Catat pengeluaran dan pemasukan kapan saja bahkan saat tidak ada sinyal internet. Data tersimpan aman di penyimpanan lokal perangkat (*IndexedDB*) dan akan langsung tersinkronisasi ke server Firebase begitu perangkat kembali online.
- **Antarmuka Neumorphism Taktil**: Desain bertema kanvas lembut `#E5E5E5` dengan tombol timbul 3D, sumur input tenggelam (*sunken*), efek teks bertekstur relief, serta palet 4 warna standar (Hijau Mint untuk Pemasukan, Merah Koral untuk Pengeluaran, Biru Samudra untuk Budget & Transfer, Kuning Surya untuk Utang).
- **Multi-Rekening & Pindah Saldo**: Kelola beragam rekening terpisah (seperti BCA, Mandiri, GoPay, OVO, maupun Uang Tunai) lengkap dengan kalkulasi saldo otomatis dan riwayat mutasi saldo per akun.
- **Pindai Struk Otomatis (Smart OCR)**: Cukup ambil foto struk belanja menggunakan kamera ponsel atau unggah gambar. Sistem akan mengenali nominal total, tanggal, dan nama toko secara otomatis menggunakan Tesseract OCR lokal di perangkat maupun integrasi Gemini AI Vision.
- **Pengawasan Anggaran (Budgeting)**: Tentukan batas maksimal pengeluaran bulanan untuk setiap kategori belanja. Pantau persentase anggaran yang sudah terpakai agar tidak boros sebelum akhir bulan.
- **Pencatatan Utang & Cicilan**: Lacak daftar pinjaman dan piutang, lengkap dengan sisa tagihan, tanggal jatuh tempo, nominal cicilan bulanan, serta tombol pelunasan cepat.
- **Statistik & Tren Arus Kas**: Visualisasi grafik interaktif pergerakan pemasukan versus pengeluaran, analisis rasio tabungan, serta daftar kategori belanja paling boros.
- **Ekspor Laporan PDF & Cadangan Data**: Cetak laporan keuangan rapi dalam format PDF resmi tanpa watermark dialog browser, serta ekspor/impor seluruh data akun ke format Excel (.xlsx) dan JSON.
- **Dukungan Mata Uang Fleksibel**: Deteksi otomatis mata uang berdasarkan zona waktu perangkat, disertai opsi pemilihan manual untuk lebih dari 20 negara (Rupiah, USD, Ringgit, Dollar Singapura, dsb.).

---

## 🛠️ Teknologi yang Digunakan

| Kategori | Teknologi |
| :--- | :--- |
| **Frontend Framework** | [React 19](https://react.dev/) + [Vite](https://vite.dev/) |
| **Styling & Desain** | [Tailwind CSS v4](https://tailwindcss.com/) + Custom Neumorphic Design System |
| **Database & Autentikasi** | [Firebase Firestore](https://firebase.google.com/) (Persistent Local Cache & Multi-Tab Manager) + Firebase Auth |
| **Pemindaian Struk** | [Tesseract.js](https://tesseract.projectnaptha.com/) & [Google Gemini AI](https://ai.google.dev/) |
| **Grafik & Visualisasi** | [Chart.js](https://www.chartjs.org/) |
| **Pembuat Dokumen** | [jsPDF](https://github.com/parallax/jsPDF) & [jspdf-autotable](https://github.com/simonbengtsson/jsPDF-AutoTable) |
| **Olah Data Spreadsheet** | [SheetJS (xlsx)](https://sheetjs.com/) |
| **Progressive Web App** | [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) (Service Worker Cache & Background Sync) |

---

## 📁 Struktur Direktori

```text
├── public/                # Aset statis PWA (manifest, favicon, ikon aplikasi)
├── src/
│   ├── components/        # Komponen UI inti (Shell navigasi, Clay & Neu UI, Modal, Splash)
│   ├── features/
│   │   ├── auth/          # Hook dan penanganan login akun
│   │   ├── backup/        # Ekspor, impor data JSON, dan migrasi dataset XLSX
│   │   ├── budget/        # Pengaturan limit anggaran dan manajemen kartu rekening
│   │   ├── laporan/       # Generator berkas laporan keuangan PDF (vektor client-side)
│   │   ├── statistik/     # Grafik tren arus kas dan ringkasan metrik
│   │   ├── transaksi/     # Form pencatatan, filter tanggal, dan riwayat transaksi
│   │   └── utang/         # Modul pelacakan utang, cicilan aktif, dan modal bayar
│   ├── lib/               # Utilitas database Firestore, OCR struk, format uang, & tema
│   ├── styles/            # Token desain Neumorphism, CSS variabel, dan font
│   ├── App.jsx            # Gerbang autentikasi dan inisialisasi aplikasi
│   └── main.jsx           # Entry point utama React
├── firebase.json          # Konfigurasi hosting dan database Firestore
├── firestore.rules        # Aturan keamanan database Firestore per pengguna (UID)
└── vite.config.js         # Konfigurasi bundler Vite dan plugin PWA
```

---

## 🚀 Menjalankan Proyek Secara Lokal

### 1. Prasyarat Sistem
- Node.js versi 20 atau yang lebih baru
- npm (bawaan Node.js)

### 2. Kloning Repositori
```bash
git clone https://github.com/DavidTimoteus/PWA-MyDuit.git
cd PWA-MyDuit
```

### 3. Pasang Dependensi
```bash
npm install
```

### 4. Konfigurasi Variabel Lingkungan (.env)
Salin contoh file lingkungan dan isi kredensial proyek Firebase Anda:
```bash
cp .env.example .env.local
```

Buka `.env.local` lalu masukkan konfigurasi Firebase Anda:
```env
VITE_FIREBASE_API_KEY=kunci_api_firebase_anda
VITE_FIREBASE_AUTH_DOMAIN=proyek-anda.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=proyek-anda
VITE_FIREBASE_STORAGE_BUCKET=proyek-anda.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=nomor_pengirim
VITE_FIREBASE_APP_ID=id_aplikasi_firebase
VITE_FIREBASE_DATABASE_ID=(default)
```

> **Catatan OCR Gemini (Opsional)**: Untuk menggunakan fitur pemindaian struk berbasis AI dengan akurasi tinggi, Anda dapat memasukkan API Key Google AI Studio langsung melalui pengaturan OCR di dalam aplikasi.

### 5. Jalankan Server Development
```bash
npm run dev
```
Buka browser pada alamat `http://localhost:5173` untuk mencoba aplikasi.

### 6. Build untuk Produksi
```bash
npm run build
```
Hasil build siap rilis akan tersedia di folder `dist/`.

---

## 🧪 Pengujian Kualitas Kode

Aplikasi ini memiliki serangkaian uji otomatis untuk memastikan keandalan sinkronisasi data offline, konsistensi styling antarmuka, dan parsing OCR:

```bash
# Jalankan seluruh 19 uji otomatis + linter + build check
npm run check

# Uji kontrak tema Neumorphism & palet warna
npm run test:theme

# Uji parser OCR struk belanja
npm run test:ocr

# Uji logika mutasi dan perhitungan saldo rekening
npm run test:riwayat

# Uji integritas sinkronisasi offline Firestore
npm run test:offline
```

---

## 📄 Lisensi

Proyek ini berlisensi [MIT License](LICENSE). Bebas digunakan, dipelajari, dan dikembangkan lebih lanjut.
