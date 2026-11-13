import { useEffect, useState } from 'react'
import { EVENT_LOKASI, uangAktif } from './format.js'
import { EVENT_KURS } from './kurs.js'

/**
 * Hook reaktif untuk memicu render ulang komponen saat lokasi/mata uang
 * atau kurs global live diperbarui. Mengembalikan tag versi stabil (`CUR:N`).
 */
export function useKursVersi() {
  const [ver, setVer] = useState(0)

  useEffect(() => {
    const bump = () => setVer((v) => v + 1)
    window.addEventListener(EVENT_KURS, bump)
    window.addEventListener(EVENT_LOKASI, bump)
    return () => {
      window.removeEventListener(EVENT_KURS, bump)
      window.removeEventListener(EVENT_LOKASI, bump)
    }
  }, [])

  return `${uangAktif().currency}:${ver}`
}

