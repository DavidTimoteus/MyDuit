// Evaluator ekspresi kalkulator nominal murni (+, -, *, /) dengan tokenisasi aman strict CSP.
import { MAX_NOMINAL, uangAktif } from '../../lib/format.js'

const OP_MAP = { '×': '*', '÷': '/', '−': '-' }
const PRETTY_OP = { '+': '+', '-': '−', '*': '×', '/': '÷' }
const OPS = new Set(['+', '-', '*', '/'])

function normalisasiEkspresi(raw) {
  let s = String(raw ?? '').trim()
  if (!s) return ''
  for (const [k, v] of Object.entries(OP_MAP)) {
    s = s.replaceAll(k, v)
  }
  s = s.replace(/\s+/g, '')
  // Ubah koma desimal jadi titik
  s = s.replace(/,/g, '.')
  return s
}

function tokenisasi(expr) {
  const tokens = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let numStr = ''
      while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) {
        numStr += expr[i]
        i++
      }
      // Jika user memasukkan pemisah ribuan bergaya ID (mis. 15.000 atau 1.500.000),
      // konversi ke angka murni sebelum parseFloat.
      let normalizedNum = numStr
      if (/^\d{1,3}(\.\d{3})+$/.test(numStr)) {
        normalizedNum = numStr.replace(/\./g, '')
      } else if ((numStr.match(/\./g) || []).length > 1) {
        return null
      }
      const val = Number(normalizedNum)
      if (!Number.isFinite(val)) return null
      tokens.push({ type: 'num', value: val })
      continue
    }
    if (OPS.has(ch)) {
      // Minus unary di awal atau tepat setelah operator lain
      if (ch === '-' && (tokens.length === 0 || tokens[tokens.length - 1].type === 'op')) {
        let j = i + 1
        let numStr = '-'
        while (j < expr.length && ((expr[j] >= '0' && expr[j] <= '9') || expr[j] === '.')) {
          numStr += expr[j]
          j++
        }
        if (numStr === '-') return null
        const normalizedNum = /^-\d{1,3}(\.\d{3})+$/.test(numStr) ? numStr.replace(/\./g, '') : numStr
        const val = Number(normalizedNum)
        if (!Number.isFinite(val)) return null
        tokens.push({ type: 'num', value: val })
        i = j
        continue
      }
      tokens.push({ type: 'op', value: ch })
      i++
      continue
    }
    return null
  }
  return tokens
}

export function evaluasiEkspresiNominal(raw) {
  const expr = normalisasiEkspresi(raw)
  if (!expr) return { ok: false, error: 'Masukkan angka terlebih dahulu.' }
  // Hapus operator menggantung di ujung untuk evaluasi aman bila diperlukan
  const cleanExpr = OPS.has(expr[expr.length - 1]) ? expr.slice(0, -1) : expr
  if (!cleanExpr) return { ok: false, error: 'Ekspresi belum lengkap.' }

  const tokens = tokenisasi(cleanExpr)
  if (!tokens || tokens.length === 0) {
    return { ok: false, error: 'Format hitungan tidak valid.' }
  }
  if (tokens[tokens.length - 1].type === 'op') {
    return { ok: false, error: 'Ekspresi belum lengkap.' }
  }

  // Pass 1: evaluasi perkalian (*) & pembagian (/) kiri-ke-kanan
  const pass1 = [tokens[0]]
  for (let i = 1; i < tokens.length; i += 2) {
    const opTok = tokens[i]
    const rhsTok = tokens[i + 1]
    if (!opTok || opTok.type !== 'op' || !rhsTok || rhsTok.type !== 'num') {
      return { ok: false, error: 'Format hitungan tidak valid.' }
    }
    if (opTok.value === '*' || opTok.value === '/') {
      const lhsTok = pass1.pop()
      if (opTok.value === '/' && rhsTok.value === 0) {
        return { ok: false, error: 'Tidak bisa membagi dengan 0.' }
      }
      const res = opTok.value === '*' ? lhsTok.value * rhsTok.value : lhsTok.value / rhsTok.value
      if (!Number.isFinite(res)) return { ok: false, error: 'Hasil perhitungan tidak valid.' }
      pass1.push({ type: 'num', value: res })
    } else {
      pass1.push(opTok, rhsTok)
    }
  }

  // Pass 2: evaluasi penjumlahan (+) & pengurangan (-) kiri-ke-kanan
  let hasil = pass1[0].value
  for (let i = 1; i < pass1.length; i += 2) {
    const op = pass1[i].value
    const rhs = pass1[i + 1].value
    hasil = op === '+' ? hasil + rhs : hasil - rhs
  }

  if (!Number.isFinite(hasil)) {
    return { ok: false, error: 'Hasil perhitungan tidak valid.' }
  }
  if (Math.abs(hasil) > MAX_NOMINAL) {
    return { ok: false, error: 'Hasil melebihi batas maksimal nominal.' }
  }
  return { ok: true, nilai: hasil, dibulatkan: Math.round(hasil) }
}

export function formatEkspresiPreview(raw) {
  const expr = normalisasiEkspresi(raw)
  if (!expr) return ''
  const locale = uangAktif().locale || 'id-ID'
  const decimalSep = locale.startsWith('en') ? '.' : ','
  let out = ''
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let buf = ''
      while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || expr[i] === '.')) {
        buf += expr[i]
        i++
      }
      const [intPart, decPart] = buf.split('.')
      const intFmt = intPart ? Number(intPart).toLocaleString(locale) : '0'
      out += decPart !== undefined ? `${intFmt}${decimalSep}${decPart}` : intFmt
    } else if (OPS.has(ch)) {
      out += ` ${PRETTY_OP[ch] || ch} `
      i++
    } else {
      i++
    }
  }
  return out.trim()
}

export function sisipTokenKalkulator(ekspresi, token) {
  const cur = normalisasiEkspresi(ekspresi)
  const tRaw = String(token ?? '').trim()
  if (!tRaw) return cur
  if (tRaw === 'C') return ''
  if (tRaw === 'DEL') return cur.slice(0, -1)

  const mappedOp = OP_MAP[tRaw] || tRaw
  if (OPS.has(mappedOp)) {
    if (!cur) return ''
    const last = cur[cur.length - 1]
    if (OPS.has(last)) return cur.slice(0, -1) + mappedOp
    if (last === '.') return cur.slice(0, -1) + mappedOp
    return cur + mappedOp
  }

  if (mappedOp === ',' || mappedOp === '.') {
    const seg = cur.split(/[+\-*/]/).pop() || ''
    if (seg.includes('.')) return cur
    return seg === '' ? `${cur}0.` : `${cur}.`
  }

  if (/^\d+$/.test(mappedOp)) {
    if (cur.length >= 48) return cur
    const seg = cur.split(/[+\-*/]/).pop() || ''
    if (seg === '0') {
      if (mappedOp === '0' || mappedOp === '000') return cur
      return cur.slice(0, -1) + mappedOp
    }
    if (seg === '' && mappedOp === '000') return `${cur}0`
    return cur + mappedOp
  }

  return cur
}
