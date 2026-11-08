# DESIGN: Sistem Desain Neumorphism & Claymorphism MyDuit PWA

> **Status:** Spesifikasi Resmi & Otoritatif (Rev. 6 - Pure Neumorphism & Tactile Depth Standard)  
> **Filosofi Visual:** Taktil 3D Neumorphism (Kanvas Murni `#E5E5E5`, Bayangan Ganda Dua Arah, Sumur Galian Tenggelam *Sunken Trenches*, Tipografi Bertekstur Relief 3D, serta Palet Semantik 4-Warna)  
> **Standar Aksesibilitas:** WCAG 2.1 AA Compliant (Rasio Kontras Teks >= 4.5:1, Target Sentuh Mobile >= 44x44px)

---

## 1. Fondasi Token Desain & Kanvas `#E5E5E5`

### A. Permukaan Kanvas Neumorphism
- **Latar Belakang Global:** `--clay-bg: #E5E5E5`
- Seluruh kartu, sheet, modal, dan container utama bertumpu pada warna kanvas seragam `#E5E5E5` untuk menciptakan ilusi bahwa antarmuka dibentuk dari satu lembaran material fisik yang fleksibel dan taktil.

### B. Palet Semantik 4-Warna Terstandarisasi
Warna fungsional aplikasi menggunakan 4 aksen murni yang kontras dan nyaman di mata:

| Peran Semantik | Nama Warna | Kode Hex | RGB Tuple | Penggunaan Utama |
| :--- | :--- | :--- | :--- | :--- |
| **Primary** | Mint Teal | `#36AE7C` | `54, 174, 124` | Pemasukan, Tombol Simpan / Aksi Utama, Tab Transaksi |
| **Danger** | Coral Red | `#EB5353` | `235, 83, 83` | Pengeluaran, Peringatan Jatuh Tempo, Hapus Data |
| **Info / Blue** | Ocean Blue | `#187498` | `24, 116, 152` | Budget, Pindah Saldo, Filter Tanggal, Rekening Bank |
| **Warning / Amber** | Sunny Yellow | `#D4AF0D` | `249, 217, 35` | Utang & Cicilan, Peringatan Sistem, Streak Pencatatan |

---

## 2. Arsitektur Bayangan Ganda (*Dual-Directional Shadow Physics*)

Neumorphism MyDuit mensimulasikan pencahayaan matahari dari sudut kiri-atas (135 derajat) dengan bayangan gelap di kanan-bawah dan pantulan cahaya (*specular highlight*) di kiri-atas:

### A. Elemen Timbul (*Raised / Extruded Surfaces*)
Digunakan pada kartu, sheet, panel samping, dan container utama:
```css
box-shadow:
  -8px -8px 20px rgba(255, 255, 255, 0.75),
   8px  8px 20px rgba(0, 0, 0, 0.18);
```

### B. Sumur Galian Tenggelam (*Sunken Trenches / Insets*)
Digunakan pada input formulir (`.clay-field`, `.clay-input`, `.neu-inset`, `.neu-well`), segmented track, dan datepicker:
```css
box-shadow:
  inset -4px -4px 8px rgba(255, 255, 255, 0.80),
  inset  4px  4px 8px rgba(13, 39, 80, 0.16);
```

### C. Tombol Taktil & Status Tekan (*Button Press States*)
- **Resting (Mengambang Timbul):**
  ```css
  box-shadow:
    -5px -5px 12px rgba(255, 255, 255, 0.80),
     5px  5px 12px rgba(0, 0, 0, 0.15);
  ```
- **Active / Pressed (Tenggelam Tertekan):**
  ```css
  box-shadow:
    inset -4px -4px 8px rgba(255, 255, 255, 0.80),
    inset  4px  4px 8px rgba(13, 39, 80, 0.18);
  transform: translateY(1px);
  ```

---

## 3. Tipografi Bertekstur Relief 3D (*Embossed Typography*)

Untuk menyatu dengan kanvas Neumorphism, teks tidak sekadar diwarnai hitam flat, melainkan diberi kedalaman ukiran (*engraved / embossed*):

### A. Teks Judul & Label Utama (Embossed Taktil Gelap `#0F172A`)
```css
text-shadow:
   1px  1px 1px rgba(255, 255, 255, 0.95),
  -1px -1px 1px rgba(0, 0, 0, 0.08);
```

### B. Angka Metrik Berwarna (*Colored Embossed Metrics*)
Angka nominal besar (misal total saldo, pemasukan, pengeluaran, utang) menggunakan kombinasi dual shadow berwarna:
```css
/* Contoh untuk Hijau Mint (#36AE7C) */
color: #36AE7C;
text-shadow:
  -1px -1px 2px rgba(255, 255, 255, 0.85),
   2px  2px 3px rgba(0, 0, 0, 0.22),
   3px  4px 6px rgba(0, 0, 0, 0.14);
```

### C. Perlindungan Khusus (Pengecualian)
- Elemen ikon `.material-symbols-outlined` wajib memiliki `text-shadow: none !important` agar bentuk glif font tetap tajam dan tidak kabur.
- Input teks di dalam sumur galian kapsul wajib memiliki `background: transparent !important` dan `box-shadow: none !important` untuk mengeliminasi artefak kotak abu-abu.

---

## 4. Standar Animasi, Fisika Gerak, & Gestur

### A. Transisi Swipe Pagination
Perpindahan halaman pada daftar transaksi dan daftar utang mobile menggunakan animasi geser terarah yang halus:
- Jarak travel: **14px** (dioptimalkan dari 28px agar pergerakan tidak terasa melompat).
- Kurva easing: `cubic-bezier(0.16, 1, 0.3, 1)` (deselerasi alami).
- Durasi: `240ms` dengan opacity awal `0.08`.

### B. Transisi Buka Modal Sheet (*GPU-Accelerated*)
Modal sheet menggunakan `@keyframes modalCardIn` dengan akselerasi transform 3D:
```css
@keyframes modalCardIn {
  from {
    opacity: 0;
    transform: scale3d(0.96, 0.96, 1) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale3d(1, 1, 1) translateY(0);
  }
}
```

### C. Gestur Dropdown Mobile
- Dropdown kustom (`ClaySelect` & `ClayCombobox`) membatasi `e.preventDefault()` hanya untuk pointer mouse, memungkinkan gestur *touch swipe up/down* native berjalan lancar di browser mobile.
- Scrollbar dibatasi dengan `overflow-x: hidden` dan `margin: 8px 0` pada webkit track agar tidak keluar melampaui sudut kapsul 20px.

---

## 5. Tata Letak Responsif & Breakpoint

### A. Desktop (Layar Lebar `>= 1024px`)
- Grid 3 Kolom: `lg:grid-cols-[350px_1fr_350px]`.
- Sidebar Kiri (350px): Identitas brand MyDuit, navigasi 4 modul utama, kartu wawasan (*insight streak/budget*), dan info profil pengguna.
- Konten Tengah (1fr): Area kerja utama dengan toolbar filter, pagination swipe, dan daftar kartu.
- Panel Kanan (350px): Ringkasan metrik instan, grafik perbandingan, tombol ekspor PDF, serta tombol aksi cepat.

### B. Mobile (Layar Ponsel `< 768px`)
- **Header Mobile:** Foto profil ring putih, pemilih mata uang interaktif, status koneksi offline, dan tombol aksi.
- **Bottom Navigation Bar:** Floating clay bar dengan lengkungan *radial notch* 40px di tengah, 4 ikon navigasi modul, dan Central FAB berukuran 56px dengan speed dial.

---

## 6. Aturan Integritas Desain (Anti-Pola)

1. **Anti-Ghost Button:** Status tombol aktif navigasi wajib memiliki kontras minimal 7:1 dengan teks dan ikon yang jelas.
2. **Anti-Square Inset Artifact:** Tidak boleh ada elemen `<input>` bersarang yang mempertahankan background abu-abu kotak di dalam kapsul bulat.
3. **Optimistic Modal UI:** Setiap proses simpan/update/bayar wajib menutup modal dialog secara instan dalam **0ms** sebelum proses *network commit* Firestore berjalan di background.
