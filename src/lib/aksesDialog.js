// Aksesibilitas dialog (Fase 6 re-audit: R-06 focus trap, R-07 Escape,
// R-08 role="dialog"). Satu hook dipakai semua modal supaya perilaku
// keyboard konsisten: Escape menutup, Tab berputar di dalam dialog, fokus
// kembali ke pemicu saat dialog ditutup.
import { useEffect, useRef } from 'react'

// Selektor elemen yang bisa menerima fokus keyboard (pola standar dialog).
export const SELEKTOR_FOKUSABEL =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Daftar elemen fokusabel yang sedang terlihat di dalam wadah. Elemen
// disabled dan yang tersembunyi (offsetParent null) dibuang — tanpanya Tab
// bisa "hilang" ke tombol yang tidak terlihat.
export function daftarFokusabel(el) {
  if (!el?.querySelectorAll) return []
  return [...el.querySelectorAll(SELEKTOR_FOKUSABEL)].filter(
    (n) => !n.disabled && n.offsetParent !== null,
  )
}

// Penjaga keyboard murni (tanpa React) supaya bisa diuji node tanpa browser:
// Escape -> onClose; Tab di ujung -> lompat ke ujung seberang; tanpa elemen
// fokusabel -> Tab dicegah supaya fokus tidak kabur ke belakang dialog.
export function buatPenjagaDialog(el, onClose) {
  return function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation?.()
      onClose?.()
      return
    }
    if (e.key !== 'Tab') return
    const daftar = daftarFokusabel(el)
    if (!daftar.length) {
      e.preventDefault()
      return
    }
    const pertama = daftar[0]
    const terakhir = daftar[daftar.length - 1]
    if (e.shiftKey && document.activeElement === pertama) {
      e.preventDefault()
      terakhir.focus()
    } else if (!e.shiftKey && document.activeElement === terakhir) {
      e.preventDefault()
      pertama.focus()
    }
  }
}

// Hook dialog: pasang penjaga saat dialog terbuka; saat dibuka, fokus ke
// elemen [data-fokus-awal] (atau elemen fokusabel pertama, atau wadah
// sendiri bila tidak ada); saat ditutup, fokus kembali ke pemicu.
// onClose disimpan di ref supaya identitasnya yang berubah tiap render
// tidak membuat effect pasang-lepas listener berulang.
export function useDialogAkses(refDialog, terbuka, onClose) {
  const refTutup = useRef(onClose)
  refTutup.current = onClose

  useEffect(() => {
    if (!terbuka) return
    const el = refDialog.current
    if (!el) return
    const pemicu = document.activeElement
    const target =
      el.querySelector('[data-fokus-awal]') ?? daftarFokusabel(el)[0] ?? el
    target.focus?.()
    const jaga = buatPenjagaDialog(el, () => refTutup.current?.())
    document.addEventListener('keydown', jaga, true)
    return () => {
      document.removeEventListener('keydown', jaga, true)
      if (pemicu && pemicu.focus) pemicu.focus()
    }
  }, [terbuka, refDialog])
}
