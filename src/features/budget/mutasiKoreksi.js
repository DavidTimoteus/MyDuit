// Logika murni untuk ringkasan koreksi saldo di menu Budget.
// Tidak bergantung pada Firestore/React supaya bisa diuji langsung di Node.
// Sumber utama = koleksi mutasiLog (append-only, satu dokumen per koreksi).
// mutasiTerakhir di dokumen akun dipakai hanya sebagai fallback data lama.
import { isoDari, tanggalRelatifLabel } from '../../lib/format.js'

export function waktuMillis(v) {
  if (!v) return 0
  if (typeof v === 'number') return v
  if (typeof v.toMillis === 'function') return v.toMillis()
  if (typeof v.toDate === 'function') {
    const d = v.toDate()
    return d instanceof Date && !isNaN(d.getTime()) ? d.getTime() : 0
  }
  if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6)
  if (typeof v === 'string') {
    const n = Date.parse(v)
    return isNaN(n) ? 0 : n
  }
  const d = new Date(v)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

export function jamDariWaktu(v) {
  const ms = waktuMillis(v)
  if (!ms) return ''
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Gabungkan entri log + fallback legacy, hilangkan duplikat, urutkan terbaru dulu.
export function gabungkanKoreksi(logs = [], akunList = []) {
  const rows = []
  const minLogPerAkun = new Map()

  for (const l of logs) {
    if (!l || l.deleted || !/koreksi/i.test(l.aksi || '')) continue
    const delta = Number(l.delta) || 0
    if (!delta) continue
    const waktu = waktuMillis(l.timestamp ?? l.createdAt)
    rows.push({
      id: l.id || `log-${l.akunId}-${waktu}-${rows.length}`,
      akunId: l.akunId,
      delta,
      waktu,
      sumber: 'log',
    })
    const sebelum = minLogPerAkun.get(l.akunId)
    if (sebelum === undefined || waktu < sebelum) minLogPerAkun.set(l.akunId, waktu)
  }

  for (const a of akunList) {
    const m = a?.mutasiTerakhir
    if (!m || !/koreksi penyesuaian saldo/i.test(m.keterangan || '')) continue
    const delta = Number(m.delta) || 0
    if (!delta) continue
    const waktu = waktuMillis(m.at)
    const minLog = minLogPerAkun.get(a.id)
    // Kalau log sudah mencakup masa legacy ini, jangan dobel tampilkan.
    if (minLog !== undefined && waktu >= minLog) continue
    rows.push({
      id: `legacy-${a.id}`,
      akunId: a.id,
      delta,
      waktu,
      sumber: 'legacy',
    })
  }

  return rows.sort((x, y) => y.waktu - x.waktu)
}

export function ringkasKoreksi(rows = []) {
  const akun = new Set(rows.map((r) => r.akunId).filter(Boolean))
  return {
    total: rows.reduce((s, r) => s + r.delta, 0),
    jumlah: rows.length,
    akunCount: akun.size,
  }
}

// Kelompokkan berdasarkan tanggal lokal. `rows` sudah terurut terbaru dulu,
// sehingga grup juga otomatis terurut: Hari Ini, Kemarin, lalu tanggal lama.
export function grupKoreksi(rows = []) {
  const grup = new Map()
  for (const r of rows) {
    const iso = isoDari(new Date(r.waktu))
    if (!grup.has(iso)) grup.set(iso, { key: iso, label: tanggalRelatifLabel(iso), items: [] })
    grup.get(iso).items.push(r)
  }
  return [...grup.values()]
}
