// Runner uji render StatistikView (JSX + import.meta.env dari firebase.js
// tidak bisa dibaca Node mentah -> bundel dulu dengan esbuild, pola sama
// dengan chipRowMobile.test.mjs dan render.test.mjs).
//
// Jalankan: node src/features/statistik/statistikRender.test.mjs
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const keluar = path.resolve('node_modules/.myduit-test')
const hasil = path.join(keluar, 'statistik.render.test.bundle.mjs')

await build({
  entryPoints: [path.resolve('src/features/statistik/statistikRender.test.jsx')],
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
