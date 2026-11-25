// Runner uji laporan (laporan.js mengimpor firebase + firebase.js yang
// membaca import.meta.env -> bundel dulu dengan esbuild, pola render test).
//
// Jalankan: node src/features/laporan/laporan.test.mjs
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const keluar = path.resolve('node_modules/.myduit-test')
const hasil = path.join(keluar, 'laporan.test.bundle.mjs')

await build({
  entryPoints: [path.resolve('src/features/laporan/laporan.test.jsx')],
  bundle: true,
  external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/server', 'firebase', 'firebase/*'],
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  define: { 'import.meta.env': '{}' },
  loader: { '.css': 'empty' },
  outfile: hasil,
  logLevel: 'warning',
})

await import(pathToFileURL(hasil).href)
