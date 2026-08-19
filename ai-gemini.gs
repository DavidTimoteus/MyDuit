/*******************************************************
 * MyDuit — ai-gemini.gs
 * Domain: Integrasi Google Gemini
 * - Multi-Key round-robin: tiap panggilan memutar key yang dipakai duluan,
 *   sisanya jadi fallback otomatis saat key kena limit/kuota.
 * - Multi-Model round-robin: tiap panggilan memutar model awal sesuai kebutuhan
 *   (OCR_STRUK / TUGAS_RINGAN), sisanya jadi fallback jika model gagal.
 * - Kompatibel dengan ViewJS.html / controller.js:
 *   - processReceiptImage(base64Data, mimeType)
 *   - getRekomendasiKeuanganServer(mode, bulan, tahun)
 *   - setGeminiApiKey, setGeminiApiKeys, setGeminiApiKeysOnce
 *******************************************************/

const GEMINI_MODELS = {
  PRO_2_5: 'gemini-2.5-pro',
  FLASH_2_5: 'gemini-2.5-flash',
  FLASH_LITE_2_5: 'gemini-2.5-flash-lite',
  FLASH_2_0: 'gemini-2.0-flash',
  FLASH_LITE_2_0: 'gemini-2.0-flash-lite'
};

// Daftar model per kebutuhan. Urutan = preferensi, tapi karena round-robin model,
// model di index awal BERPUTAR per panggilan sehingga semua model terpakai merata.
const GEMINI_MODEL_ROUTES = {
  // OCR struk: butuh kemampuan vision → keluarga Flash (cepat & murah), Pro sebagai cadangan terakhir.
  OCR_STRUK: [
    GEMINI_MODELS.FLASH_2_5,
    GEMINI_MODELS.FLASH_LITE_2_5,
    GEMINI_MODELS.FLASH_2_0,
    GEMINI_MODELS.PRO_2_5,
    GEMINI_MODELS.FLASH_LITE_2_0
  ],
  // Rekomendasi (teks ringan): dahulukan model kecil, Pro untuk kualitas saat dibutuhkan.
  TUGAS_RINGAN: [
    GEMINI_MODELS.FLASH_LITE_2_5,
    GEMINI_MODELS.FLASH_2_5,
    GEMINI_MODELS.FLASH_LITE_2_0,
    GEMINI_MODELS.FLASH_2_0,
    GEMINI_MODELS.PRO_2_5
  ]
};

function getGeminiModelRoute_(kebutuhan) {
  return GEMINI_MODEL_ROUTES[kebutuhan] || GEMINI_MODEL_ROUTES.OCR_STRUK;
}

// Round-robin MODEL: memutar index model awal per panggilan (per kebutuhan) supaya
// semua model di route terpakai merata, bukan selalu model pertama yang dicoba duluan.
// Dipadukan dengan round-robin key di callGeminiGenerateContent_() → tiap panggilan
// berputar BAIK model MAUPUN key. State disimpan di ScriptProperties (lock aman).
function getNextModelIndexAndAdvance_(kebutuhan, totalModels) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const props = PropertiesService.getScriptProperties();
    const propKey = 'GEMINI_MODEL_RR_IDX_' + kebutuhan;
    let idx = parseInt(props.getProperty(propKey) || '0', 10);
    if (isNaN(idx) || idx < 0) idx = 0;
    const current = idx % totalModels;
    props.setProperty(propKey, String((idx + 1) % totalModels));
    return current;
  } finally {
    lock.releaseLock();
  }
}

function getGeminiApiKeys_() {
  // Prioritas: UserProperties (per-user) → ScriptProperties (admin default)
  const userProps = PropertiesService.getUserProperties();
  const multi = userProps.getProperty('MYDUIT_AI_KEYS');
  if (multi) {
    try {
      const arr = JSON.parse(multi);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) {}
  }
  const single = userProps.getProperty('MYDUIT_AI_KEY');
  if (single) return [single];

  // Fallback ke ScriptProperties (admin default)
  const scriptProps = PropertiesService.getScriptProperties();
  const scriptMulti = scriptProps.getProperty('GEMINI_API_KEYS');
  if (scriptMulti) {
    try {
      const arr = JSON.parse(scriptMulti);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) {}
  }
  const scriptSingle = scriptProps.getProperty('GEMINI_API_KEY');
  if (scriptSingle) return [scriptSingle];
  return [];
}

function getNextKeyIndexAndAdvance_(totalKeys) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const props = PropertiesService.getScriptProperties();
    let idx = parseInt(props.getProperty('GEMINI_KEY_ROUND_ROBIN_IDX') || '0', 10);
    if (isNaN(idx) || idx < 0) idx = 0;
    const current = idx % totalKeys;
    props.setProperty('GEMINI_KEY_ROUND_ROBIN_IDX', String((idx + 1) % totalKeys));
    return current;
  } finally {
    lock.releaseLock();
  }
}

function isGeminiQuotaOrRateLimitError_(statusCode, responseText) {
  if (statusCode === 429) return true;
  const t = (responseText || '').toUpperCase();
  if (statusCode === 403 && (t.indexOf('QUOTA') !== -1 || t.indexOf('RESOURCE_EXHAUSTED') !== -1)) return true;
  if (statusCode === 400 && t.indexOf('RESOURCE_EXHAUSTED') !== -1) return true;
  return false;
}

function callGeminiGenerateContent_(model, payload, logLabel) {
  const keys = getGeminiApiKeys_();
  if (!keys.length) throw new Error('GEMINI_API_KEY tidak dikonfigurasi.');

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const startIdx = getNextKeyIndexAndAdvance_(keys.length);
  let lastError = null;

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const keyIdx = (startIdx + attempt) % keys.length;
    const apiKey = keys[keyIdx];
    const keyLabel = 'Key#' + (keyIdx + 1) + '/' + keys.length;
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;

    let response;
    try {
      response = UrlFetchApp.fetch(url, options);
    } catch (e) {
      lastError = e;
      continue;
    }

    const statusCode = response.getResponseCode();
    if (statusCode === 200) return response;

    const bodyText = response.getContentText();
    if (isGeminiQuotaOrRateLimitError_(statusCode, bodyText)) {
      lastError = new Error(keyLabel + ' kena rate limit/kuota habis');
      continue;
    }
    lastError = new Error(keyLabel + ' status ' + statusCode + ': ' + bodyText);
  }

  throw lastError || new Error('Semua API key Gemini gagal untuk model ' + model);
}

function extractStrukDataWithGemini_(base64Data, mimeType, daftarAkun) {
  const contentType = mimeType || 'image/jpeg';
  const daftarAkunText = daftarAkun && daftarAkun.length ? daftarAkun.join(', ') : '(kosong)';

  const promptText =
    'Kamu adalah asisten pencatatan keuangan pribadi. Analisis gambar struk belanja, lalu isi field berikut:\n\n' +
    '1. tanggal: dd/mm/yyyy ("" kalau tidak ada)\n' +
    '2. sumber: WAJIB salah satu dari [' + daftarAkunText + ']\n' +
    '3. kategori: salah satu dari "Pulsa, Tagihan, & Tiket", "Online Shop", "Makanan", "Minuman", "Belanja"\n' +
    '4. keterangan: nama produk (ringkas)\n' +
    '5. nominal: total akhir, angka murni\n' +
    '6. metodePembayaranTerdeteksi: metode pembayaran ("" kalau tidak ada)';

  const sumberSchema = { type: 'STRING', description: 'Wajib salah satu dari daftar akun.' };
  if (daftarAkun && daftarAkun.length) sumberSchema.enum = daftarAkun;

  const payload = {
    contents: [{
      role: 'user',
      parts: [
        { text: promptText },
        { inline_data: { mime_type: contentType, data: base64Data } }
      ]
    }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          tanggal: { type: 'STRING' },
          sumber: sumberSchema,
          kategori: { type: 'STRING', enum: ['Pulsa, Tagihan, & Tiket', 'Online Shop', 'Makanan', 'Minuman', 'Belanja'] },
          keterangan: { type: 'STRING' },
          nominal: { type: 'NUMBER' },
          metodePembayaranTerdeteksi: { type: 'STRING' }
        },
        required: ['tanggal', 'sumber', 'kategori', 'keterangan', 'nominal', 'metodePembayaranTerdeteksi']
      }
    }
  };

  const modelRoute = getGeminiModelRoute_('OCR_STRUK');
  // Round-robin: mulai dari model yang berbeda tiap panggilan, sisanya jadi fallback.
  const startModelIdx = getNextModelIndexAndAdvance_('OCR_STRUK', modelRoute.length);
  let lastError = null;

  for (let i = 0; i < modelRoute.length; i++) {
    const model = modelRoute[(startModelIdx + i) % modelRoute.length];
    let response;
    try {
      response = callGeminiGenerateContent_(model, payload, 'OCR');
    } catch (e) {
      lastError = e;
      continue;
    }

    const json = JSON.parse(response.getContentText());
    const candidate = json.candidates && json.candidates[0];
    const parts = candidate && candidate.content && candidate.content.parts;
    const rawJsonText = (parts || []).map(p => p.text || '').join('').trim();

    if (!rawJsonText) {
      lastError = new Error('Output kosong');
      continue;
    }

    try {
      return JSON.parse(rawJsonText);
    } catch (e) {
      lastError = new Error('Gagal parse JSON: ' + e.message);
      continue;
    }
  }

  throw new Error('Semua model gagal. Error terakhir: ' + (lastError ? lastError.message : 'unknown'));
}

function pilihSumberOtomatis_(sumberDariAI, metodePembayaran, daftarAkun) {
  if (!daftarAkun || !daftarAkun.length) return sumberDariAI || 'Dompet';

  const teksGabungan = (String(metodePembayaran || '') + ' ' + String(sumberDariAI || '')).toLowerCase();

  if (teksGabungan.indexOf('shopee') !== -1 || teksGabungan.indexOf('seabank') !== -1) {
    const found = daftarAkun.find(function (nama) { return String(nama).toLowerCase() === 'seabank / shopee'; });
    if (found) return found;
    return daftarAkun.find(function (n) { return String(n).toLowerCase().indexOf('shopee') !== -1 || String(n).toLowerCase().indexOf('seabank') !== -1; }) || 'Seabank / Shopee';
  }

  return daftarAkun.find(function (n) { return String(n).toLowerCase().indexOf('dompet') !== -1; }) || daftarAkun[0] || 'Dompet';
}

function adaIndikasiPulsaTagihanTiket_(keterangan) {
  const KATA = ['pulsa', 'paket data', 'kuota', 'telkomsel', 'indosat', 'axis', 'smartfren', 'tagihan', 'listrik', 'pln', 'pdam', 'wifi', 'indihome', 'pajak', 'pbb', 'samsat', 'bpjs', 'tiket', 'pesawat', 'kereta', 'bioskop'];
  const teks = String(keterangan || '').toLowerCase();
  return KATA.some(function (k) { return teks.indexOf(k) !== -1; });
}

function tentukanKategoriOtomatis_(kategoriDariAI, metodePembayaran, keterangan) {
  const opsiValid = ['Pulsa, Tagihan, & Tiket', 'Online Shop', 'Makanan', 'Minuman', 'Belanja'];
  if (adaIndikasiPulsaTagihanTiket_(keterangan)) return 'Pulsa, Tagihan, & Tiket';
  if (opsiValid.indexOf(kategoriDariAI) !== -1) return kategoriDariAI;

  const teks = (String(metodePembayaran || '') + ' ' + String(keterangan || '')).toLowerCase();
  if (teks.indexOf('shopee') !== -1 || teks.indexOf('seabank') !== -1) return 'Online Shop';
  return 'Belanja';
}

function processReceiptImage(base64Data, mimeType) {
  const daftarAkun = fetchSumberAkunServer();
  const hasilAI = extractStrukDataWithGemini_(base64Data, mimeType, daftarAkun);

  return {
    tanggal: hasilAI.tanggal || '',
    jenis: 'Pengeluaran',
    kategori: tentukanKategoriOtomatis_(hasilAI.kategori, hasilAI.metodePembayaranTerdeteksi, hasilAI.keterangan),
    sumber: pilihSumberOtomatis_(hasilAI.sumber, hasilAI.metodePembayaranTerdeteksi, daftarAkun),
    keterangan: hasilAI.keterangan || '',
    nominal: Number(hasilAI.nominal) || 0
  };
}

function getRekomendasiKeuanganServer(mode, bulan, tahun) {
  const now = new Date();
  const modeAktif = (mode === 'tahunan') ? 'tahunan' : 'bulanan';
  const bulanAktif = (bulan === undefined || bulan === null || bulan === '') ? now.getMonth() : Number(bulan);
  const tahunAktif = (tahun === undefined || tahun === null || tahun === '') ? now.getFullYear() : Number(tahun);
  const labelPeriode = modeAktif === 'tahunan' ? ('Tahun ' + tahunAktif) : (BULAN_NAMA[bulanAktif] + ' ' + tahunAktif);

  const cacheKey = 'rekomendasiAI_v2_' + modeAktif + '_' + bulanAktif + '_' + tahunAktif;
  const cache = CacheService.getUserCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const stats = getStatistikPeriodeServer(modeAktif, bulanAktif, tahunAktif);

  if (stats.pemasukan === 0 && stats.pengeluaran === 0) {
    const hasilKosong = {
      rekomendasi: 'Belum ada transaksi untuk periode ' + labelPeriode + '.'
    };
    try { cache.put(cacheKey, JSON.stringify(hasilKosong), 60); } catch (e) {}
    return hasilKosong;
  }

  const daftarKategoriText = (stats.categories && stats.categories.length)
    ? stats.categories.map(function (k) { return k.kategori + ': Rp ' + k.total; }).join(', ')
    : '(tidak ada)';

  const prompt = 'Kamu adalah perencana keuangan profesional. Berikan rekomendasi untuk periode ' + labelPeriode + '.\n\n' +
    'DATA: Pemasukan Rp ' + stats.pemasukan + ', Pengeluaran Rp ' + stats.pengeluaran + '.\n' +
    'Kategori: ' + daftarKategoriText + '\n\n' +
    'Berikan dalam format: KONDISI: ... HEMAT DI SINI: - ... PRIORITAS ALOKASI: - ...';

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 350 }
  };

  const modelRoute = getGeminiModelRoute_('TUGAS_RINGAN');
  // Round-robin: mulai dari model yang berbeda tiap panggilan, sisanya jadi fallback.
  const startModelIdx = getNextModelIndexAndAdvance_('TUGAS_RINGAN', modelRoute.length);
  let lastError = null;

  for (let i = 0; i < modelRoute.length; i++) {
    const model = modelRoute[(startModelIdx + i) % modelRoute.length];
    let resp;
    try {
      resp = callGeminiGenerateContent_(model, payload, 'Rekomendasi');
    } catch (e) {
      lastError = e;
      continue;
    }

    const json = JSON.parse(resp.getContentText());
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      lastError = new Error('Tidak ada teks dikembalikan');
      continue;
    }

    const hasil = { rekomendasi: text.trim() };
    try { cache.put(cacheKey, JSON.stringify(hasil), 60); } catch (e) {}
    return hasil;
  }

  throw new Error('Semua model Gemini gagal. Error terakhir: ' + (lastError ? lastError.message : 'unknown'));
}

function setGeminiApiKey(key) {
  if (!key) throw new Error('API key tidak boleh kosong.');
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
  return 'Gemini API key tersimpan';
}

function setGeminiApiKeys(keys) {
  if (!keys) throw new Error('Parameter keys diperlukan.');
  const arr = Array.isArray(keys) ? keys : String(keys).split(',');
  const cleaned = arr.map(k => String(k).trim()).filter(Boolean);
  if (!cleaned.length) throw new Error('Tidak ada API key valid.');
  PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEYS', JSON.stringify(cleaned));
  return `Tersimpan ${cleaned.length} Gemini API key.`;
}

function setGeminiApiKeysOnce() {
  Logger.log(setGeminiApiKeys(['GANTI_DENGAN_API_KEY_ANDA']));
}

/**
 * Simpan API key Gemini ke UserProperties (per-user).
 * Dipanggil dari modal onboarding AI saat user pertama kali input key.
 * @param {string[]|string} keys — array key atau string koma-terpisah.
 * @return {string} pesan sukses.
 */
function setUserGeminiApiKeys(keys) {
  if (!keys) throw new Error('Parameter keys diperlukan.');
  const arr = Array.isArray(keys) ? keys : String(keys).split(',');
  const cleaned = arr.map(k => String(k).trim()).filter(Boolean);
  if (!cleaned.length) throw new Error('Tidak ada API key valid.');
  PropertiesService.getUserProperties().setProperty('MYDUIT_AI_KEYS', JSON.stringify(cleaned));
  // Hapus single key lama kalau ada
  PropertiesService.getUserProperties().deleteProperty('MYDUIT_AI_KEY');
  return `Tersimpan ${cleaned.length} API key Gemini (user).`;
}

/**
 * Cek status API key user.
 * @return {{exists: boolean, count: number, source: string}}
 */
function getUserGeminiApiKeysStatus() {
  const userProps = PropertiesService.getUserProperties();
  const multi = userProps.getProperty('MYDUIT_AI_KEYS');
  if (multi) {
    try {
      const arr = JSON.parse(multi);
      if (Array.isArray(arr) && arr.length) return { exists: true, count: arr.length, source: 'user', dismissed: false };
    } catch (e) {}
  }
  const single = userProps.getProperty('MYDUIT_AI_KEY');
  if (single) return { exists: true, count: 1, source: 'user', dismissed: false };

  // Cek apakah user pernah menekan "Nggak dulu" (sudah dismiss once)
  const dismissed = userProps.getProperty('AI_ONBOARDING_DISMISSED') === '1';

  // Fallback ke ScriptProperties (admin default)
  const scriptProps = PropertiesService.getScriptProperties();
  const scriptMulti = scriptProps.getProperty('GEMINI_API_KEYS');
  if (scriptMulti) {
    try {
      const arr = JSON.parse(scriptMulti);
      if (Array.isArray(arr) && arr.length) {
        // Admin sudah set key → onboarding tidak perlu ditanyakan
        return { exists: true, count: arr.length, source: 'admin', dismissed: false };
      }
    } catch (e) {}
  }
  if (scriptProps.getProperty('GEMINI_API_KEY')) {
    return { exists: true, count: 1, source: 'admin', dismissed: false };
  }
  return { exists: false, count: 0, source: 'none', dismissed: dismissed };
}

/**
 * Tandai onboarding AI udah pernah dilewati (user tekan "Nggak dulu").
 * Agar tidak muncul berulang kali sebelum AI dipakai.
 */
function markAIOnboardingDismissed() {
  PropertiesService.getUserProperties().setProperty('AI_ONBOARDING_DISMISSED', '1');
  return 'Dismissed';
}

/**
 * Hapus API key user (mis. saat user mau ganti key baru total).
 */
function clearUserGeminiApiKeys() {
  const up = PropertiesService.getUserProperties();
  up.deleteProperty('MYDUIT_AI_KEYS');
  up.deleteProperty('MYDUIT_AI_KEY');
  return 'API key user dihapus.';
}
