import { useEffect, useRef } from 'react'
import InstallButton from './InstallButton.jsx'

/**
 * UserMenuSheet — lembar menu pengguna untuk layar mobile.
 *
 * Mengapa perlu
 * -------------
 * Di mobile, sidebar desktop (`hidden md:flex`) tidak pernah tampil. Selama ini
 * tombol Keluar, Backup, ganti lokasi/mata uang, dan Install app hanya ada di
 * sidebar itu — plus header mobile yang sengaja hanya dirender di tab
 * Transaksi (tab lain punya header sendiri, sesuai desain GAS).
 *
 * Akibatnya user yang sedang berada di tab Budget / Utang / Statistik tidak
 * punya jalur ke mana pun: tidak bisa keluar, tidak bisa backup, tidak bisa
 * ganti negara. Untuk aplikasi keuangan itu bukan sekadar fitur yang hilang — data
 * yang belum di-backup bisa hilang, dan user terkunci di sesi itu.
 *
 * Solusi: satu tombol avatar di bottom nav (semua tab) yang membuka lembar
 * berisi keempat aksi tersebut. Pascangannya lengkap dengan header Transaksi,
 * jadi setiap aksi selalu punya maksimal dua jalan pintas.
 */
export default function UserMenuSheet({
  open,
  onClose,
  onLokasi,
  onBackup,
  onKeluar,
  user,
  countryFlag,
  currencySymbol,
  negara,
}) {
  const sheetRef = useRef(null)
  const btnRef = useRef(null)
  const wasOpenRef = useRef(false)

  // Tutup saat tekan Escape — perilaku dasar dialog yang sering hilang.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Kembalikan fokus ke pemicu hanya setelah sheet ditutup dari kondisi terbuka.
  useEffect(() => {
    if (wasOpenRef.current && !open) btnRef.current?.focus()
    wasOpenRef.current = open
  }, [open])

  if (!open) return null

  const nama = user?.displayName || user?.email || 'Pengguna'

  const itemCls =
    'clay-btn flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-bold text-slate-700'
  const iconCls = 'clay-icon-tile clay-key-neutral flex h-10 w-10 shrink-0 items-center justify-center'

  return (
    <div className="modal-backdrop-wrap fixed inset-0 z-[70] md:hidden" role="dialog" aria-modal="true" aria-label="Menu pengguna">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={onClose} />

      <div
        ref={sheetRef}
        className="clay clay-sheet clay-key-neutral modal-sheet-bottom absolute inset-x-0 bottom-0 flex flex-col gap-2 rounded-b-none rounded-t-[28px] px-4 pb-6 pt-3"
      >
        {/* Gagang tarik */}
        <div className="mx-auto mb-1 h-1.5 w-11 rounded-full bg-slate-300" aria-hidden="true" />

        <div className="flex items-center gap-3 px-1 pb-2">
          <div className={iconCls + ' !h-12 !w-12'}>
            <span className="material-symbols-outlined icon-lg">{countryFlag}</span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold text-slate-800">{nama}</p>
            <p className="truncate text-[11px] text-slate-500">
              {negara} · {currencySymbol}
            </p>
          </div>
        </div>

        <button type="button" className={itemCls} onClick={() => { onLokasi(); onClose() }}>
          <span className={iconCls}>
            <span className="material-symbols-outlined icon-md">public</span>
          </span>
          <span className="flex-1">
            <span className="block">Lokasi &amp; Mata Uang</span>
            <span className="block text-[11px] font-semibold text-slate-500">{negara} · {currencySymbol}</span>
          </span>
        </button>

        <button type="button" className={itemCls} onClick={() => { onBackup(); onClose() }}>
          <span className={iconCls}>
            <span className="material-symbols-outlined icon-md">backup</span>
          </span>
          <span className="flex-1">
            <span className="block">Backup Data</span>
            <span className="block text-[11px] font-semibold text-slate-500">Ekspor atau pulihkan data</span>
          </span>
        </button>

        

        {/* InstallButton dipakai langsung (bukan memicu dari luar): event
            beforeinstallprompt hanya boleh dipanggil sekali per sesi, jadi
            pemanggilan dari Sheet ditolak browser di percobaan kedua. */}
        <InstallButton variant="sheet" />

        <button
          type="button"
          className="clay-btn clay-key-danger flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-extrabold text-danger"
          onClick={onKeluar}
        >
          <span className={iconCls + ' clay-key-danger'}>
            <span className="material-symbols-outlined icon-md">logout</span>
          </span>
          Keluar
        </button>
      </div>
    </div>
  )
}

/** Ekspor handle pemicu supaya pemanggil bisa memegang ref dan fokus. */
export function useUserMenuTrigger() {
  return useRef(null)
}