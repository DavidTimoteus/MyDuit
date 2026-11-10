import { useEffect, useState } from 'react'
import { isLocalMockAllowed } from '../features/auth/useAuth.js'

// Splash screen MyDuit — Neumorphism & Claymorphism adaptive
export default function Splash({ ready }) {
  const [leaving, setLeaving] = useState(false)
  const [mounted, setMounted] = useState(true)

  useEffect(() => {
    if (!ready) return
    const isMock =
      isLocalMockAllowed() &&
      typeof window !== 'undefined' &&
      (localStorage.getItem('myduit:mock_user') || localStorage.getItem('myduit:mock_unauth'))
    const minDisplay = isMock ? 100 : 350
    const fadeMs = 300
    let timer
    let unmountTimer

    timer = setTimeout(() => {
      setLeaving(true)
      unmountTimer = setTimeout(() => setMounted(false), fadeMs)
    }, minDisplay)

    return () => {
      clearTimeout(timer)
      clearTimeout(unmountTimer)
    }
  }, [ready])

  if (!mounted) return null

  return (
    <div id="splashScreen" className={`splash-screen${leaving ? ' is-leaving' : ''}`} aria-hidden={leaving}>
      <div className="splash-inner">
        <div className="splash-logo">
          <img src="/favicon.svg" alt="MyDuit" className="w-20 h-20" width="80" height="80" />
        </div>
        <div className="splash-title brand-title-embossed font-display font-extrabold tracking-tight text-3xl" aria-label="MyDuit">
          {'MyDuit'.split('').map((ch, i) => (
            <span key={i} className="splash-title-letter">{ch}</span>
          ))}
        </div>
        <div className="splash-tagline">Catat. Pantau. Kendalikan.</div>
        <div className="splash-sub">Pemasukan dan pengeluaranmu dalam satu tempat.</div>
        <div className="splash-dots" aria-hidden="true">
          <span className="splash-dot"></span>
          <span className="splash-dot"></span>
          <span className="splash-dot"></span>
          <span className="splash-dot"></span>
          <span className="splash-dot"></span>
          <span className="splash-dot"></span>
        </div>
      </div>
    </div>
  )
}
