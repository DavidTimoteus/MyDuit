// Slicing Lengkap Seluruh Sistem PWA MyDuit ke Dokumen Native FigCraft
import { writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'

const commands = []
const cmd = (name, params) => commands.push({ command: name, params })

// Palet Warna & Styling Tokens
const C = {
  canvas: '#eef3f1',
  white: '#ffffff',
  surfaceCard: '#ffffff',
  mintPrimary: '#10b981',
  deepMint: '#059669',
  mintHighlight: '#34d399',
  redDanger: '#ef4444',
  blueAzure: '#3b82f6',
  textDark: '#1e293b',
  textMuted: '#64748b',
  textSubtle: '#94a3b8',
  borderLight: '#e2e8f0',
  shelfMint: '#047857',
  shelfCard: '#93c5b5',
  shelfDanger: '#b91c1c',
  shelfBlue: '#1d4ed8',
  softGreenBadge: '#d1fae5',
  softRedBadge: '#fee2e2',
  softBlueBadge: '#dbeafe'
}

console.log('Building FigCraft slicing commands...')

// ============================================================================
// 1. FRAME DESIGN SYSTEM & TOKENS (1600 x 1200) at (0, 0)
// ============================================================================
cmd('frame.create', {
  name: 'Design System & Clay Tokens',
  x: 0,
  y: 0,
  width: 1600,
  height: 1200,
  props: { fills: [{ type: 'solid', color: C.canvas }] }
})
const sysRoot = 2

cmd('shape.rectangle', {
  name: 'Logo Tile',
  x: 60,
  y: 60,
  width: 52,
  height: 52,
  parent: sysRoot,
  props: { fills: [{ type: 'solid', color: C.mintPrimary }], cornerRadius: 18 }
})

cmd('text.create', {
  text: 'MyDuit PWA — 3D Claymorphism Design System',
  x: 130,
  y: 66,
  parent: sysRoot,
  props: { fontSize: 26, fontFamily: 'Inter', fontWeight: 700 }
})

cmd('text.create', {
  text: 'Authoritative Design Tokens & 5-Level Tactile Elevation Matrix (FreeFrontend Standards)',
  x: 130,
  y: 104,
  parent: sysRoot,
  props: { fontSize: 14, fontFamily: 'Inter', fill: C.textMuted }
})

// Elevation Cards Showcase
const elevations = [
  { lvl: 'Level 1: Soft Surface', desc: 'Chip Netral / Rata-rata', h: 180, color: '#f8faf9' },
  { lvl: 'Level 2: Content Card', desc: 'Kartu Transaksi & Rekening', h: 180, color: '#ffffff' },
  { lvl: 'Level 3: Hero Card', desc: 'Total Saldo & Headline Metrik', h: 180, color: '#ffffff' },
  { lvl: 'Level 4: Interactive CTA', desc: 'Tombol Aksi & Primari', h: 180, color: '#10b981' },
  { lvl: 'Level 5: Central Dome FAB', desc: 'Floating Action Button 3D', h: 180, color: '#10b981' }
]

elevations.forEach((el, i) => {
  const x = 60 + i * 296
  cmd('shape.rectangle', {
    name: el.lvl,
    x,
    y: 200,
    width: 276,
    height: 160,
    parent: sysRoot,
    props: {
      fills: [{ type: 'solid', color: el.color }],
      cornerRadius: 24,
      stroke: '#ffffff',
      strokeWeight: 1.5
    }
  })
  cmd('text.create', {
    text: el.lvl,
    x: x + 20,
    y: 230,
    parent: sysRoot,
    props: {
      fontSize: 15,
      fontFamily: 'Inter',
      fontWeight: 700,
      fill: el.color === '#10b981' ? '#ffffff' : C.textDark
    }
  })
  cmd('text.create', {
    text: el.desc,
    x: x + 20,
    y: 260,
    parent: sysRoot,
    props: {
      fontSize: 13,
      fontFamily: 'Inter',
      fill: el.color === '#10b981' ? '#d1fae5' : C.textMuted
    }
  })
})

// ============================================================================
// HELPER: BUILD SHELL (SIDEBAR, ASIDE, HEADER)
// ============================================================================
function buildShell(frameName, fx, fy, activeTab, asideTitle, asideContentBuilder) {
  cmd('frame.create', {
    name: frameName,
    x: fx,
    y: fy,
    width: 1440,
    height: 900,
    props: { fills: [{ type: 'solid', color: C.canvas }] }
  })
  // We use relative referencing or step name
  const fId = { $step: commands.length - 1 }

  // 1. Sidebar Kiri (260px)
  cmd('shape.rectangle', {
    name: 'Sidebar Container',
    x: 24,
    y: 24,
    width: 250,
    height: 852,
    parent: fId,
    props: {
      fills: [{ type: 'solid', color: C.white }],
      cornerRadius: 28,
      stroke: '#ffffff',
      strokeWeight: 1.5
    }
  })

  // Brand Header in Sidebar
  cmd('shape.rectangle', {
    name: 'Brand Icon',
    x: 48,
    y: 48,
    width: 42,
    height: 42,
    parent: fId,
    props: { fills: [{ type: 'solid', color: C.mintPrimary }], cornerRadius: 14 }
  })
  cmd('text.create', {
    text: 'MyDuit',
    x: 102,
    y: 50,
    parent: fId,
    props: { fontSize: 20, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
  })
  cmd('text.create', {
    text: 'CATAT · PANTAU · KENDALIKAN',
    x: 102,
    y: 74,
    parent: fId,
    props: { fontSize: 9, fontFamily: 'Inter', fontWeight: 600, fill: C.textSubtle }
  })

  // Nav Items
  const navItems = ['Transaksi', 'Statistik', 'Budget', 'Utang']
  navItems.forEach((item, idx) => {
    const ny = 120 + idx * 56
    const isActive = item.toLowerCase() === activeTab.toLowerCase()
    cmd('shape.rectangle', {
      name: `Nav ${item}`,
      x: 44,
      y: ny,
      width: 210,
      height: 46,
      parent: fId,
      props: {
        fills: [{ type: 'solid', color: isActive ? C.mintPrimary : '#ffffff' }],
        cornerRadius: 16,
        stroke: isActive ? C.mintHighlight : '#ffffff',
        strokeWeight: 1
      }
    })
    cmd('text.create', {
      text: item,
      x: 88,
      y: ny + 14,
      parent: fId,
      props: {
        fontSize: 14,
        fontFamily: 'Inter',
        fontWeight: isActive ? 700 : 600,
        fill: isActive ? '#ffffff' : C.textDark
      }
    })
  })

  // Sidebar Footer: User Profile
  cmd('shape.rectangle', {
    name: 'Profile Avatar',
    x: 44,
    y: 810,
    width: 36,
    height: 36,
    parent: fId,
    props: { fills: [{ type: 'solid', color: '#cbd5e1' }], cornerRadius: 18 }
  })
  cmd('text.create', {
    text: 'David Timothy',
    x: 90,
    y: 812,
    parent: fId,
    props: { fontSize: 13, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
  })
  cmd('text.create', {
    text: 'ID Indonesia · Rp',
    x: 90,
    y: 830,
    parent: fId,
    props: { fontSize: 11, fontFamily: 'Inter', fill: C.textSubtle }
  })

  // 2. Right Aside Panel (340px)
  cmd('shape.rectangle', {
    name: 'Aside Panel Container',
    x: 1084,
    y: 24,
    width: 332,
    height: 852,
    parent: fId,
    props: {
      fills: [{ type: 'solid', color: C.white }],
      cornerRadius: 28,
      stroke: '#ffffff',
      strokeWeight: 1.5
    }
  })

  cmd('text.create', {
    text: asideTitle,
    x: 1108,
    y: 48,
    parent: fId,
    props: { fontSize: 20, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
  })
  // PDF icon pill
  cmd('shape.rectangle', {
    name: 'PDF Pill',
    x: 1360,
    y: 44,
    width: 36,
    height: 36,
    parent: fId,
    props: { fills: [{ type: 'solid', color: '#fff1f2' }], cornerRadius: 10 }
  })
  cmd('text.create', {
    text: 'PDF',
    x: 1368,
    y: 55,
    parent: fId,
    props: { fontSize: 11, fontFamily: 'Inter', fontWeight: 700, fill: '#e11d48' }
  })

  if (asideContentBuilder) {
    asideContentBuilder(fId)
  }

  return fId
}

// ============================================================================
// 2. VIEW 1: TRANSAKSI DASHBOARD (1440 x 900) at (1700, 0)
// ============================================================================
console.log('Slicing Transaksi Dashboard...')
const txFrame = buildShell('Desktop — Transaksi Dashboard', 1700, 0, 'Transaksi', 'Ringkasan', (fId) => {
  // Aside: Ringkasan Total Saldo (Hero Green Card)
  cmd('shape.rectangle', {
    name: 'Aside Hero Total Saldo',
    x: 1108,
    y: 96,
    width: 284,
    height: 110,
    parent: fId,
    props: {
      fills: [{ type: 'solid', color: C.shelfMint }],
      cornerRadius: 20
    }
  })
  cmd('text.create', {
    text: 'TOTAL SALDO',
    x: 1128,
    y: 116,
    parent: fId,
    props: { fontSize: 11, fontFamily: 'Inter', fontWeight: 700, fill: '#a7f3d0' }
  })
  cmd('text.create', {
    text: 'Rp 1.694.446',
    x: 1128,
    y: 138,
    parent: fId,
    props: { fontSize: 24, fontFamily: 'Inter', fontWeight: 700, fill: '#ffffff' }
  })
  cmd('text.create', {
    text: '-Rp252.377 bulan ini',
    x: 1128,
    y: 174,
    parent: fId,
    props: { fontSize: 12, fontFamily: 'Inter', fill: '#d1fae5' }
  })

  // Aside: Pengeluaran Hari Ini
  cmd('shape.rectangle', {
    name: 'Aside Card Pengeluaran',
    x: 1108,
    y: 222,
    width: 284,
    height: 90,
    parent: fId,
    props: { fills: [{ type: 'solid', color: '#f8faf9' }], cornerRadius: 18 }
  })
  cmd('text.create', {
    text: 'PENGELUARAN HARI INI',
    x: 1128,
    y: 240,
    parent: fId,
    props: { fontSize: 11, fontFamily: 'Inter', fontWeight: 700, fill: C.textSubtle }
  })
  cmd('text.create', {
    text: 'Rp 0',
    x: 1128,
    y: 260,
    parent: fId,
    props: { fontSize: 22, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
  })

  // Aside: Top Kategori
  cmd('shape.rectangle', {
    name: 'Aside Card Top Kategori',
    x: 1108,
    y: 326,
    width: 284,
    height: 90,
    parent: fId,
    props: { fills: [{ type: 'solid', color: '#f8faf9' }], cornerRadius: 18 }
  })
  cmd('text.create', {
    text: 'TOP KATEGORI',
    x: 1128,
    y: 344,
    parent: fId,
    props: { fontSize: 11, fontFamily: 'Inter', fontWeight: 700, fill: C.textSubtle }
  })
  cmd('text.create', {
    text: 'Pembayaran',
    x: 1128,
    y: 366,
    parent: fId,
    props: { fontSize: 18, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
  })
  cmd('text.create', {
    text: 'Rp 303.020',
    x: 1280,
    y: 368,
    parent: fId,
    props: { fontSize: 14, fontFamily: 'Inter', fontWeight: 600, fill: C.textDark }
  })

  // Aside: Tombol Aksi Cepat
  cmd('text.create', {
    text: 'AKSI CEPAT',
    x: 1108,
    y: 690,
    parent: fId,
    props: { fontSize: 12, fontFamily: 'Inter', fontWeight: 700, fill: C.textSubtle }
  })
  const actions = [
    { text: '+ Tambah Pemasukan', color: C.shelfMint, y: 714 },
    { text: '- Tambah Pengeluaran', color: '#dc2626', y: 766 },
    { text: '↔ Pindah Saldo', color: '#2563eb', y: 818 }
  ]
  actions.forEach((act) => {
    cmd('shape.rectangle', {
      name: `Btn ${act.text}`,
      x: 1108,
      y: act.y,
      width: 284,
      height: 44,
      parent: fId,
      props: { fills: [{ type: 'solid', color: act.color }], cornerRadius: 14 }
    })
    cmd('text.create', {
      text: act.text,
      x: 1160,
      y: act.y + 13,
      parent: fId,
      props: { fontSize: 13, fontFamily: 'Inter', fontWeight: 700, fill: '#ffffff' }
    })
  })
})

// Main Content Transaksi
cmd('shape.rectangle', {
  name: 'Search Bar',
  x: 298,
  y: 24,
  width: 320,
  height: 48,
  parent: txFrame,
  props: { fills: [{ type: 'solid', color: C.white }], cornerRadius: 16 }
})
cmd('text.create', {
  text: '🔍  Cari transaksi...',
  x: 316,
  y: 38,
  parent: txFrame,
  props: { fontSize: 14, fontFamily: 'Inter', fill: C.textMuted }
})

cmd('shape.rectangle', {
  name: 'Filter Button Pill',
  x: 880,
  y: 24,
  width: 178,
  height: 48,
  parent: txFrame,
  props: { fills: [{ type: 'solid', color: C.blueAzure }], cornerRadius: 16 }
})
cmd('text.create', {
  text: 'Semua Transaksi',
  x: 914,
  y: 38,
  parent: txFrame,
  props: { fontSize: 14, fontFamily: 'Inter', fontWeight: 600, fill: '#ffffff' }
})

// Transaction Cards Stack
const txList = [
  { title: 'Spinjam November', sub: 'Kemarin · Lainnya · Dompet', amount: '+Rp 230.000', color: C.mintPrimary },
  { title: 'Bayar cicilan Spinjam', sub: 'Kemarin · Pembayaran · Dompet', amount: '-Rp 229.689', color: C.redDanger },
  { title: 'Spinjam', sub: 'Kemarin · Pindah Saldo · Krom → Seabank', amount: 'Rp 201.877', color: C.blueAzure },
  { title: 'Pindah Saldo', sub: 'Kemarin · Pindah Saldo · Seabank → Dompet', amount: 'Rp 30.000', color: C.blueAzure },
  { title: 'Pindah Saldo', sub: '6 Nov · Pindah Saldo · Seabank → Krom', amount: 'Rp 231.022', color: C.blueAzure },
  { title: 'Sabun Mandi 400ml + Tisu', sub: '5 Nov · Online Shop', amount: '-Rp 31.357', color: C.redDanger }
]

txList.forEach((tx, idx) => {
  const ty = 140 + idx * 82
  cmd('shape.rectangle', {
    name: `Card ${tx.title}`,
    x: 298,
    y: ty,
    width: 760,
    height: 70,
    parent: txFrame,
    props: {
      fills: [{ type: 'solid', color: C.white }],
      cornerRadius: 20,
      stroke: '#ffffff',
      strokeWeight: 1.5
    }
  })
  // Icon Badge
  cmd('shape.rectangle', {
    name: 'Icon Badge',
    x: 314,
    y: ty + 15,
    width: 40,
    height: 40,
    parent: txFrame,
    props: { fills: [{ type: 'solid', color: '#f1f5f9' }], cornerRadius: 14 }
  })
  cmd('text.create', {
    text: tx.title,
    x: 368,
    y: ty + 16,
    parent: txFrame,
    props: { fontSize: 15, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
  })
  cmd('text.create', {
    text: tx.sub,
    x: 368,
    y: ty + 38,
    parent: txFrame,
    props: { fontSize: 12, fontFamily: 'Inter', fill: C.textMuted }
  })
  cmd('text.create', {
    text: tx.amount,
    x: 930,
    y: ty + 24,
    parent: txFrame,
    props: { fontSize: 16, fontFamily: 'Inter', fontWeight: 700, fill: tx.color }
  })
})

// ============================================================================
// 3. VIEW 2: STATISTIK ANALITIK (1440 x 900) at (3240, 0)
// ============================================================================
console.log('Slicing Statistik View...')
const statFrame = buildShell('Desktop — Statistik View', 3240, 0, 'Statistik', 'Statistik Cepat', (fId) => {
  // Aside: Pengeluaran Terbesar
  cmd('shape.rectangle', {
    name: 'Aside Card Terbesar',
    x: 1108,
    y: 96,
    width: 284,
    height: 84,
    parent: fId,
    props: { fills: [{ type: 'solid', color: '#f8faf9' }], cornerRadius: 18 }
  })
  cmd('text.create', {
    text: 'PENGELUARAN TERBESAR',
    x: 1124,
    y: 110,
    parent: fId,
    props: { fontSize: 11, fontFamily: 'Inter', fontWeight: 700, fill: C.textSubtle }
  })
  cmd('text.create', {
    text: 'Pembayaran (63%)',
    x: 1124,
    y: 130,
    parent: fId,
    props: { fontSize: 15, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
  })
  cmd('text.create', {
    text: 'Rp 303.020',
    x: 1290,
    y: 130,
    parent: fId,
    props: { fontSize: 14, fontFamily: 'Inter', fontWeight: 600, fill: C.redDanger }
  })

  // Aside: Rasio Tabungan
  cmd('shape.rectangle', {
    name: 'Aside Card Rasio',
    x: 1108,
    y: 194,
    width: 284,
    height: 90,
    parent: fId,
    props: { fills: [{ type: 'solid', color: '#f8faf9' }], cornerRadius: 18 }
  })
  cmd('text.create', {
    text: 'RASIO TABUNGAN',
    x: 1124,
    y: 210,
    parent: fId,
    props: { fontSize: 11, fontFamily: 'Inter', fontWeight: 700, fill: C.textSubtle }
  })
  cmd('text.create', {
    text: '-110%',
    x: 1124,
    y: 232,
    parent: fId,
    props: { fontSize: 22, fontFamily: 'Inter', fontWeight: 700, fill: C.mintPrimary }
  })
  // Pill "Boros"
  cmd('shape.rectangle', {
    name: 'Pill Boros',
    x: 1320,
    y: 232,
    width: 56,
    height: 24,
    parent: fId,
    props: { fills: [{ type: 'solid', color: '#dcfce7' }], cornerRadius: 8 }
  })
  cmd('text.create', {
    text: 'Boros',
    x: 1332,
    y: 238,
    parent: fId,
    props: { fontSize: 11, fontFamily: 'Inter', fontWeight: 600, fill: '#15803d' }
  })

  // Aside: Pola Pengeluaran
  cmd('shape.rectangle', {
    name: 'Aside Card Pola',
    x: 1108,
    y: 298,
    width: 284,
    height: 120,
    parent: fId,
    props: { fills: [{ type: 'solid', color: '#f8faf9' }], cornerRadius: 18 }
  })
  cmd('text.create', {
    text: 'POLA PENGELUARAN',
    x: 1124,
    y: 314,
    parent: fId,
    props: { fontSize: 11, fontFamily: 'Inter', fontWeight: 700, fill: C.textSubtle }
  })
  cmd('text.create', {
    text: 'Hari aktif catat: 6 / 30',
    x: 1124,
    y: 336,
    parent: fId,
    props: { fontSize: 13, fontFamily: 'Inter', fill: C.textDark }
  })
  cmd('text.create', {
    text: 'Rata-rata / hari aktif: Rp80.396',
    x: 1124,
    y: 358,
    parent: fId,
    props: { fontSize: 13, fontFamily: 'Inter', fill: C.textDark }
  })
  cmd('text.create', {
    text: 'Hari paling boros: Rp229.689',
    x: 1124,
    y: 380,
    parent: fId,
    props: { fontSize: 13, fontFamily: 'Inter', fill: C.redDanger }
  })

  // Aside: Rata-Rata Harian
  cmd('shape.rectangle', {
    name: 'Aside Card Rata2',
    x: 1108,
    y: 790,
    width: 284,
    height: 60,
    parent: fId,
    props: { fills: [{ type: 'solid', color: '#f8faf9' }], cornerRadius: 16 }
  })
  cmd('text.create', {
    text: 'Rata-rata harian',
    x: 1124,
    y: 812,
    parent: fId,
    props: { fontSize: 13, fontFamily: 'Inter', fontWeight: 600, fill: C.textDark }
  })
  cmd('text.create', {
    text: 'Rp 16.079',
    x: 1290,
    y: 812,
    parent: fId,
    props: { fontSize: 14, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
  })
})

// Main Content Statistik: Top Navigator & 3 Metric Cards
cmd('shape.rectangle', {
  name: 'Segment Switcher',
  x: 298,
  y: 24,
  width: 180,
  height: 44,
  parent: statFrame,
  props: { fills: [{ type: 'solid', color: C.white }], cornerRadius: 14 }
})
cmd('text.create', {
  text: 'Bulanan    Tahunan',
  x: 326,
  y: 38,
  parent: statFrame,
  props: { fontSize: 13, fontFamily: 'Inter', fontWeight: 600, fill: C.textDark }
})

// 3 Metric Cards
const metrics = [
  { label: 'PEMASUKAN', amount: 'Rp 230.000', comp: '-73% vs bulan lalu', color: C.mintPrimary },
  { label: 'PENGELUARAN', amount: 'Rp 482.377', comp: '-75% vs bulan lalu', color: C.redDanger },
  { label: 'SALDO BERSIH', amount: 'Rp -252.377', comp: '-77% vs bulan lalu', color: C.blueAzure }
]

metrics.forEach((m, idx) => {
  const mx = 298 + idx * 258
  cmd('shape.rectangle', {
    name: `Card ${m.label}`,
    x: mx,
    y: 90,
    width: 244,
    height: 120,
    parent: statFrame,
    props: {
      fills: [{ type: 'solid', color: C.white }],
      cornerRadius: 22,
      stroke: '#ffffff',
      strokeWeight: 1.5
    }
  })
  cmd('text.create', {
    text: m.label,
    x: mx + 20,
    y: 110,
    parent: statFrame,
    props: { fontSize: 12, fontFamily: 'Inter', fontWeight: 700, fill: C.textSubtle }
  })
  cmd('text.create', {
    text: m.amount,
    x: mx + 20,
    y: 136,
    parent: statFrame,
    props: { fontSize: 20, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
  })
  cmd('text.create', {
    text: m.comp,
    x: mx + 20,
    y: 172,
    parent: statFrame,
    props: { fontSize: 12, fontFamily: 'Inter', fill: m.color }
  })
})

// Tren Bulan Ini Chart Card
cmd('shape.rectangle', {
  name: 'Tren Bulan Ini Card',
  x: 298,
  y: 236,
  width: 760,
  height: 480,
  parent: statFrame,
  props: {
    fills: [{ type: 'solid', color: C.white }],
    cornerRadius: 26,
    stroke: '#ffffff',
    strokeWeight: 1.5
  }
})
cmd('text.create', {
  text: 'Tren Bulan Ini',
  x: 326,
  y: 264,
  parent: statFrame,
  props: { fontSize: 18, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
})
// Chart Legend
cmd('text.create', {
  text: '● Pemasukan   ● Pengeluaran   ● Saldo',
  x: 820,
  y: 266,
  parent: statFrame,
  props: { fontSize: 12, fontFamily: 'Inter', fill: C.textMuted }
})
// Chart baseline line
cmd('shape.rectangle', {
  name: 'Chart Axis X',
  x: 340,
  y: 500,
  width: 680,
  height: 2,
  parent: statFrame,
  props: { fills: [{ type: 'solid', color: '#e2e8f0' }] }
})
cmd('text.create', {
  text: '1     3     5     7     9    11    13    15    17    19    21    23    25    27    29',
  x: 340,
  y: 520,
  parent: statFrame,
  props: { fontSize: 12, fontFamily: 'Inter', fill: C.textSubtle }
})

// ============================================================================
// 4. VIEW 3: BUDGET & REKENING (1440 x 900) at (1700, 1000)
// ============================================================================
console.log('Slicing Budget & Rekening View...')
const budgetFrame = buildShell('Desktop — Budget & Rekening', 1700, 1000, 'Budget', 'Statistik Budget', (fId) => {
  // Aside: Sisa Budget Hero Card (Deep Blue)
  cmd('shape.rectangle', {
    name: 'Aside Hero Budget',
    x: 1108,
    y: 96,
    width: 284,
    height: 110,
    parent: fId,
    props: {
      fills: [{ type: 'solid', color: '#1d4ed8' }],
      cornerRadius: 20
    }
  })
  cmd('text.create', {
    text: 'SISA BUDGET',
    x: 1128,
    y: 116,
    parent: fId,
    props: { fontSize: 11, fontFamily: 'Inter', fontWeight: 700, fill: '#93c5fd' }
  })
  cmd('text.create', {
    text: '- Rp482.377',
    x: 1128,
    y: 138,
    parent: fId,
    props: { fontSize: 24, fontFamily: 'Inter', fontWeight: 700, fill: '#ffffff' }
  })
  cmd('text.create', {
    text: 'Terlampaui Rp482.377',
    x: 1128,
    y: 174,
    parent: fId,
    props: { fontSize: 12, fontFamily: 'Inter', fill: '#bfdbfe' }
  })

  // Aside: Hari Tersisa & Burn Rate
  cmd('shape.rectangle', {
    name: 'Aside Card Burn Rate',
    x: 1108,
    y: 222,
    width: 284,
    height: 80,
    parent: fId,
    props: { fills: [{ type: 'solid', color: '#f8faf9' }], cornerRadius: 18 }
  })
  cmd('text.create', {
    text: 'HARI TERSISA: 23',
    x: 1128,
    y: 242,
    parent: fId,
    props: { fontSize: 12, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
  })
  cmd('text.create', {
    text: 'BURN / HARI: Rp60.297',
    x: 1128,
    y: 266,
    parent: fId,
    props: { fontSize: 12, fontFamily: 'Inter', fontWeight: 700, fill: C.redDanger }
  })

  // Aside: Action Button
  cmd('shape.rectangle', {
    name: 'Btn Tambah Budget',
    x: 1108,
    y: 800,
    width: 284,
    height: 48,
    parent: fId,
    props: { fills: [{ type: 'solid', color: C.blueAzure }], cornerRadius: 14 }
  })
  cmd('text.create', {
    text: '+ Buat Budget Baru',
    x: 1176,
    y: 816,
    parent: fId,
    props: { fontSize: 14, fontFamily: 'Inter', fontWeight: 700, fill: '#ffffff' }
  })
})

// Main Content: Total Semua Saldo Hero Card
cmd('shape.rectangle', {
  name: 'Hero Total Semua Saldo',
  x: 298,
  y: 90,
  width: 760,
  height: 120,
  parent: budgetFrame,
  props: {
    fills: [{ type: 'solid', color: C.white }],
    cornerRadius: 24,
    stroke: '#ffffff',
    strokeWeight: 1.5
  }
})
cmd('text.create', {
  text: 'TOTAL SEMUA SALDO',
  x: 326,
  y: 114,
  parent: budgetFrame,
  props: { fontSize: 12, fontFamily: 'Inter', fontWeight: 700, fill: C.textSubtle }
})
cmd('text.create', {
  text: 'Rp 1.694.446',
  x: 326,
  y: 140,
  parent: budgetFrame,
  props: { fontSize: 28, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
})
cmd('text.create', {
  text: 'Pemasukan: Rp230.000  |  Pengeluaran: Rp482.377',
  x: 720,
  y: 146,
  parent: budgetFrame,
  props: { fontSize: 13, fontFamily: 'Inter', fill: C.textMuted }
})

// Grid Rekening (4 Cards)
const accounts = [
  { name: 'Dompet', type: 'Cash', balance: 'Rp820.974', last: '+Rp230.000 Transaksi Lainnya', x: 298, y: 236 },
  { name: 'Seabank / Shopee', type: 'E-Wallet', balance: '-Rp1.351.195', last: 'Pindah saldo dari Krom', x: 686, y: 236 },
  { name: 'Go-Pay', type: 'E-Wallet', balance: 'Rp80.000', last: '+Rp10.000 Transaksi Bonus', x: 298, y: 400 },
  { name: 'OVO', type: 'E-Wallet', balance: 'Rp48.000', last: '-Rp12.000 Pengeluaran', x: 686, y: 400 }
]

accounts.forEach((acc) => {
  cmd('shape.rectangle', {
    name: `Card ${acc.name}`,
    x: acc.x,
    y: acc.y,
    width: 372,
    height: 144,
    parent: budgetFrame,
    props: {
      fills: [{ type: 'solid', color: C.white }],
      cornerRadius: 22,
      stroke: '#ffffff',
      strokeWeight: 1.5
    }
  })
  cmd('text.create', {
    text: acc.name,
    x: acc.x + 24,
    y: acc.y + 24,
    parent: budgetFrame,
    props: { fontSize: 16, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
  })
  cmd('shape.rectangle', {
    name: 'Type Badge',
    x: acc.x + 280,
    y: acc.y + 20,
    width: 68,
    height: 24,
    parent: budgetFrame,
    props: { fills: [{ type: 'solid', color: '#f1f5f9' }], cornerRadius: 8 }
  })
  cmd('text.create', {
    text: acc.type,
    x: acc.x + 294,
    y: acc.y + 26,
    parent: budgetFrame,
    props: { fontSize: 11, fontFamily: 'Inter', fill: C.textMuted }
  })
  cmd('text.create', {
    text: acc.balance,
    x: acc.x + 24,
    y: acc.y + 60,
    parent: budgetFrame,
    props: { fontSize: 20, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
  })
  cmd('text.create', {
    text: acc.last,
    x: acc.x + 24,
    y: acc.y + 102,
    parent: budgetFrame,
    props: { fontSize: 12, fontFamily: 'Inter', fill: C.textMuted }
  })
})

// ============================================================================
// 5. VIEW 4: UTANG & CICILAN (1440 x 900) at (3240, 1000)
// ============================================================================
console.log('Slicing Utang & Cicilan View...')
const utangFrame = buildShell('Desktop — Utang & Cicilan', 3240, 1000, 'Utang', 'Ringkasan Utang', (fId) => {
  // Aside: Progres Pelunasan Ring Card
  cmd('shape.rectangle', {
    name: 'Aside Card Progres',
    x: 1108,
    y: 96,
    width: 284,
    height: 110,
    parent: fId,
    props: { fills: [{ type: 'solid', color: '#064e3b' }], cornerRadius: 20 }
  })
  // 79% Circle Ring Simulation
  cmd('shape.rectangle', {
    name: 'Ring Circle',
    x: 1128,
    y: 116,
    width: 64,
    height: 64,
    parent: fId,
    props: { fills: [{ type: 'solid', color: C.mintPrimary }], cornerRadius: 32 }
  })
  cmd('text.create', {
    text: '79%',
    x: 1144,
    y: 138,
    parent: fId,
    props: { fontSize: 16, fontFamily: 'Inter', fontWeight: 700, fill: '#ffffff' }
  })
  cmd('text.create', {
    text: 'PROGRES PELUNASAN',
    x: 1204,
    y: 122,
    parent: fId,
    props: { fontSize: 10, fontFamily: 'Inter', fontWeight: 700, fill: '#a7f3d0' }
  })
  cmd('text.create', {
    text: 'Rp965.234',
    x: 1204,
    y: 140,
    parent: fId,
    props: { fontSize: 18, fontFamily: 'Inter', fontWeight: 700, fill: '#ffffff' }
  })
  cmd('text.create', {
    text: 'dari Rp4.687.014',
    x: 1204,
    y: 164,
    parent: fId,
    props: { fontSize: 11, fontFamily: 'Inter', fill: '#d1fae5' }
  })

  // Aside: Jatuh Tempo Terdekat
  cmd('shape.rectangle', {
    name: 'Aside Card Jatuh Tempo',
    x: 1108,
    y: 222,
    width: 284,
    height: 140,
    parent: fId,
    props: { fills: [{ type: 'solid', color: '#f8faf9' }], cornerRadius: 18 }
  })
  cmd('text.create', {
    text: 'JATUH TEMPO TERDEKAT',
    x: 1124,
    y: 238,
    parent: fId,
    props: { fontSize: 11, fontFamily: 'Inter', fontWeight: 700, fill: C.textSubtle }
  })
  const dues = [
    { name: 'Spaylater', time: '26h', amount: 'Rp23.239' },
    { name: 'Spaylater', time: '57h', amount: 'Rp23.239' },
    { name: 'Spinjam', time: '150h', amount: 'Rp918.756' }
  ]
  dues.forEach((d, idx) => {
    const dy = 262 + idx * 26
    cmd('text.create', {
      text: `● ${d.name} (${d.time}): ${d.amount}`,
      x: 1124,
      y: dy,
      parent: fId,
      props: { fontSize: 12, fontFamily: 'Inter', fill: C.textDark }
    })
  })

  // Aside: Action Buttons
  cmd('shape.rectangle', {
    name: 'Btn Tambah Utang',
    x: 1108,
    y: 790,
    width: 136,
    height: 48,
    parent: fId,
    props: { fills: [{ type: 'solid', color: '#dc2626' }], cornerRadius: 14 }
  })
  cmd('text.create', {
    text: '+ Utang',
    x: 1150,
    y: 806,
    parent: fId,
    props: { fontSize: 13, fontFamily: 'Inter', fontWeight: 700, fill: '#ffffff' }
  })

  cmd('shape.rectangle', {
    name: 'Btn Tambah Cicilan',
    x: 1256,
    y: 790,
    width: 136,
    height: 48,
    parent: fId,
    props: { fills: [{ type: 'solid', color: '#b91c1c' }], cornerRadius: 14 }
  })
  cmd('text.create', {
    text: '+ Cicilan',
    x: 1294,
    y: 806,
    parent: fId,
    props: { fontSize: 13, fontFamily: 'Inter', fontWeight: 700, fill: '#ffffff' }
  })
})

// Main Content Utang: 3 Metric Pills
const utangMetrics = [
  { label: 'TOTAL UTANG', amount: 'Rp965.234', sub: '3 aktif' },
  { label: 'LUNAS', amount: 'Rp2.573.335', sub: '4 item lunas' },
  { label: 'CICILAN AKTIF', amount: '1', sub: 'Rp229.689/bln' }
]
utangMetrics.forEach((m, idx) => {
  const mx = 298 + idx * 258
  cmd('shape.rectangle', {
    name: `Card ${m.label}`,
    x: mx,
    y: 24,
    width: 244,
    height: 100,
    parent: utangFrame,
    props: {
      fills: [{ type: 'solid', color: C.white }],
      cornerRadius: 20,
      stroke: '#ffffff',
      strokeWeight: 1.5
    }
  })
  cmd('text.create', {
    text: m.label,
    x: mx + 20,
    y: 42,
    parent: utangFrame,
    props: { fontSize: 11, fontFamily: 'Inter', fontWeight: 700, fill: C.textSubtle }
  })
  cmd('text.create', {
    text: m.amount,
    x: mx + 20,
    y: 62,
    parent: utangFrame,
    props: { fontSize: 20, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
  })
  cmd('text.create', {
    text: m.sub,
    x: mx + 20,
    y: 92,
    parent: utangFrame,
    props: { fontSize: 11, fontFamily: 'Inter', fill: C.textMuted }
  })
})

// Utang Debt Cards (2x2 Grid)
const debts = [
  { name: 'Spaylater', rem: 'Rp23.239', due: 'Jatuh tempo 4 Des (26 hari lagi)', x: 298, y: 144 },
  { name: 'Spaylater', rem: 'Rp23.239', due: 'Jatuh tempo 4 Jan (57 hari lagi)', x: 686, y: 144 },
  { name: 'Spinjam', rem: 'Rp918.756', due: 'Cicilan Rp229.689/bln', x: 298, y: 320 },
  { name: 'Spaylater', rem: 'Rp0', due: 'Sudah lunas', x: 686, y: 320 }
]

debts.forEach((d) => {
  cmd('shape.rectangle', {
    name: `Card ${d.name}`,
    x: d.x,
    y: d.y,
    width: 372,
    height: 156,
    parent: utangFrame,
    props: {
      fills: [{ type: 'solid', color: C.white }],
      cornerRadius: 22,
      stroke: '#ffffff',
      strokeWeight: 1.5
    }
  })
  cmd('text.create', {
    text: d.name,
    x: d.x + 20,
    y: d.y + 20,
    parent: utangFrame,
    props: { fontSize: 16, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
  })
  cmd('text.create', {
    text: 'SISA UTANG',
    x: d.x + 20,
    y: d.y + 48,
    parent: utangFrame,
    props: { fontSize: 10, fontFamily: 'Inter', fontWeight: 700, fill: C.textSubtle }
  })
  cmd('text.create', {
    text: d.rem,
    x: d.x + 20,
    y: d.y + 68,
    parent: utangFrame,
    props: { fontSize: 24, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
  })
  cmd('text.create', {
    text: d.due,
    x: d.x + 20,
    y: d.y + 116,
    parent: utangFrame,
    props: { fontSize: 12, fontFamily: 'Inter', fill: C.textMuted }
  })
  // Action Buttons
  cmd('shape.rectangle', {
    name: 'Btn Bayar',
    x: d.x + 276,
    y: d.y + 64,
    width: 76,
    height: 38,
    parent: utangFrame,
    props: { fills: [{ type: 'solid', color: C.shelfMint }], cornerRadius: 12 }
  })
  cmd('text.create', {
    text: 'Bayar',
    x: d.x + 296,
    y: d.y + 74,
    parent: utangFrame,
    props: { fontSize: 13, fontFamily: 'Inter', fontWeight: 700, fill: '#ffffff' }
  })
})

// ============================================================================
// 6. VIEW 5: MOBILE TRANSAKSI & FAB VIEW (390 x 844) at (4780, 0)
// ============================================================================
console.log('Slicing Mobile View...')
cmd('frame.create', {
  name: 'Mobile — Transaksi & FAB View',
  x: 4780,
  y: 0,
  width: 390,
  height: 844,
  props: { fills: [{ type: 'solid', color: C.canvas }] }
})
const mRoot = { $step: commands.length - 1 }

// Mobile Header
cmd('shape.rectangle', {
  name: 'Mobile Header Bar',
  x: 16,
  y: 44,
  width: 358,
  height: 60,
  parent: mRoot,
  props: { fills: [{ type: 'solid', color: C.white }], cornerRadius: 20 }
})
cmd('text.create', {
  text: 'MyDuit',
  x: 72,
  y: 60,
  parent: mRoot,
  props: { fontSize: 18, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
})

// Mobile Hero Card
cmd('shape.rectangle', {
  name: 'Mobile Hero Total Saldo',
  x: 16,
  y: 118,
  width: 358,
  height: 100,
  parent: mRoot,
  props: { fills: [{ type: 'solid', color: C.white }], cornerRadius: 22 }
})
cmd('text.create', {
  text: 'TOTAL SALDO',
  x: 36,
  y: 136,
  parent: mRoot,
  props: { fontSize: 11, fontFamily: 'Inter', fontWeight: 700, fill: C.textSubtle }
})
cmd('text.create', {
  text: 'Rp 1.694.446',
  x: 36,
  y: 156,
  parent: mRoot,
  props: { fontSize: 24, fontFamily: 'Inter', fontWeight: 700, fill: C.textDark }
})

// Mobile Bottom Nav Bar with Central 3D FAB
cmd('shape.rectangle', {
  name: 'Mobile Bottom Dock',
  x: 16,
  y: 750,
  width: 358,
  height: 64,
  parent: mRoot,
  props: { fills: [{ type: 'solid', color: C.white }], cornerRadius: 24 }
})
// Central Elevated 3D FAB
cmd('shape.rectangle', {
  name: 'Central 3D FAB',
  x: 167,
  y: 724,
  width: 56,
  height: 56,
  parent: mRoot,
  props: {
    fills: [{ type: 'solid', color: C.mintPrimary }],
    cornerRadius: 28,
    stroke: '#ffffff',
    strokeWeight: 3
  }
})
cmd('text.create', {
  text: '+',
  x: 186,
  y: 732,
  parent: mRoot,
  props: { fontSize: 28, fontFamily: 'Inter', fontWeight: 700, fill: '#ffffff' }
})

// Save script
const scriptPath = join(process.cwd(), 'design', 'slice_pwa_script.json')
writeFileSync(scriptPath, JSON.stringify(commands, null, 2), 'utf-8')
console.log(`Saved ${commands.length} slicing commands to ${scriptPath}`)
