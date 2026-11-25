// Kontrak kamus i18n Fase 4 re-audit (R-01/R-02): setiap kunci yang dipakai
// tr()/t() di JSX/JS harus ada di KAMUS.id DAN KAMUS.en. Kelas bug yang
// sama dengan chip kosong: kunci hilang dikembalikan mentah sebagai teks
// (t() mengembalikan key-nya sendiri) tanpa ada yang protes.
// Hanya literal string statis yang diperiksa; kunci dinamis (template /
// variabel) tidak bisa diperiksa statis dan dikecualikan.
// Jalankan: node src/lib/i18nKunci.test.mjs
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const _store = {}
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v) },
  removeItem: (k) => { delete _store[k] },
}
globalThis.CustomEvent = function CustomEvent(type, init) {
  return { type, detail: init?.detail }
}
globalThis.window = { dispatchEvent: () => true, CustomEvent: globalThis.CustomEvent }

const { KAMUS, simpanBahasa, t } = await import('./i18n.js')

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const POLA = /\b(?:tr|t)\(\s*['"]([A-Za-z0-9_]+)['"]/g

function jalan(dir, keluar = []) {
  for (const entri of readdirSync(dir)) {
    const p = join(dir, entri)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (entri === 'node_modules' || entri === 'dist') continue
      jalan(p, keluar)
    } else if ((p.endsWith('.js') || p.endsWith('.jsx')) && !p.includes('.test.')) {
      keluar.push(p)
    }
  }
  return keluar
}

const dipakai = new Map() // kunci -> file pertama yang memakai
for (const file of jalan(SRC)) {
  // i18n.js sendiri adalah definisi kamus, bukan pemakai.
  if (file.endsWith('/lib/i18n.js')) continue
  const isi = readFileSync(file, 'utf8')
  for (const m of isi.matchAll(POLA)) {
    if (!dipakai.has(m[1])) dipakai.set(m[1], file.replace(SRC + '/', ''))
  }
}

const hilangId = []
const hilangEn = []
for (const [kunci, file] of [...dipakai.entries()].sort()) {
  if (!(kunci in KAMUS.id)) hilangId.push(`${kunci} (dipakai di ${file})`)
  if (!(kunci in KAMUS.en)) hilangEn.push(`${kunci} (dipakai di ${file})`)
}

console.log(`  kunci dipakai di src: ${dipakai.size}`)
assert.deepEqual(hilangId, [], `Kunci hilang di kamus ID:\n- ${hilangId.join('\n- ')}`)
assert.deepEqual(hilangEn, [], `Kunci hilang di kamus EN:\n- ${hilangEn.join('\n- ')}`)
console.log('  ok - semua kunci tr()/t() ada di kamus ID dan EN')

// R-01: kunci hampir_limit_persen harus menerjemahkan + menginterpolasi {persen}.
simpanBahasa('id')
assert.equal(t('hampir_limit_persen', { persen: 85 }), 'hampir mencapai limit (85%)')
simpanBahasa('en')
assert.equal(t('hampir_limit_persen', { persen: 85 }), 'is nearing its limit (85%)')
console.log('  ok - hampir_limit_persen menerjemahkan + menginterpolasi {persen}')
simpanBahasa('id')

console.log('i18nKunci: OK')
