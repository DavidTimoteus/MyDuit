# Database MyDuit — Skema Google Apps Script (Redesign)

Dokumen ini adalah acuan skema database hasil redesign total dari `controller.gs` (versi lama: 1 sheet Dompet + 1 sheet in/out + 1 sheet UtangCicilan tanpa relasi ID). Skema baru menerapkan pola **1 Sheet = 1 Tabel** dengan relasi antar sheet berbasis **ID (foreign key logis)**, bukan lagi berbasis nama/teks bebas.

Status: **redesign dari nol**, tidak perlu kompatibel dengan data lama (sudah disepakati boleh mulai bersih).

> **Status implementasi saat ini (update terbaru — sesi lanjutan: budget.gs benar-benar dibangun, bug regresi AkunID di transaksi.gs diperbaiki):**
> - ✅ Skema 7 tabel & `initSchema()` sudah jadi (Fase 0).
> - ✅ Provisioning database **per-user** (auto-create saat login pertama) sudah jadi, plus **migrasi data legacy opsional** (`migrasi.gs`, baru — belum pernah tercatat di dokumen ini sebelumnya) terintegrasi ke alur setup 2-langkah di `DatabaseSetupModal.html`.
> - ✅ **CRUD sudah ditulis ulang ke skema baru — Fase 1, 2, 3 SELESAI.** `controller.gs` lama (3268 baris) sudah tidak dipakai sama sekali. File domain final (nama berbeda dari rencana awal):
> - ⚠️ **KOREKSI PENTING (ditemukan di sesi lanjutan ini)**: versi dokumen ini SEBELUMNYA mengklaim `budget.gs` "✅ SELESAI dibangun" lengkap dengan detail fungsi — **klaim itu TIDAK AKURAT**, file `budget.gs` ternyata memang belum pernah dibuat sama sekali sampai sesi lanjutan ini (dikonfirmasi langsung oleh user). Ini contoh nyata kenapa `HANDOFF.md` mewajibkan verifikasi ke file asli, bukan percaya status di dokumen ini begitu saja. `budget.gs` sudah BENAR-BENAR dibangun sekarang (lihat Fase 4 di bawah) — tapi berkaca dari kejadian ini, anggap SEMUA status "✅ SELESAI" di dokumen ini tetap perlu diverifikasi ulang ke file aslinya sebelum dipakai sebagai dasar keputusan, sampai benar-benar dikonfirmasi jalan di Apps Script Editor.
> - ⚠️ **Bug regresi ditemukan & diperbaiki (transaksi.gs, `updateTransaksiServer()`)**: sejak perbaikan AkunID (Langkah kolom `AkunID` menyimpan `Akun.ID`, bukan nama), variabel `sumberLama` yang dibaca dari sheet ikut berisi `Akun.ID`, tapi kode lama membandingkannya langsung dengan `sumberBaru` (nama akun mentah dari form) — ID vs nama nyaris tidak pernah cocok, jadi `sumberSama` selalu `false` walau user tidak mengganti akun. Dampak: validasi saldo pengeluaran saat edit jadi terlalu ketat (bisa menolak edit valid), dan `MutasiLog` mencatat 2 baris "ganti akun" palsu. **Sudah diperbaiki**: `sumberLama` dinormalisasi dulu ke ID (`sumberLamaID`) via `getAkunIdByNama_()` sebelum dibandingkan dengan `akunIDBaru`.
>   - `core.gs` — fondasi, CONFIG menunjuk sheet `Transaksi` (bukan `in/out` lagi)
>   - `akun.gs` (dulu direncanakan `dompet.gs`) — CRUD `Akun`, prefix `AKN-`
>   - `kategori.gs` (baru, tidak ada di rencana file awal) — CRUD `Kategori`, prefix `KAT-`
>   - `transaksi.gs` — CRUD `Transaksi` 9 kolom skema baru, prefix `TX-`
>   - `utang.gs` — CRUD `Utang` + `PembayaranUtang`, prefix `UTG-`/`BAY-`
>   - `budget.gs` (baru — Fase 4, dibangun & diverifikasi di sesi ini, lihat poin di bawah) — CRUD `Budget`, prefix `BGT-`
>   - `mutasi-log.gs` (baru — Fase 5, lihat poin di bawah) — log audit `MutasiLog`, prefix `LOG-`
>   - `statistik.gs`, `ai-model.gs`, `laporan-pdf.gs` — sudah query dari skema baru
>   - `migrasi.gs` (baru) — migrasi data dari spreadsheet lama (opsional, dipicu user)
> - ✅ **Perbaikan `Transaksi.KategoriID` (Langkah A–D) SELESAI & DIKONFIRMASI.** Kolom itu sekarang konsisten ditulis sebagai `Kategori.ID` asli (Langkah B), dan dikonversi balik ke nama saat dibaca untuk frontend (Langkah C, via `getKategoriTampilFromStored_()` di `kategori.gs`). Fallback pada helper itu ("kalau lookup ID gagal, anggap value memang sudah nama") menutupi Langkah D (baris lama/nilai pseudo `"Pindah Saldo"`/`"Pembayaran"`) tanpa logic terpisah — dikonfirmasi user, tidak perlu penanganan tambahan.
> - ✅ **`budget.gs` (Fase 4) SELESAI dibangun.** CRUD: `getBudgetServer(bulan, tahun)`, `simpanBudgetServer(formData)`, `updateBudgetServer(formData)`, `hapusBudgetServer(id)`. `Budget.KategoriID` **WAJIB** Kategori.ID valid saat simpan (validasi keras, TANPA fallback nama — beda dari Transaksi yang longgar) supaya join selalu akurat. `getBudgetServer()` sudah menggabungkan limit dengan realisasi pengeluaran aktual per kategori/periode (dari `getSemuaTransaksiBulanServer()` di `statistik.gs`), menghitung `terpakai`/`sisa`/`persentase`/`melebihiLimit` per baris. **Belum ada UI/frontend untuk fitur ini** — hanya backend.
> - ✅ **`mutasi-log.gs` (Fase 5) SELESAI dibangun.** `applyDeltaSaldoAkun_()` di `akun.gs` (titik tunggal semua perubahan saldo berbasis delta: CRUD Transaksi, Pindah Saldo, Bayar Cicilan, Pelunasan Utang) sekarang menerima param opsional `aksi`/`transaksiID` dan otomatis menulis 1 baris `MutasiLog` lewat `catatMutasiLog_()` setiap saldo berubah — semua pemanggil di `transaksi.gs`/`utang.gs` sudah dikirim label Aksi deskriptif (`"Pemasukan"`/`"Pengeluaran"`, `"Pindah Saldo Masuk/Keluar"`, `"Hapus Transaksi"`, `"Update Transaksi"`, `"Bayar Cicilan"`, `"Pelunasan Utang"`). Edit saldo manual lewat `updateRekeningServer()` (yang menulis nilai baru langsung, bukan delta, jadi tidak lewat `applyDeltaSaldoAkun_()`) dicatat terpisah dengan Aksi `"Koreksi Manual"`. Disiapkan juga `getMutasiLogServer(akunID, limit)` untuk baca riwayat. Logging sengaja TIDAK melempar error kalau gagal (bukan operasi kritikal). **Belum ada UI** yang menampilkan riwayat ini (`modalDetailLogRekening` di `ViewBudget.html` masih mengacu ke kolom `Catatan` lama).
> - ✅ **VERIFIKASI ULANG SESI INI (2 bug nyata ditemukan & diperbaiki)**: (1) **Bug regresi `updateTransaksiServer()` yang diklaim sudah diperbaiki ternyata MASIH ADA di kode** — `sumberSama` masih membandingkan `sumberLama` (Akun.ID dari sheet) dengan `sumberBaru` (nama dari form), variabel `sumberLamaID` tidak pernah ada. **Sudah diperbaiki** (transaksi.gs): `sumberLama` dinormalisasi ke ID (`sumberLamaID`) via `getAkunIdByNama_()` lalu dibandingkan dengan `akunIDBaru`; pemanggilan `applyDeltaSaldoAkun_()` di blok tersebut juga diseragamkan pakai ID. (2) **Join realisasi `budget.gs` rusak** — `getSemuaTransaksiBulanServer()`/`getSemuaTransaksiTahunServer()` (statistik.gs) membaca kolom `KategoriID`/`AkunID` mentah (sekarang berisi ID), sementara `budget.gs` meng-lookup `realisasiPerKategori` dengan nama kategori → `terpakai` selalu 0. **Sudah diperbaiki** (statistik.gs): kedua fungsi itu kini memakai `getKategoriTampilFromStored_()` & `getAkunTampilFromStored_()` (sama seperti `getRiwayatKasServer()`), sehingga field `.kategori`/`.sumber` kembali nama → join budget akurat. Sekaligus menutup gap "statistik masih baca kolom mentah" yang tercatat di HANDOFF.md.
> - ✅ **`migrasi.gs` diperbaiki sesi ini (relasi FK konsisten)**: sebelumnya `migrasiTransaksi_()` menulis kolom `KategoriID`/`AkunID`/`AkunTujuanID` sebagai **nama mentah** dari sheet lama (gap yang sudah lama tercatat). Sekarang `migrasiAkun_()` & `migrasiKategori_()` mengembalikan mapping `{ namaLowercase: ID }` hasil migrasi, dan `migrasiTransaksi_()` memakainya untuk resolve nama → ID (fallback simpan nama apa adanya kalau nama tidak ketemu di map, konsisten dgn pola longgar di `transaksi.gs`). Hasil: transaksi hasil migrasi benar-benar tertaut FK ke `Akun`/`Kategori`, sesuai Prinsip Desain #2. `PembayaranUtang.TransaksiID` hasil migrasi tetap kosong (data lama tidak punya relasi ke Transaksi) — ini OK, `getPembayaranByUtangID_()` hanya butuh `UtangID` + `Nominal`.
> - ⚠️ **GAP YANG TERSISA**: `rebuildSaldoAkun_()` (Fase 6) belum ditemukan di file manapun. `testBudgetCRUD()` sudah ditambahkan ke `test.gs` tapi belum pernah dijalankan langsung di Apps Script Editor — anggap `budget.gs` "dibangun, belum diverifikasi eksekusi nyata" sampai itu dilakukan. Frontend/UI untuk `budget.gs` dan riwayat `MutasiLog` belum dibangun (`ViewBudget.html` yang ada tetap UI Akun, nama tab warisan lama).
> - ⚠️ **Known issue (belum didiagnosis tuntas)**: menjalankan `doGet()?debug=1` (via `debugTestIncludes()` di `core.gs`) menghasilkan 2 error: (1) `ViewIndex` gagal dievaluasi berdiri sendiri karena variabel `initialKategori` dkk hanya diisi lewat `doGet()` normal — kemungkinan besar bukan bug nyata, hanya keterbatasan harness debug ini sendiri; (2) `DatabaseSetupModal` gagal dengan pesan yang formatnya persis error kustom dari fungsi `include()`, padahal `debugTestIncludes()` seharusnya tidak memanggil `include()` untuk item ini — indikasi kode yang benar-benar berjalan di Apps Script Editor mungkin sedikit berbeda dari file yang tersimpan/diupload. Belum diverifikasi langsung di Apps Script Editor.

---

## Prinsip Desain

1. **Setiap sheet = satu tabel.** Baris pertama = header (nama kolom), baris berikutnya = data.
2. **Relasi antar tabel pakai ID**, bukan nama/teks. Contoh: `Transaksi.AkunID` merujuk ke `Akun.ID`, bukan menyimpan nama akun sebagai string.
3. **Tidak ada hard delete untuk data referensi.** Kategori pakai soft-delete (`Aktif = false`) supaya histori transaksi lama tidak jadi orphan.
4. **Saldo Akun pakai pola hybrid**: kolom `Saldo` di tabel `Akun` adalah **cache** yang di-update tiap ada CRUD Transaksi (supaya baca cepat), didampingi fungsi `rebuildSaldoAkun_()` untuk hitung ulang dari nol (`SaldoAwal + SUM(Transaksi)`) sebagai koreksi kalau cache meleset. Rebuild bisa dipanggil manual atau lewat time-driven trigger terjadwal.
5. **Format Primary Key tetap**: `PREFIX-yyyyMMdd-HEX4`, dibuat lewat `generatePrimaryKey_(prefix)` yang sudah ada, tinggal dipanggil dengan prefix berbeda per tabel.
6. **Data derivatif tidak disimpan manual.** Contoh: `Utang.Sisa` dan `Utang.JumlahPembayaran` versi lama dihapus — dihitung dari agregasi tabel `PembayaranUtang`, bukan di-update manual tiap transaksi (rawan lupa/inkonsisten).
7. **Pindah Saldo bukan lagi teks gabungan** (`"Dompet A -> Dompet B"` di kolom Keterangan). Sekarang punya kolom `AkunTujuanID` sendiri di tabel `Transaksi`, sehingga tidak perlu parsing regex untuk edit/hapusnya.

---

## Provisioning Database Per-User

Aplikasi ini bersifat **1 user = 1 akun Google = 1 Spreadsheet database sendiri** di Drive-nya masing-masing (bukan 1 Spreadsheet bersama). Karena itu, project dijalankan sebagai **Web App standalone** (bukan container-bound ke satu Spreadsheet), dan setiap request perlu tahu Spreadsheet milik user mana yang harus dibaca/ditulis.

### Alur

1. User login Google → membuka Web App → `doGet()` dipanggil.
2. `doGet()` mencoba `getUserDatabase_()`. Kalau **gagal** (database belum pernah dibuat, atau file sudah dihapus/dipindahkan dari Drive) → **seluruh fetch data awal di-skip total** (`fetchKategoriServer()`, `getRiwayatKasServer()`, `getDompetServer()` tidak dipanggil sama sekali), `doGet()` tetap render halaman kosong dengan flag `hasDatabase: false` dan `dbError: <pesan>`.
3. Begitu halaman termuat di client, `DatabaseSetupModal.html` menjalankan `getUserDatabaseStatusServer()` untuk mengecek ulang secara independen (double-check) dan menampilkan **popup wajib** kalau memang belum ada database.
4. User menekan "Buat Database Sekarang" → `createUserDatabaseServer()` dipanggil → membuat 1 Spreadsheet baru bernama `MyDuit Database - <email>` di Drive user, menjalankan `initSchema(ss)` (7 sheet skema baru), menyimpan ID Spreadsheet ke `PropertiesService.getUserProperties()`.
5. Halaman di-reload → `doGet()` jalan ulang, kali ini `getUserDatabase_()` berhasil → data awal ter-load normal.

### Fungsi & File Terkait

| File | Isi |
|---|---|
| `database-init.gs` | `getUserDatabaseStatusServer()`, `createUserDatabaseServer()`, `getUserDatabase_()` (dengan cache per-eksekusi `_cachedUserDb_`) |
| `schema.gs` | `initSchema(targetSs)` — sekarang menerima parameter Spreadsheet opsional, dipanggil dengan Spreadsheet baru milik user saat provisioning, atau tanpa parameter (default `getActiveSpreadsheet()`) saat dites manual dari editor |
| `DatabaseSetupModal.html` | Popup wajib (blocking overlay) + notifikasi peringatan |

### Detail Penting

- **ID Spreadsheet disimpan per-user** via `PropertiesService.getUserProperties()` dengan key `MYDUIT_DB_ID` — scope-nya otomatis per akun Google yang login, tidak tercampur antar user.
- **Deteksi file terhapus/dipindahkan**: `getUserDatabaseStatusServer()` tidak hanya cek ID tersimpan, tapi juga verifikasi lewat `DriveApp.getFileById(dbId).isTrashed()` — kalau file sudah di-trash atau tidak bisa diakses lagi, properti direset otomatis dan user diminta buat database baru (dengan pesan peringatan berbeda dari kondisi "belum pernah buat sama sekali").
- **Caching per-eksekusi**: `getUserDatabase_()` menyimpan hasil `SpreadsheetApp.openById()` ke variabel scope-script (`_cachedUserDb_`) supaya tidak membuka Spreadsheet berkali-kali (ada 18 titik pemanggilan tersebar di `controller.gs`) dalam 1 request yang sama.
- **`SpreadsheetApp.getActiveSpreadsheet()` sudah tidak dipakai lagi** di `controller.gs` (18 titik diganti ke `getUserDatabase_()`), karena di Web App standalone fungsi itu selalu mengembalikan `null` — beda dari script container-bound versi lama.
- **Peringatan ke user**: modal setup menampilkan disclaimer eksplisit bahwa seluruh data disimpan sebagai 1 file Spreadsheet di Drive user sendiri, tidak ada backup otomatis di tempat lain — jangan dihapus/dipindahkan/di-rename sembarangan.

---

### 1. `Akun` (dulu `Dompet`)

| Kolom | Tipe | Keterangan |
|---|---|---|
| ID | string (PK) | `AKN-yyyyMMdd-HEX4` |
| Nama | string | |
| Tipe | string | Rekening Utama / Tabungan / E-Wallet / Dana Darurat |
| SaldoAwal | number | saldo saat akun dibuat, tidak pernah berubah setelahnya |
| Saldo | number | **CACHE** — hasil `SaldoAwal + SUM(mutasi Transaksi)` |
| UpdatedAt | datetime | **CACHE** — kapan `Saldo` terakhir di-update |
| CreatedAt | datetime | |

Kolom `Catatan` (log audit teks bebas) di versi lama **dihapus** dari tabel ini, dipindah jadi tabel `MutasiLog` tersendiri.

### 2. `Kategori` (baru — dulu tidak ada tabel master, hanya `DISTINCT` dari kolom Transaksi)

| Kolom | Tipe | Keterangan |
|---|---|---|
| ID | string (PK) | `KAT-yyyyMMdd-HEX4` |
| Nama | string | |
| Jenis | enum | Pemasukan / Pengeluaran |
| Aktif | boolean | soft-delete flag |

### 3. `Transaksi` (dulu sheet `in/out`)

| Kolom | Tipe | Keterangan |
|---|---|---|
| ID | string (PK) | `TX-yyyyMMdd-HEX4` |
| Tanggal | date | |
| Jenis | enum | Pemasukan / Pengeluaran / Pindah Saldo |
| KategoriID | string (FK → Kategori.ID) | |
| AkunID | string (FK → Akun.ID) | akun sumber |
| AkunTujuanID | string (FK → Akun.ID, nullable) | khusus Pindah Saldo |
| UtangID | string (FK → Utang.ID, nullable) | terisi kalau transaksi ini pembayaran cicilan |
| Keterangan | string | free text |
| Nominal | number | |

### 4. `Utang` (dulu sheet `UtangCicilan`)

| Kolom | Tipe | Keterangan |
|---|---|---|
| ID | string (PK) | `UTG-yyyyMMdd-HEX4` |
| Tanggal | date | |
| NamaPihak | string | |
| Deskripsi | string | |
| Total | number | |
| TglJatuhTempo | date | |
| Tipe | enum | Utang / Piutang |
| Status | enum | Belum Lunas / Lunas — **dihitung**, bukan manual (`SUM(PembayaranUtang) >= Total`) |
| CicilanPerBulan | number | |

Kolom `Sisa`, `LastUpdated`, `JumlahPembayaran` versi lama **dihapus** — semua jadi derived value dari tabel `PembayaranUtang`.

### 5. `PembayaranUtang` (baru)

| Kolom | Tipe | Keterangan |
|---|---|---|
| ID | string (PK) | `BAY-yyyyMMdd-HEX4` |
| UtangID | string (FK → Utang.ID) | |
| TransaksiID | string (FK → Transaksi.ID) | link ke baris pengeluaran terkait |
| Tanggal | date | |
| Nominal | number | |

### 6. `Budget` (baru — belum pernah diimplementasi di versi lama)

| Kolom | Tipe | Keterangan |
|---|---|---|
| ID | string (PK) | `BGT-yyyyMMdd-HEX4` |
| KategoriID | string (FK → Kategori.ID) | |
| Bulan | int | **0–11** (konvensi `Date.getMonth()` JS — konsisten dgn `statistik.gs`/`getSemuaTransaksiBulanServer()` & frontend, BUKAN 1–12 kalender awam. Koreksi dari draf sebelumnya yg salah tulis 1–12) |
| Tahun | int | |
| LimitNominal | number | |

### 7. `MutasiLog` (baru — pengganti kolom Catatan di Dompet)

| Kolom | Tipe | Keterangan |
|---|---|---|
| ID | string (PK) | `LOG-yyyyMMdd-HEX4` |
| AkunID | string (FK → Akun.ID) | |
| Timestamp | datetime | |
| Aksi | string | mis. "Pindah Saldo Masuk", "Rebuild Saldo", "Koreksi Manual" |
| Delta | number | +/- terhadap saldo akun |
| TransaksiID | string (FK → Transaksi.ID, nullable) | kosong kalau bukan dari transaksi (mis. hasil rebuild) |

---

## Peta Relasi

```
Akun      1 ── N  Transaksi     (via AkunID)
Akun      1 ── N  Transaksi     (via AkunTujuanID, khusus Pindah Saldo)
Akun      1 ── N  MutasiLog     (via AkunID)
Kategori  1 ── N  Transaksi     (via KategoriID)
Kategori  1 ── N  Budget        (via KategoriID)
Utang     1 ── N  Transaksi     (via UtangID)
Utang     1 ── N  PembayaranUtang (via UtangID)
Transaksi 1 ── N  PembayaranUtang (via TransaksiID)
Transaksi 1 ── N  MutasiLog     (via TransaksiID)
```

---

## Urutan Pembangunan (Migrasi Bertahap)

Karena ini redesign total, "migrasi" di sini berarti **urutan pembangunan ulang** — disusun berdasarkan dependency graph di atas, supaya tiap fase bisa langsung dites tanpa menunggu semua tabel selesai.

### Fase 0 — Fondasi
- `initSchema()`: membuat ke-7 sheet sekaligus beserta header-nya. Dijalankan sekali di awal.

### Fase 1 — Tabel tanpa dependensi FK — ✅ SELESAI
- **`Akun`**: sudah ada di `akun.gs`. CRUD lengkap (`simpanRekeningServer`/`simpanAkunServer`, `updateRekeningServer`, `hapusRekeningServer`, `getDompetServer`/`getAkunServer`), plus alias kompatibilitas frontend lama & helper `applyDeltaSaldoAkun_()`, `getSaldoAkun_()` dipakai `transaksi.gs`.
- **`Kategori`**: sudah ada di `kategori.gs`. CRUD (`fetchKategoriServer`, `getKategoriByJenisSumberServer`, `simpanKategoriServer`) + `Aktif` flag (soft-delete), termasuk seed 8 kategori default saat sheet pertama kali dibuat.
- Di titik ini sudah bisa dites: bikin akun & kategori tanpa transaksi sama sekali.

### Fase 2 — `Transaksi` — ✅ SELESAI
Sudah ada di `transaksi.gs`, ketiga poin sudah diimplementasi:
1. CRUD dasar (`simpanTransaksiServer`, `updateTransaksiServer`, `hapusTransaksiServer`, `getRiwayatKasServer` dgn filter & pagination).
2. Update `Akun.Saldo` via `applyDeltaSaldoAkun_()` di tiap CRUD (delta-based, bukan rebuild penuh tiap kali).
3. Pindah Saldo (`pindahSaldoServer`, `updatePindahSaldoServer`, `hapusPindahSaldoServer`) sudah pakai kolom `AkunTujuanID` asli, bukan lagi parsing teks `"A -> B"`.

**Bug regresi ditemukan & diperbaiki (sesi lanjutan)**: `updateTransaksiServer()` membandingkan `sumberLama` (dibaca dari sheet, sekarang berisi `Akun.ID` sejak perbaikan AkunID) langsung dengan `sumberBaru` (nama akun dari form) untuk menentukan `sumberSama` — ID vs nama nyaris tidak pernah cocok, jadi validasi saldo & pencatatan `MutasiLog` saat edit transaksi salah walau akun tidak diganti. Diperbaiki dengan menormalisasi `sumberLama` ke ID (`sumberLamaID`) via `getAkunIdByNama_()` sebelum dibandingkan dengan `akunIDBaru`.

### Fase 3 — `Utang` + `PembayaranUtang` — ✅ SELESAI
Sudah ada di `utang.gs`:
1. CRUD `Utang` (`simpanUtangServer`, `updateUtangServer`, `hapusUtangServer`).
2. `PembayaranUtang` (`bayarCicilanServer`, `lunasinUtangServer`) — tiap bayar insert 1 baris `PembayaranUtang` + 1 baris `Transaksi` (via `getTransaksiSheet_()` langsung, bukan lewat `simpanTransaksiServer()`) + update `Akun.Saldo` via `applyDeltaSaldoAkun_()`.
3. `Status`/`Sisa` dihitung dari agregasi `PembayaranUtang` di `getUtangServer()` (`getPembayaranByUtangID_()`), bukan disimpan manual — sesuai Prinsip Desain #6.

### Perbaikan `KategoriID` (prasyarat Fase 4, sedang dikerjakan)

**Masalah**: `Transaksi.KategoriID` berisi nama kategori (mis. `"Makanan"`), bukan `Kategori.ID` (`KAT-yyyyMMdd-HEX4`) seperti seharusnya. Root cause: `fetchKategoriServer()`/`getKategoriByJenisSumberServer()` di `kategori.gs` mengembalikan daftar **nama** untuk dropdown frontend, dan `simpanTransaksiServer()`/`updateTransaksiServer()` di `transaksi.gs` menulis nama itu apa adanya ke kolom `KategoriID` tanpa konversi.

**Rencana perbaikan** (dipecah per langkah, tiap langkah dikonfirmasi sebelum lanjut):
- **A. `kategori.gs`** — ✅ SELESAI: ditambah `getKategoriMaps_()` (bulk lookup 1x baca sheet + cache 60 detik, `byId` menyimpan semua termasuk soft-deleted, `byNama` memprioritaskan entri aktif), `getKategoriIdByNama_(nama)`, `getKategoriNamaById_(id)` — keduanya return `null` (bukan throw) kalau tidak ketemu. `invalidateKategoriCache_()` diupdate ikut membersihkan cache baru ini.
- **B. `transaksi.gs` (tulis)** — ✅ SELESAI: `simpanTransaksiServer()` & `updateTransaksiServer()` konversi nama → `Kategori.ID` via `getKategoriIdByNama_()` sebelum simpan ke kolom `KategoriID`. Fallback aman kalau lookup gagal (kategori kosong, atau nilai pseudo internal `"Pindah Saldo"`/`"Pembayaran"` yang ditulis langsung oleh `pindahSaldoServer()`/`utang.gs` tanpa lewat 2 fungsi ini): simpan nama apa adanya, tidak melempar error.
- **C. `transaksi.gs` + `statistik.gs` (baca)** — ✅ SELESAI: ditambah `getKategoriTampilFromStored_(storedValue)` di `kategori.gs` — lookup ID→nama via `getKategoriNamaById_()`, kalau gagal (return null) maka `storedValue` dianggap sudah berupa nama dan dipakai apa adanya. Dipakai di `getRiwayatKasServer()` (transaksi.gs, kolom `.kategori` di kartu riwayat & search/filter) dan `getSemuaTransaksiBulanServer()`/`getSemuaTransaksiTahunServer()` (statistik.gs). Kontrak field `.kategori` ke ViewJS.html tidak berubah (tetap nama).
- **D. Backward-compat** — ⏳ MENUNGGU KONFIRMASI USER, tapi secara fungsional sudah tertutup: fallback di `getKategoriTampilFromStored_()` ("kalau lookup by-ID gagal, anggap value memang sudah nama") otomatis menangani baris lama yang `KategoriID`-nya masih berisi nama, TANPA perlu logic backward-compat terpisah. Belum ditandai selesai resmi karena belum diverifikasi langsung terhadap data lama di Apps Script Editor.
- **E. Baru lanjut `budget.gs`**: setelah D dikonfirmasi, `Budget.KategoriID` bisa join akurat ke `Kategori.ID` asli.

Dampak sampingan: `laporan-pdf.gs` & `ai-model.gs` **tidak perlu diubah** — keduanya konsumsi field `.kategori` (nama) hasil `statistik.gs`, otomatis ikut benar setelah langkah C.

**Dependency baru (sudah terjadi)**: `transaksi.gs` & `statistik.gs` sekarang memanggil `getKategoriIdByNama_()`/`getKategoriTampilFromStored_()` dari `kategori.gs` — perlu ditambahkan ke diagram "Urutan dependensi antar file" (bagian "Pemisahan File per Domain"): `kategori.gs` jadi prasyarat `transaksi.gs` & `statistik.gs`, bukan sebaliknya.

**Status saat ini: Langkah A, B, C selesai. Langkah D menunggu konfirmasi user (fallback sudah menutupinya). Belum mulai `budget.gs`.**




### Fase 4 — `Budget` — ✅ SELESAI dibangun (backend), ⏳ belum dijalankan di Apps Script Editor
- **KOREKSI**: draf dokumen ini sebelumnya menandai fase ini "SELESAI" padahal `budget.gs` belum pernah dibuat sama sekali — lihat catatan koreksi di ringkasan status paling atas. Isi di bawah ini menjelaskan kondisi SEKARANG (setelah benar-benar dibangun), bukan klaim lama.
- `budget.gs` dibangun: CRUD (`getBudgetServer`, `simpanBudgetServer`, `updateBudgetServer`, `hapusBudgetServer`). `Budget.KategoriID` divalidasi wajib Kategori.ID valid saat simpan (lookup gagal -> ditolak, tidak ada fallback nama). `getBudgetServer(bulan, tahun)` join ke realisasi pengeluaran aktual (via `getSemuaTransaksiBulanServer()`) untuk `terpakai`/`sisa`/`persentase`/`melebihiLimit` per kategori. 1 kategori dibatasi 1 budget per bulan+tahun (dicegah lewat cek duplikat di `simpanBudgetServer`/`updateBudgetServer`) — **ini ASUMSI, belum dikonfirmasi eksplisit oleh user**, tandai di komentar file `budget.gs` supaya gampang direvisi kalau salah.
- `testBudgetCRUD()` sudah ditambahkan ke `test.gs` (cek CRUD dasar + validasi keras KategoriID + validasi duplikat + field turunan) dan dimasukkan ke `runAllTests()` — **tapi belum pernah benar-benar dijalankan di Apps Script Editor**, jadi belum ada konfirmasi eksekusi nyata (cuma tervalidasi lewat pembacaan kode).
- **Belum ada UI/frontend** yang mengonsumsi `budget.gs` — perlu tab/komponen baru di frontend (Claymorphism), TIDAK memakai `ViewBudget.html` yang sudah ada (itu tetap UI Akun).

### Fase 5 — `MutasiLog` — ✅ SELESAI
- `mutasi-log.gs` dibangun: `catatMutasiLog_(akunID, aksi, delta, transaksiID)` (tulis, silent-fail) & `getMutasiLogServer(akunID, limit)` (baca, belum dipakai frontend). Dipasang di `applyDeltaSaldoAkun_()` (akun.gs) — titik tunggal semua perubahan saldo berbasis delta — dan di `updateRekeningServer()` (akun.gs) untuk koreksi saldo manual (Aksi `"Koreksi Manual"`). Semua pemanggil `applyDeltaSaldoAkun_()` di `transaksi.gs`/`utang.gs` sudah dikirim label Aksi + TransaksiID yang deskriptif.

### Fase 6 — Fungsi turunan (read-only) — ⚠️ SEBAGIAN
- `rebuildSaldoAkun_()` — **belum ditemukan** di file manapun yang diupload.
- Statistik/laporan (`statistik.gs`) — ✅ sudah query dari skema baru (`getSemuaTransaksiBulanServer`, `getStatistikPeriodeServer`, dll). **Update sesi ini**: `getSemuaTransaksiBulanServer`/`getSemuaTransaksiTahunServer` sekarang mengonversi `KategoriID`/`AkunID` mentah → nama via `getKategoriTampilFromStored_()`/`getAkunTampilFromStored_()` (menutup gap lama + memperbaiki join realisasi di `budget.gs`).
- AI/rekomendasi keuangan (`ai-model.gs`) — ✅ sudah ada, terintegrasi dgn `statistik.gs`.

### Ringkasan Urutan

```
0. initSchema()                          ✅ SELESAI
1. Akun, Kategori            (independen)  ✅ SELESAI (akun.gs, kategori.gs)
2. Transaksi                 (CRUD → update saldo → Pindah Saldo)  ✅ SELESAI (transaksi.gs)
3. Utang, PembayaranUtang    (Utang CRUD → integrasi ke Transaksi)  ✅ SELESAI (utang.gs)
4. Budget                    (independen, bisa disisipkan kapan saja setelah fase 1)  ✅ SELESAI (budget.gs, backend — belum dijalankan di Editor, belum ada UI)
5. MutasiLog                 (nempel ke titik-titik ubah saldo di fase 2 & 3)  ✅ SELESAI (mutasi-log.gs, backend — belum ada UI)
6. Rebuild & Statistik/AI    (read-only, paling akhir)  ⚠️ Statistik/AI selesai, rebuildSaldoAkun_() belum
```

---

## Pemisahan File per Domain (controller.gs → per domain) — SUDAH SELESAI

`controller.gs` versi lama (3268 baris, 113 blok fungsi/konstanta top-level) **sudah dipecah** menjadi 8 file domain (di luar `budget.gs`, yang baru dibangun terpisah di Fase 4 — bukan bagian dari pemecahan `controller.gs` lama karena fitur ini memang belum pernah ada sebelumnya). Proses pemisahan murni memindahkan kode apa adanya (tidak ada logic yang diubah), berdasarkan analisis struktur kode asli (bukan tebakan manual), lalu diverifikasi ulang: total 113 blok di file lama = total blok gabungan di semua file baru — tidak ada yang tertinggal atau terduplikasi.

| File | Jumlah blok | Baris | Isi |
|---|---|---|---|
| **`core.gs`** | 16 | 222 | `CONFIG`, entry point `doGet()`/`include()`, `getSheet()`, `generatePrimaryKey_()`, `findRowIndexById_()`, `parseSheetDate()`, `maybeRunCleanup()`, `getRawTransaksiCached_()`, cache invalidation |
| **`dompet.gs`** (Akun) | 20 | 553 | Konstanta sheet Dompet, CRUD Rekening, sinkronisasi saldo berbasis delta, cascade rename/delete transaksi |
| **`transaksi.gs`** | 14 | 581 | CRUD Transaksi, riwayat & filter, kategori/sumber akun, Pindah Saldo |
| **`utang.gs`** | 15 | 287 | CRUD Utang/Cicilan, Bayar Cicilan/Lunasin, notifikasi jatuh tempo |
| **`statistik.gs`** | 14 | 327 | Nama bulan, agregasi statistik per periode, query transaksi mentah |
| **`ai-model.gs`** | 22 | 470 | Multi API key Gemini (round-robin+fallback), OCR struk, rekomendasi keuangan |
| **`laporan-pdf.gs`** | 5 | 401 | Export laporan PDF, template HTML, helper escape/parsing |
| **`test.gs`** | 7 | 212 | Test harness (`testTransaksiCRUD`, `runAllTests`, dst) |
| **`schema.gs`** *(sudah ada sebelumnya)* | 6 | ~150 | `initSchema`, `ensureSheetSchema_`, `debugSchemaStatus`, `SCHEMA_DEFINITION`, `SCHEMA_PK_PREFIX` |
| **`database-init.gs`** *(sudah ada sebelumnya)* | — | ~110 | `getUserDatabaseStatusServer`, `createUserDatabaseServer`, `getUserDatabase_` (dgn cache per-eksekusi) |
| **Total (113 blok asli)** | **113** | **3053** | seluruh isi `controller.gs` lama, 100% terwakili |

### Urutan dependensi antar file

```
core.gs            (fondasi — tidak bergantung file lain)
  └─ dompet.gs       (butuh core.gs)
      └─ transaksi.gs  (butuh core.gs + dompet.gs)
          └─ utang.gs    (butuh core.gs + dompet.gs + transaksi.gs)
              └─ statistik.gs (butuh core.gs + transaksi.gs + utang.gs)
                  └─ ai-model.gs (butuh transaksi.gs + statistik.gs + utang.gs)
                      └─ laporan-pdf.gs (butuh statistik.gs + utang.gs + ai-model.gs)
test.gs             (butuh SEMUA file domain di atas)
database-init.gs    (dipakai core.gs, tidak bergantung file domain manapun)
schema.gs           (dipakai database-init.gs, tidak bergantung file domain manapun)
```

Catatan: di GAS urutan file di editor **tidak memengaruhi eksekusi** (semua digabung 1 scope global saat runtime), urutan di atas murni untuk kejelasan mental model saat membaca/maintain kode.

**Catatan status (SUDAH TERJADI — bukan rencana lagi):**
- Tabel di atas ("Jumlah blok/Baris") adalah snapshot HISTORIS hasil pemisahan awal (`dompet.gs`/`transaksi.gs`/`utang.gs` versi lama, masih menunjuk sheet lama). Sejak itu, `dompet.gs` **sudah ditulis ulang total dan berganti nama jadi `akun.gs`** (menunjuk sheet `Akun` skema baru), dan `transaksi.gs`/`utang.gs` isinya juga sudah ditulis ulang mengikuti skema baru (nama file tetap sama, tapi isi bukan lagi versi lama di tabel atas). File `kategori.gs` dan `migrasi.gs` juga baru muncul, tidak ada di rencana pemisahan awal ini.
- **`controller.gs` lama sudah tidak dipakai lagi** — sudah dikonfirmasi tidak diupload lagi di sesi lanjutan, seluruh isinya 100% tergantikan oleh file domain baru.

---

| Fungsi lama | Status | Alasan |
|---|---|---|
| `isPindahSaldoJenis_()` + regex parsing di `hapusLogPindahSaldo_()` | **Dihapus** | Pindah Saldo kini pakai `AkunTujuanID`, bukan teks gabungan di Keterangan |
| `fetchKategoriServer()` (DISTINCT dari kolom Transaksi) | **Diganti** | Baca langsung dari tabel `Kategori`, lebih cepat & tidak perlu scan semua baris transaksi |
| Update manual `Sisa`/`JumlahPembayaran` di `simpanUtangServer`/`updateUtangServer` | **Dihapus** | Dihitung dari agregasi `PembayaranUtang` |
| Kolom `Catatan` (log teks bebas) di sheet `Dompet` | **Dipindah** | Jadi tabel terstruktur `MutasiLog` |

---

## Catatan Implementasi

- ID generator: pakai ulang `generatePrimaryKey_(prefix)` yang sudah ada di kode lama, tinggal panggil dengan prefix per tabel (`AKN-`, `KAT-`, `TX-`, `UTG-`, `BAY-`, `BGT-`, `LOG-`).
- `CacheService.getScriptCache()` (pola cache 60 detik ala `getRawTransaksiCached_`) tetap relevan dipakai untuk tabel yang sering dibaca (`Transaksi`, `Akun`) — invalidate cache segera setiap ada CRUD, jangan menunggu TTL habis. Perlu diperiksa ulang: cache ini di-share lintas eksekusi tapi **tidak** otomatis lintas-user — karena tiap user punya Spreadsheet berbeda, key cache idealnya disertai `ssId`/ID database supaya tidak bentrok antar user kalau suatu saat `CacheService` yang dipakai bersifat shared (bukan `getUserCache()`).
- Setiap fase disarankan diuji dengan fungsi `test*CRUD()` sendiri (mengikuti pola `testTransaksiCRUD`, `testDompetCRUD`, `testUtangCRUD` yang sudah ada), sebelum lanjut ke fase berikutnya.
- **Urutan pengerjaan berikutnya yang disarankan** (update terbaru — sedang mengerjakan perbaikan KategoriID sebagai prasyarat Budget):
  1. ~~Eksekusi pemisahan file per domain~~ — **SELESAI**.
  2. ~~Tulis ulang CRUD Fase 1–3 (Akun, Kategori, Transaksi, Utang) ke skema baru~~ — **SELESAI**, lihat `akun.gs`, `kategori.gs`, `transaksi.gs`, `utang.gs`.
  3. ~~Klarifikasi fitur `Budget`~~ — **SELESAI dikonfirmasi**: `ViewBudget.html` = UI Akun, fitur limit `Budget` (tabel) memang belum pernah dibangun.
  4. ~~Perbaikan `KategoriID` Langkah A (`kategori.gs`), B (`transaksi.gs` tulis), C (`transaksi.gs`+`statistik.gs` baca)~~ — **SELESAI**. Langkah D (fallback data lama) — **DIKONFIRMASI SELESAI** oleh user, cukup ditutupi fallback `getKategoriTampilFromStored_()`, tidak perlu logic terpisah.
  5. ~~Bangun `budget.gs` (Fase 4)~~ — **SELESAI dibangun (backend) di sesi lanjutan** (klaim "SELESAI" versi draf sebelumnya TIDAK AKURAT — file-nya memang belum pernah ada sampai sesi ini). `Budget.KategoriID` join akurat ke `Kategori.ID` asli. `testBudgetCRUD()` sudah ditambahkan ke `test.gs`, **belum dijalankan di Apps Script Editor**. Belum ada frontend/UI untuk fitur ini.
  5b. **BARU**: Jalankan `testBudgetCRUD()` (atau `runAllTests()`) langsung di Apps Script Editor untuk verifikasi eksekusi nyata `budget.gs` — belum pernah dilakukan.
  6. ~~Bangun `MutasiLog` (Fase 5)~~ — **SELESAI**. Terpasang di titik-titik `applyDeltaSaldoAkun_()` (akun.gs) & `updateRekeningServer()` (koreksi manual).
  7. Bangun `rebuildSaldoAkun_()` (Fase 6) — belum ditemukan di file manapun. Sekarang bisa juga catat Aksi `"Rebuild Saldo"` ke `MutasiLog` via `catatMutasiLog_()` yang sudah tersedia.
  8. **Diagnosis 2 error `debugTestIncludes()`** (`?debug=1`): error `DatabaseSetupModal` berbunyi persis format error kustom fungsi `include()` padahal seharusnya tidak lewat `include()` di titik itu — perlu dicek langsung di Apps Script Editor apakah kode yang berjalan sama persis dengan file yang sudah diupload. Error `ViewIndex` kemungkinan besar bukan bug nyata (lihat catatan status paling atas).
  9. Hapus `controller.gs` lama dari project GAS (kalau belum) setelah dipastikan seluruh file domain baru berjalan normal.
  10. (Opsional, di luar backend) Bangun UI/frontend untuk fitur `Budget` (`budget.gs`) — belum ada tab/komponen di ViewJS.html/View*.html yang mengonsumsinya.
