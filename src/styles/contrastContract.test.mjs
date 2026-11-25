// src/styles/contrastContract.test.mjs
// Kontrak kontras WCAG 2.2 AA untuk pasangan warna yang diperbaiki audit 25 Nov 2026.
// Menjaga agar tidak ada lagi yang mengembalikan hijau mint #36AE7C / koral #EB5353
// sebagai warna TEKS atau latar tombol dengan teks putih.
// Teks normal butuh >= 4,5:1; indikator fokus (WCAG 2.4.11) butuh >= 3:1.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function luminansi(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [lr, lg, lb] = [f(r), f(g), f(b)];
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}
function rasio(fg, bg) {
  const [a, b] = [luminansi(fg), luminansi(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const KANVAS = '#E5E5E5';
const PUTIH = '#FFFFFF';

console.log('--- Menjalankan Uji Contrast Contract (WCAG 2.2 AA) ---');

function assertKontras(fg, bg, minimal, deskripsi) {
  const r = rasio(fg, bg);
  assert.ok(r >= minimal, `${deskripsi}: ${fg} di atas ${bg} = ${r.toFixed(2)}:1 < ${minimal}:1`);
  console.log(`  ok    ${deskripsi}: ${r.toFixed(2)}:1 (>= ${minimal}:1)`);
}

// Teks hijau/biru/merah/kuning gelap di atas kanvas (tema neumorphism)
assertKontras('#1E6B48', KANVAS, 4.5, 'teks hijau gelap di kanvas');
assertKontras('#A92E2E', KANVAS, 4.5, 'teks merah gelap di kanvas');
assertKontras('#125773', KANVAS, 4.5, 'teks biru gelap di kanvas');
assertKontras('#7A5C00', KANVAS, 4.5, 'teks kuning gelap di kanvas');
// Teks putih di atas latar tombol baru (semua stop gradien)
for (const [hex, nama] of [
  ['#35795a', 'gradien hijau atas'], ['#2d6a4f', 'gradien hijau tengah'],
  ['#1b4332', 'gradien hijau bawah'], ['#C73838', 'gradien merah atas'],
  ['#A92E2E', 'gradien merah tengah'], ['#8F1D1D', 'gradien merah bawah'],
  ['#187498', 'gradien biru atas'], ['#14617F', 'gradien biru tengah'],
  ['#125773', 'gradien biru bawah'], ['#1E6B48', 'tombol neumorphism hijau'],
  ['#26805B', 'hover tombol hijau'], ['#9E2B2B', 'hover tombol merah'],
]) {
  assertKontras(PUTIH, hex, 4.5, `teks putih di ${nama} ${hex}`);
}
// Indikator fokus biru (WCAG 2.4.11, >= 3:1) di atas kanvas & putih
assertKontras('#1D4ED8', KANVAS, 3, 'outline fokus di kanvas');
assertKontras('#1D4ED8', PUTIH, 3, 'outline fokus di kartu putih');
// Regresi: warna lama yang gagal TIDAK boleh kembali sebagai teks/latar
for (const [hex, nama] of [['#36AE7C', 'mint'], ['#EB5353', 'koral']]) {
  assert.ok(rasio(PUTIH, hex) < 4.5, `${nama} ${hex} tetap tidak lolos sebagai latar teks putih`);
  assert.ok(rasio(hex, KANVAS) < 4.5, `${nama} ${hex} tetap tidak lolos sebagai teks di kanvas`);
  console.log(`  ok    regresi: ${nama} ${hex} tetap tercatat gagal (tidak dipakai lagi)`);
}

// --- R03 (re-review 25 Nov 2026): tes ini DULU hanya menghitung rasio antar
// literal hex — ia lolos meski CSS dikembalikan ke warna lama. Sekarang tes
// membaca index.css langsung dan memastikan aturan yang diperbaiki BENAR-BENAR
// ada di stylesheet (dan warna lama tidak ada lagi di posisi teks/latar).
const DIR = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(DIR, 'index.css'), 'utf8');

function assertCssAda(snippet, deskripsi) {
  assert.ok(css.includes(snippet), `index.css tidak lagi memuat: ${deskripsi} (${snippet})`);
  console.log(`  ok    css: ${deskripsi}`);
}

// Indikator fokus biru (C01) benar-benar terpasang
assertCssAda('outline: 2px solid #1D4ED8;', 'outline fokus global :focus-visible');
assertCssAda('outline: 3px solid #1D4ED8 !important;', 'outline fokus neumorphism');
assertCssAda('rgba(29, 78, 216, 0.55)', 'cincin fokus biru');
// Latar tombol neumorphism + hover (A01)
assertCssAda('background-color: #1E6B48 !important;', 'tombol neumorphism hijau');
assertCssAda('background-color: #26805B !important;', 'hover tombol hijau');
assertCssAda('background-color: #A92E2E !important;', 'tombol neumorphism merah');
assertCssAda('background-color: #9E2B2B !important;', 'hover tombol merah');
// Gradien dasar (A01 + ronde 2)
assertCssAda('linear-gradient(180deg, #35795a 0%, #2d6a4f 60%, #1b4332 100%)', 'gradien tombol hijau');
assertCssAda('linear-gradient(180deg, #C73838 0%, #A92E2E 60%, #8F1D1D 100%)', 'gradien tombol merah');
assertCssAda('linear-gradient(180deg, #187498 0%, #14617F 60%, #125773 100%)', 'gradien tombol biru');
assertCssAda('linear-gradient(180deg, #35795a 0%, #2d6a4f 55%, #1b4332 100%)', 'gradien FAB hijau');
assertCssAda('linear-gradient(180deg, #C73838 0%, #A92E2E 55%, #8F1D1D 100%)', 'gradien FAB merah');
// Teks gelap di atas kanvas (A01 + ronde 2)
assertCssAda('color: #1E6B48 !important;', 'teks hijau gelap neumorphism');
assertCssAda('color: #A92E2E !important;', 'teks merah gelap neumorphism');
assertCssAda('color: #1E6B48;', 'teks hijau gelap (var --color-primary diganti)');
assertCssAda('color: #A92E2E;', 'teks merah gelap (var --color-danger diganti)');
// Warna lama tidak boleh lagi muncul sebagai warna teks/latar interaktif.
// (Masih sah sebagai TOKEN --color-primary/--color-danger dan di komentar.)
for (const pola of ['background-color: #36AE7C', 'background-color: #EB5353', 'background: #36AE7C', 'background: #EB5353']) {
  assert.ok(!css.includes(pola), `index.css masih memuat latar gagal: ${pola}`);
  console.log(`  ok    css: tidak ada ${pola}`);
}

// Toast: kontainer toast TIDAK BOLEH punya aria-hidden="true" (berisi tombol fokus).
const toast = readFileSync(join(DIR, '..', 'components', 'ToastHost.jsx'), 'utf8');
assert.ok(!toast.includes('aria-hidden="true"'), 'ToastHost masih memakai aria-hidden="true"');
console.log('  ok    toast: tidak ada aria-hidden="true"');
// clay-ui: altInput flatpickr tidak boleh mematikan outline via inline style.
const clayUi = readFileSync(join(DIR, '..', 'components', 'clay-ui.jsx'), 'utf8');
assert.ok(!clayUi.includes(".style.outline = 'none'"), 'clay-ui masih mematikan outline altInput');
console.log("  ok    clay-ui: tidak ada style.outline = 'none'");

console.log('\nLULUS: Semua uji Contrast Contract lolos.\n');
