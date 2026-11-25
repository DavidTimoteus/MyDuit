// Kontrak bundle awal Fase 5 re-audit (R-01): halaman login TIDAK BOLEH
// membayar Firestore 577 kB. Satu-satunya yang boleh masuk bundel awal
// adalah Firebase App + Auth; Firestore (dan db.js yang membawanya) hanya
// boleh dimuat SETELAH user ada, lewat dynamic import / React.lazy.
//
// Tes ini statis (membaca impor di berkas sumber) — bukti ukuran sebenarnya
// diukur dari hasil `npm run build` (dist/index.html tidak boleh me-preload
// vendor-firebase-firestore; chunk entry tidak boleh memuat db.js).
// Jalankan: node src/lib/bundleAwal.test.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const baca = (rel) => readFileSync(join(SRC, rel), 'utf8')

// Impor statis saja (baris `import ... from '...'` / `import '...'`).
// Dynamic import('...') di dalam efek/handler BOLEH — itu justru jalurnya.
function imporStatis(sumber) {
  const keluar = []
  for (const m of sumber.matchAll(/^import\s+(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"]/gm)) {
    keluar.push(m[1])
  }
  return keluar
}

function dilarang(isi) {
  return isi.some(
    (s) =>
      s === 'firebase/firestore' ||
      s.startsWith('firebase/firestore/') ||
      s.endsWith('/lib/db.js') ||
      s === './lib/db.js' ||
      s.endsWith('/lib/firebase.js') ||
      s === './lib/firebase.js',
  )
}

const JALUR_LOGIN = ['App.jsx', 'features/auth/useAuth.js', 'components/AuthScreen.jsx', 'main.jsx', 'components/ErrorBoundary.jsx']
for (const rel of JALUR_LOGIN) {
  const isi = baca(rel)
  const statis = imporStatis(isi)
  assert.ok(
    !dilarang(statis),
    `${rel} masih mengimpor Firestore/db.js secara statis: ${statis.filter((s) => dilarang([s])).join(', ')}`,
  )
  console.log(`  ok    ${rel}: tanpa impor statis Firestore/db.js`)
}

// Modul auth-only harus ada dan bersih dari Firestore sepenuhnya.
// (Komentar boleh menyebut nama paketnya — yang dilarang adalah impor.)
const appPath = join(SRC, 'lib/firebaseApp.js')
assert.ok(existsSync(appPath), 'src/lib/firebaseApp.js tidak ada')
const appSrc = readFileSync(appPath, 'utf8')
const appTanpaKomentar = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
assert.ok(!appTanpaKomentar.includes('firebase/firestore'), 'firebaseApp.js masih mengimpor firebase/firestore')
assert.ok(!imporStatis(appTanpaKomentar).some((s) => s.startsWith('firebase/firestore')), 'firebaseApp.js masih mengimpor firebase/firestore')
assert.ok(appSrc.includes('export function getFirebaseApp'), 'firebaseApp.js harus mengekspor getFirebaseApp')
assert.ok(appSrc.includes('export function isFirebaseConfigured'), 'firebaseApp.js harus mengekspor isFirebaseConfigured')
assert.ok(appSrc.includes('export const googleProvider'), 'firebaseApp.js harus mengekspor googleProvider')
console.log('  ok    lib/firebaseApp.js: auth-only, tanpa Firestore')

// Jalur login memakai modul auth-only.
const appJsx = baca('App.jsx')
assert.ok(appJsx.includes("from './lib/firebaseApp.js'"), 'App.jsx harus mengimpor dari ./lib/firebaseApp.js')
assert.ok(baca('features/auth/useAuth.js').includes("from '../../lib/firebaseApp.js'"), 'useAuth.js harus mengimpor dari firebaseApp.js')
assert.ok(baca('components/AuthScreen.jsx').includes("from '../lib/firebaseApp.js'"), 'AuthScreen.jsx harus mengimpor dari firebaseApp.js')
console.log('  ok    jalur login memakai firebaseApp.js')

// Jalur malasnya benar-benar ada: db.js + firebase.js + provider via lazy.
assert.ok(appJsx.includes("import('./lib/db.js')"), 'App.jsx harus memuat db.js secara dinamis')
assert.ok(appJsx.includes("import('./lib/firebase.js')"), 'App.jsx harus memuat firebase.js secara dinamis (isolasi UID / lupa PIN)')
assert.ok(
  appJsx.includes("lazy(() => import('./lib/AkunKategoriProvider.jsx'))"),
  'App.jsx harus memuat AkunKategoriProvider lewat React.lazy',
)
console.log('  ok    App.jsx: db.js + firebase.js + AkunKategoriProvider dimuat malas')

// API pasca-login tetap utuh di firebase.js.
const fb = baca('lib/firebase.js')
assert.ok(fb.includes('export function getFirebase'), 'firebase.js harus tetap mengekspor getFirebase')
assert.ok(fb.includes('export async function hapusCacheFirestoreLokal'), 'firebase.js harus tetap mengekspor hapusCacheFirestoreLokal')
console.log('  ok    lib/firebase.js: API pasca-login utuh')

console.log('bundleAwal: OK')
