import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(__dirname, '..')
const rootDir = path.resolve(desktopDir, '..')

const srcDist = path.join(rootDir, 'dist')
const outWww = path.join(desktopDir, 'www')
const outBuild = path.join(desktopDir, 'build')

if (!fs.existsSync(srcDist)) {
  throw new Error('Folder dist/ tidak ditemukan. Jalankan "npm run build" di root proyek terlebih dahulu.')
}

fs.rmSync(outWww, { recursive: true, force: true })
fs.cpSync(srcDist, outWww, { recursive: true })

// Baca VITE_GOOGLE_DESKTOP_CLIENT_ID & opsional VITE_GOOGLE_DESKTOP_CLIENT_SECRET
function bacaEnvOpsional(namaVar) {
  let val = (process.env[namaVar] || '').trim()
  if (!val) {
    const envLocalPath = path.join(rootDir, '.env.local')
    if (fs.existsSync(envLocalPath)) {
      const raw = fs.readFileSync(envLocalPath, 'utf8')
      const re = new RegExp(`^\\s*${namaVar}\\s*=\\s*(.+)\\s*$`, 'm')
      const m = raw.match(re)
      if (m) val = m[1].trim().replace(/^['"]|['"]$/g, '')
    }
  }
  return val
}

const clientId = bacaEnvOpsional('VITE_GOOGLE_DESKTOP_CLIENT_ID')
const clientSecret = bacaEnvOpsional('VITE_GOOGLE_DESKTOP_CLIENT_SECRET')

fs.writeFileSync(
  path.join(desktopDir, 'desktop-config.json'),
  JSON.stringify(
    {
      googleDesktopClientId: clientId,
      ...(clientSecret ? { googleDesktopClientSecret: clientSecret } : {}),
    },
    null,
    2,
  ) + '\n',
)

// Siapkan icon.png & icon.ico valid untuk electron-builder / Windows taskbar
fs.mkdirSync(outBuild, { recursive: true })
const icon512Path = path.join(rootDir, 'public', 'icons', 'icon-512.png')
const icon192Path = path.join(rootDir, 'public', 'icons', 'icon-192.png')
if (!fs.existsSync(icon512Path) || !fs.existsSync(icon192Path)) {
  throw new Error('Ikon PWA public/icons/icon-512.png & icon-192.png tidak ditemukan.')
}
fs.copyFileSync(icon512Path, path.join(outBuild, 'icon.png'))

// Bangun ICO 256x256 (memakai canvas bila terpasang di root, atau fallback ke icon-192.png)
async function buildPngForIco() {
  try {
    const { createCanvas, loadImage } = await import('canvas')
    const img = await loadImage(icon512Path)
    const canvas = createCanvas(256, 256)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, 256, 256)
    return { buf: canvas.toBuffer('image/png'), dim: 0 } // 0 = 256px pada header ICO
  } catch {
    return { buf: fs.readFileSync(icon192Path), dim: 192 }
  }
}

const { buf: pngBuf, dim } = await buildPngForIco()
const icoHeader = Buffer.alloc(6)
icoHeader.writeUInt16LE(0, 0) // reserved
icoHeader.writeUInt16LE(1, 2) // 1 = ICO
icoHeader.writeUInt16LE(1, 4) // 1 image entry

const dirEntry = Buffer.alloc(16)
dirEntry.writeUInt8(dim, 0) // width (0 = 256)
dirEntry.writeUInt8(dim, 1) // height (0 = 256)
dirEntry.writeUInt8(0, 2) // color palette
dirEntry.writeUInt8(0, 3) // reserved
dirEntry.writeUInt16LE(1, 4) // color planes
dirEntry.writeUInt16LE(32, 6) // bits per pixel
dirEntry.writeUInt32LE(pngBuf.length, 8) // image bytes size
dirEntry.writeUInt32LE(6 + 16, 12) // image offset

fs.writeFileSync(path.join(outBuild, 'icon.ico'), Buffer.concat([icoHeader, dirEntry, pngBuf]))
console.log(`[desktop:prepare-web] www synced (${srcDist} -> ${outWww}), icon.ico generated.`)
