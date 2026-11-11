import { useEffect, useState } from 'react'

/**
 * Mengecek preferensi aksesibilitas `prefers-reduced-motion: reduce`.
 */
export function prefersReducedMotion(win = typeof window !== 'undefined' ? window : null) {
  try {
    return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
  } catch {
    return false
  }
}

/**
 * Menghitung jeda stagger (ms) dengan batas maksimum agar daftar panjang tetap gesit.
 */
export function computeRevealDelayMs(index, maxSteps = 5, stepMs = 36) {
  const idx = Math.max(0, Number(index) || 0)
  return Math.min(idx, maxSteps) * stepMs
}

/**
 * Menemukan kontainer scroll utama (`.main-scroll` atau ancestor scrollable terdekat).
 */
export function findScrollRoot(node) {
  if (typeof document === 'undefined') return null
  let cur = node?.parentElement ?? node ?? null
  while (cur && cur !== document.body && cur !== document.documentElement) {
    if (cur.classList?.contains('main-scroll')) return cur
    cur = cur.parentElement
  }
  return document.querySelector('.main-scroll') || null
}

/**
 * Mengklasifikasikan elemen `[data-reveal]` terhadap viewport `.main-scroll`.
 * - 'skip'    : elemen tersembunyi (display:none / 0x0), abaikan.
 * - 'visible' : sudah di dalam atau di atas viewport — wajib tampil instan tanpa opacity:0.
 * - 'pending' : di bawah lipatan bawah viewport (below the fold) — animasikan saat scroll.
 */
export function classifyRevealTarget(elRect, rootRect, marginPx = 8) {
  if (!elRect || (elRect.width <= 0 && elRect.height <= 0)) return 'skip'
  const bottomLimit = rootRect?.bottom ?? 800
  if (elRect.top < bottomLimit - marginPx) return 'visible'
  return 'pending'
}

/**
 * Scroll-triggered reveal self-cleaning berbasis IntersectionObserver pada `.main-scroll`.
 * Elemen yang sudah terlihat langsung tampil (`opacity: 1`), sedangkan elemen di bawah
 * lipatan layar beranimasi masuk saat di-scroll lalu membersihkan kelas & transform pada
 * `animationend` sehingga elemen kembali bersih (`transform: none`).
 */
export function useScrollReveal(containerRef, deps = []) {
  useEffect(() => {
    const host = containerRef?.current
    if (!host || typeof document === 'undefined') return undefined

    const targets = []
    if (host.hasAttribute?.('data-reveal')) targets.push(host)
    targets.push(...host.querySelectorAll('[data-reveal]'))
    if (targets.length === 0) return undefined

    const finishReveal = (el) => {
      el.classList.remove('scroll-reveal-pending', 'scroll-reveal-run')
      el.style.removeProperty('--reveal-delay')
      el.dataset.scrollRevealed = '1'
    }

    const unrevealed = targets.filter((el) => el.dataset.scrollRevealed !== '1')
    if (unrevealed.length === 0) return undefined

    if (prefersReducedMotion() || typeof IntersectionObserver !== 'function') {
      unrevealed.forEach(finishReveal)
      return undefined
    }

    const scrollRoot = findScrollRoot(host)
    const getRootRect = () =>
      scrollRoot
        ? scrollRoot.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight || 800 }
    const rootRect = getRootRect()

    const pendingSet = new Set()
    const activeTimers = new Set()

    const runReveal = (el, delayMs) => {
      pendingSet.delete(el)
      el.classList.remove('scroll-reveal-pending')
      if (delayMs > 0) el.style.setProperty('--reveal-delay', `${delayMs}ms`)
      else el.style.removeProperty('--reveal-delay')
      el.classList.add('scroll-reveal-run')

      let settled = false
      const cleanup = () => {
        if (settled) return
        settled = true
        finishReveal(el)
      }
      el.addEventListener('animationend', cleanup, { once: true })
      const fallbackId = window.setTimeout(() => {
        activeTimers.delete(fallbackId)
        cleanup()
      }, (delayMs || 0) + 420)
      activeTimers.add(fallbackId)
    }

    for (const el of unrevealed) {
      const rect = el.getBoundingClientRect()
      const kind = classifyRevealTarget(rect, rootRect)
      if (kind === 'skip') continue
      if (kind === 'visible') {
        finishReveal(el)
      } else {
        el.classList.add('scroll-reveal-pending')
        pendingSet.add(el)
      }
    }

    if (pendingSet.size === 0) return undefined

    // Jaga class pending bila React me-re-render elemen offscreen sebelum masuk viewport.
    let classObserver = null
    if (typeof MutationObserver === 'function') {
      classObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          const el = m.target
          if (pendingSet.has(el) && !el.classList.contains('scroll-reveal-pending')) {
            el.classList.add('scroll-reveal-pending')
          }
        }
      })
      pendingSet.forEach((el) => classObserver.observe(el, { attributes: true, attributeFilter: ['class'] }))
    }

    let observer = null
    let scrollRaf = 0
    const scrollTarget = scrollRoot || window

    const sweepVisible = (marginPx = 24) => {
      if (pendingSet.size === 0) return
      const nowRect = getRootRect()
      let batchIdx = 0
      for (const el of [...pendingSet]) {
        const r = el.getBoundingClientRect()
        if (r.width <= 0 && r.height <= 0) {
          pendingSet.delete(el)
          observer?.unobserve(el)
          el.classList.remove('scroll-reveal-pending')
          continue
        }
        if (r.top < nowRect.bottom + marginPx) {
          observer?.unobserve(el)
          runReveal(el, computeRevealDelayMs(batchIdx, 3, 36))
          batchIdx++
        }
      }
    }

    observer = new IntersectionObserver(
      (entries) => {
        let batchIdx = 0
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const el = entry.target
          if (!pendingSet.has(el)) continue
          observer.unobserve(el)
          runReveal(el, computeRevealDelayMs(batchIdx, 3, 36))
          batchIdx++
        }
      },
      {
        root: scrollRoot,
        threshold: 0.01,
        rootMargin: '0px 0px 24px 0px',
      },
    )
    pendingSet.forEach((el) => observer.observe(el))

    const onScrollSweep = () => {
      if (scrollRaf || pendingSet.size === 0) return
      scrollRaf = window.requestAnimationFrame(() => {
        scrollRaf = 0
        sweepVisible(24)
      })
    }
    scrollTarget.addEventListener('scroll', onScrollSweep, { passive: true })

    return () => {
      if (scrollRaf) window.cancelAnimationFrame(scrollRaf)
      activeTimers.forEach((t) => window.clearTimeout(t))
      activeTimers.clear()
      scrollTarget.removeEventListener('scroll', onScrollSweep)
      observer?.disconnect()
      classObserver?.disconnect()
      // Jangan pernah meninggalkan elemen off-screen terjebak opacity: 0 saat deps berubah/unmount
      pendingSet.forEach((el) => el.classList.remove('scroll-reveal-pending'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/**
 * Memantau apakah kontainer `.main-scroll` telah digulir melewati ambang `threshold`
 * untuk mengaktifkan elevasi sticky header/toolbar.
 */
export function useScrolledState(targetRef, threshold = 6) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const el = targetRef?.current
    if (typeof window === 'undefined') return undefined
    const root = findScrollRoot(el)
    const target = root || window
    let ticking = false

    const readOffset = () => {
      ticking = false
      const top = root ? root.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0)
      setScrolled(top > threshold)
    }

    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(readOffset)
    }

    readOffset()
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => target.removeEventListener('scroll', onScroll)
  }, [targetRef, threshold])

  return scrolled
}

