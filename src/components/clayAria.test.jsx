// Kunci atribut ARIA ClayCombobox/ClaySelect (Fase 6: D03 re-audit).
// Dua lapis: (1) render komponen asli — keadaan tertutup (daftar opsi
// dirender portal hanya sesudah useLayoutEffect mengukur posisi, jadi di
// SSR daftar tidak ada; yang bisa dikunci di sini adalah pemicu/input);
// (2) pemindaian sumber mengunci markup daftar (listbox + option) yang
// hanya muncul saat terbuka.
import React from 'react'
import { readFileSync } from 'node:fs'
import { renderToString } from 'react-dom/server'
import { ClayCombobox, ClaySelect } from './clay-ui.jsx'

function gagal(pesan) {
  throw new Error(pesan)
}

const opsi = [
  { value: 'makan', label: 'Makan' },
  { value: 'transport', label: 'Transport' },
  { value: 'gaji', label: 'Gaji' },
]

// ---- (1) Render: pemicu/input keadaan tertutup ----
const htmlCombo = renderToString(
  <ClayCombobox id="uji-kategori" value="ma" onChange={() => {}} options={opsi} placeholder="Kategori" />,
)
if (!/role="combobox"/.test(htmlCombo)) gagal('ClayCombobox: input tanpa role=combobox')
if (!/aria-expanded="false"/.test(htmlCombo)) gagal('ClayCombobox: aria-expanded bukan false saat tertutup')
if (!/aria-controls="uji-kategori-listbox"/.test(htmlCombo)) gagal('ClayCombobox: aria-controls tidak menunjuk listbox')
if (!/aria-autocomplete="list"/.test(htmlCombo)) gagal('ClayCombobox: tanpa aria-autocomplete=list')

const htmlSelect = renderToString(
  <ClaySelect id="uji-akun" value="makan" onChange={() => {}} options={opsi} placeholder="Pilih" />,
)
if (!/aria-haspopup="listbox"/.test(htmlSelect)) gagal('ClaySelect: pemicu tanpa aria-haspopup=listbox')
if (!/aria-expanded="false"/.test(htmlSelect)) gagal('ClaySelect: aria-expanded bukan false saat tertutup')
if (!/aria-controls="uji-akun-listbox"/.test(htmlSelect)) gagal('ClaySelect: pemicu tanpa aria-controls ke listbox')

// ---- (2) Sumber: markup daftar saat terbuka ----
// (Jangan pakai import.meta.url: berkas ini dibundel esbuild ke
// node_modules/.myduit-test, jadi URL-nya menunjuk ke bundel, bukan sumber.)
const sumber = readFileSync('src/components/clay-ui.jsx', 'utf8')
const perlu = [
  ['combobox: listbox ber-id', /role="listbox"\s*\n\s*id=\{id \? `\$\{id\}-listbox` : undefined\}/],
  ['combobox: opsi ber-id + aria-selected', /role="option"\s*\n\s*id=\{id \? `\$\{id\}-option-\$\{i\}` : undefined\}\s*\n\s*aria-selected=\{o\.label === value\}/],
  ['combobox: activedescendant mengikuti sorotan', /aria-activedescendant=\{open && hl >= 0 && matches\[hl\] \? `\$\{id\}-option-\$\{hl\}` : undefined\}/],
  ['select: listbox ber-id', /role="listbox"\s*\n\s*id=\{id \? `\$\{id\}-listbox` : undefined\}/],
  ['select: opsi ber-id + aria-selected', /role="option"\s*\n\s*id=\{id \? `\$\{id\}-option-\$\{i\}` : undefined\}\s*\n\s*aria-selected=\{o\.value === value\}/],
]
for (const [nama, pola] of perlu) {
  if (!pola.test(sumber)) gagal(nama)
}

console.log('clayAria: OK (combobox + select terikat ARIA)')
