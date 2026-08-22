/*******************************************************
 * MyDuit — ai-model.gs
 * Domain: Integrasi AI multi-provider (Gemini native + OpenRouter) dengan
 *         deteksi otomatis model aktif + round-robin model & key.
 *
 * Konsep:
 * - AI_MODEL_CATALOG: katalog model yang mau kita pakai (dari semua provider),
 *   lengkap dengan kebutuhan (OCR_STRUK / TUGAS_RINGAN) & kemampuan vision.
 * - detectAvailableModels_(): panggil endpoint "list models" tiap provider yang
 *   punya key → model yang BENAR-BENAR aktif tersimpan ke cache (6 jam). Dengan
 *   ini model deprecated (mis. gemini-2.5-flash-lite yang 404) otomatis tidak
 *   dipakai, tanpa harus update manual katalog.
 * - getAvailableModels_(kebutuhan): gabungan model aktif dari semua provider
 *   yang cocok dengan kebutuhan, diurutkan sesuai preferensi katalog.
 * - getNextModelIndexAndAdvance_(): round-robin MODEL (index awal berputar).
 * - getNextKeyIndexAndAdvance_(): round-robin KEY per provider.
 *
 * Kompatibel dengan ViewJS.html:
 *   - processReceiptImage(base64Data, mimeType)
 *   - getRekomendasiKeuanganServer(mode, bulan, tahun)
 *   - setUserGeminiApiKeys / setUserAIKeys / getUserGeminiApiKeysStatus
 *******************************************************/

// ============================================================
// PROVIDER
// ============================================================
const AI_PROVIDERS = {
  GEMINI: {
    label: 'Gemini',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta',
    callUrl: function (modelId) { return this.apiBase + '/models/' + modelId + ':generateContent'; },
    listUrl: function () { return this.apiBase + '/models'; },
    parseList: function (json) {
      return (json && json.models || []).map(function (m) { return String(m.name || '').replace(/^models\//, ''); }).filter(Boolean);
    }
  },
  OPENROUTER: {
    label: 'OpenRouter',
    apiBase: 'https://openrouter.ai/api/v1',
    callUrl: function () { return this.apiBase + '/chat/completions'; },
    listUrl: function () { return this.apiBase + '/models'; },
    parseList: function (json) {
      return (json && json.data || []).map(function (m) { return String(m.id || ''); }).filter(Boolean);
    }
  }
};

// ============================================================
// KATALOG MODEL (sumber preferensi; yang tidak aktif otomatis disaring)
// ============================================================
const AI_MODEL_CATALOG = [
  // ---- Gemini native ----
  // REKOMENDASI_AI: hanya model terkuat & paling andal untuk analisis keuangan.
  { id: 'gemini-3.5-flash',        provider: 'GEMINI', vision: true, needs: ['OCR_STRUK', 'TUGAS_RINGAN', 'REKOMENDASI_AI'] },
  { id: 'gemini-3.6-flash',        provider: 'GEMINI', vision: true, needs: ['OCR_STRUK', 'TUGAS_RINGAN', 'REKOMENDASI_AI'] },
  { id: 'gemini-3.5-flash-lite',   provider: 'GEMINI', vision: true, needs: ['OCR_STRUK', 'TUGAS_RINGAN'] },
  { id: 'gemini-3.1-flash-lite',   provider: 'GEMINI', vision: true, needs: ['OCR_STRUK', 'TUGAS_RINGAN', 'REKOMENDASI_AI'] },
  // ---- OpenRouter (vision, untuk OCR + teks) ----
  { id: 'google/gemini-3.5-flash',  provider: 'OPENROUTER', vision: true, needs: ['OCR_STRUK', 'TUGAS_RINGAN', 'REKOMENDASI_AI'] },
  { id: 'openai/gpt-4o-mini',       provider: 'OPENROUTER', vision: true, needs: ['OCR_STRUK', 'TUGAS_RINGAN', 'REKOMENDASI_AI'] },
  { id: 'openai/gpt-4.1-mini',      provider: 'OPENROUTER', vision: true, needs: ['OCR_STRUK', 'TUGAS_RINGAN', 'REKOMENDASI_AI'] },
  { id: 'openai/gpt-4.1-nano',      provider: 'OPENROUTER', vision: true, needs: ['OCR_STRUK', 'TUGAS_RINGAN'] },
  { id: 'anthropic/claude-3.5-haiku', provider: 'OPENROUTER', vision: true, needs: ['OCR_STRUK', 'TUGAS_RINGAN', 'REKOMENDASI_AI'] },
  { id: 'qwen/qwen2.5-vl-7b-instruct', provider: 'OPENROUTER', vision: true, needs: ['OCR_STRUK', 'TUGAS_RINGAN'] },
  // ---- OpenRouter (teks saja, untuk rekomendasi ringan) ----
  { id: 'meta-llama/llama-3.3-70b-instruct', provider: 'OPENROUTER', vision: false, needs: ['TUGAS_RINGAN', 'REKOMENDASI_AI'] },
  { id: 'meta-llama/llama-3.1-8b-instruct',  provider: 'OPENROUTER', vision: false, needs: ['TUGAS_RINGAN'] },
  { id: 'mistralai/mistral-small-3.1-24b-instruct', provider: 'OPENROUTER', vision: false, needs: ['TUGAS_RINGAN', 'REKOMENDASI_AI'] },
  { id: 'deepseek/deepseek-chat-v3-0324',    provider: 'OPENROUTER', vision: false, needs: ['TUGAS_RINGAN', 'REKOMENDASI_AI'] },
  { id: 'qwen/qwen-2.5-7b-instruct',          provider: 'OPENROUTER', vision: false, needs: ['TUGAS_RINGAN'] }
];

const AI_MODEL_CACHE_KEY = 'aiActiveModels_v1';
const AI_MODEL_CACHE_TTL = 21600; // 6 jam

// Kumpulkan key per provider (UserProperties → ScriptProperties fallback admin)
function getAIKeys_() {
  const userProps = PropertiesService.getUserProperties();
  const gemini = [];
  const openrouter = [];

  // Format baru: MYDUIT_AI_KEYS = JSON array [{k, p}] atau legacy array string (=gemini)
  const raw = userProps.getProperty('MYDUIT_AI_KEYS');
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        arr.forEach(function (item) {
          const isObj = item !== null && typeof item === 'object';
          const k = String(isObj ? item.k : item).trim();
          const p = (isObj && item.p === 'openrouter') ? 'openrouter' : 'gemini';
          if (!k) return;
          if (p === 'openrouter') openrouter.push(k); else gemini.push(k);
        });
      }
    } catch (e) {}
  }
  const single = userProps.getProperty('MYDUIT_AI_KEY');
  if (single) gemini.push(single);

  // Fallback ScriptProperties (admin / legacy)
  const sp = PropertiesService.getScriptProperties();
  const sMulti = sp.getProperty('GEMINI_API_KEYS');
  if (sMulti) {
    try {
      const arr = JSON.parse(sMulti);
      if (Array.isArray(arr)) arr.forEach(function (k) { const v = String(k).trim(); if (v) gemini.push(v); });
    } catch (e) {}
  }
  if (sp.getProperty('GEMINI_API_KEY')) gemini.push(sp.getProperty('GEMINI_API_KEY'));
  const orMulti = sp.getProperty('OPENROUTER_API_KEYS');
  if (orMulti) {
    try {
      const arr = JSON.parse(orMulti);
      if (Array.isArray(arr)) arr.forEach(function (k) { const v = String(k).trim(); if (v) openrouter.push(v); });
    } catch (e) {}
  }
  if (sp.getProperty('OPENROUTER_API_KEY')) openrouter.push(sp.getProperty('OPENROUTER_API_KEY'));

  return { gemini: dedupeArr_(gemini), openrouter: dedupeArr_(openrouter) };
}

function dedupeArr_(arr) {
  const seen = {};
  return arr.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; });
}

// ============================================================
// DETEKSI OTOMATIS MODEL AKTIF
// ============================================================
// Memanggil endpoint "list models" setiap provider yang punya key. Hasil di-cache
// 6 jam. Mengembalikan map { modelId: provider }.
function detectAvailableModels_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(AI_MODEL_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }

  const keys = getAIKeys_();
  const active = {};

  // Gemini
  keys.gemini.forEach(function (key) {
    try {
      const resp = UrlFetchApp.fetch(AI_PROVIDERS.GEMINI.listUrl() + '?key=' + encodeURIComponent(key), { muteHttpExceptions: true });
      if (resp.getResponseCode() === 200) {
        AI_PROVIDERS.GEMINI.parseList(JSON.parse(resp.getContentText()))
          .forEach(function (id) { if (!(id in active)) active[id] = 'GEMINI'; });
        // cukup 1 key berhasil → stop
        return true;
      }
    } catch (e) {}
    return false;
  });

  // OpenRouter
  keys.openrouter.forEach(function (key) {
    try {
      const resp = UrlFetchApp.fetch(AI_PROVIDERS.OPENROUTER.listUrl(), {
        muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + key }
      });
      if (resp.getResponseCode() === 200) {
        AI_PROVIDERS.OPENROUTER.parseList(JSON.parse(resp.getContentText()))
          .forEach(function (id) { if (!(id in active)) active[id] = 'OPENROUTER'; });
        return true;
      }
    } catch (e) {}
    return false;
  });

  try { cache.put(AI_MODEL_CACHE_KEY, JSON.stringify(active), AI_MODEL_CACHE_TTL); } catch (e) {}
  return active;
}

// Model aktif dari semua provider yang cocok dengan kebutuhan, urut preferensi katalog.
function getAvailableModels_(kebutuhan) {
  const active = detectAvailableModels_();
  const urutan = {};
  AI_MODEL_CATALOG.forEach(function (m, i) { urutan[m.id] = i; });
  return AI_MODEL_CATALOG
    .filter(function (m) {
      return m.needs.indexOf(kebutuhan) !== -1 && active[m.id] !== undefined;
    })
    .sort(function (a, b) { return (urutan[a.id] || 999) - (urutan[b.id] || 999); });
}

// Round-robin MODEL: memutar index model awal per panggilan (per kebutuhan) supaya
// semua model aktif terpakai merata. State ScriptProperties (lock aman).
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

// Round-robin KEY per provider (pakai ScriptProperties + lock, aman multi-execution)
function getNextKeyIndexAndAdvance_(propKey, totalKeys) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const props = PropertiesService.getScriptProperties();
    let idx = parseInt(props.getProperty(propKey) || '0', 10);
    if (isNaN(idx) || idx < 0) idx = 0;
    const current = idx % totalKeys;
    props.setProperty(propKey, String((idx + 1) % totalKeys));
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
  const keys = getAIKeys_().gemini;
  if (!keys.length) throw new Error('GEMINI_API_KEY tidak dikonfigurasi.');

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const startIdx = getNextKeyIndexAndAdvance_('GEMINI_KEY_RR_IDX', keys.length);
  let lastError = null;

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const keyIdx = (startIdx + attempt) % keys.length;
    const apiKey = keys[keyIdx];
    const keyLabel = 'Key#' + (keyIdx + 1) + '/' + keys.length;
    const url = AI_PROVIDERS.GEMINI.callUrl(model) + '?key=' + encodeURIComponent(apiKey);

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

// Panggil OpenRouter (OpenAI-compatible /chat/completions) dengan round-robin key.
function callOpenRouter_(modelId, payload, logLabel) {
  const keys = getAIKeys_().openrouter;
  if (!keys.length) throw new Error('OPENROUTER_API_KEY tidak dikonfigurasi.');

  const startIdx = getNextKeyIndexAndAdvance_('OPENROUTER_KEY_RR_IDX', keys.length);
  let lastError = null;

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const keyIdx = (startIdx + attempt) % keys.length;
    const apiKey = keys[keyIdx];
    const keyLabel = 'Key#' + (keyIdx + 1) + '/' + keys.length;

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    let response;
    try {
      response = UrlFetchApp.fetch(AI_PROVIDERS.OPENROUTER.callUrl(), options);
    } catch (e) {
      lastError = e;
      continue;
    }

    const statusCode = response.getResponseCode();
    if (statusCode === 200) return response;

    const bodyText = response.getContentText();
    // OpenRouter: 429 rate limit / 400 context_length_exceeded → coba key lain
    if (statusCode === 429 || (statusCode === 400 && bodyText.indexOf('context_length_exceeded') !== -1)) {
      lastError = new Error(keyLabel + ' kena rate limit/kuota habis');
      continue;
    }
    lastError = new Error(keyLabel + ' status ' + statusCode + ': ' + bodyText);
  }

  throw lastError || new Error('Semua API key OpenRouter gagal untuk model ' + modelId);
}

// Konversi payload Gemini (contents + generationConfig) → OpenAI-compatible (OpenRouter).
function toOpenRouterPayload_(payload) {
  const out = { model: undefined, messages: [], temperature: 0.3, max_tokens: 1024 };
  if (payload.generationConfig) {
    if (payload.generationConfig.temperature !== undefined) out.temperature = payload.generationConfig.temperature;
    if (payload.generationConfig.maxOutputTokens !== undefined) out.max_tokens = payload.generationConfig.maxOutputTokens;
  }
  const contents = payload.contents || [];
  contents.forEach(function (c) {
    const role = (c.role === 'model') ? 'assistant' : 'user';
    const content = [];
    (c.parts || []).forEach(function (p) {
      if (p.text !== undefined) {
        content.push({ type: 'text', text: p.text });
      } else if (p.inline_data) {
        // Image → data URL (OpenAI format)
        content.push({ type: 'image_url', image_url: { url: 'data:' + (p.inline_data.mime_type || 'image/jpeg') + ';base64,' + p.inline_data.data } });
      }
    });
    if (content.length) out.messages.push({ role: role, content: content });
  });
  // Minta output JSON bila provider/modal butuh (opsional, tidak semua model dukung response_format)
  if (payload.generationConfig && payload.generationConfig.responseMimeType === 'application/json') {
    out.response_format = { type: 'json_object' };
  }
  return out;
}

// Panggil model via provider-nya (dipakai dari loop model round-robin).
function callAIModel_(modelEntry, payload, logLabel) {
  if (modelEntry.provider === 'OPENROUTER') {
    const orPayload = toOpenRouterPayload_(payload);
    orPayload.model = modelEntry.id;
    return callOpenRouter_(modelEntry.id, orPayload, logLabel);
  }
  return callGeminiGenerateContent_(modelEntry.id, payload, logLabel);
}

// Ambil teks dari response tiap provider (Gemini: candidates/parts, OpenRouter: choices/message).
function parseAIContent_(modelEntry, response) {
  const json = JSON.parse(response.getContentText());
  if (modelEntry.provider === 'OPENROUTER') {
    const choice = json.choices && json.choices[0];
    const msg = choice && choice.message;
    return (msg && String(msg.content || '')) || '';
  }
  const candidate = json.candidates && json.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  return (parts || []).map(function (p) { return p.text || ''; }).join('').trim();
}

// Helper: jalankan round-robin model untuk suatu kebutuhan sampai berhasil.
// cbText(jsonText) dipanggil utk tiap model yang berhasil → return object hasil atau
// undefined/throw untuk lanjut ke model berikutnya. Mengembalikan {hasil} pada sukses.
// ops.rotate=true (default) → mulai dari model acak (round-robin); false → selalu urut
// katalog (model terkuat/pertama dulu) agar latensi konsisten & prediktabbel.
function callModelRoundRobin_(kebutuhan, payload, logLabel, cbParse, ops) {
  const opts = ops || {};
  const modelRoute = getAvailableModels_(kebutuhan);
  if (!modelRoute.length) throw new Error('Tidak ada model aktif untuk kebutuhan ' + kebutuhan + '. Pastikan API key terisi.');

  const startModelIdx = opts.rotate === false
    ? 0
    : getNextModelIndexAndAdvance_(kebutuhan, modelRoute.length);
  let lastError = null;

  for (let i = 0; i < modelRoute.length; i++) {
    const entry = modelRoute[(startModelIdx + i) % modelRoute.length];
    let response;
    try {
      response = callAIModel_(entry, payload, logLabel + ' [' + entry.provider + ':' + entry.id + ']');
    } catch (e) {
      lastError = e;
      continue;
    }
    const text = parseAIContent_(entry, response);
    if (!text) {
      lastError = new Error('Output kosong');
      continue;
    }
    try {
      return cbParse(text, entry);
    } catch (e) {
      lastError = e;
      continue;
    }
  }

  throw new Error('Semua model gagal. Error terakhir: ' + (lastError ? lastError.message : 'unknown'));
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
    '6. metodePembayaranTerdeteksi: metode pembayaran ("" kalau tidak ada)\n\n' +
    'Jawab HANYA dengan objek JSON (tanpa teks lain, tanpa markdown): {"tanggal": "...", "sumber": "...", "kategori": "...", "keterangan": "...", "nominal": 0, "metodePembayaranTerdeteksi": "..."}';

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

  return callModelRoundRobin_('OCR_STRUK', payload, 'OCR', function (jsonText) {
    return JSON.parse(bersihkanMarkdownJson_(jsonText));
  });
}

// Beberapa model (terutama via OpenRouter) membungkus JSON dengan ```json ... ```.
function bersihkanMarkdownJson_(text) {
  let t = String(text || '').trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m && m[1]) t = m[1].trim();
  // Hapus teks sebelum '{' atau setelah '}' terakhir kalau model nambahin komentar
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end > start) t = t.slice(start, end + 1);
  return t;
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

/**
 * FINGERPRINT DATA TRANSAKSI: lastRow + ID baris terakhir sheet Transaksi & MutasiLog.
 * Murah (hanya baca beberapa sel) tapi peka terhadap tambah/edit/hapus lewat jalur
 * manapun -> dipakai utk memutuskan apakah rekomendasi AI perlu di-generate ulang.
 */
function dataFingerprint_() {
  try {
    const tx = getTransaksiSheet_();
    const lrTx = tx.getLastRow();
    const idTx = lrTx > 1 ? String(tx.getRange(lrTx, 1).getDisplayValue()) : '';
    let lrLog = 0, idLog = '';
    try {
      const log = tx.getParent().getSheetByName('MutasiLog');
      if (log) {
        lrLog = log.getLastRow();
        idLog = lrLog > 1 ? String(log.getRange(lrLog, 1).getDisplayValue()) : '';
      }
    } catch (e2) {}
    return lrTx + '|' + idTx + '|' + lrLog + '|' + idLog;
  } catch (e) {
    return 'fp-err-' + new Date().getTime(); // gagal baca -> anggap berubah (regenerate)
  }
}

function getRekomendasiKeuanganServer(mode, bulan, tahun) {
  const now = new Date();
  const modeAktif = (mode === 'tahunan') ? 'tahunan' : 'bulanan';
  const bulanAktif = (bulan === undefined || bulan === null || bulan === '') ? now.getMonth() : Number(bulan);
  const tahunAktif = (tahun === undefined || tahun === null || tahun === '') ? now.getFullYear() : Number(tahun);
  const labelPeriode = modeAktif === 'tahunan' ? ('Tahun ' + tahunAktif) : (BULAN_NAMA[bulanAktif] + ' ' + tahunAktif);

  // CACHE TAHAN LAMA + FINGERPRINT: rekomendasi hanya di-generate ulang saat data
  // transaksi/mutasi BERUBAH (fingerprint beda). Sama = balas instan tanpa panggil AI.
  // (Sebelumnya TTL cuma 60 detik -> hampir selalu regenerate & boros kuota AI.)
  const fp = dataFingerprint_();
  const cacheKey = 'rekomendasiAI_v5_' + modeAktif + '_' + bulanAktif + '_' + tahunAktif;
  const cache = CacheService.getUserCache();
  const cachedRaw = cache.get(cacheKey);
  if (cachedRaw) {
    try {
      const parsed = JSON.parse(cachedRaw);
      if (parsed && parsed.fp === fp && parsed.hasil) return parsed.hasil;
    } catch (e) {}
  }

  const stats = getStatistikPeriodeServer(modeAktif, bulanAktif, tahunAktif);

  if (stats.pemasukan === 0 && stats.pengeluaran === 0) {
    const hasilKosong = {
      rekomendasi: 'Belum ada transaksi untuk periode ' + labelPeriode + '.'
    };
    try { cache.put(cacheKey, JSON.stringify({ fp: fp, hasil: hasilKosong }), 600); } catch (e) {}
    return hasilKosong;
  }

  const daftarKategoriText = (stats.categories && stats.categories.length)
    ? stats.categories.map(function (k) { return k.kategori + ': Rp ' + k.total; }).join(', ')
    : '(tidak ada)';

  const prompt = 'Kamu adalah perencana keuangan profesional dan analis data. ' +
    'Tugasmu: analisis data keuangan periode ' + labelPeriode + ' lalu berikan rekomendasi yang jelas, spesifik, dan bisa langsung dipraktikkan.\n\n' +
    'DATA PERIODE INI:\n' +
    '- Pemasukan: Rp ' + stats.pemasukan + '\n' +
    '- Pengeluaran: Rp ' + stats.pengeluaran + '\n' +
    '- Sisa (selisih): Rp ' + (stats.pemasukan - stats.pengeluaran) + '\n' +
    '- Rincian per kategori: ' + daftarKategoriText + '\n\n' +
    'ATURAN PENTING:\n' +
    '1. Hanya gunakan data yang diberikan. Jangan menebak angka, jangan menyebut "Persembahan", "sedekah", atau kategori yang TIDAK ADA di rincian.\n' +
    '2. Keluarkan TIGA bagian persis dengan label berikut (pakai plain text, TANPA markdown, tanpa **, tanpa *, tanpa ##, tanpa bullet selain "-"):\n\n' +
    'KONDISI: [1-2 kalimat ringkas tentang kondisi keuangan: hitung persentase sisa terhadap pemasukan, dan sebut kategori terbesar]\n' +
    'HEMAT DI SINI:\n- [poin saran hemat paling berdampak, sebut kategori & perkiraan nominal]\n- [poin berikutnya]\n- [maksimal 3 poin]\n' +
    'PRIORITAS ALOKASI:\n- [prioritas paling penting pertama]\n- [prioritas berikutnya]\n- [maksimal 3 poin]\n\n' +
    'CONTOH YANG BENAR:\n' +
    'KONDISI: Kondisi keuangan sehat, sisa 35% dari pemasukan. Pengeluaran terbesar ada di kategori Makanan sebesar Rp 1.200.000.\n' +
    'HEMAT DI SINI:\n- Kurangi jajan di luar untuk kategori Makanan, potensi hemat sekitar Rp 200.000/bulan.\n' +
    'PRIORITAS ALOKASI:\n- Alokasikan Rp 400.000 ke dana darurat.\n\n' +
    'Jangan menulis apa pun di luar tiga bagian tersebut. Keluarkan persis dengan format contoh.';

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 700,
      // Matikan extended thinking Gemini → respons jauh lebih cepat (latensi ~1-2 dtk).
      // Field ini hanya dibaca untuk provider Gemini; diabaikan OpenRouter.
      thinkingConfig: { thinkingBudget: 0 }
    }
  };

  const hasil = callModelRoundRobin_('REKOMENDASI_AI', payload, 'Rekomendasi', function (text) {
    const t = String(text || '').trim();
    // Validasi kualitas: tolak output yang terpotong / terlalu pendek / tidak punya
    // bagian yang diminta → dianggap gagal, lanjut ke model berikutnya.
    if (t.length < 120) throw new Error('Output terlalu pendek/terpotong (' + t.length + ' char)');
    const adaKondisi = t.indexOf('KONDISI') !== -1;
    const adaHemat = t.indexOf('HEMAT DI SINI') !== -1;
    const adaPrioritas = t.indexOf('PRIORITAS ALOKASI') !== -1;
    if (!adaKondisi && !(adaHemat && adaPrioritas)) throw new Error('Format output tidak sesuai (KONDISI/HEMAT/PRIORITAS)');
    return { rekomendasi: t };
  }, { rotate: false });
  try { cache.put(cacheKey, JSON.stringify({ fp: fp, hasil: hasil }), 21600); } catch (e) {}
  return hasil;
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
 * Terima array key dalam bentuk:
 *   - [{ k: 'AIza...', p: 'gemini' | 'openrouter' }, ...]  (multi-provider)
 *   - ['AIza...', ...]  (legacy, dianggap Gemini)
 * @param {Array|string} keys
 * @return {string} pesan sukses.
 */
function setUserGeminiApiKeys(keys) {
  if (!keys) throw new Error('Parameter keys diperlukan.');
  const arr = Array.isArray(keys) ? keys : String(keys).split(',');
  const cleaned = arr.map(function (item) {
    const isObj = item !== null && typeof item === 'object';
    return {
      k: String(isObj ? item.k : item).trim(),
      p: (isObj && item.p === 'openrouter') ? 'openrouter' : 'gemini'
    };
  }).filter(function (o) { return o.k; });
  if (!cleaned.length) throw new Error('Tidak ada API key valid.');
  PropertiesService.getUserProperties().setProperty('MYDUIT_AI_KEYS', JSON.stringify(cleaned));
  // Hapus single key lama kalau ada
  PropertiesService.getUserProperties().deleteProperty('MYDUIT_AI_KEY');
  // Model yang aktif berubah → buang cache deteksi model biar di-refresh saat pemakaian
  try { CacheService.getScriptCache().remove(AI_MODEL_CACHE_KEY); } catch (e) {}
  return 'Tersimpan ' + cleaned.length + ' API key (Gemini/OpenRouter).';
}

/**
 * Cek status API key user (multi-provider).
 * @return {{exists: boolean, count: number, source: string, dismissed: boolean,
 *           providers: {gemini: number, openrouter: number}}}
 */
function getUserGeminiApiKeysStatus() {
  const userProps = PropertiesService.getUserProperties();
  const dismissed = userProps.getProperty('AI_ONBOARDING_DISMISSED') === '1';

  const keys = getAIKeys_();
  const total = keys.gemini.length + keys.openrouter.length;

  if (total > 0) {
    return {
      exists: true,
      count: total,
      source: 'user',
      dismissed: false,
      providers: { gemini: keys.gemini.length, openrouter: keys.openrouter.length }
    };
  }
  return { exists: false, count: 0, source: 'none', dismissed: dismissed, providers: { gemini: 0, openrouter: 0 } };
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

/**
 * TIPS HARIAN (kartu sidebar tab Statistik) � dibuat oleh AI SEKALI PER HARI
 * berdasarkan evaluasi transaksi KEMARIN, lalu disimpan seharian penuh supaya
 * tidak ada prompt ulang (hemat kuota/request API).
 *
 * Penyimpanan: UserProperties (bukan CacheService � TTL CacheService maks 6 jam,
 * tidak cukup untuk "selama sehari"). Key: tipsHarian_v1 = {tanggal, tips}.
 * Fallback: jika belum ada API key / semua model gagal / tidak ada transaksi
 * kemarin -> kembalikan tips:'' dan client memakai pool tips statis.
 */
function getTipsHarianServer() {
  try {
    const tz = Session.getScriptTimeZone();
    const fmtDay = function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
    const now = new Date();
    const todayStr = fmtDay(now);
    const kemarin = new Date(now.getTime() - 86400000);
    const kemarinStr = fmtDay(kemarin);

    // 1) Sudah ada tips untuk HARI INI? -> pakai tanpa panggil AI sama sekali
    const props = PropertiesService.getUserProperties();
    const stored = props.getProperty('tipsHarian_v1');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.tanggal === todayStr && parsed.tips) {
          return { status: 'success', tips: parsed.tips, sumber: 'cache-harian' };
        }
      } catch (e) {}
    }

    // 2) Kumpulkan ringkasan transaksi KEMARIN (evaluasi kondisi sebelumnya)
    const sheet = getTransaksiSheet_();
    const lastRow = sheet.getLastRow();
    let masuk = 0, keluar = 0, jml = 0;
    const katMap = {};
    if (lastRow >= 2) {
      const raw = getRawTransaksiCached_(sheet);
      raw.forEach(function (row) {
        const tgl = parseSheetDate(row[1]);
        if (!tgl || fmtDay(tgl) !== kemarinStr) return;
        const jenis = String(row[2] || '').trim().toLowerCase();
        if (jenis === 'pindah saldo') return;
        const nominal = Number(row[8]) || 0;
        jml += 1;
        if (jenis === 'pemasukan') { masuk += nominal; return; }
        keluar += nominal;
        const kat = getKategoriTampilFromStored_(row[3]) || 'Lainnya';
        katMap[kat] = (katMap[kat] || 0) + nominal;
      });
    }

    // Tidak ada aktivitas kemarin -> tidak perlu AI; biarkan client pakai tips statis
    if (jml === 0) return { status: 'success', tips: '', sumber: 'tanpa-data' };

    const katTop = Object.keys(katMap).sort(function (a, b) { return katMap[b] - katMap[a]; })[0] || '-';

    // 3) Prompt RINGKAS & TO THE POINT (output 1 kalimat pendek saja)
    const prompt =
      'Kamu asisten keuangan aplikasi MyDuit.\n' +
      'DATA TRANSAKSI KEMARIN (' + kemarinStr + '):\n' +
      '- Pemasukan: Rp ' + masuk.toLocaleString('id-ID') + '\n' +
      '- Pengeluaran: Rp ' + keluar.toLocaleString('id-ID') + ' (' + jml + ' transaksi)\n' +
      '- Kategori pengeluaran terbesar: ' + katTop + '\n\n' +
      'Beri SATU tips keuangan praktis untuk HARI INI berdasarkan pola kemarin.\n' +
      'ATURAN KERAS:\n' +
      '- MAKSIMAL 20 kata, Bahasa Indonesia santai.\n' +
      '- Satu kalimat langsung, TANPA emoji, TANPA sapaan, TANPA markdown/bullet.\n' +
      '- Spesifik merujuk data di atas (sebut kategori/nominal bila relevan).\n' +
      'Contoh bentuk: Kurangi jajan di kantin hari ini, alokasikan Rp20rb untuk tabungan.\n' +
      'Jawab HANYA kalimat tips itu.';

    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 80,
        thinkingConfig: { thinkingBudget: 0 }
      }
    };

    const hasil = callModelRoundRobin_('REKOMENDASI_AI', payload, 'Tips Harian', function (text) {
      let t = String(text || '').trim()
        .replace(/^["'\u201C\u201D]+|["'\u201C\u201D]+$/g, '')   // buang kutip pembungkus
        .replace(/\s+/g, ' ');
      if (t.length < 15) throw new Error('Output terlalu pendek (' + t.length + ' char)');
      if (t.length > 220) t = t.slice(0, 217).trim() + '...';
      return t;
    }, { rotate: false });

    const tipsFinal = (typeof hasil === 'string') ? hasil : ((hasil && hasil.rekomendasi) || '');
    if (!tipsFinal) throw new Error('Tips kosong');

    // 4) Simpan seharian penuh -> besok baru regenerate
    try { props.setProperty('tipsHarian_v1', JSON.stringify({ tanggal: todayStr, tips: tipsFinal })); } catch (e) {}
    try { CacheService.getUserCache().put('tipsHarian_v1_today', tipsFinal, 300); } catch (e) {}

    return { status: 'success', tips: tipsFinal, sumber: 'ai' };
  } catch (err) {
    // Gagal (API key belum ada / kuota habis / dsb.) -> client pakai pool statis
    return { status: 'success', tips: '', sumber: 'fallback', pesan: err.message };
  }
}
