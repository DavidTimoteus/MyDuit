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
 * Scroll-triggered reveal progresif berbasis IntersectionObserver pada `.main-scroll`.
 * Memakai atribut `data-reveal="pending|revealed"` yang kebal terhadap re-render `className`
 * React, sambil menjaga class `.scroll-reveal-pending` & `.is-revealed` tetap sinkron.
 */
export function useScrollReveal(containerRef, deps = []) {
  useEffect(() => {
    const host = containerRef?.current
    if (!host || typeof document === 'undefined') return undefined

    const targets = []
    if (host.hasAttribute?.('data-reveal')) targets.push(host)
    targets.push(...host.querySelectorAll('[data-reveal]'))
    if (targets.length === 0) return undefined

    const markPending = (el) => {
      el.setAttribute('data-reveal', 'pending')
      if (!el.classList.contains('scroll-reveal-pending')) el.classList.add('scroll-reveal-pending')
    }

    const markRevealed = (el, delayMs) => {
      if (delayMs != null) el.style.setProperty('--reveal-delay', `${delayMs}ms`)
      el.setAttribute('data-reveal', 'revealed')
      if (!el.classList.contains('scroll-reveal-pending')) el.classList.add('scroll-reveal-pending')
      if (!el.classList.contains('is-revealed')) el.classList.add('is-revealed')
    }

    // Sinkronkan ulang bila re-render React mengganti string `className` elemen `[data-reveal]`
    const syncClassWithState = (el) => {
      const state = el.getAttribute('data-reveal')
      if (state === 'revealed') {
        if (!el.classList.contains('scroll-reveal-pending')) el.classList.add('scroll-reveal-pending')
        if (!el.classList.contains('is-revealed')) el.classList.add('is-revealed')
      } else if (state === 'pending') {
        if (!el.classList.contains('scroll-reveal-pending')) el.classList.add('scroll-reveal-pending')
      }
    }

    let classObserver = null
    if (typeof MutationObserver === 'function') {
      classObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.target) syncClassWithState(m.target)
        }
      })
      targets.forEach((el) => {
        syncClassWithState(el)
        classObserver.observe(el, { attributes: true, attributeFilter: ['class'] })
      })
    }

    const unrevealed = targets.filter((el) => el.getAttribute('data-reveal') !== 'revealed')
    if (unrevealed.length === 0) {
      return () => {
        classObserver?.disconnect()
      }
    }

    if (prefersReducedMotion() || typeof IntersectionObserver !== 'function') {
      unrevealed.forEach((el) => {
        el.setAttribute('data-reveal', 'revealed')
        el.classList.remove('scroll-reveal-pending')
        if (!el.classList.contains('is-revealed')) el.classList.add('is-revealed')
      })
      return () => {
        classObserver?.disconnect()
      }
    }

    const scrollRoot = findScrollRoot(host)
    const getRootRect = () =>
      scrollRoot
        ? scrollRoot.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight || 800 }
    const rootRect = getRootRect()

    const pendingSet = new Set()
    const visibleNow = []

    for (const el of unrevealed) {
      const rect = el.getBoundingClientRect()
      if (rect.bottom <= rootRect.top) {
        markRevealed(el, 0)
      } else if (rect.top < rootRect.bottom - 8) {
        markPending(el)
        visibleNow.push(el)
      } else {
        markPending(el)
        pendingSet.add(el)
      }
    }

    visibleNow.forEach((el, idx) => {
      el.style.setProperty('--reveal-delay', `${computeRevealDelayMs(idx)}ms`)
    })

    let raf1 = 0
    let raf2 = 0
    if (visibleNow.length > 0) {
      raf1 = window.requestAnimationFrame(() => {
        raf2 = window.requestAnimationFrame(() => {
          visibleNow.forEach((el) => markRevealed(el))
        })
      })
    }

    let observer = null
    let scrollTarget = null
    let scrollRaf = 0
    let onScrollSweep = null

    const sweepVisible = (marginPx = 24) => {
      if (pendingSet.size === 0) return
      const nowRect = getRootRect()
      let batchCount = 0
      for (const el of [...pendingSet]) {
        const r = el.getBoundingClientRect()
        if (r.top < nowRect.bottom + marginPx) {
          markRevealed(el, computeRevealDelayMs(batchCount, 4, 32))
          pendingSet.delete(el)
          observer?.unobserve(el)
          batchCount++
        }
      }
      if (pendingSet.size === 0 && scrollTarget && onScrollSweep) {
        scrollTarget.removeEventListener('scroll', onScrollSweep)
      }
    }

    if (pendingSet.size > 0) {
      observer = new IntersectionObserver(
        (entries) => {
          let batchCount = 0
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            const el = entry.target
            markRevealed(el, computeRevealDelayMs(batchCount, 4, 32))
            pendingSet.delete(el)
            observer.unobserve(el)
            batchCount++
          }
          if (pendingSet.size === 0 && scrollTarget && onScrollSweep) {
            scrollTarget.removeEventListener('scroll', onScrollSweep)
          }
        },
        {
          root: scrollRoot,
          threshold: 0.01,
          rootMargin: '40px 0px 24px 0px',
        },
      )
      pendingSet.forEach((el) => observer.observe(el))

      scrollTarget = scrollRoot || window
      onScrollSweep = () => {
        if (scrollRaf || pendingSet.size === 0) return
        scrollRaf = window.requestAnimationFrame(() => {
          scrollRaf = 0
          sweepVisible(24)
        })
      }
      scrollTarget.addEventListener('scroll', onScrollSweep, { passive: true })
    }

    // Failsafe: pastikan elemen yang berada di dalam/dekat viewport selalu terungkap.
    const safetyTimer = window.setTimeout(() => {
      sweepVisible(60)
    }, 500)

    return () => {
      if (raf1) window.cancelAnimationFrame(raf1)
      if (raf2) window.cancelAnimationFrame(raf2)
      if (scrollRaf) window.cancelAnimationFrame(scrollRaf)
      window.clearTimeout(safetyTimer)
      if (scrollTarget && onScrollSweep) {
        scrollTarget.removeEventListener('scroll', onScrollSweep)
      }
      observer?.disconnect()
      classObserver?.disconnect()
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

