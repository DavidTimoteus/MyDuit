const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const PORT_TETAP = 45781
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function loadDesktopConfig() {
  try {
    const cfgPath = path.join(__dirname, 'desktop-config.json')
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    }
  } catch {
    // Abaikan config rusak
  }
  return { googleDesktopClientId: '' }
}

const desktopConfig = loadDesktopConfig()
let staticServer = null
let mainWindow = null
let activeAppOrigin = ''

function startStaticServer() {
  const wwwDir = fs.existsSync(path.join(__dirname, 'www', 'index.html'))
    ? path.join(__dirname, 'www')
    : path.resolve(__dirname, '..', 'dist')

  const handler = (req, res) => {
    const reqUrl = new URL(req.url || '/', 'http://localhost')
    let relPath = decodeURIComponent(reqUrl.pathname)
    if (relPath === '/') relPath = '/index.html'
    const safeRel = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '')
    let filePath = path.join(wwwDir, safeRel)

    if (!filePath.startsWith(wwwDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // SPA fallback — kecuali aset statis & legal docs
      if (relPath.startsWith('/assets/')) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }
      filePath = path.join(wwwDir, 'index.html')
    }

    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache, no-store, must-revalidate' : 'public, max-age=86400',
    })
    fs.createReadStream(filePath).pipe(res)
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    server.once('error', () => {
      // Fallback port acak bila PORT_TETAP terpakai aplikasi lain
      const fallback = http.createServer(handler)
      fallback.once('error', reject)
      fallback.listen(0, '127.0.0.1', () => {
        staticServer = fallback
        resolve(`http://localhost:${fallback.address().port}`)
      })
    })
    server.listen(PORT_TETAP, '127.0.0.1', () => {
      staticServer = server
      resolve(`http://localhost:${PORT_TETAP}`)
    })
  })
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function runGoogleOAuthLoopback(clientId) {
  return new Promise((resolve, reject) => {
    const codeVerifier = base64url(crypto.randomBytes(32))
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest())
    const state = base64url(crypto.randomBytes(16))

    let settled = false
    const cbServer = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url || '/', 'http://127.0.0.1')
        if (u.pathname !== '/oauth-callback') {
          res.writeHead(404)
          res.end('Not found')
          return
        }
        const err = u.searchParams.get('error')
        const code = u.searchParams.get('code')
        const gotState = u.searchParams.get('state')

        if (err || !code || gotState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<h2>Login dibatalkan / Sign-in cancelled</h2><p>Anda dapat menutup tab ini dan kembali ke aplikasi MyDuit.</p>')
          if (!settled) {
            settled = true
            cbServer.close()
            mainWindow?.focus()
            reject(new Error(err || 'Autentikasi Google tidak selesai.'))
          }
          return
        }

        const redirectUri = `http://127.0.0.1:${cbServer.address().port}/oauth-callback`
        const tokenParams = new URLSearchParams({
          client_id: clientId,
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        })
        if (desktopConfig.googleDesktopClientSecret) {
          tokenParams.set('client_secret', desktopConfig.googleDesktopClientSecret)
        }
        const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: tokenParams,
        })
        const tokenJson = await tokenResp.json()
        if (!tokenResp.ok || !tokenJson.id_token) {
          throw new Error(tokenJson.error_description || tokenJson.error || 'Gagal menukar token Google.')
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(`<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:48px;background:#f4f7f5;color:#1b4332">
          <h2>Login MyDuit Berhasil! / Sign-In Complete!</h2>
          <p>Silakan tutup tab browser ini untuk kembali ke aplikasi desktop MyDuit.</p>
          <script>setTimeout(()=>window.close(), 1200)</script>
        </body></html>`)

        if (!settled) {
          settled = true
          cbServer.close()
          mainWindow?.focus()
          resolve({ idToken: tokenJson.id_token })
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Authentication error')
        if (!settled) {
          settled = true
          cbServer.close()
          mainWindow?.focus()
          reject(e)
        }
      }
    })

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        cbServer.close()
        reject(new Error('Waktu login Google habis (timeout).'))
      }
    }, 180_000)

    cbServer.once('close', () => clearTimeout(timer))
    cbServer.listen(0, '127.0.0.1', () => {
      const port = cbServer.address().port
      const redirectUri = `http://127.0.0.1:${port}/oauth-callback`
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      authUrl.searchParams.set('client_id', clientId)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', 'openid email profile')
      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('prompt', 'select_account')
      shell.openExternal(authUrl.toString())
    })
  })
}

function createWindow(startUrl) {
  Menu.setApplicationMenu(null)
  const iconPath = fs.existsSync(path.join(__dirname, 'build', 'icon.png'))
    ? path.join(__dirname, 'build', 'icon.png')
    : undefined

  const win = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 420,
    minHeight: 680,
    title: 'MyDuit',
    icon: iconPath,
    backgroundColor: '#E5E5E5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Izinkan popup Firebase Auth (accounts.google.com / firebaseapp) sebagai fallback;
  // tautan luar lainnya diarahkan aman ke browser sistem pengguna.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const isAuthPopup =
      url.startsWith('https://accounts.google.com/') ||
      url.includes('.firebaseapp.com/__/auth/') ||
      url.startsWith(activeAppOrigin)
    if (isAuthPopup) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: win,
          width: 520,
          height: 680,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.loadURL(startUrl)
  mainWindow = win
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    ipcMain.handle('myduit:get-config', () => ({
      hasLoopbackClient: Boolean(desktopConfig.googleDesktopClientId),
    }))
    ipcMain.handle('myduit:oauth-loopback', async () => {
      if (!desktopConfig.googleDesktopClientId) {
        throw new Error('Google Desktop Client ID belum dikonfigurasi.')
      }
      return runGoogleOAuthLoopback(desktopConfig.googleDesktopClientId)
    })

    activeAppOrigin = await startStaticServer()
    createWindow(activeAppOrigin)
  })

  app.on('window-all-closed', () => {
    if (staticServer) staticServer.close()
    if (process.platform !== 'darwin') app.quit()
  })
}
