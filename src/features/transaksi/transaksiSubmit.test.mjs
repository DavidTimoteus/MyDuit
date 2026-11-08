// Runner uji submit transaksi & render FormTransaksiModal (JSX + esbuild)
// Jalankan via: node src/features/transaksi/transaksiSubmit.test.mjs
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const keluar = path.resolve('node_modules/.myduit-test')
const hasil = path.join(keluar, 'transaksiSubmit.test.bundle.mjs')

await build({
  entryPoints: [path.resolve('src/features/transaksi/transaksiSubmit.test.jsx')],
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
