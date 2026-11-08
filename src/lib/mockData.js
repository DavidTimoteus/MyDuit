// src/lib/mockData.js
// Mock data terstandarisasi untuk mode demo / QA visual dogfooding
// Memastikan seluruh view, chart, dan modal dapat diuji secara visual dengan data realistis.

export const IS_DEMO_UID = (uid) => uid === 'demo_user_001';

export const MOCK_AKUN = [
  { id: 'a1', nama: 'BCA Utama', tipe: 'Rekening Utama', saldo: 15450000, deleted: false },
  { id: 'a2', nama: 'GoPay / E-Wallet', tipe: 'E-Wallet', saldo: 850000, deleted: false },
  { id: 'a3', nama: 'Tabungan Darurat', tipe: 'Tabungan', saldo: 35000000, deleted: false },
];

export const MOCK_KATEGORI = [
  { id: 'k1', nama: 'Makanan & Minuman', jenis: 'pengeluaran', deleted: false },
  { id: 'k2', nama: 'Transportasi', jenis: 'pengeluaran', deleted: false },
  { id: 'k3', nama: 'Belanja Bulanan', jenis: 'pengeluaran', deleted: false },
  { id: 'k4', nama: 'Tagihan & Utilitas', jenis: 'pengeluaran', deleted: false },
  { id: 'k5', nama: 'Gaji Pokok', jenis: 'pemasukan', deleted: false },
  { id: 'k6', nama: 'Freelance & Bonus', jenis: 'pemasukan', deleted: false },
];

export const MOCK_TRANSAKSI = [
  { id: 'tx1', jumlah: 75000, jenis: 'pengeluaran', kategoriId: 'k1', akunId: 'a1', tanggal: '2026-11-08', catatan: 'Makan siang ayam geprek', deleted: false },
  { id: 'tx2', jumlah: 35000, jenis: 'pengeluaran', kategoriId: 'k2', akunId: 'a2', tanggal: '2026-11-08', catatan: 'Ojek online ke kantor', deleted: false },
  { id: 'tx3', jumlah: 12500000, jenis: 'pemasukan', kategoriId: 'k5', akunId: 'a1', tanggal: '2026-11-01', catatan: 'Gaji bulan November', deleted: false },
  { id: 'tx4', jumlah: 1500000, jenis: 'pengeluaran', kategoriId: 'k3', akunId: 'a1', tanggal: '2026-11-03', catatan: 'Belanja bulanan supermarket', deleted: false },
  { id: 'tx5', jumlah: 500000, jenis: 'pindah saldo', dariId: 'a1', keId: 'a2', akunId: 'a1', tanggal: '2026-11-05', catatan: 'Top up GoPay', deleted: false },
  { id: 'tx6', jumlah: 250000, jenis: 'pengeluaran', kategoriId: 'k4', akunId: 'a1', tanggal: '2026-11-06', catatan: 'Listrik & Internet', deleted: false },
];

export const MOCK_BUDGET = [
  { id: 'b1', kategoriId: 'k1', limitNominal: 2000000, bulan: 10, tahun: 2026, deleted: false },
  { id: 'b2', kategoriId: 'k2', limitNominal: 1000000, bulan: 10, tahun: 2026, deleted: false },
  { id: 'b3', kategoriId: 'k3', limitNominal: 3000000, bulan: 10, tahun: 2026, deleted: false },
];

export const MOCK_UTANG = [
  { id: 'u1', namaPihak: 'Kredit Motor Honda', total: 18000000, sisa: 6000000, cicilanPerBulan: 1500000, tipe: 'Cicilan', tglJatuhTempo: '2026-12-15', status: 'aktif', deleted: false },
];
