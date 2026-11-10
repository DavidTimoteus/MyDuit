import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import 'flatpickr/dist/flatpickr.min.css'
import './styles/index.css'

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller)
  const MODAL_SELECTOR = '[aria-modal="true"], .modal-backdrop-wrap, .backdrop-blur-sm'
  // Cek update service worker dan refresh aman saat tidak mengganggu pengisian form
  navigator.serviceWorker.ready.then((reg) => {
    reg.update().catch(() => {})
  })
  const cobaReloadAman = () => {
    if (window._swReloading) return
    if (document.querySelector(MODAL_SELECTOR)) {
      window.dispatchEvent(
        new CustomEvent('myduit:toast', {
          detail: {
            type: 'info',
            msg: 'Pembaruan aplikasi siap diterapkan setelah Anda menutup jendela ini.',
          },
        }),
      )
      if (!window._swReloadObserver) {
        const obs = new MutationObserver(() => {
          if (!document.querySelector(MODAL_SELECTOR)) {
            obs.disconnect()
            window._swReloadObserver = null
            if (!window._swReloading) {
              window._swReloading = true
              window.location.reload()
            }
          }
        })
        obs.observe(document.body, { childList: true, subtree: true })
        window._swReloadObserver = obs
      }
      return
    }
    window._swReloading = true
    window.location.reload()
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Abaikan klaim awal SW pada kunjungan pertama (!hadController)
    if (!hadController) return
    cobaReloadAman()
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
