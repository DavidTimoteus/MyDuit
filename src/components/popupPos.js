// Kalkulasi posisi popup fixed/portal (boundary-aware smart flip)
// Menghindari dropdown terpotong layar atau tertutup oleh keyboard virtual mobile.

export function calculatePopupPos(r, vh = (typeof window !== 'undefined' ? window.innerHeight : 800), vw = (typeof window !== 'undefined' ? window.innerWidth : 360)) {
  if (!r) return null
  const spaceBelow = vh - r.bottom
  const spaceAbove = r.top
  // Buka ke atas bila ruang di bawah sempit (< 180px, mis. keyboard virtual aktif)
  // dan ruang di atas lebih leluasa.
  const openUp = spaceBelow < 180 && spaceAbove > spaceBelow
  const width = Math.min(r.width, vw - 16)
  const left = Math.max(8, Math.min(r.left, vw - width - 8))

  if (openUp) {
    return {
      left,
      bottom: Math.max(8, vh - r.top + 6),
      top: 'auto',
      width,
      maxHeight: Math.max(120, Math.min(240, spaceAbove - 16)),
    }
  }

  return {
    left,
    top: r.bottom + 6,
    bottom: 'auto',
    width,
    maxHeight: Math.max(120, Math.min(240, spaceBelow - 16)),
  }
}
