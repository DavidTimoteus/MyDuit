// Runner uji render ClayCombobox/ClaySelect (JSX; clay-ui mengimpor CSS
// lewat rantai modul -> bundel dulu dengan esbuild).
//
// Jalankan: node src/components/clayAria.test.mjs
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const keluar = path.resolve('node_modules/.myduit-test')
const hasil = path.join(keluar, 'clay.aria.test.bundle.mjs')

await build({
  entryPoints: [path.resolve('src/components/clayAria.test.jsx')],
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
