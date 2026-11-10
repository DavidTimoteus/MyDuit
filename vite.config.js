import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

import { fileURLToPath } from 'node:url'

// Path absolut ke stub kosong (lihat resolve.alias di bawah).
const emptyStub = fileURLToPath(new URL('./src/lib/empty-stub.js', import.meta.url))

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: true,
  },
  build: {
    // Pisah vendor besar supaya browser bisa cache-nya terpisah dari kode app.
    // Tanpa ini, satu deploy baru membatalkan seluruh cache dan user mengunduh
    // ulang >1MB — hal yang paling terasa di jaringan seluler.
    rollupOptions: {
      output: {
        // Hanya lib besar yang dipisah eksplisit. Sisanya dikembalikan
        // undefined supaya Rollup memakai pemisahan alaminya — penting karena
        // catch-all `return 'vendor'` justru menelan jspdf ke chunk awal
        // (terbukti: chunk vendor membengkak jadi 830 kB) dan membatalkan
        // efek lazy-load yang sudah dibangun.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          // React + ReactDOM jarang berubah: pisahkan agar cache browser tidak
          // batal tiap kali kode app diedit (dan sebaliknya).
          if (id.includes('/react-dom/') || id.includes('/react/') ||
              id.includes('/scheduler/')) return 'vendor-react'
          if (id.includes('chart.js')) return 'vendor-chart'
          if (id.includes('xlsx')) return 'vendor-xlsx'
          if (id.includes('firebase') || id.includes('@firebase')) return 'vendor-firebase'
          // undefined = serahkan ke Rollup (jspdf tetap di chunk lazy-nya).
          return undefined
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  resolve: {
    // jsPDF mengimpor html2canvas/canvg/dompurify lewat dynamic import
    // BER-VARIABEL: `import(i.html2canvas)`. Rollup tidak bisa menganalisis
    // bentuk seperti itu, jadi ia membundel ketiganya apa adanya — padahal
    // laporan MyDuit digambar sepenuhnya sebagai vektor dan tidak pernah
    // memanggilnya. Akibatnya user mengunduh ~800KB mati, bahkan di halaman
    // login (Vite men-preload chunk-nya di index.html). Alias ke stub kosong
    // memutus rantai itu; jsPDF hanya memanggilnya kalau ada ForeignObject,
    // yang tidak pernah terjadi di sini.
    alias: [
      { find: /^html2canvas$/, replacement: emptyStub },
      { find: /^canvg$/, replacement: emptyStub },
      { find: /^dompurify$/, replacement: emptyStub },
    ],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        id: '/',
        name: 'MyDuit — Catatan Keuangan',
        short_name: 'MyDuit',
        description: 'Catat, pantau, dan kendalikan keuangan pribadi. Offline-first.',
        lang: 'id',
        dir: 'ltr',
        theme_color: '#f8faf9',
        background_color: '#1B4332',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache HANYA aset yang dibutuhkan untuk membuka app: HTML, CSS,
        // bundel utama, dan ikon. Chunk besar (pdf/xlsx/chart/firebase) sengaja
        // TIDAK diprecache: semuanya sudah lazy, dan memprecache-nya membuat
        // setiap kunjungan mengunduh >2MB sebelum app bisa dipakai — justru
        // mematikan alasan utama PWA ini ada (dipakai offline di HP).
        // Chunk yang sudah terunduh tetap tersimpan di HTTP cache biasa dan
        // service worker runtime-cache saat benar-benar dibuka.
        globPatterns: [
          'index.html',
          'boot.js',
          'manifest.webmanifest',
          'registerSW.js',
          'assets/*.js',
          'assets/*.css',
          'icons/*.png',
          'favicon.svg',
        ],
        globIgnores: [
          '**/vendor-xlsx-*.js',
          '**/jspdf*.js',
          '**/autotable*.js',
          '**/purify*.js',
          '**/html2canvas*.js',
        ],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        // Chunk lazy yang dibuka saat runtime disimpan di cache ini supaya
        // kunjungan berikutnya tidak perlu unduh ulang.
        runtimeCaching: [
          {
            urlPattern: /\/assets\/.*\.(?:js|css)$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'myduit-lazy-chunks',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          // Aset OCR (Tesseract): worker, WASM core, dan model bahasa (ind/eng)
          // diunduh dari CDN jsdelivr. Di-cache agar pemakaian KEDUA dan
          // seterusnya berjalan offline — konsisten dengan janji offline-first
          // app. CacheFirst karena aset ini berversi (URL mengandung versi) dan
          // tidak akan berubah.
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/(?:tesseract\.js|tesseract\.js-core|@tesseract\.js-data)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'myduit-ocr-assets',
              // Model bahasa ~10-15MB per bahasa + core WASM ~4MB.
              expiration: { maxEntries: 24, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
})