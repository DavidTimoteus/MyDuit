import { useEffect, useState } from 'react'
import { portalBody } from '../lib/portal.js'
import { useBahasa } from '../lib/i18n.js'
import {
  aktifkanAppLock,
  hapusAppLockPaksa,
  nonaktifkanAppLock,
  verifikasiPinAppLock,
} from '../lib/appLock.js'

function KeypadGrid({ pin, onDigit, onBackspace, disabled }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
  return (
    <div className="mx-auto w-full max-w-[260px] select-none">
      {/* Dots */}
      <div className="mb-5 flex items-center justify-center gap-3" aria-label={`PIN ${pin.length} / 6`}>
        {Array.from({ length: 6 }).map((_, i) => (
          <span
            key={i}
            className={`h-3.5 w-3.5 rounded-full transition-all duration-150 ${
              i < pin.length
                ? 'scale-110 bg-[#36AE7C] shadow-[0_2px_6px_rgba(54,174,124,0.45)]'
                : 'neu-inset bg-[#E5E5E5]'
            }`}
          />
        ))}
      </div>

      {/* Pad */}
      <div className="grid grid-cols-3 gap-2.5">
        {keys.map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            onClick={() => onDigit(d)}
            className="clay-btn clay-key-neutral h-12 rounded-2xl font-mono text-lg font-extrabold text-slate-800 active:scale-95 disabled:opacity-50"
          >
            {d}
          </button>
        ))}
        <div />
        <button
          type="button"
          disabled={disabled}
          onClick={() => onDigit('0')}
          className="clay-btn clay-key-neutral h-12 rounded-2xl font-mono text-lg font-extrabold text-slate-800 active:scale-95 disabled:opacity-50"
        >
          0
        </button>
        <button
          type="button"
          disabled={disabled || pin.length === 0}
          onClick={onBackspace}
          aria-label="Backspace"
          className="clay-btn clay-key-neutral flex h-12 items-center justify-center rounded-2xl text-slate-600 active:scale-95 disabled:opacity-40"
        >
          <span className="material-symbols-outlined icon-lg">backspace</span>
        </button>
      </div>
    </div>
  )
}

export function AppLockScreen({ onUnlocked, onForgotSignOut }) {
  const { t } = useBahasa()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if (busy) return
      if (/^[0-9]$/.test(e.key)) handleDigit(e.key)
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function handleDigit(d) {
    if (busy || pin.length >= 6) return
    const next = pin + d
    setPin(next)
    setError('')
    if (next.length === 6) {
      setBusy(true)
      try {
        const res = await verifikasiPinAppLock(next)
        if (res.ok) {
          onUnlocked?.()
        } else if (res.terkunciSementara) {
          setError(t('pin_cooldown', { detik: res.sisaDetik }))
          setPin('')
        } else {
          setError(t('pin_salah', { sisa: res.sisaPercobaan }))
          setPin('')
        }
      } finally {
        setBusy(false)
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[10050] flex flex-col items-center justify-center bg-surface p-6">
      <div className="clay-card clay-key-primary w-full max-w-sm rounded-[32px] p-7 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl solid-primary text-white shadow-md">
          <span className="material-symbols-outlined icon-2xl">lock</span>
        </div>
        <h2 className="text-xl font-extrabold text-slate-800">{t('pin_judul_buka')}</h2>
        <p className="mt-1 mb-5 text-xs font-medium text-slate-500">{t('pin_desc_buka')}</p>

        <KeypadGrid
          pin={pin}
          disabled={busy}
          onDigit={handleDigit}
          onBackspace={() => setPin((p) => p.slice(0, -1))}
        />

        {error && (
          <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-[#EB5353]">
            {error}
          </p>
        )}

        {onForgotSignOut && (
          <button
            type="button"
            onClick={() => {
              hapusAppLockPaksa()
              onForgotSignOut()
            }}
            className="mt-5 text-xs font-bold text-slate-500 underline-offset-4 hover:text-[#EB5353] hover:underline"
          >
            {t('pin_lupa_keluar')}
          </button>
        )}
      </div>
    </div>
  )
}

export function AppLockSetupModal({ open, mode = 'enable', onClose, onStatusChange }) {
  const { t } = useBahasa()
  const [step, setStep] = useState(mode === 'disable' ? 'verify' : 'create')
  const [firstPin, setFirstPin] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setStep(mode === 'disable' ? 'verify' : 'create')
    setFirstPin('')
    setPin('')
    setError('')
    setBusy(false)
  }, [open, mode])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (busy) return
      if (e.key === 'Escape') onClose()
      else if (/^[0-9]$/.test(e.key)) handleDigit(e.key)
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!open) return null

  async function handleDigit(d) {
    if (busy || pin.length >= 6) return
    const next = pin + d
    setPin(next)
    setError('')
    if (next.length < 6) return

    if (step === 'create') {
      setFirstPin(next)
      setPin('')
      setStep('confirm')
      return
    }

    if (step === 'confirm') {
      if (next !== firstPin) {
        setError(t('pin_tidak_cocok'))
        setFirstPin('')
        setPin('')
        setStep('create')
        return
      }
      setBusy(true)
      try {
        await aktifkanAppLock(next)
        onStatusChange?.(true)
        onClose()
      } finally {
        setBusy(false)
      }
      return
    }

    if (step === 'verify') {
      setBusy(true)
      try {
        const res = await nonaktifkanAppLock(next)
        if (res.ok) {
          onStatusChange?.(false)
          onClose()
        } else if (res.terkunciSementara) {
          setError(t('pin_cooldown', { detik: res.sisaDetik }))
          setPin('')
        } else {
          setError(t('pin_salah', { sisa: res.sisaPercobaan }))
          setPin('')
        }
      } finally {
        setBusy(false)
      }
    }
  }

  const judul =
    step === 'verify'
      ? t('pin_judul_matikan')
      : step === 'confirm'
        ? t('pin_judul_konfirm')
        : t('pin_judul_setup')

  return portalBody(
    <div
      className="modal-backdrop-wrap fixed inset-0 z-[10060] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="clay-card clay-sheet w-full max-w-xs rounded-[28px] p-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-extrabold text-slate-800">{judul}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('tutup')}
            className="clay-chip clay-key-neutral flex h-8 w-8 items-center justify-center rounded-full text-slate-500"
          >
            <span className="material-symbols-outlined icon-md">close</span>
          </button>
        </div>

        <KeypadGrid
          pin={pin}
          disabled={busy}
          onDigit={handleDigit}
          onBackspace={() => setPin((p) => p.slice(0, -1))}
        />

        {error && (
          <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-[#EB5353]">
            {error}
          </p>
        )}
      </div>
    </div>,
  )
}

