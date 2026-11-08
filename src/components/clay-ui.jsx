import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import flatpickr from 'flatpickr'
import 'flatpickr/dist/flatpickr.min.css'
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
    const onPointerDown = (e) => {
      if (listRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return
      close()
    }
    const onScroll = (e) => {
      if (listRef.current?.contains(e.target)) return
      // Di mobile: jika input di dalam trigger sedang fokus, browser sering melakukan auto-scroll
      // untuk memastikan input berada di atas keyboard. Jangan menutup popup karena auto-scroll ini.
      if (triggerRef.current && triggerRef.current.contains(document.activeElement)) return
      close()
    }
    const onKey = (e) => e.key === 'Escape' && close()
    const onResize = () => {
      // Di perangkat mobile, kemunculan/penutupan soft-keyboard memicu event resize window.
      // Jika input sedang aktif/fokus, abaikan resize agar popup kategori tidak tertutup seketika.
      if (triggerRef.current && triggerRef.current.contains(document.activeElement)) return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open, close, listRef, triggerRef])
}

const TRIGGER_BASE =
  'clay-input field-lg w-full text-sm focus:outline-none transition-colors cursor-pointer'

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
        className={`${TRIGGER_BASE} clay-select-trigger flex items-center justify-between gap-2 text-left ${className}`}
      >
        <span className={`truncate ${selected ? 'font-medium text-slate-800' : 'text-slate-500'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="material-symbols-outlined icon-md text-slate-500 shrink-0">expand_more</span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={listRef} role="listbox" className="clay-select-list" style={pos}>
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
                  e.preventDefault()
                  choose(i)
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
  const matches = kw ? options.filter((o) => o.label.toLowerCase().includes(kw)) : options

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
          <div ref={listRef} className="clay-select-list" style={pos}>
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
                    e.preventDefault()
                    onChange(o.label)
                    setOpen(false)
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

// ===== Field tanggal gaya TOMBOL (flatpickr; range utk filter periode) =====
// value: 'YYYY-MM-DD' (single) atau { start, end } (range). onChange mengirim format sama.
export function ClayDateInput({ id, value, onChange, range = false, accent = false, placeholder = 'Pilih tanggal' }) {
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const fpRef = useRef(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!inputRef.current) return
    const fp = flatpickr(inputRef.current, {
      mode: range ? 'range' : 'single',
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'd/m/Y',
      allowInput: false,
      disableMobile: true,
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
    // armDatePicker_ (GAS): altInput readOnly + transparan + klik wrapper membuka kalender
    if (fp.altInput) {
      fp.altInput.readOnly = true
      fp.altInput.classList.add('clay-date-picker-field')
      if (accent) fp.altInput.classList.add('clay-date-picker-field--accent')
      // flatpickr membuat input alternatif (yang terlihat & difokus). Pindahkan
      // id ke elemen itu supaya <label htmlFor> benar-benar mengarah ke field
      // yang bisa diklik/difokus — kalau id tertinggal di input tersembunyi,
      // klik label tidak membuka kalender dan screen reader tidak menemukannya.
      if (id) {
        inputRef.current.removeAttribute('id')
        fp.altInput.id = id
      }
    }
    const wrap = wrapRef.current
    const openIt = () => fp.open()
    wrap?.addEventListener('click', openIt)
    return () => {
      wrap?.removeEventListener('click', openIt)
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
      className={`clay-btn clay-btn-secondary w-full field-lg flex items-center gap-2 text-sm font-semibold text-textSecondary transition-colors cursor-pointer`}
    >
      <span className="material-symbols-outlined icon-md shrink-0 text-primary">calendar_month</span>
      {/* Input asli disembunyikan eksplisit — flatpickr membuat altInput terpisah yang tampil */}
      <input type="text" id={id ? id + '-hidden' : undefined} ref={inputRef} autoComplete="off" placeholder={placeholder} style={{ display: 'none' }} />
    </div>
  )
}
