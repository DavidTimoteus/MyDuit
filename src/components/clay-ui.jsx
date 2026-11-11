import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import flatpickr from 'flatpickr'
import { calculatePopupPos } from './popupPos.js'

export { calculatePopupPos }

// ===== Popup list fixed (portal ke body) — posisi dihitung dari rect trigger,
// supaya tidak ke-clip overflow-y-auto modal (pola sama dgn enhanceClaySelect_ GAS).
export function usePopupList(open, triggerRef) {
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const update = () => {
      if (!triggerRef.current) return
      const r = triggerRef.current.getBoundingClientRect()
      setPos(calculatePopupPos(r, window.innerHeight, window.innerWidth))
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, triggerRef])
  return pos
}

function useDismiss(open, close, listRef, triggerRef) {
  useEffect(() => {
    if (!open) return
    let isTouchingList = false
    const onTouchStart = (e) => {
      if (listRef.current?.contains(e.target)) isTouchingList = true
    }
    const onTouchEnd = () => {
      isTouchingList = false
    }
    const onPointerDown = (e) => {
      if (listRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return
      close()
    }
    const onScroll = (e) => {
      // Jika scroll/swipe terjadi di dalam popup atau sedang disentuh pengguna di mobile,
      // jangan tutup dropdown.
      if (isTouchingList || listRef.current?.contains(e.target)) return
      // Di mobile: jika input di dalam trigger sedang fokus, browser sering melakukan auto-scroll
      // untuk memastikan input berada di atas keyboard. Jangan menutup popup karena auto-scroll ini.
      if (triggerRef.current && triggerRef.current.contains(document.activeElement)) return
      close()
    }
    const onKey = (e) => e.key === 'Escape' && close()
    let lebarAwal = window.innerWidth
    const onResize = () => {
      // Abaikan resize vertikal (muncul/hilangnya soft-keyboard mobile) agar tap pada opsi dropdown tidak dibatalkan.
      const lebarBaru = window.innerWidth
      if (lebarBaru === lebarAwal) return
      lebarAwal = lebarBaru
      if (triggerRef.current && triggerRef.current.contains(document.activeElement)) return
      close()
    }
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open, close, listRef, triggerRef])
}

const TRIGGER_BASE =
  'clay-input field-lg w-full text-sm focus:outline-none cursor-pointer'

// ===== Dropdown clay — pengganti popup native <select> =====
export function ClaySelect({ id, value, onChange, options, placeholder = 'Pilih', className = '', ...rest }) {
  const [open, setOpen] = useState(false)
  const [hl, setHl] = useState(-1)
  const triggerRef = useRef(null)
  const listRef = useRef(null)
  const pos = usePopupList(open, triggerRef)
  useDismiss(open, () => setOpen(false), listRef, triggerRef)

  const selected = options.find((o) => o.value === value)

  // Highlight mengikuti arrow key WAJIB di-scroll ke pandangan (block:'nearest',
  // pola sama dgn updateHighlight_ GAS) — tanpa ini highlight "jalan di tempat"
  // saat opsi banyak dan user harus scroll manual.
  useEffect(() => {
    if (!open || hl < 0) return
    listRef.current?.children[hl]?.scrollIntoView({ block: 'nearest' })
  }, [hl, open])

  function openList() {
    setOpen(true)
    setHl(options.findIndex((o) => o.value === value))
  }

  function move(dir) {
    if (!options.length) return
    let idx = hl < 0 ? (dir > 0 ? -1 : 0) : hl
    for (let step = 0; step < options.length; step++) {
      idx = (idx + dir + options.length) % options.length
      if (!options[idx].disabled) { setHl(idx); return }
    }
  }

  function choose(i) {
    const opt = options[i]
    if (!opt || opt.disabled) return
    onChange(opt.value)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        {...rest}
        ref={triggerRef}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!open) openList()
            else move(e.key === 'ArrowDown' ? 1 : -1)
          } else if (e.key === 'Enter' && open) {
            e.preventDefault()
            choose(hl)
          } else if (e.key === 'Tab' && open) setOpen(false)
        }}
        className={`${TRIGGER_BASE} clay-select-trigger ${open ? 'is-open' : ''} flex items-center justify-between gap-2 text-left ${className}`}
      >
        <span className={`truncate ${selected ? 'font-medium text-slate-800' : 'text-slate-500'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="material-symbols-outlined icon-md text-slate-500 shrink-0">expand_more</span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            data-placement={pos.top === 'auto' ? 'top' : 'bottom'}
            className="clay-select-list"
            style={pos}
          >
            {options.length === 0 && <div className="clay-select-option is-empty">Tidak ada pilihan</div>}
            {options.map((o, i) => (
              <div
                key={o.value}
                role="option"
                aria-disabled={o.disabled || undefined}
                className={`clay-select-option ${o.disabled ? 'is-disabled' : ''} ${o.value === value ? 'is-selected' : ''} ${i === hl ? 'is-highlighted' : ''}`}
                onMouseEnter={() => !o.disabled && setHl(i)}
                onPointerDown={(e) => {
                  if (o.disabled) return
                  if (e.pointerType === 'mouse') e.preventDefault()
                }}
                onClick={() => choose(i)}
              >
                {o.label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

// ===== Combobox kategori — bebas ketik + saran dari daftar (popup clay) =====
export function ClayCombobox({ id, value, onChange, options, placeholder, required, inputProps = {} }) {
  const [open, setOpen] = useState(false)
  const [hl, setHl] = useState(-1)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const pos = usePopupList(open, wrapRef)
  useDismiss(open, () => setOpen(false), listRef, wrapRef)

  const kw = String(value ?? '').trim().toLowerCase()
  const matches = kw ? options.filter((o) => String(o?.label ?? "").toLowerCase().includes(kw)) : options

  // Scroll mengikuti highlight keyboard (sama dgn ClaySelect)
  useEffect(() => {
    if (!open || hl < 0) return
    listRef.current?.children[hl]?.scrollIntoView({ block: 'nearest' })
  }, [hl, open])

  return (
    <div ref={wrapRef} className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value ?? ''}
        required={required}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHl(-1)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
            setHl((i) => (matches.length ? (i + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length : -1))
          } else if (e.key === 'Enter') {
            if (open && hl >= 0 && matches[hl]) {
              e.preventDefault()
              onChange(matches[hl].label)
              setOpen(false)
              inputRef.current?.blur()
            }
          } else if (e.key === 'Tab') setOpen(false)
        }}
        {...inputProps}
        className={`${TRIGGER_BASE} w-full ${inputProps.className ?? ''}`}
      />
      {open &&
        pos &&
        createPortal(
          <div
            ref={listRef}
            data-placement={pos.top === 'auto' ? 'top' : 'bottom'}
            className="clay-select-list"
            style={pos}
          >
            {matches.length === 0 ? (
              <div className="clay-select-option is-empty">
                {kw ? `Ketik enter utk pakai "${value}"` : 'Belum ada kategori'}
              </div>
            ) : (
              matches.map((o, i) => (
                <div
                  key={o.value}
                  className={`clay-select-option ${o.label === value ? 'is-selected' : ''} ${i === hl ? 'is-highlighted' : ''}`}
                  onMouseEnter={() => setHl(i)}
                  onPointerDown={(e) => {
                    if (e.pointerType === 'mouse') e.preventDefault()
                  }}
                  onClick={() => {
                    onChange(o.label)
                    setOpen(false)
                  }}
                >
                  {o.label}
                </div>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

function buatTanggalValid(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, m - 1, d)
  // Tolak tanggal kalender mustahil (mis. 31/02/2026 yg di-rollover JS ke 3 Maret)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return dt
}

// Helper parsing tanggal multi-format yang ramah pengetikan bebas pengguna:
// Mendukung ISO (YYYY-MM-DD), DMY (DD/MM/YYYY, DD-MM-YYYY, D/M/YYYY), dan DDMMYYYY rapat.
export function parseTanggalInput(str) {
  if (!str || typeof str !== 'string') return null
  const s = str.trim()
  if (!s) return null

  // 1. Format ISO: YYYY-MM-DD atau YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (isoMatch) {
    return buatTanggalValid(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))
  }

  // 2. Format DD/MM/YYYY, DD-MM-YYYY, atau D/M/YY (tahun 2 digit diasumsikan 20xx)
  const dmyMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (dmyMatch) {
    const d = Number(dmyMatch[1])
    const m = Number(dmyMatch[2])
    let y = Number(dmyMatch[3])
    if (y < 100) y += 2000
    return buatTanggalValid(y, m, d)
  }

  // 3. Format angka rapat DDMMYYYY (mis. 09092026 atau 09112026)
  const digitsMatch = s.match(/^(\d{2})(\d{2})(\d{4})$/)
  if (digitsMatch) {
    return buatTanggalValid(Number(digitsMatch[3]), Number(digitsMatch[2]), Number(digitsMatch[1]))
  }

  // 4. Default JS Date fallback (hanya utk string berformat teks eksplisit seperti "15 Aug 2026")
  const dObj = new Date(s)
  return !isNaN(dObj.getTime()) ? dObj : null
}

export function parseRangeInput(str) {
  if (!str || typeof str !== 'string') return null
  const s = str.trim()
  if (!s) return null

  const seps = [' to ', ' - ', ' s/d ', ' s.d. ']
  for (const sep of seps) {
    if (s.includes(sep)) {
      const parts = s.split(sep)
      if (parts.length === 2) {
        const d1 = parseTanggalInput(parts[0])
        const d2 = parseTanggalInput(parts[1])
        if (d1 && d2) return [d1, d2]
      }
    }
  }

  const single = parseTanggalInput(s)
  return single ? [single] : null
}

// ===== Field tanggal (flatpickr; mendukung pemilihan kalender & pengetikan langsung) =====
// value: 'YYYY-MM-DD' (single) atau { start, end } (range). onChange mengirim format sama.
export function ClayDateInput({ id, value, onChange, range = false, accent = false, placeholder = 'Pilih tanggal' }) {
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const btnRef = useRef(null)
  const fpRef = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!inputRef.current) return
    const fp = flatpickr(inputRef.current, {
      mode: range ? 'range' : 'single',
      dateFormat: 'Y-m-d',
      altInput: true,
      altInputClass: 'clay-date-picker-field bg-transparent !bg-transparent outline-none border-none shadow-none w-full flex-1 min-w-0 text-slate-800 font-semibold text-sm cursor-text',
      altFormat: 'd/m/Y',
      allowInput: true,
      disableMobile: true,
      parseDate: (dateStr, format) => {
        const parsed = parseTanggalInput(dateStr)
        if (parsed) return parsed
        return flatpickr.parseDate(dateStr, format)
      },
      ...(range ? { maxDate: 'today' } : {}),
      onChange: (dates, dateStr) => {
        if (range) {
          if (dates.length === 2) {
            onChangeRef.current({
              start: flatpickr.formatDate(dates[0], 'Y-m-d'),
              end: flatpickr.formatDate(dates[1], 'Y-m-d'),
            })
          }
        } else {
          onChangeRef.current(dateStr)
        }
      },
    })
    fpRef.current = fp

    // Komit input teks manual saat Enter atau blur
    const commitManualInput = () => {
      if (!fp.altInput) return
      const raw = fp.altInput.value.trim()
      if (!raw) {
        if (!range && fp.selectedDates[0]) {
          fp.setDate(fp.selectedDates[0], false)
        }
        return
      }
      if (range) {
        const parsed = parseRangeInput(raw)
        if (parsed && parsed.length === 2) {
          fp.setDate(parsed, true)
        } else if (fp.selectedDates.length === 2) {
          fp.setDate(fp.selectedDates, false)
        }
      } else {
        const parsed = parseTanggalInput(raw)
        if (parsed) {
          fp.setDate(parsed, true)
        } else if (fp.selectedDates[0]) {
          fp.setDate(fp.selectedDates[0], false)
        }
      }
    }

    const onAltKeyDown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commitManualInput()
        fp.close()
        fp.altInput?.blur()
      } else if (e.key === 'Escape') {
        fp.close()
      }
    }

    const onAltBlur = () => {
      commitManualInput()
    }

    if (fp.altInput) {
      fp.altInput.readOnly = false
      fp.altInput.style.backgroundColor = 'transparent'
      fp.altInput.style.border = 'none'
      fp.altInput.style.outline = 'none'
      fp.altInput.style.boxShadow = 'none'
      fp.altInput.style.webkitBoxShadow = 'none'
      fp.altInput.style.cursor = 'text'
      if (accent) fp.altInput.classList.add('clay-date-picker-field--accent')
      // Pindahkan id ke elemen altInput supaya <label htmlFor> benar-benar memfokuskan
      // input teks yang tampil.
      if (id) {
        inputRef.current.removeAttribute('id')
        fp.altInput.id = id
      }
      fp.altInput.addEventListener('keydown', onAltKeyDown)
      fp.altInput.addEventListener('blur', onAltBlur)
    }

    const btn = btnRef.current
    const onBtnClick = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (fp.isOpen) {
        fp.close()
      } else {
        fp.open()
      }
    }
    btn?.addEventListener('click', onBtnClick, true)

    const wrap = wrapRef.current
    const onWrapClick = (e) => {
      // Jika area luar diklik (bukan input dan bukan tombol ikon), buka kalender dan arahkan fokus
      if (e.target !== fp.altInput && !btn?.contains(e.target)) {
        fp.open()
        fp.altInput?.focus()
      }
    }
    wrap?.addEventListener('click', onWrapClick)

    return () => {
      btn?.removeEventListener('click', onBtnClick, true)
      wrap?.removeEventListener('click', onWrapClick)
      if (fp.altInput) {
        fp.altInput.removeEventListener('keydown', onAltKeyDown)
        fp.altInput.removeEventListener('blur', onAltBlur)
      }
      fp.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range])

  // Sinkronkan perubahan value dari luar (prefill edit / reset form) ke kalender.
  // Nilai dependensi diekstrak ke variabel sederhana: ekspresi ternary di dalam
  // array deps tidak bisa diverifikasi statis oleh ESLint dan mudah salah.
  const vStart = range ? value?.start : undefined
  const vEnd = range ? value?.end : undefined
  const vScalar = range ? undefined : value
  useEffect(() => {
    const fp = fpRef.current
    if (!fp) return
    if (range) {
      const v = value || {}
      if (v.start && v.end) fp.setDate([v.start, v.end], false)
      else if (!v.start && !v.end) fp.clear()
    } else if (value) fp.setDate(value, false)
    else fp.clear()
    // `value` sengaja dibaca di dalam efek; identitasnya sudah diwakili oleh
    // vStart/vEnd/vScalar di bawah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, vStart, vEnd, vScalar])

  return (
    <div
      ref={wrapRef}
      className="clay-input field-lg flex w-full cursor-text items-center gap-2.5 text-sm font-semibold text-slate-800"
    >
      <button
        ref={btnRef}
        type="button"
        tabIndex={-1}
        aria-label="Buka kalender"
        className="flex shrink-0 items-center justify-center cursor-pointer text-[#36AE7C] hover:opacity-80 active:scale-95 transition-all"
      >
        <span className="material-symbols-outlined icon-md">calendar_month</span>
      </button>
      {/* Input asli disembunyikan eksplisit — flatpickr membuat altInput terpisah yang tampil */}
      <input type="text" id={id ? id + '-hidden' : undefined} ref={inputRef} autoComplete="off" placeholder={placeholder} style={{ display: 'none' }} />
    </div>
  )
}
