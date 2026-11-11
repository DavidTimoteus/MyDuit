import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { canInstall, isIOS, isStandalone, onInstallAvailable, promptInstall } from '../lib/pwa.js'

// Tombol "Install App".
// - Sudah standalone (dibuka sebagai app) -> tidak dirender.
// - Browser dukung beforeinstallprompt -> langsung prompt.
// - iOS Safari -> buka petunjuk manual Share > Add to Home Screen.
// variant: 'sidebar' (item lebar) | 'chip' (pill kecil utk header mobile)
export default function InstallButton({ variant = 'sidebar' }) {
  const [available, setAvailable] = useState(false)
  const [hint, setHint] = useState(false)

  useEffect(() => {
    if (isStandalone()) return undefined
    return onInstallAvailable(setAvailable)
  }, [])

  if (isStandalone()) return null

  const tampil = available || isIOS()
  if (!tampil) return null

  async function klik() {
    if (canInstall()) {
      await promptInstall()
    } else {
      setHint(true)
    }
  }

  const cls =
    variant === 'sidebar'
      ? 'clay-btn-soft flex w-full items-center gap-3 px-4 py-2.5 text-sm font-bold text-primary'
      : variant === 'sheet'
        ? 'clay-btn flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-bold text-slate-700'
        : 'clay-chip flex h-9 w-9 items-center justify-center rounded-full text-primary active:bg-primary active:text-white'

  return (
    <>
      <button onClick={klik} className={cls} title="Install aplikasi">
        <span
          className={
            variant === 'sheet'
              ? 'clay-icon-tile clay-key-neutral flex h-10 w-10 shrink-0 items-center justify-center'
              : 'material-symbols-outlined icon-lg'
          }
        >
          {variant === 'sheet' ? (
            <span className="material-symbols-outlined icon-md">install_mobile</span>
          ) : (
            'install_mobile'
          )}
        </span>
        {variant === 'sidebar' && <span>Install App</span>}
        {variant === 'sheet' && (
          <span className="flex-1">
            <span className="block">Pasang Aplikasi</span>
            <span className="block text-[11px] font-semibold text-slate-500">Akses cepat &amp; offline</span>
          </span>
        )}
      </button>

      {hint && createPortal(
        <div className="modal-backdrop-wrap fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/50 p-5 backdrop-blur-sm" onClick={() => setHint(false)}>
          <div className="clay-card clay-sheet w-full max-w-xs rounded-[24px] p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <span className="material-symbols-outlined text-4xl text-primary">ios_share</span>
            <p className="mt-2 text-sm font-bold text-slate-800">Pasang MyDuit di iPhone</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Tekan ikon <strong>Share</strong> di bawah Safari, lalu pilih{' '}
              <strong>“Add to Home Screen”</strong>.
            </p>
              <button onClick={() => setHint(false)} className="clay-btn-primary btn-md mt-4 w-full">
              Mengerti
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
