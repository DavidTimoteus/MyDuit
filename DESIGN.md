# DESIGN: MyDuit PWA Design System (Claymorphism & Responsive Engine)

> **Status:** Authoritative Specification  
> **Filosofi Visual:** Tactile Claymorphism (Soft Inner & Outer Shadows, Organic Radius, Depth-Driven Interaction)  
> **Aksesibilitas:** WCAG 2.1 AA Compliant (Kontras Teks >= 4.5:1, Target Sentuh >= 44x44px)

---

## 1. Fondasi Token Desain (3-Tier Token Architecture)

### A. Primitive Tokens (Warna & Cahaya)
- **Primary Brand (Emerald Green):**
  - `--color-primary`: `#2d6a4f`
  - `--clay-h-primary`: `45, 106, 79`
  - Gradien Aktif: `linear-gradient(145deg, #35795a 0%, #2d6a4f 60%, #1b4332 100%)`
- **Danger (Coral Crimson - Pengeluaran/Utang):**
  - `--color-danger`: `#e63946`
  - `--clay-h-danger`: `230, 57, 70`
- **Blue (Azure Accent - Budget/Rekening):**
  - `--color-blue`: `#1d3557`
  - `--clay-h-blue`: `29, 53, 87`
- **Neutral (Slate Grey):**
  - Text Primary: `#1e293b` (Slate-800)
  - Text Secondary: `#64748b` (Slate-500)
  - Canvas Surface: `#f4f7f6`

### B. Semantic Tokens (Makna Data)
- **Teks Pemasukan:** `.text-incomeText` (`#1b4332`) — Rasio kontras 7.2:1 di atas putih/surface.
- **Teks Pengeluaran:** `.text-expenseText` (`#991b1b`) — Rasio kontras 6.4:1 di atas putih/surface.
- **Teks Bantuan / Keterangan:** `.text-textSecondary` (`#475569`) — Rasio kontras 5.1:1 (Lolos AA).

### C. Component Tokens (Clay Anatomy & Spring Dynamics)
- **Border Radius:**
  - Card: `var(--clay-r-card, 26px)`
  - Card Small / Hero: `var(--clay-r-card-sm, 22px)`
  - Input & Trigger: `var(--clay-r-input, 18px)`
  - Icon Tile: `var(--clay-r-icon, 20px)` (Squircle)
  - Pill / Chip: `9999px` (Full Rounded)
- **Bayangan Clay Multi-Lapis:**
  - Card Outset: `8px 8px 20px rgba(var(--clay-h), 0.09), -6px -6px 16px rgba(255,255,255,0.98)`
  - Card Specular Rim: `inset 1.5px 1.5px 3px rgba(255,255,255,0.9), inset -2px -2px 6px rgba(var(--clay-h), 0.05)`
  - Surface Fill: `linear-gradient(145deg, rgba(255,255,255,0.98) 0%, rgba(246,250,248,0.92) 100%)`
  - Border: `1px solid rgba(255, 255, 255, 0.65)`
- **Spring Micro-Interactions (Emil Kowalski / Jakub Krehel Physics):**
  - Easing Curve Release / Pop: `cubic-bezier(0.34, 1.56, 0.64, 1)` (180ms - 200ms)
  - Easing Curve Smooth Damping: `cubic-bezier(0.16, 1, 0.3, 1)`
  - Button Active State: `transform: scale(0.97) translateY(1px);` dengan inset resistance
- **Tabular Numeric Matrix:**
  - Font: `font-variant-numeric: tabular-nums lining-nums; font-feature-settings: 'tnum' on, 'lnum' on; letter-spacing: -0.02em;`
- **Aturan Sintaks Warna Hue:**
  - Nilai `--clay-h-*` adalah *RGB triplet* (contoh: `38, 90, 67`). Penggunaan pada warna CSS wajib dibungkus `rgb(var(--clay-h))` atau `rgba(var(--clay-h), <alpha>)`. Dilarang menggunakan `background-color: var(--clay-h);` tanpa wrapper fungsi warna.

---

## 2. Tata Letak Responsif & Breakpoint Rules

### A. 3-Column Responsive Engine (Desktop >= 1024px)
- **Kolom Kiri (Navigasi & Profil):** Lebar 260px–280px tetap.
- **Kolom Tengah (Feed Konten Utama):** `flex-1 min-w-0 max-w-3xl`, scrollable independen dengan scrollbar tipis estetik.
- **Kolom Kanan (Aside Panel Kontekstual):** Lebar 340px–380px, berisi form cepat atau ringkasan rekening/kategori.

### B. Mobile Layout (Lebar < 1024px)
- **Shell Konten:**
  - Padding bawah wajib: `pb-24` (agar konten paling bawah tidak tertutup navigasi).
  - Wrapper konten: `min-h-[calc(100dvh-76px)]` dengan `overflow-y-auto` dan `touch-action: pan-y`.
  - Mencegah scroll lockup: Dilarang memasang `overflow-hidden` di parent `main` saat mobile.
- **Bottom Navigation Bar (5 Kolom Simetris):**
  - Tinggi tetap: `76px` dengan `fixed inset-x-0 bottom-0 z-50`.
  - Pembagian grid: `grid grid-cols-5` (2 Tab Kiri | FAB Tengah | 2 Tab Kanan).
  - Nav-item: padding horizontal minimal (`px-0.5` s/d `px-0` pada layar sempit) agar label tidak terpotong.
- **FAB Notch & Speed Dial:**
  - Tombol aksi utama berada di tengah (`-mt-10`), dipusatkan oleh kolom ke-3.
  - `#navShell` menggunakan `overflow-x: clip` untuk menampung animasi speed dial tanpa memicu scroll horizontal pada dokumen.

---

## 3. Aturan Pencegahan "Shape Overload" & Clipping
1. **Aturan Hug Content untuk Kartu:**
   - Dilarang keras memaksa `h-full` pada kartu mobile. Kartu wajib mengikuti isi kontent (`align-self: center`, `height: auto`).
2. **Kedalaman Tumpukan (*Card Stack*):**
   - Wrapper `.rekening-stack-wrap` wajib `overflow: visible` dan memiliki `padding-bottom: 30px` untuk menampung efek layer `translateY(12px / 24px)`.
3. **Pill & Chip Integrity:**
   - Seluruh elemen berlabel pill (`.clay-chip`, `.stat-pill-tab`, `.mutasi-tab`) memiliki styling dasar mandiri dengan radius penuh, sehingga tidak pernah berubah menjadi kotak bersudut lancip saat status non-aktif.
