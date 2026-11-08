// src/lib/theme.check.mjs
import assert from 'node:assert/strict';
import { THEMES, KEY_THEME, temaAktif, setTema, initTema } from './theme.js';

// Mock localStorage
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear()
};

// Mock document
let currentAttribute = '';
globalThis.document = {
  documentElement: {
    setAttribute: (attr, val) => {
      if (attr === 'data-theme') currentAttribute = val;
    },
    getAttribute: (attr) => (attr === 'data-theme' ? currentAttribute : null)
  }
};

// Mock window
let lastDispatched = null;
globalThis.window = {
  dispatchEvent: (ev) => {
    lastDispatched = ev;
  }
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};

console.log('--- Menjalankan Uji Theme Manager ---');

// 1. Default should be neumorphism
storage.clear();
assert.equal(temaAktif(), THEMES.NEUMORPHISM, 'Default tema harus Neumorphism');

// 2. Init tema sets document attribute
initTema();
assert.equal(currentAttribute, THEMES.NEUMORPHISM, 'initTema harus menyetel attribute ke Neumorphism');

// 3. Switch to claymorphism
setTema(THEMES.CLAYMORPHISM);
assert.equal(storage.get(KEY_THEME), THEMES.CLAYMORPHISM, 'setTema harus menyimpan claymorphism');
assert.equal(currentAttribute, THEMES.CLAYMORPHISM, 'setTema harus menyetel attribute ke claymorphism');
assert.equal(lastDispatched?.detail?.tema, THEMES.CLAYMORPHISM, 'setTema harus mendispatch event');

// 4. Switch back to neumorphism
setTema(THEMES.NEUMORPHISM);
assert.equal(storage.get(KEY_THEME), THEMES.NEUMORPHISM, 'setTema harus menyimpan neumorphism');
assert.equal(currentAttribute, THEMES.NEUMORPHISM, 'setTema harus menyetel attribute ke neumorphism');

console.log('theme.check: OK');
