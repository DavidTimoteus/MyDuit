// strukMeta.js — pembacaan struk tingkat LANJUT: memetakan isi struk ke tiga
// kolom form (kategori, keterangan, sumber/akun), bukan sekadar total+tanggal.
//
// Dipisah dari ocrStruk.js karena modul ini MURNI (tanpa canvas/Tesseract),
// jadi bisa diuji di Node lewat `npm run test:struk` dalam milidetik.
//
// PRINSIP: tempelNYA tidak boleh kosong. Setiap fungsi mengembalikan nilai
// selalu punya fallback, karena kolom kosong = transaksi tidak bisa dikategorikan
// = laporan keuangan jadi sampah.
//
// Alur:
//   cariBarang()    -> nama barang per baris (untuk kolom Keterangan)
//   petakanKategori() -> barang + merchant -> nama kategori
//   cariPembayar()  -> dompet/bank mana yang membayar (untuk kolom Sumber)

/**
 * Normalisasi OCR: perbaiki huruf yang sering salah di struk termal, dan rapatkan
 * spasi yang menyisip di dalam angka ("38. 000" -> "38.000").
 */
export function normalisasiTeks(teks) {
  return String(teks || '')
    .replace(/\r/g, '')
    .replace(/[|]/g, 'l') // pipe sering = 'l'/'1'
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    // OCR sering menyisipkan spasi di dalam satu angka ("38. 000", "20, 00").
    .replace(/(\d)\s*([.,])\s*(\d)/g, '$1$2$3')
    // 'O'/'o' di antara digit sering harus '0'
    .replace(/(?<=\d)[oO](?=\d)/g, '0')
    .replace(/(?<=\d)[lI](?=\d)/g, '1')
}

/** Baris struk yang BUKAN barang (total, pajak, metode bayar, identitas). */
const BARIS_NON_BARANG =
  /total|sub ?total|grand ?total|kembal|kembali|kembali|refund|diskon|disc|pajak|ppn|pph|tax|service|svc|admin|denda|bunga|npwp|telp|telepon|phone|fax|npwp|cashier|kasir|struk|invoice|nota ?(no|#)|no\.? ?nota|bayar|payment|metode|tunai|cash|debit|kredit|kreditcard|va ?number|no\. ?va|trx ?id|ref ?no|terima kasih|thank|kode ?pos|poin|point|diskon member|member|balance|sisa ?saldo|uang ?tunai/i

// ===== KAMUS KATEGORI =====
//
// Urutan pemeriksaan menentukan hasil: kategori paling spesifik diperiksa lebih
// dulu. "Beras" harus jadi Bahan Makan, bukan Makanan, walau sama-sama bahan
// pangan.

// Kata yang menandai BARANG MENTAH (belum dimasak) -> Bahan Makan
const BAHAN_MAKAN = [
  'beras', 'padi', 'gandum', 'jagung', 'oat', 'quinoa',
  'ketumbar', 'singkong', 'ubi', 'tahu', 'tempe', 'telur',
  'egg', 'cream', 'yogurt', 'yoghurt', 'mentega', 'butter',
  'margarine', 'minyak', 'santan', 'kecap', 'saus', 'sauce',
  'timba', 'bawang', 'bawangputih', 'bawangmerah', 'garam', 'gula',
  'gulaapasir', 'gulaaren', 'pala', 'cengkih', 'kayumanis', 'vanili',
  'lada', 'meric', 'penyedap', 'penyedaprasa', 'bumbu', 'dabu',
  'petis', 'terasi', 'kecapmanis', 'saos', 'mayones', 'daging',
  'sapi', 'ayam', 'bebek', 'domba', 'kambing', 'ikan',
  'lele', 'patin', 'tuna', 'sarden', 'udang', 'cumi',
  'kepiting', 'kerang', 'clam', 'mussels', 'bakteri', 'sayur',
  'sayuran', 'daun', 'daunbawang', 'buncis', 'kangkung', 'bayam',
  'tomat', 'timun', 'carot', 'kentang', 'terong', 'cabai',
  'cabe', 'jamur', 'brokoli', 'wortel', 'mentimun', 'selada',
  'lettuce', 'kepeng', 'petai', 'melinjo', 'daunpisang', 'talas',
  'labu', 'buah', 'fruit', 'apel', 'jeruk', 'mangga',
  'pisang', 'semangka', 'anggur', 'melon', 'pepaya', 'nanas',
  'salak', 'rambutan', 'duku', 'santol', 'markisa', 'belimbing',
  'stroberi', 'berasmerah', 'ketan', 'sAGO', 'ketumbarbubuk', 'brownies',
  'susukental', 'roti', 'sosis', 'nugget', 'bakso', 'surimi',
  'ikanas', 'margarin', 'keju', 'cheddar', 'mozzarella',
]

// Kata yang menandai MAKANAN / MINUMAN JADI -> Makanan
const MAKANAN_JADI = [
  'nasi', 'mie', 'ramen', 'spaghetti', 'pasta', 'pizza',
  'rotibakar', 'donat', 'cake', 'kue', 'bolu', 'martabak',
  'risol', 'dimsum', 'sate', 'lumpia', 'bakwan', 'pisang',
  'goreng', 'bakar', 'ayamgeprek', 'ayamgoreng', 'ayambakar', 'ayammadu',
  'gulai', 'rendang', 'soto', 'sop', 'sayur', 'tahu',
  'tempe', 'madu', 'sup', 'salad', 'burger', 'omelette',
  'omelet', 'nugget', 'sosis', 'kentang', 'perkede', 'cemilan',
  'snack', 'keripik', 'kripik', 'kerupuk', 'emping', 'onionring',
  'coffe', 'coffee', 'kopi', 'teh', 'tea', 'es',
  'soda', 'airmineral', 'mineralwater', 'air', 'mineral', 'susu',
  'milk', 'juice', 'jus', 'limau', 'lemonade', 'mocktail',
  'smoothie', 'milkshake', 'latte', 'cappuccino', 'americano', 'matcha',
  'chocolate', 'cokelat', 'vanillalatte', 'espresso', 'mocha', 'bubble',
  'boba', 'milktea', 'cheese', 'keju', 'yogurt', 'pecel',
  'kroepoek', 'krupuk', 'martabaktelur', 'sirup', 'siruppekat',
]

// Kata yang menandai ALAT / PERLENGKAPAN -> Belanja
const ALAT_PERLENGKAPAN = [
  'panci', 'wajan', 'kompor', 'sendok', 'garpu', 'pisau',
  'talenan', 'talent', 'botol', 'thermos', 'jermen', 'cup',
  'gelas', 'mangkuk', 'pingsan', 'wadah', 'kontainer', 'toples',
  'rak', 'lemari', 'kulkas', 'freezer', 'microwave', 'sambungan',
  'colokan', 'kabel', 'charger', 'casing', 'hp', 'handphone',
  'powerbank', 'sapu', 'tempat', 'sabun', 'sampo', 'shampo',
  'deterjen', 'pewangi', 'pengharum', 'sabunmandi', 'bayi', 'popok',
  'diaper', 'bedong', 'stroller', 'mainan', 'balok', 'robot',
  'masker', 'tissue', 'kapas', 'plester', 'sapro', 'pebersih',
  'baterai', 'batery', 'lampu', 'bolpoin', 'pena', 'kertas',
  'notebook', 'tas', 'ransel', 'dompet', 'sepatu', 'sandal',
  'baju', 'kaos', 'celana', 'jaket', 'topi', 'jamtangan',
  'kacamata', 'kaos kaki', 'sapu tangan',
]

// Kata yang langsung memetakan ke kategori bawaan (agar tidak jatuh ke Lainnya)
const PETA_LANGSUNG = {
  Transportasi: [
    'bensin','pertamax','pertalite','diesel','solar','parkir','tol','grab','gojek',
    'maxride','uber','taxi','taksi','bus','kereta','pesawat','parkir','makanankota',
    'oje','angkot','krl','mrt','transjakarta','tj','tol',
  ],
  Tagihan: [
    'listrik','pulsa','wifi','internet','indihome','telkomsel','telkom','vodafone',
    'water bill','pdam','bpjs','asuransi','premium','tagihan','bills','pln','token',
    'gas','pajak','ipl','kontrakan','sewa','rental','subscription','netflix','spotify',
  ],
  Kesehatan: [
    'apotek','farmasi','obat','klinik','hospital','rumahsakit','dokter','doktergigi',
    'bpjs','lab','pemeriksaan','konsultasi','vit','vitamin','suplemen','masker','testimoni',
    'medical','obat-obatan','serum','skincare','toner','moisturizer','sunscreen',
  ],
  Pendidikan: [
    'kursus','course','buku','book','spp','tuition','sekolah','kampus','udemy','coursera',
    'skill','komputer','laptop','mouse','keyboard','printer','monitor','stationery',
    'atk','alat tulis',
  ],
  Hiburan: [
    'bioskop','cinema','nonton','musik','konser','concert','game','games','steam',
    'playstation','xbox','nintendo','hiburan','rekreasi','tiket','ticket','danantara',
    'kotak','mendayung',
  ],
}

// Urutan prioritas: spesifik dulu, umum belakangan.
const URUTAN_KATEGORI = ['Bahan Makan', 'Makanan', 'Belanja', 'Kesehatan', 'Pendidikan', 'Hiburan', 'Transportasi', 'Tagihan']

/** Pecah teks struk jadi baris-baris bersih yang layak dipindai. */
export function barisStruk(teks) {
  return normalisasiTeks(teks)
    .split('\n')
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/**
 * Ambil nama-nama BARANG dari struk.
 * Menangani dua layout yang lazim di struk Indonesia:
 *   (a) "AYAM GORENG        2 x  34.000"   (nama di depan, qty di belakang)
 *   (b) "2 x 34.000  AYAM GORENG"          (qty/harga di depan, nama di belakang)
 * plus bentuk polos "BERAS 5 KG  68.000".
 *
 * @returns {Array<{nama: string, qty: number|null, harga: number}>}
 */
export function cariBarang(teks) {
  const hasil = []
  const lihat = new Set()

  // Baris IDENTITAS/nama toko/alamat hanya muncul di bagian atas struk.
  // Ambang: baris sebelum item pertama yang memuat angka besar (harga).
  // Jadi kita hentikan penelusuran begitu ketemu baris ber-harga, dan lewati
  // 3 baris teratas sebagai header (nama toko, alamat, NPWP/telp).
  const semuaBaris = barisStruk(teks)
  let mulai = 0
  for (let i = 0; i < Math.min(semuaBaris.length, 12); i++) {
    // Baris dianggap "mulai item" kalau punya angka >= 1000 (harga realistis).
    const angkaBesar = [...semuaBaris[i].matchAll(/\d[\d.,]*/g)]
      .map((m) => parseAngkaID(m[0]))
      .some((n) => Number.isFinite(n) && n >= 1000)
    if (angkaBesar) {
      // Jika baris sebelum harga (i - 1) memiliki huruf nama barang (bukan header/alamat),
      // mulai dari nama barang tersebut (pola multi-line item).
      if (i > 0 && !BARIS_NON_BARANG.test(semuaBaris[i - 1])) {
        const hurufSblm = (semuaBaris[i - 1].replace(/\d[\d.,]*/g, '').match(/[A-Za-z]/g) || []).length
        const isHeader = /jalan|jl\.|telp|phone|alamat|kasir|cashier|nota|struk|npwp/i.test(semuaBaris[i - 1])
        if (hurufSblm >= 3 && !isHeader) {
          mulai = i - 1
          break
        }
      }
      mulai = i
      break
    }
  }

  for (let idx = mulai; idx < semuaBaris.length; idx++) {
    const baris = semuaBaris[idx]
    // Buang baris non-barang (total, pajak, metode bayar, identitas, dll).
    if (BARIS_NON_BARANG.test(baris)) continue

    // Ambil semua angka di baris sebagai kandidat qty/harga.
    const angka = [...baris.matchAll(/\d[\d.,]*/g)].map((m) => parseAngkaID(m[0])).filter((n) => Number.isFinite(n) && n > 0)
    const teksAngkaTersisa = baris.replace(/\d[\d.,]*\s*[xX*]?/g, ' ').replace(/\s+/g, ' ').trim()

    // Nama barang = sisa teks non-angka. Wajib ada huruf & panjang wajar.
    const huruf = (teksAngkaTersisa.match(/[A-Za-z]/g) || []).length
    if (huruf < 2) continue
    if (teksAngkaTersisa.length < 2 || teksAngkaTersisa.length > 44) continue

    // Buang sisa yang cuma kata sambung/keterangan, bukan nama barang.
    if (/^(qty|item|itemno|desc|harga|price|amount|total|by|via|cara|bayar)$/i.test(teksAngkaTersisa)) continue

    // Buang satuan yang menempel di nama: "Beras Premium KG" -> "Beras Premium".
    const nama = titleCase(
      teksAngkaTersisa
        .replace(/\s+(kg|gr|g|ml|ltr|liter|pcs|pc|biji|buah|biji|sachet|box|karton|pack|pak|btl|botol|strip|tablet|butir|btg|ls|ons|ounce|oz|lb|pound|galon|gal)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    const kunci = nama.toLowerCase()
    if (lihat.has(kunci)) continue
    lihat.add(kunci)

    // Heuristik qty: angka kecil di (range 1..99) yang sering jadi jumlah.
    // Harga: angka terbesar di baris.
    let qty = angka.find((n) => n >= 1 && n <= 99 && n !== angka[angka.length - 1]) ?? null
    let harga = angka.length ? Math.max(...angka) : null

    // Multi-line item pairing (R-SWA / spatial reading-order collinearity):
    // Jika baris saat ini belum memiliki harga wajar tapi baris berikutnya memuat qty/harga
    if (harga === null && idx + 1 < semuaBaris.length) {
      const barisBerikut = semuaBaris[idx + 1]
      if (!BARIS_NON_BARANG.test(barisBerikut)) {
        const angkaBerikut = [...barisBerikut.matchAll(/\d[\d.,]*/g)]
          .map((m) => parseAngkaID(m[0]))
          .filter((n) => Number.isFinite(n) && n > 0)
        const hurufBerikut = (barisBerikut.replace(/\d[\d.,]*\s*[xX*]?/g, ' ').match(/[A-Za-z]/g) || []).length
        if (hurufBerikut <= 4 && angkaBerikut.length > 0) {
          const hargaBerikut = Math.max(...angkaBerikut)
          if (hargaBerikut >= 500) {
            harga = hargaBerikut
            qty = angkaBerikut.find((n) => n >= 1 && n <= 99 && n !== hargaBerikut) ?? qty
            idx++ // lewati baris harga berikutnya agar tidak diduplikasi
          }
        }
      }
    }

    hasil.push({ nama, qty, harga })
    if (hasil.length >= 12) break
  }
  return hasil
}

/** Ubah "AYAM GORENG" -> "Ayam Goreng" supaya kolom Keterangan enak dibaca. */
function titleCase(s) {
  return s
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
}

/**
 * Cocokkan satu kata dengan toleransi salah baca OCR ringan (jarak edit <= 1),
 * TAPI hanya terhadap KATA UTUH — bukan substring.
 *
 * Bug lama: `teks.includes(kata)` membuat "susu" cocok di dalam kata lain, dan
 * fuzzy tanpa batas kata membuat kata pendek tidak sengaja cocok. Fix: pecah
 * corpus jadi kata, cocok persis dulu, baru fuzzy per kata dengan batas panjang
 * yang wajar (kata >= 5 huruf).
 */
function cocokKata(teks, kata) {
  const kataArr = String(teks || '').split(' ')
  if (kataArr.includes(kata)) return true
  if (kata.length < 5) return false
  for (const w of kataArr) {
    if (w.length < 4) continue
    if (Math.abs(w.length - kata.length) <= 1 && jarakEdit(w, kata) <= 1) return true
  }
  return false
}

/** Jarak Levenshtein sederhana (cukup untuk kata pendek). */
function jarakEdit(a, b) {
  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > 1) return 9
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const biaya = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + biaya)
    }
  }
  return dp[m][n]
}

/** Parse angka Indonesia ("1.234.567" -> 1234567). Sama seperti versi ocrStruk. */
function parseAngkaID(s) {
  let t = String(s || '').replace(/[^\d.,]/g, '')
  if (!t) return NaN
  const koma = (t.match(/,/g) || []).length
  const titik = (t.match(/\./g) || []).length
  if (koma > 0 && titik > 0) {
    // Pemisah desimal = tanda baca yang TERAKHIR.
    t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  } else if (koma > 1 || titik > 1) {
    t = t.replace(/[.,]/g, '')
  } else if (koma === 1) {
    const bagian = t.split(',')
    t = bagian.length === 2 && bagian[1].length === 3 ? t.replace(',', '') : t.replace(',', '.')
  } else if (titik === 1) {
    const bagian = t.split('.')
    t = bagian.length === 2 && bagian[1].length === 3 ? t.replace('.', '') : t.replace('.', '')
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

/**
 * Petakan isi struk ke kategori + keterangan.
 *
 * @param {object} masukan
 * @param {Array} masukan.barang   hasil cariBarang()
 * @param {string} masukan.merchant nama toko (fallback kalau isi struk tak terbaca)
 * @param {string} masukan.jenis    'pemasukan' | 'pengeluaran'
 * @returns {{kategoriNama: string, kategoriDari: string, keterangan: string, yakin: boolean}}
 */
export function petakanKategori({ barang = [], merchant = '', jenis = 'pengeluaran' } = {}) {
  // Pemasukan tidak lewat kamus belanja — pakai kategori bawaan.
  if (jenis === 'pemasukan') {
    return {
      kategoriNama: tentukanPemasukan(merchant, barang),
      kategoriDari: 'pemasukan',
      keterangan: ringkasBarang(barang) || merchant || '',
      yakin: Boolean(merchant || barang.length),
    }
  }

  // Gabungkan seluruh nama barang + merchant jadi satu corpora untuk pencarian.
  const corpus = [...barang.map((b) => b.nama), merchant].join(' ').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')

  // 0) SUDAH DIMASAK? Kata kerja cooking turning SIAP PANGAN jadi Makanan
  //    apa pun bahannya: "AYAM GORENG" (bukan Bahan Makan), "IKAN BAKAR"
  //    (bukan Bahan Makan), "SAPI BALADO" (bukan Bahan Makan). Dicek sebelum
  //    semua kamus lain karena "ayam"/"ikan"/"sapi" mentah ada di Bahan Makan
  //    dan akan salah menang kalau dicek duluan.
  // Pengecualian: nama produk ber-"goreng" yang sebenarnya BAHAN pantry.
  // "MINYAK GORENG" = minyak untuk menggoreng, bukan ayam goreng.
  const bahanPantry = /\b(minyak|santan|mentega|margarin|butter|terigu|tepung|gula|garam|kecap|saus)\b/
  const kataMasak = /\b(goreng|bakar|panggang|kukus|rebus|tumis|oseng|balado|sambal|masak|manggang|cawir|unggas|areng)\b/
  const sudahMasak = kataMasak
  if (sudahMasak.test(corpus) && !bahanPantry.test(corpus)) {
    return { kategoriNama: 'Makanan', kategoriDari: 'sudah-masak', keterangan: ringkasBarang(barang) || merchant || '', yakin: true }
  }

  // 1) Keyword khusus lebih dulu (Bahan Makan > Makanan > Belanja > ...).
  for (const kat of URUTAN_KATEGORI) {
    const kamus =
      kat === 'Bahan Makan' ? BAHAN_MAKAN : kat === 'Makanan' ? MAKANAN_JADI : kat === 'Belanja' ? ALAT_PERLENGKAPAN : PETA_LANGSUNG[kat] || []
    for (const kata of kamus) {
      if (cocokKata(corpus, kata)) {
        return {
          kategoriNama: kat,
          kategoriDari: kata,
          keterangan: ringkasBarang(barang) || merchant || '',
          yakin: true,
        }
      }
    }
  }

  // 2) merchant sebagai sinyal kategori (mis. "Apotek K-24" -> Kesehatan).
  const mj = merchant.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')
  for (const kat of URUTAN_KATEGORI) {
    const kamus = PETA_LANGSUNG[kat] || []
    for (const kata of kamus) {
      if (cocokKata(mj, kata)) {
        return { kategoriNama: kat, kategoriDari: kata, keterangan: ringkasBarang(barang) || merchant, yakin: true }
      }
    }
  }

  // 3) Fallback: tidak pernah kosong. "Lainnya" + merchant sebagai keterangan.
  return {
    kategoriNama: 'Lainnya',
    kategoriDari: 'fallback',
    keterangan: ringkasBarang(barang) || merchant || 'Struk',
    yakin: false,
  }
}

function tentukanPemasukan(merchant, _barang) {
  const m = merchant.toLowerCase()
  if (/gaji|salary|payroll|tunjangan/.test(m)) return 'Gaji'
  if (/bonus|hadiah|prize|doorprize/.test(m)) return 'Bonus'
  if (/refund|retur|return|pengembalian/.test(m)) return 'Lainnya'
  if (/jual|sale|terjual|penjualan/.test(m)) return 'Penjualan'
  return 'Lainnya'
}

/** Gabung nama barang jadi satu keterangan yang ringkas & enak dibaca. */
function ringkasBarang(barang) {
  if (!barang.length) return ''
  const unik = []
  const lihat = new Set()
  for (const b of barang) {
    const k = b.nama.toLowerCase()
    if (lihat.has(k)) continue
    lihat.add(k)
    unik.push(b.nama)
  }
  const maks = 4
  if (unik.length <= maks) return unik.join(', ')
  return `${unik.slice(0, maks).join(', ')} +${unik.length - maks} lainnya`
}

// ===== PEMBAYARAN / SUMBER =====

// Dompet digital & e-wallet yang lazim dipakai di Indonesia.
const DOMPET = [
  'gopay','go pay','go-pay','ovo','dana','linkaja','link aja','shopeepay','sepay',
  'shopee pay','grabpay','grab pay','paymaya','bjb e-?pay','bri e-?pay',
]
// Bank / provider pembayaran.
const BANK = [
  'seabank','sea bank','bca','bank central asia','mandiri','bri','bni','cimb niaga',
  'cimbniaga','permata','danamon','bank danamon','kebhana','keb hana','hana','bjb',
  'bsi','bank syahariah','bsi stumpok','mutiara','altimeta','bank btpn',
  'qris','quick response code',
]

/**
 * Deteksi sumber pembayaran (akun/rekening) dari struk.
 * Kalau struk tidak menyebut metode pembayaran -> null (user pilih sendiri).
 *
 * @returns {{nama: string, jenis: 'dompet'|'bank', yakin: boolean}|null}
 */
export function cariPembayar(teks) {
  const t = normalisasiTeks(teks).toLowerCase()
  const baris = t.split('\n').map((b) => b.replace(/\s+/g, ' ').trim())

  // Cari di baris yang_bankir saja (biasanya metode bayar ada di footer/header).
  const kandidat = baris.filter((b) => /(bayar|payment|metode|debit|kredit|va ?number|qris|ref ?no)/i.test(b))

  const telusuri = (daftar, jenis) => {
    for (const b of kandidat.length ? kandidat : baris) {
      for (const nama of daftar) {
        if (b.includes(nama)) return { nama: titleCase(nama), jenis, yakin: true }
      }
    }
    return null
  }

  // E-wallet lebih spesifik -> dicek dulu.
  const dompet = telusuri(DOMPET, 'dompet')
  if (dompet) return dompet
  const bank = telusuri(BANK, 'bank')
  if (bank) return bank
  return null
}

/** Deteksi pembayaran tunai (cash) — sering tercetak "TUNAI"/"CASH". */
export function cariTunai(teks) {
  const t = normalisasiTeks(teks).toLowerCase()
  return /(tunai|cash|bayar tunai|cash payment)/i.test(t)
}