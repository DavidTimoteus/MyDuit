import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import 'flatpickr/dist/flatpickr.min.css'
import './styles/index.css'

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  // Cek update service worker dan auto refresh jika versi baru terdeteksi
  navigator.serviceWorker.ready.then((reg) => {
    reg.update().catch(() => {})
  })
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Hindari infinite loop saat reload
    if (!window._swReloading) {
      window._swReloading = true
      window.location.reload()
    }
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
