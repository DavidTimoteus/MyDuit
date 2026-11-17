import { useEffect, useRef, useState } from 'react'
import { portalBody } from '../lib/portal.js'
import { useBahasa } from '../lib/i18n.js'
import { jamSekarang } from '../lib/format.js'

// Pemilih jam bergaya Claymorphism — pengganti <input type="time"> bawaan
// browser yang tampilannya ditentukan OS (tidak mengikuti tema neumorphism).
// Field memakai sumur galian .clay-input; popover memakai .clay-sheet dengan
// dua kolom jam (00-23) & menit (00-59). Kosong diizinkan (opsional).
const JAM = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MENIT = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

export default function ClayTimeInput({ id, value, onChange, placeholder = '--:--' }) {
  const { t: tr } = useBahasa()
  const [open, setOpen] = useState(false)
  const [jam, setJam] = useState('')
  const [menit, setMenit] = useState('00')
  const jamRef = useRef(null)
  const menitRef = useRef(null)

  useEffect(() => {
    const v = typeof value === 'string' ? value : ''
    const [j, m] = v.split(':')
    setJam(/^([01]\d|2[0-3])$/.test(j || '') ? j : '')
    setMenit(/^[0-5]\d$/.test(m || '') ? m : '00')
  }, [value, open])

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const scrollKe = (el, val) => {
      const target = el?.querySelector(`[data-nilai="${val}"]`)
      target?.scrollIntoView?.({ block: 'center' })
    }
    scrollKe(jamRef.current, jam || '00')
    scrollKe(menitRef.current, menit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function tutup() {
    setOpen(false)
  }
  function simpan() {
    onChange(jam ? `${jam}:${menit || '00'}` : '')
    tutup()
  }
  function kosongkan() {
    onChange('')
    tutup()
  }
  function pakaiSekarang() {
    const [j, m] = jamSekarang().split(':')
    setJam(j)
    setMenit(m)
  }

  const label = value || placeholder

  return (
    <>
      <div className="clay-input field-lg flex w-full items-center gap-2 text-sm font-semibold text-slate-800">
        <button
          type="button"
          tabIndex={-1}
          aria-label={tr('jam')}
          onClick={() => setOpen(true)}
          className="flex shrink-0 cursor-pointer items-center justify-center text-[#36AE7C] transition-transform hover:opacity-80 active:scale-95"
        >
          <span className="material-symbols-outlined icon-md">schedule</span>
        </button>
        <button
          id={id}
          type="button"
          onClick={() => setOpen(true)}
          className={`min-w-0 flex-1 bg-transparent text-left outline-none ${value ? '' : 'text-slate-400'}`}
        >
          {label}
        </button>
        {value && (
          <button
            type="button"
            onClick={kosongkan}
            aria-label={tr('hapus_jam')}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400 hover:text-slate-600"
          >
            <span className="material-symbols-outlined icon-xs">close</span>
          </button>
        )}
      </div>

      {open && portalBody(
        <div
          className="modal-backdrop-wrap fixed inset-0 z-[10000] flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={tutup}
        >
          <div
            className="clay-sheet clay-key-primary flex max-h-[85vh] w-full max-w-xs flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 pb-3 pt-4">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-base font-extrabold text-slate-800">
                  <span className="material-symbols-outlined icon-md text-primary">schedule</span>
                  {tr('jam')}
                </h3>
                <p className="mt-0.5 text-[11px] font-medium text-textSecondary">{tr('pilih_jam_hint')}</p>
              </div>
              <button
                type="button"
                onClick={tutup}
                aria-label={tr('tutup')}
                className="clay-chip clay-key-neutral flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500"
              >
                <span className="material-symbols-outlined icon-md">close</span>
              </button>
            </div>

            <div className="flex min-h-0 flex-1 items-stretch justify-center gap-3 px-5 py-4">
              <Kolom
                innerRef={jamRef}
                judul={tr('jam')}
                nilai={JAM}
                aktif={jam}
                onPilih={setJam}
              />
              <Kolom
                innerRef={menitRef}
                judul={tr('menit')}
                nilai={MENIT}
                aktif={menit}
                onPilih={setMenit}
              />
            </div>

            <div className="shrink-0 space-y-2 border-t border-slate-100 px-5 pb-5 pt-3">
              <button
                type="button"
                onClick={pakaiSekarang}
                className="clay-btn clay-key-neutral btn-md flex w-full items-center justify-center gap-1.5 text-xs font-bold text-slate-600"
              >
                <span className="material-symbols-outlined icon-sm">schedule</span>
                {tr('jam_sekarang')}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={kosongkan}
                  className="clay-btn clay-key-neutral btn-md text-xs font-bold text-slate-600"
                >
                  {tr('kosongkan')}
                </button>
                <button
                  type="button"
                  onClick={simpan}
                  className="clay-btn clay-key-primary solid-primary btn-md text-xs font-bold text-white"
                >
                  {tr('simpan')}
                </button>
              </div>
            </div>
          </div>
        </div>,
      )}
    </>
  )
}

function Kolom({ innerRef, judul, nilai, aktif, onPilih }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <p className="mb-2 text-center text-[10px] font-bold uppercase tracking-wider text-slate-500">{judul}</p>
      <div ref={innerRef} className="clay-inset hide-scrollbar max-h-64 min-h-0 flex-1 space-y-1 overflow-y-auto rounded-[18px] p-1.5">
        {nilai.map((n) => {
          const dipilih = n === aktif
          return (
            <button
              key={n}
              type="button"
              data-nilai={n}
              onClick={() => onPilih(n)}
              className={`flex h-10 w-full items-center justify-center rounded-xl font-mono text-sm font-extrabold transition-all active:scale-[0.97] ${
                dipilih
                  ? 'clay-btn clay-key-primary solid-primary text-white'
                  : 'text-slate-600 hover:bg-white/60'
              }`}
            >
              {n}
            </button>
          )
        })}
      </div>
    </div>
  )
}
