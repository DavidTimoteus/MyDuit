const { contextBridge, ipcRenderer } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const pkg = require('./package.json')

let hasLoopbackClient = false
try {
  const cfgPath = path.join(__dirname, 'desktop-config.json')
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    hasLoopbackClient = Boolean(cfg?.googleDesktopClientId)
  }
} catch {
  hasLoopbackClient = false
}

contextBridge.exposeInMainWorld('myduitDesktop', {
  isDesktop: true,
  platform: process.platform,
  appVersion: pkg.version,
  hasLoopbackClient,
  loginGoogleLoopback: () => ipcRenderer.invoke('myduit:oauth-loopback'),
})

