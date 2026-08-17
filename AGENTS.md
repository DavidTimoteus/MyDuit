# MyDuit — Project Memory

## Deploy Policy
- **WAJIB konfirmasi dulu sebelum `clasp push`**, kecuali user memberi perintah eksplisit untuk langsung deploy (mis. "deploy sekarang", "push", "langsung push").
- Konfirmasi cukup satu baris singkat: tampilkan ringkasan file yang akan di-push + tanya "Lanjut deploy?".
- Berlaku untuk semua sesi di repo ini.

## Recent Changes / Progres

### 2024 - Rename ViewInOut → ViewTransaksi
- **File baru**: `ViewTransaksi.html` (dari `ViewInOut.html`)
- **Update `View_Index.html:53`**: `include('ViewTransaksi')`
- **Hapus file lama**: `ViewInOut.html`
- **Update komentar** di 6 file lain (`ViewTransaksi.html`, `ViewStatistik.html`, `ViewBudget.html`, `ViewUtang.html`, `ViewJS.html`, `controller.js`)
- **Deploy**: `clasp push` berhasil

### Ukuran Teks di Tab Budget
- **Issue**: Label "Perubahan Terakhir" di kartu rekening pakai `text-[10px]`, tidak konsisten
- **Fix**: `ViewJS.html:1993-1994` -> ganti ke `text-xs font-semibold text-slate-400`
- **Heading "Catatan Rekening"** di `ViewBudget.html:21-32`: diubah jadi "Rekening" dengan class sama besar "Transaksi" (`text-2xl sm:text-[28px] tracking-tight riwayat-heading-neumorphism heading-accent-blue`)

## Project Structure
- `controller.js` — Backend Google Apps Script (CRUD, caching, sheet operations)
- `ViewTransaksi.html` — Main tab Transaksi/Riwayat (entry point via doGet)
- `ViewBudget.html` — Tab Budget/Dompet (card stack slider)
- `ViewStatistik.html` — Tab Statistik (chart.js)
- `ViewUtang.html` — Tab Utang & Cicilan
- `ViewJS.html` — Client-side JavaScript (4375+ lines)
- `ViewCSS.html` — Custom Tailwind styles
- `View_Index.html` — Shell template (meng-include semua tab)

## Commands
- `npx @google/clasp push` — Deploy ke Apps Script
- `npx @google/clasp open` — Buka di Apps Script editor
- `npx @google/clasp deploy` — Create new deployment

## Sheet Structure
- **SHEET_NAME: "in/out"** — Transaksi (kolom A:G, start row 6)
- **Sheet "Dompet"** — Rekening akun (start row 7, kolom A=ID, B=Nama, C=Saldo, D=Updated, E=Tipe, F=Catatan)