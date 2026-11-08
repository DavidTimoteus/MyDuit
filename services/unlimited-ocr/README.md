# 🚀 Unlimited-OCR Microservice untuk MyDuit PWA

Microservice ini menjembatani kemampuan model **[baidu/Unlimited-OCR](https://github.com/baidu/Unlimited-OCR)** (Vision-Language Model berukuran 3.34B parameter dengan arsitektur Reference Sliding Window Attention / R-SWA) ke dalam Progressive Web App (PWA) **MyDuit**.

---

## 🎯 Arsitektur Adaptive Dual-Tier

```
                      [ Pengguna Upload / Foto Struk ]
                                     │
                                     ▼
                      ┌─────────────────────────────┐
                      │    MyDuit PWA (Frontend)    │
                      │  src/lib/ocrProvider.js     │
                      └──────────────┬──────────────┘
                                     │
              ┌──────────────────────┴──────────────────────┐
              ▼ (Mode Auto / Hybrid)                        ▼ (Mode Offline / Fallback)
    ┌───────────────────────────┐                 ┌───────────────────────────┐
    │  Unlimited-OCR Service    │                 │   Tesseract.js Lokal      │
    │  Port 8000 (FastAPI/GPU)  │                 │   100% di browser client  │
    │  - Multi-line collinearity│                 │   - Heuristik R-SWA port  │
    │  - Markdown item table    │                 │   - Sauvola adaptive      │
    │  - Akurasi VLM ~98%       │                 │   - Ringan, tanpa server  │
    └───────────────────────────┘                 └───────────────────────────┘
```

1. **Client-Side (PWA Browser):**
   - Menggunakan `Tesseract.js` + algoritma heuristik spatial reading-order dan sliding window lookahead (terinspirasi R-SWA).
   - Berjalan 100% offline, hemat memori RAM (< 1.5 GB), dan aman di HP Android berlayar kecil.
2. **Server-Side (Microservice):**
   - Menjalankan FastAPI bridge untuk multi-page receipts, dokumen PDF keuangan, dan ekstraksi kolom kompleks dengan kecepatan tinggi.
   - PWA secara otomatis mencoba server ini terlebih dahulu; jika server tidak aktif, app secara mulus (*zero interruption*) langsung beralih ke engine lokal.

---

## 🛠️ Panduan Instalasi & Menjalankan Server

### 1. Prasyarat Lingkungan
- Python 3.10+
- (Opsional) GPU NVIDIA dengan CUDA 11.8+ / 12.1+ untuk akselerasi VLM

### 2. Instalasi Dependensi
```bash
cd services/unlimited-ocr
pip install -r requirements.txt
```

Jika Anda ingin menjalankan model VLM penuh berbasis PyTorch & Transformers:
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
pip install transformers accelerate
```

### 3. Mengunduh Bobot Model baidu/Unlimited-OCR (Opsional)
Model dapat diunduh langsung dari Hugging Face atau ModelScope:
```bash
# Via Git LFS atau huggingface-cli:
huggingface-cli download baidu/Unlimited-OCR --local-dir ./weights
export UNLIMITED_OCR_MODEL_PATH="./weights"
```
*Catatan: Jika bobot belum diunduh, server otomatis berjalan dalam mode Fast Resilient Bridge.*

### 4. Menjalankan Server
```bash
python run_server.py --port 8000
```
Server akan aktif di `http://127.0.0.1:8000`.

---

## 📡 Dokumentasi Endpoint API

### `GET /health`
Mengecek status kesehatan server dan ketersediaan perangkat (CUDA/CPU).
- **Respons (200 OK):**
```json
{
  "status": "ok",
  "engine": "Unlimited-OCR",
  "version": "1.0.0",
  "device": "cuda",
  "model_loaded": true
}
```

### `POST /api/v1/parse-receipt`
Menerima file gambar struk (`multipart/form-data`) dan menghasilkan data transaksi terstruktur MyDuit.
- **Request:** `file` (multipart file)
- **Respons (200 OK):**
```json
{
  "success": true,
  "engine": "unlimited-ocr",
  "data": {
    "merchant": "Indomaret Merdeka",
    "tanggal": "2026-11-08",
    "total": 55000,
    "totalSumber": "TOTAL 55.000",
    "jenis": "pengeluaran",
    "keterangan": "Roti Gandum, Susu UHT",
    "kategoriNama": "Makanan",
    "barang": [
      { "nama": "Roti Gandum", "qty": 2, "harga": 30000 },
      { "nama": "Susu UHT", "qty": 1, "harga": 25000 }
    ],
    "sumberBayar": { "nama": "Gopay", "jenis": "dompet" },
    "bayarTunai": false,
    "confidence": 98.5,
    "markdown": "### 🧾 Ringkasan Struk Transaksi..."
  }
}
```

### `POST /api/v1/parse-long-document`
Menerima kumpulan gambar untuk dokumen struk multi-halaman atau faktur berukuran panjang.
