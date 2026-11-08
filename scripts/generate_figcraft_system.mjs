// Generator resmi file desain native FigCraft (.figcraft) untuk MyDuit Claymorphism Design System
import { writeFileSync, copyFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

const commands = []

// Helper untuk command
const cmd = (name, params) => commands.push({ command: name, params })

// 1. Kanvas Utama: MyDuit 3D Claymorphism Design System
cmd('frame.create', {
  name: 'MyDuit Claymorphism Design System',
  x: 0,
  y: 0,
  width: 1600,
  height: 1200,
  props: {
    fills: [{ type: 'solid', color: '#eef3f1' }]
  }
})
const rootId = 2

// Header Frame
cmd('shape.rectangle', {
  name: 'Logo Tile',
  x: 60,
  y: 60,
  width: 48,
  height: 48,
  parent: rootId,
  props: {
    fills: [{ type: 'solid', color: '#10b981' }],
    cornerRadius: 16
  }
})

cmd('text.create', {
  text: 'MyDuit PWA — 3D Claymorphism Design System',
  x: 124,
  y: 66,
  parent: rootId,
  props: {
    fontSize: 26,
    fontFamily: 'Inter',
    fontWeight: 700
  }
})

cmd('text.create', {
  text: 'Authoritative Design Tokens & 5-Level Tactile Elevation Matrix (FreeFrontend & Styleguide Compliant)',
  x: 124,
  y: 102,
  parent: rootId,
  props: {
    fontSize: 14,
    fontFamily: 'Inter',
    fill: '#64748b'
  }
})

// SECTION 1: PALET WARNA (SWATCHES)
cmd('text.create', {
  text: '1. COLOR TOKENS & SEMANTIC ROLES',
  x: 60,
  y: 160,
  parent: rootId,
  props: { fontSize: 13, fontFamily: 'Inter', fontWeight: 700, fill: '#475569' }
})

const swatches = [
  { name: 'Mint Primary', hex: '#10b981', desc: 'Brand / Pemasukan' },
  { name: 'Deep Mint', hex: '#059669', desc: 'Active Shelf / Hover' },
  { name: 'Soft Mint Glow', hex: '#34d399', desc: 'Specular Highlight' },
  { name: 'Coral Red', hex: '#ef4444', desc: 'Pengeluaran / Alert' },
  { name: 'Azure Blue', hex: '#3b82f6', desc: 'Transfer / Rekening' },
  { name: 'Slate Neutral', hex: '#1e293b', desc: 'Text Primary' },
  { name: 'Clay Canvas', hex: '#eef3f1', desc: 'Background Kanvas' },
  { name: 'Porcelain Card', hex: '#ffffff', desc: 'Surface Container' }
]

swatches.forEach((s, idx) => {
  const x = 60 + idx * 180
  const y = 190
  cmd('shape.rectangle', {
    name: s.name,
    x,
    y,
    width: 160,
    height: 80,
    parent: rootId,
    props: {
      fills: [{ type: 'solid', color: s.hex }],
      cornerRadius: 18,
      stroke: s.hex === '#ffffff' || s.hex === '#eef3f1' ? '#cbd5e1' : 'none',
      strokeWeight: 1
    }
  })
  cmd('text.create', {
    text: s.name,
    x: x + 12,
    y: y + 90,
    parent: rootId,
    props: { fontSize: 12, fontFamily: 'Inter', fontWeight: 700, fill: '#1e293b' }
  })
  cmd('text.create', {
    text: `${s.hex} · ${s.desc}`,
    x: x + 12,
    y: y + 108,
    parent: rootId,
    props: { fontSize: 10, fontFamily: 'Inter', fill: '#64748b' }
  })
})

// SECTION 2: 5-LEVEL ELEVASI CLAYMORPHISM
cmd('text.create', {
  text: '2. 5-LEVEL CLAYMORPHISM ELEVATION SYSTEM',
  x: 60,
  y: 350,
  parent: rootId,
  props: { fontSize: 13, fontFamily: 'Inter', fontWeight: 700, fill: '#475569' }
})

// Card Level 3: Hero Summary Card (Total Saldo)
cmd('shape.rectangle', {
  name: 'Hero Card (Level 3)',
  x: 60,
  y: 380,
  width: 440,
  height: 200,
  parent: rootId,
  props: {
    fills: [{ type: 'solid', color: '#ffffff' }],
    cornerRadius: 28,
    stroke: '#ffffff',
    strokeWeight: 2
  }
})
cmd('text.create', {
  text: 'TOTAL SEMUA SALDO (LEVEL 3 HERO CARD)',
  x: 88,
  y: 408,
  parent: rootId,
  props: { fontSize: 12, fontFamily: 'Inter', fontWeight: 700, fill: '#64748b' }
})
cmd('text.create', {
  text: 'Rp1.694.446',
  x: 88,
  y: 446,
  parent: rootId,
  props: { fontSize: 36, fontFamily: 'Inter', fontWeight: 700, fill: '#1e293b' }
})
cmd('text.create', {
  text: '+Rp230.000 bulan ini · Surplus',
  x: 88,
  y: 504,
  parent: rootId,
  props: { fontSize: 14, fontFamily: 'Inter', fontWeight: 700, fill: '#10b981' }
})
cmd('text.create', {
  text: 'Dual clay shadow: 12px 18px 34px ambient + soft inset specular tanpa noda lingkaran',
  x: 88,
  y: 536,
  parent: rootId,
  props: { fontSize: 11, fontFamily: 'Inter', fill: '#94a3b8' }
})

// Card Level 2: Standard Content Card (Dompet Tunai)
cmd('shape.rectangle', {
  name: 'Standard Card (Level 2)',
  x: 530,
  y: 380,
  width: 440,
  height: 200,
  parent: rootId,
  props: {
    fills: [{ type: 'solid', color: '#ffffff' }],
    cornerRadius: 24,
    stroke: '#ffffff',
    strokeWeight: 1.5
  }
})
cmd('text.create', {
  text: 'DOMPET TUNAI (LEVEL 2 STANDARD CARD)',
  x: 558,
  y: 408,
  parent: rootId,
  props: { fontSize: 12, fontFamily: 'Inter', fontWeight: 700, fill: '#64748b' }
})
cmd('text.create', {
  text: 'Rp820.974',
  x: 558,
  y: 446,
  parent: rootId,
  props: { fontSize: 32, fontFamily: 'Inter', fontWeight: 700, fill: '#1e293b' }
})
cmd('text.create', {
  text: 'Cash · Terakhir diperbarui hari ini',
  x: 558,
  y: 498,
  parent: rootId,
  props: { fontSize: 13, fontFamily: 'Inter', fill: '#64748b' }
})
cmd('text.create', {
  text: 'Volumetric depth: 10px 14px 26px drop shadow + 3px lip shelf',
  x: 558,
  y: 536,
  parent: rootId,
  props: { fontSize: 11, fontFamily: 'Inter', fill: '#94a3b8' }
})

// Card Level 1: Sub-metric Chips (Baris Metrik Ringkas)
cmd('shape.rectangle', {
  name: 'Sub-metric Card A (Level 1)',
  x: 1000,
  y: 380,
  width: 170,
  height: 90,
  parent: rootId,
  props: {
    fills: [{ type: 'solid', color: '#ffffff' }],
    cornerRadius: 18,
    stroke: '#f1f5f9',
    strokeWeight: 1
  }
})
cmd('text.create', {
  text: 'RATA HARIAN',
  x: 1020,
  y: 404,
  parent: rootId,
  props: { fontSize: 10, fontFamily: 'Inter', fontWeight: 700, fill: '#64748b' }
})
cmd('text.create', {
  text: 'Rp16.079',
  x: 1020,
  y: 432,
  parent: rootId,
  props: { fontSize: 16, fontFamily: 'Inter', fontWeight: 700, fill: '#1e293b' }
})

cmd('shape.rectangle', {
  name: 'Sub-metric Card B (Level 1)',
  x: 1190,
  y: 380,
  width: 170,
  height: 90,
  parent: rootId,
  props: {
    fills: [{ type: 'solid', color: '#ffffff' }],
    cornerRadius: 18,
    stroke: '#f1f5f9',
    strokeWeight: 1
  }
})
cmd('text.create', {
  text: 'HARI AKTIF',
  x: 1210,
  y: 404,
  parent: rootId,
  props: { fontSize: 10, fontFamily: 'Inter', fontWeight: 700, fill: '#64748b' }
})
cmd('text.create', {
  text: '6 / 30 Hari',
  x: 1210,
  y: 432,
  parent: rootId,
  props: { fontSize: 16, fontFamily: 'Inter', fontWeight: 700, fill: '#1e293b' }
})

cmd('shape.rectangle', {
  name: 'Sub-metric Card C (Level 1)',
  x: 1000,
  y: 490,
  width: 360,
  height: 90,
  parent: rootId,
  props: {
    fills: [{ type: 'solid', color: '#ffffff' }],
    cornerRadius: 18,
    stroke: '#f1f5f9',
    strokeWeight: 1
  }
})
cmd('text.create', {
  text: 'RASIO TABUNGAN',
  x: 1020,
  y: 514,
  parent: rootId,
  props: { fontSize: 10, fontFamily: 'Inter', fontWeight: 700, fill: '#64748b' }
})
cmd('text.create', {
  text: '42% · Cukup (Sisa setelah belanja)',
  x: 1020,
  y: 542,
  parent: rootId,
  props: { fontSize: 15, fontFamily: 'Inter', fontWeight: 700, fill: '#10b981' }
})

// SECTION 3: KONTROL TAKTIL (LEVEL 4 TOMBOL & NAVIGASI)
cmd('text.create', {
  text: '3. INTERACTIVE CONTROLS (LEVEL 4 TACTILE BUTTONS & TABS)',
  x: 60,
  y: 630,
  parent: rootId,
  props: { fontSize: 13, fontFamily: 'Inter', fontWeight: 700, fill: '#475569' }
})

// Primary Mint Button
cmd('shape.rectangle', {
  name: 'Primary Button',
  x: 60,
  y: 660,
  width: 220,
  height: 52,
  parent: rootId,
  props: {
    fills: [{ type: 'solid', color: '#10b981' }],
    cornerRadius: 20,
    stroke: '#34d399',
    strokeWeight: 1
  }
})
cmd('text.create', {
  text: '+ Tambah Transaksi',
  x: 95,
  y: 678,
  parent: rootId,
  props: { fontSize: 14, fontFamily: 'Inter', fontWeight: 700, fill: '#ffffff' }
})

// Secondary Neutral Button
cmd('shape.rectangle', {
  name: 'Secondary Button',
  x: 300,
  y: 660,
  width: 220,
  height: 52,
  parent: rootId,
  props: {
    fills: [{ type: 'solid', color: '#ffffff' }],
    cornerRadius: 20,
    stroke: '#cbd5e1',
    strokeWeight: 1
  }
})
cmd('text.create', {
  text: 'Tambah Pengeluaran',
  x: 335,
  y: 678,
  parent: rootId,
  props: { fontSize: 14, fontFamily: 'Inter', fontWeight: 700, fill: '#334155' }
})

// Active Sidebar Nav Item
cmd('shape.rectangle', {
  name: 'Active Sidebar Nav Item',
  x: 540,
  y: 660,
  width: 220,
  height: 52,
  parent: rootId,
  props: {
    fills: [{ type: 'solid', color: '#10b981' }],
    cornerRadius: 22,
    stroke: '#34d399',
    strokeWeight: 1
  }
})
cmd('text.create', {
  text: 'Statistik (Active Tab)',
  x: 580,
  y: 678,
  parent: rootId,
  props: { fontSize: 14, fontFamily: 'Inter', fontWeight: 700, fill: '#ffffff' }
})

// Segmented Control
cmd('shape.rectangle', {
  name: 'Segmented Track',
  x: 780,
  y: 660,
  width: 260,
  height: 52,
  parent: rootId,
  props: {
    fills: [{ type: 'solid', color: '#e2e8f0' }],
    cornerRadius: 18
  }
})
cmd('shape.rectangle', {
  name: 'Active Segment',
  x: 785,
  y: 665,
  width: 122,
  height: 42,
  parent: rootId,
  props: {
    fills: [{ type: 'solid', color: '#ffffff' }],
    cornerRadius: 14
  }
})
cmd('text.create', {
  text: 'Bulanan',
  x: 820,
  y: 678,
  parent: rootId,
  props: { fontSize: 13, fontFamily: 'Inter', fontWeight: 700, fill: '#10b981' }
})
cmd('text.create', {
  text: 'Tahunan',
  x: 945,
  y: 678,
  parent: rootId,
  props: { fontSize: 13, fontFamily: 'Inter', fontWeight: 500, fill: '#64748b' }
})

// Filter Chips
cmd('shape.rectangle', {
  name: 'Filter Chip Active',
  x: 1060,
  y: 666,
  width: 100,
  height: 40,
  parent: rootId,
  props: {
    fills: [{ type: 'solid', color: '#10b981' }],
    cornerRadius: 14
  }
})
cmd('text.create', {
  text: 'Semua',
  x: 1088,
  y: 678,
  parent: rootId,
  props: { fontSize: 12, fontFamily: 'Inter', fontWeight: 700, fill: '#ffffff' }
})

cmd('shape.rectangle', {
  name: 'Filter Chip Inactive',
  x: 1170,
  y: 666,
  width: 90,
  height: 40,
  parent: rootId,
  props: {
    fills: [{ type: 'solid', color: '#ffffff' }],
    cornerRadius: 14,
    stroke: '#e2e8f0',
    strokeWeight: 1
  }
})
cmd('text.create', {
  text: 'Aktif',
  x: 1200,
  y: 678,
  parent: rootId,
  props: { fontSize: 12, fontFamily: 'Inter', fontWeight: 500, fill: '#64748b' }
})

// SECTION 4: KONTRAK & CARA BUKA DI FIGCRAFT
cmd('shape.rectangle', {
  name: 'Footer Card',
  x: 60,
  y: 770,
  width: 1480,
  height: 120,
  parent: rootId,
  props: {
    fills: [{ type: 'solid', color: '#ffffff' }],
    cornerRadius: 20,
    stroke: '#e2e8f0',
    strokeWeight: 1
  }
})
cmd('text.create', {
  text: 'PANDUAN MEMBUKA DI FIGCRAFT GUI (X:\\Artcraft\\FigCraft\\figcraft.exe):',
  x: 88,
  y: 800,
  parent: rootId,
  props: { fontSize: 13, fontFamily: 'Inter', fontWeight: 700, fill: '#1e293b' }
})
cmd('text.create', {
  text: '1. File ini dapat dibuka langsung via menu File -> Open di FigCraft, atau double-click shortcut pada Desktop.',
  x: 88,
  y: 826,
  parent: rootId,
  props: { fontSize: 12, fontFamily: 'Inter', fill: '#475569' }
})
cmd('text.create', {
  text: '2. Terhubung langsung dengan implementasi kode MyDuit via Code Connect: figcraft.connect.json',
  x: 88,
  y: 850,
  parent: rootId,
  props: { fontSize: 12, fontFamily: 'Inter', fill: '#475569' }
})

const scriptPath = 'design/figcraft_native_script.json'
writeFileSync(scriptPath, JSON.stringify(commands, null, 2))
console.log(`[FigCraft Generator] Menulis script instruksi ke ${scriptPath} (${commands.length} langkah)...`)

// Eksekusi figcraft-cli run
const outFile = 'design/myduit_claymorphism_system.figcraft'
console.log(`[FigCraft Generator] Menjalankan figcraft-cli run --out ${outFile}...`)
execSync(`figcraft-cli run --out "${outFile}" "${scriptPath}"`, { stdio: 'inherit' })
console.log(`[FigCraft Generator] File desain native FigCraft berhasil dibuat di ${outFile}`)

// Copy ke lokasi strategis
const artcraftPath = 'X:/Artcraft/myduit_claymorphism_system.figcraft'
copyFileSync(outFile, artcraftPath)
console.log(`[FigCraft Generator] Disalin ke ${artcraftPath}`)

const desktopPath = 'C:/Users/dtimo/Desktop/myduit_claymorphism_system.figcraft'
try {
  copyFileSync(outFile, desktopPath)
  console.log(`[FigCraft Generator] Disalin ke Desktop: ${desktopPath}`)
} catch (e) {
  console.warn('Gagal salin ke desktop:', e.message)
}

// Buat launcher batch script di X:\Artcraft\
const batContent = `@echo off
echo Membuka MyDuit 3D Claymorphism Design System di FigCraft...
start "" "X:\\Artcraft\\FigCraft\\figcraft.exe" "X:\\Artcraft\\myduit_claymorphism_system.figcraft"
`
writeFileSync('X:/Artcraft/Buka_MyDuit_di_FigCraft.bat', batContent)
console.log('[FigCraft Generator] Launcher dibuat di X:/Artcraft/Buka_MyDuit_di_FigCraft.bat')
