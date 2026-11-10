(function () {
  try {
    var t = localStorage.getItem('myduit:theme') || 'neumorphism'
    document.documentElement.setAttribute('data-theme', t)
  } catch {
    // Abaikan error storage pada mode terisolasi
  }

  window.addEventListener('vite:preloadError', function () {
    try {
      if (!sessionStorage.getItem('myduit-preload-reload')) {
        sessionStorage.setItem('myduit-preload-reload', '1')
        window.location.reload()
      }
    } catch {
      window.location.reload()
    }
  })
})()

