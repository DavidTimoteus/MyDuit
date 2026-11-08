# DESIGN: MyDuit PWA Design System (Claymorphism & Responsive Engine)

> **Status:** Authoritative Specification (Rev. 5 - Mint Claymorphism Standard, 5-Level Elevation Architecture & FigCraft Code Connect)  
> **Filosofi Visual:** Tactile 3D Claymorphism (Soft Inset Highlights, Organic Radius, 3D Extruded Lip Shelf, Depth-Driven Interaction, Clean Mint Pastel Palette)  
> **Aksesibilitas:** WCAG 2.1 AA Compliant (Kontras Teks >= 4.5:1, Target Sentuh Mobile >= 44x44px)

---

## 1. Fondasi Token Desain & Identitas Brand (Sovereign Brand Authority)

### A. Identitas Brand Terpadu (Tactile Mint Emerald Clay)
- **Brand Utama (Signature Mint Clay — Product UI Styleguide Standard):**
  - `--color-primary`: `#10b981` (Mint Emerald)
  - `--color-primary-dark`: `#059669` (Deep Mint)
  - `--color-primary-light`: `#34d399` (Soft Mint Glow)
  - `--clay-h-primary`: `16, 185, 129` (RGB tuple untuk bayangan berwarna)
  - Gradien Aktif Primer: `linear-gradient(180deg, #34d399 0%, #10b981 60%, #059669 100%)`
  - Lip Shelf Ekstrusi 3D: `--clay-lip-btn-primary: #047857` (Tinggi 4px saat resting, 1px saat active)
  - **Invarian Brand:** Logo aplikasi MyDuit dan panel navigasi sidebar bersifat permanen menggunakan palet identitas primer. DILARANG KERAS mengubah logo atau aura glow sidebar menjadi merah/biru saat berpindah menu (anti-bunglon).

### B. Palet Semantik & Fungsional (Matte Clay, Anti-Candy Plastic)
- **Danger / Alert (Coral Red — Hanya untuk Peringatan & Jatuh Tempo Terlambat):**
  - `--color-danger`: `#ef4444` / `#dc2626`
  - `--clay-h-danger`: `195, 53, 53`
  - Lip Shelf: `--clay-lip-btn-danger: #991b1b`
- **Blue Accent (Azure / Transfer Saldo):**
  - `--color-blue`: `#3b82f6` / `#1d4ed8`
  - `--clay-h-blue`: `29, 78, 216`
  - Lip Shelf: `--clay-lip-btn-blue: #1e3a8a`
- **Neutral Clay Surface (Warm Matte Clay Canvas):**
  - Kanvas Aplikasi: `--clay-bg: #f0f3f0`
  - Permukaan Kartu: `--color-surfaceContainerLowest: #ffffff`
  - Lip Shelf Netral: `--clay-lip-card: rgba(0, 0, 0, 0.08)`
  - Lip Shelf Tombol Netral: `--clay-lip-btn-neutral: rgba(0, 0, 0, 0.12)`
  - Text Primary: `#1e293b` (Slate-800, kontras > 10:1)
  - Text Secondary: `#475569` (Slate-600, kontras > 5:1)

### C. Larangan Ornamen Semu & Lingkaran Blurry (Anti-Fake Circle Directive)
- **Prinsip Fisika Clay:** Permukaan kartu clay adalah matte solid fisik murni dengan highlight specular tepi (inset shadow).
- **Larangan Keras:** Dilarang menempelkan pseudo-element `::before`/`::after` berupa bulatan gradien radial blur di sudut kartu (seperti `.hero-card::before`). Efek tersebut merusak ilusi taktilitas clay 3D dan tampak seperti noda/kotoran visual yang menurunkan estetika aplikasi.

---

## 2. Skala Elevasi 5-Level Claymorphism (Taktil & Anti-Inkonsistensi)

| Level | Token / Kelas | Peruntukan Komponen | Karakteristik Bayangan & Kedalaman |
|---|---|---|---|
| **Level 1** | `.clay-lvl-1`, `.clay-card-soft` | Sub-metrik, chip statis, indikator ringkas | Inset halus (`inset 1.5px 1.5px 3px rgba(255,255,255,0.9)`), elevasi 1-2px, tanpa lip shelf |
| **Level 2** | `.clay-lvl-2`, `.clay-card`, `.clay` | Kartu konten standar (rekening, mutasi, utang) | Dual shadow (`0 3px 0 lip`, `0 8px 18px rgba(0,0,0,0.05)`), inset specular kiri-atas dan ambient kanan-bawah |
| **Level 3** | `.clay-lvl-3`, `.hero-card` | Kartu ringkasan finansial utama (Saldo, Total Utang, Sisa Budget) | Lip shelf 4px, elevasi 14px, specular border `1px solid rgba(255,255,255,0.95)`, sudut 24px |
| **Level 4** | `.clay-lvl-4`, `.clay-btn.solid-primary`, `.sidebar-nav-btn.is-active` | Tombol aksi utama, tab aktif | Ekstrusi 3D 4px shelf, kurva deselerasi spring, kompresi tekan `translateY(2.5px)` |
| **Level 5** | `.clay-lvl-5`, `.clay-sheet`, `.clay-modal`, `.clay-fab` | Modal dialog, bottom sheet, floating action button | Kubah 3D cembung (`0 5px 0 lip`), elevasi melayang `0 14px 28px`, backdrop blur |

---

## 3. Kontrak Komponen & Tata Letak

### A. Navigasi Sidebar Desktop (`.sidebar-nav-btn`)
- **Tujuan Arsitektur:** Menjamin status aktif memiliki visibilitas 100% dan mengeliminasi total bug teks putih di atas putih (*ghost button*).
- **Aturan Implementasi:**
  - Status Non-Aktif: Menggunakan `.sidebar-nav-btn` dengan latar putih gradien lembut, teks dan ikon `#334155`, serta lip shelf netral 3.5px.
  - Status Aktif: Menggunakan modifier `.is-active` yang mengunci `background: linear-gradient(180deg, #34d399 0%, #10b981 60%, #059669 100%) !important;` dan `color: #ffffff !important;` dengan shelf lip `#047857` 4px dan bayangan 3D `0 10px 20px rgba(16, 185, 129, 0.28)`.
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

### E. Pencegahan Kebocoran Batas & Pemotongan Konten (*Anti-Boundary Leak*)
- **Chart.js Safeguards:** Garis sumbu X dan Y wajib memiliki `border: { display: true, color: 'rgba(148, 163, 184, 0.25)', width: 1.5 }` dengan `ticks.padding: 8` dan `grace: '10%'` pada sumbu Y, sehingga batang negatif tidak pernah menabrak teks tanggal.
- **Safe Scroll Margin:** Seluruh kontainer tampilan (`StatistikView`, `UtangView`, `BudgetView`) wajib memiliki padding bawah aman `pb-32 md:pb-20` agar kartu terbawah tidak terpotong tepi layar atau navigation bar.

---

## 4. Standar Responsivitas Mobile

### A. Bottom Navigation Bar Mobile (`#navShell`)
- Tinggi tetap: `76px` dengan `fixed inset-x-0 bottom-0 z-50`.
- Grid 5 kolom simetris dengan Central FAB notch di kolom ke-3.
- **Indikator Aktif Mobile:** Menggunakan pil inset bercahaya mint luminous (`.nav-icon-wrap.nav-icon-active`) dengan `background: rgba(16, 185, 129, 0.12)` dan bayangan galian inset lembut.
- Label teks nav: Selalu menggunakan warna primer brand (`text-primary`) saat aktif, font-extrabold 11px.

### B. Trek Segmen Kontrol Taktil (`.clay-segmented-track`)
- Seluruh pengubah mode sub-tab (Pengeluaran vs Pemasukan, Rekening vs Budget, Bulanan vs Tahunan) WAJIB menggunakan struktur `.clay-segmented-track` dan `.clay-segment-item`.
- Dilarang membuat wrapper ad-hoc flat `shadow-md` yang tidak seragam.

### C. Modal & Formulir Transaksi
- Input Nominal (`#tx-jumlah`) WAJIB berada di **Puncak Formulir** sebagai Hero Input (`text-xl font-black font-mono` dengan galian inset `.clay-input`).
- Tidak boleh tertutup virtual keyboard saat perangkat mobile membuka form.
- Tombol aksi simpan berada dalam viewport yang mudah dijangkau.

---

## 5. Matriks Aksesibilitas & Fisika Gerak (*Motion Dynamics*)
- **Kurva Spring:** `cubic-bezier(0.16, 1, 0.3, 1)` untuk deselerasi halus tanpa overshoot liar.
- **Kompresi Tombol Tekan:** `transform: translateY(2.5px);` saat `:active` dengan shelf berkurang menjadi 1px (mereplikasi tuts mekanikal fisik).
- **Fokus Keyboard:** Cincin Zamrud Luminous (`outline: 2px solid var(--color-primary); box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.35) !important;`).

---

## 6. Integrasi Desain FigCraft (Code Connect & Vector Spec)
- **Konektor Dev Mode:** `figcraft.connect.json` menghubungkan komponen Figma/FigCraft langsung ke implementasi React dan token CSS di `src/styles/index.css`.
- **Desain File Sumber:** `design/myduit_claymorphism_design_system.json` dapat diimpor atau dibuka langsung di FigCraft untuk iterasi visual instan tanpa membuang token LLM.
