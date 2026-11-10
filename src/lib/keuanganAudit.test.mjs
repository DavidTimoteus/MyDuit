// Runner uji audit keamanan, integritas CRUD, dan perhitungan finansial.
// Jalankan via: node src/lib/keuanganAudit.test.mjs
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const keluar = path.resolve('node_modules/.myduit-test')
const hasil = path.join(keluar, 'keuanganAudit.bundle.mjs')

await build({
  entryPoints: [path.resolve('src/lib/keuanganAudit.suite.js')],
  bundle: true,
  external: ['firebase', 'firebase/*', 'xlsx'],
  format: 'esm',
  platform: 'node',
  define: { 'import.meta.env': '{}' },
  outfile: hasil,
  logLevel: 'warning',
})

await import(pathToFileURL(hasil).href)

