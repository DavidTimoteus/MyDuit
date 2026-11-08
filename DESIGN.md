# DESIGN: MyDuit PWA Design System (Claymorphism & Responsive Engine)

> **Status:** Authoritative Specification (Rev. 4 - Claymorphism Tactile Standard & Anti-Overcrowding Architecture)  
> **Filosofi Visual:** Tactile 3D Claymorphism (Soft Inset Highlights, Organic Radius, 3D Extruded Lip Shelf, Depth-Driven Interaction)  
> **Aksesibilitas:** WCAG 2.1 AA Compliant (Kontras Teks >= 4.5:1, Target Sentuh Mobile >= 44x44px)

---

## 1. Fondasi Token Desain & Identitas Brand (Sovereign Brand Authority)

### A. Identitas Brand Terpadu (Anti-Chameleon Directive)
- **Brand Utama (Signature Forest Emerald & Mint Clay):**
  - `--color-primary`: `#2d6a4f` (Forest Emerald)
  - `--color-primary-hover`: `#1b4332`
  - `--clay-h-primary`: `45, 106, 79`
  - Gradien Aktif Primer: `linear-gradient(180deg, #3d8b67 0%, #2d6a4f 60%, #1b4332 100%)`
  - Lip Shelf Ekstrusi 3D: `--clay-lip-btn-primary: #143527` (Tinggi 4px saat resting, 1px saat active)
  - **Invarian Brand:** Logo aplikasi MyDuit dan panel navigasi sidebar bersifat permanen menggunakan palet identitas primer. DILARANG KERAS mengubah logo atau aura glow sidebar menjadi merah/biru saat berpindah menu (anti-bunglon).

### B. Palet Semantik & Fungsional (Matte Clay, Anti-Candy Plastic)
- **Danger / Alert (Coral Crimson - Hanya untuk Peringatan & Jatuh Tempo Terlambat):**
  - `--color-danger`: `#c62828`
  - `--clay-h-danger`: `195, 53, 53`
  - Lip Shelf: `--clay-lip-btn-danger: #991b1b`
- **Blue Accent (Azure / Transfer Saldo):**
  - `--color-blue`: `#1d4ed8`
  - `--clay-h-blue`: `29, 78, 216`
  - Lip Shelf: `--clay-lip-btn-blue: #1e3a8a`
- **Neutral Clay Surface (Warm Matte Clay Canvas):**
  - Kanvas Aplikasi: `--clay-bg: #f0f3f0`
  - Permukaan Kartu: `--color-surfaceContainerLowest: #ffffff`
  - Lip Shelf Netral: `--clay-lip-card: rgba(0, 0, 0, 0.09)`
  - Lip Shelf Tombol Netral: `--clay-lip-btn-neutral: rgba(0, 0, 0, 0.12)`
  - Text Primary: `#1e293b` (Slate-800, kontras > 10:1)
  - Text Secondary: `#475569` (Slate-600, kontras > 5:1)

### C. Larangan Ornamen Semu & Lingkaran Blurry (Anti-Fake Circle Directive)
- **Prinsip Fisika Clay:** Permukaan kartu clay adalah matte solid fisik murni dengan highlight specular tepi (inset shadow).
- **Larangan Keras:** Dilarang menempelkan pseudo-element `::before`/`::after` berupa bulatan gradien radial blur di sudut kartu (seperti `.hero-card::before`). Efek tersebut merusak ilusi taktilitas clay 3D dan tampak seperti noda/kotoran visual yang menurunkan estetika aplikasi.

---

## 2. Kontrak Komponen 3D Claymorphism

### A. Navigasi Sidebar Desktop (`.sidebar-nav-btn`)
- **Tujuan Arsitektur:** Menjamin status aktif memiliki visibilitas 100% dan mengeliminasi total bug teks putih di atas putih (*ghost button*).
- **Aturan Implementasi:**
  - Status Non-Aktif: Menggunakan `.sidebar-nav-btn` dengan latar putih gradien lembut, teks dan ikon `#334155`, serta lip shelf netral 3.5px.
  - Status Aktif: Menggunakan modifier `.is-active` yang mengunci `background: linear-gradient(180deg, #3d8b67 0%, #2d6a4f 60%, #1b4332 100%) !important;` dan `color: #ffffff !important;` dengan shelf lip `#143527` 4px dan bayangan 3D `0 10px 20px rgba(45, 106, 79, 0.38)`.
  - **Larangan Keras:** Dilarang menggunakan kombinasi kelas utility `clay-btn bg-primary text-white` atau `bg-blue-600 text-white` pada sidebar nav karena utility `bg-*` akan tertimpa gradien `.clay-btn`.

### B. Arsitektur Aside Panel & Anti-Penumpukan Konten (*Anti-Overcrowding Standard*)
- **Kanvas Netral:** Seluruh kontainer aside panel (`RightPanel`, `StatistikAsidePanel`, `BudgetAsidePanel`, `UtangAsidePanel`) WAJIB menggunakan pembungkus netral `clay clay-key-neutral bg-surfaceContainerLowest`. DILARANG memberi glow berwarna (hijau/merah/biru) pada bayangan kontainer luar panel.
- **Konsolidasi Kartu (Maksimal 2-3 Kartu per Panel):**
  - Dilarang menumpuk 7+ kartu kecil secara vertikal yang menyebabkan tabrakan bayangan (*shadow collision*), teks terpotong, dan kelelahan visual (*visual clutter*).
  - Satukan metrik terkait ke dalam satu kartu terpadu dengan pemisah garis halus (`h-px bg-slate-100`).
  - Metrik sekunder disajikan dalam baris kompak 3-kolom (`grid grid-cols-3 gap-2` dengan `.clay-card-soft`), bukan kartu individual bertingkat.
- **Netralitas Permukaan Kartu:**
  - Seluruh kartu informasi wajib menggunakan permukaan netral off-white (`bg-surfaceContainerLowest`, `#ffffff`) dengan bayangan elevasi standar.
  - Dilarang membuat kartu slab monolitik gelap (`solid-primary`, `solid-blue`, `solid-danger` pada `.clay-card`) yang menyerupai tombol raksasa dan merusak ritme visual. Warna semantik HANYA digunakan pada tombol aksi, chip, badge status, dan ikon tile.

### C. Hierarki Tombol & Aksi Cepat (*Panel Action Hierarchy*)
- **Prinsip:** 1 Aksi Utama (*Tactile Primary Clay*) + Aksi Sekunder (*Neutral Soft Clay*).
- **Larangan Penumpukan Permen (Traffic Light Candy Stack):** Dilarang menumpuk 3 tombol solid jenuh tinggi (Hijau, Merah, Biru) secara berdampingan.
  - Aksi utama (misal "Tambah Transaksi" / "Pemasukan"): Gunakan `.clay-btn.solid-primary`.
  - Aksi sekunder (misal "Tambah Pengeluaran" & "Pindah Saldo"): Gunakan `.clay-btn.clay-btn-secondary` dengan teks slate dan ikon berwarna tajam.

### D. Semantik Filter Chip & Tab
- **Status Aktif Standar ("Semua", "Aktif", "Lunas"):** Menggunakan pil zamrud brand primer (`.clay-chip.solid-primary`), bukan merah darurat.
- **Status Bahaya ("Terlambat"):** HANYA filter terlambat atau peringatan jatuh tempo yang diizinkan menggunakan `.clay-chip-active-danger`.

---

## 3. Standar Tata Letak & Responsivitas Mobile

### A. Bottom Navigation Bar Mobile (`#navShell`)
- Tinggi tetap: `76px` dengan `fixed inset-x-0 bottom-0 z-50`.
- Grid 5 kolom simetris dengan Central FAB notch di kolom ke-3.
- **Indikator Aktif Mobile:** Menggunakan pil inset bercahaya mint luminous (`.nav-icon-wrap.nav-icon-active`) dengan `background: rgba(45, 106, 79, 0.12)` dan bayangan galian inset lembut, bukan bulatan abu-abu mati.
- Label teks nav: Selalu menggunakan warna primer brand (`text-primary`) saat aktif, font-extrabold 11px.

### B. Trek Segmen Kontrol Taktil (`.clay-segmented-track`)
- Seluruh pengubah mode sub-tab (Pengeluaran vs Pemasukan, Rekening vs Budget, Bulanan vs Tahunan) WAJIB menggunakan struktur `.clay-segmented-track` dan `.clay-segment-item`.
- Dilarang membuat wrapper ad-hoc flat `shadow-md` yang tidak seragam.

### C. Modal & Formulir Transaksi
- Input Nominal (`#tx-jumlah`) WAJIB berada di **Puncak Formulir** sebagai Hero Input (`text-xl font-black font-mono` dengan galian inset `.clay-input`).
- Tidak boleh tertutup virtual keyboard saat perangkat mobile membuka form.
- Tombol aksi simpan berada dalam viewport yang mudah dijangkau.

---

## 4. Matriks Aksesibilitas & Fisika Gerak (*Motion Dynamics*)
- **Kurva Spring:** `cubic-bezier(0.16, 1, 0.3, 1)` untuk deselerasi halus tanpa overshoot liar.
- **Kompresi Tombol Tekan:** `transform: translateY(2.5px);` saat `:active` dengan shelf berkurang menjadi 1px (mereplikasi tuts mekanikal fisik).
- **Fokus Keyboard:** Cincin Zamrud Luminous (`outline: 2px solid var(--color-primary); box-shadow: 0 0 0 3px rgba(45, 106, 79, 0.35) !important;`).
