// src/styles/themeContract.test.mjs
// Verifikasi integritas kontrak tema [data-theme="neumorphism"] dan palet 4-warna
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync('src/styles/index.css', 'utf8');

console.log('--- Menjalankan Uji Theme Contract (Neumorphism & 4-Color Palette) ---');

function assertContains(pattern, msg) {
  assert.ok(css.includes(pattern), msg);
  console.log('  ok   ', msg);
}

// 1. Selector tema
assertContains('[data-theme="neumorphism"]', 'selector tema [data-theme="neumorphism"] terdefinisi');

// 2. Permukaan kanvas #E5E5E5
assertContains('--clay-bg: #E5E5E5;', 'token --clay-bg disetel ke #E5E5E5');
assertContains('background-color: #E5E5E5 !important;', 'background-color #E5E5E5 terpasang pada kartu/sheet/body');

// 3. Palet 4-warna terstandarisasi
assertContains('--color-primary: #36AE7C;', 'token primary disetel ke Mint Teal (#36AE7C)');
assertContains('--color-danger: #EB5353;', 'token danger disetel ke Coral Red (#EB5353)');
assertContains('--color-info: #187498;', 'token info disetel ke Ocean Blue (#187498)');
assertContains('--color-warning: #D4AF0D;', 'token warning disetel ke Sunny Yellow text-safe (#D4AF0D)');
assertContains('--clay-h-primary: 54, 174, 124;', 'RGB triple primary disetel ke (54, 174, 124)');
assertContains('--clay-h-danger: 235, 83, 83;', 'RGB triple danger disetel ke (235, 83, 83)');
assertContains('--clay-h-blue: 24, 116, 152;', 'RGB triple blue disetel ke (24, 116, 152)');
assertContains('--clay-h-amber: 249, 217, 35;', 'RGB triple amber disetel ke (249, 217, 35)');

// 4. Dual directional shadows
assertContains('-8px -8px 20px rgba(255, 255, 255, 0.75)', 'dual shadow dropShadow (raised) terpasang');
assertContains('inset -4px -4px 8px rgba(255, 255, 255, 0.80)', 'dual shadow innerShadow (sunken) terpasang');
assertContains('text-shadow:', '3D relief text-shadow terpasang untuk tipografi timbul');

console.log('\nLULUS: Semua uji Theme Contract lolos.\n');
