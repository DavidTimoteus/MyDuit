import { useEffect, useState } from 'react'
import { EVENT_LOKASI, NEGARA, negaraUntukMataUang, simpanNegaraManual, uangAktif } from '../lib/format.js'
import { EVENT_BASIS_MATA_UANG, bacaStatusBasis } from '../lib/kurs.js'
import { tetapkanMataUangDasar } from '../lib/db.js'
import { useBahasa } from '../lib/i18n.js'

const PILIHAN_UTAMA = [
  { currency: 'IDR', countryCode: 'ID', symbol: 'Rp', flag: '🇮🇩', descKey: 'onboard_idr_desc' },
  { currency: 'USD', countryCode: 'US', symbol: 'US$', flag: '🇺🇸', descKey: 'onboard_usd_desc' },
]

/**
 * Kartu onboarding penawaran mata uang dasar awal ketika akun masih 100% kosong
 * (`meta/mataUang` belum terkunci). Membantu pengguna memilih standar pembukuan pertama
 * sambil tetap membuka fleksibilitas Money Changer lintas mata uang kapan saja.
 */
export default function PenawaranMataUangAwal({ uid, className = '' }) {
  const { t } = useBahasa()
  const [statusBasis, setStatusBasis] = useState(() => bacaStatusBasis())
  const [aktifCurrency, setAktifCurrency] = useState(() => uangAktif().currency || 'IDR')
  const [tersimpan, setTersimpan] = useState(false)

  useEffect(() => {
    const syncBasis = () => setStatusBasis(bacaStatusBasis())
    const syncLokasi = () => setAktifCurrency(uangAktif().currency || 'IDR')
    window.addEventListener(EVENT_BASIS_MATA_UANG, syncBasis)
    window.addEventListener(EVENT_LOKASI, syncLokasi)
    return () => {
      window.removeEventListener(EVENT_BASIS_MATA_UANG, syncBasis)
      window.removeEventListener(EVENT_LOKASI, syncLokasi)
    }
  }, [])

  if (statusBasis.terkunci) return null

  const kodeNegaraAktif = negaraUntukMataUang(aktifCurrency)
  const infoAktif = kodeNegaraAktif ? NEGARA[kodeNegaraAktif] : null
  const bukanIdrUsd = aktifCurrency !== 'IDR' && aktifCurrency !== 'USD'

  function pratinjau(currency, countryCode) {
    setAktifCurrency(currency)
    simpanNegaraManual(countryCode)
  }

  function konfirmasiBasis() {
    setTersimpan(true)
    tetapkanMataUangDasar(uid, aktifCurrency).catch(() => {})
  }

  return (
    <div className={`clay-card clay-key-blue rounded-[22px] p-4 ${className}`}>
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
          <span className="material-symbols-outlined icon-md">currency_exchange</span>
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-xs font-extrabold tracking-tight text-slate-800">{t('onboard_judul')}</h4>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{t('onboard_desc')}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {PILIHAN_UTAMA.map((p) => {
          const aktif = aktifCurrency === p.currency
          return (
            <button
              key={p.currency}
              type="button"
              onClick={() => pratinjau(p.currency, p.countryCode)}
              className={`clay-btn ${aktif ? 'clay-key-blue solid-blue text-white' : 'clay-key-neutral text-slate-700'} btn-md flex items-center justify-between gap-2 px-3 text-left`}
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm leading-none">{p.flag}</span>
                <span className="truncate text-xs font-extrabold">{p.currency}</span>
              </span>
              <span className={`font-mono text-[11px] font-bold ${aktif ? 'text-white/90' : 'text-slate-500'}`}>
                {p.symbol}
              </span>
            </button>
          )
        })}
      </div>

      {bukanIdrUsd && infoAktif && (
        <div className="mt-2 flex items-center justify-between rounded-xl bg-blue-50 px-3 py-1.5 text-[11px] font-bold text-blue-800">
          <span className="flex items-center gap-1.5">
            <span>{infoAktif.bendera}</span>
            <span>{infoAktif.nama} ({aktifCurrency})</span>
          </span>
          <span className="font-mono">{infoAktif.symbol}</span>
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={konfirmasiBasis}
          disabled={tersimpan}
          className="clay-btn clay-key-primary solid-primary btn-sm flex-1 text-xs font-extrabold text-white disabled:opacity-70"
        >
          <span className="material-symbols-outlined icon-xs">check_circle</span>
          <span>{tersimpan ? t('onboard_tersimpan', { currency: aktifCurrency }) : t('onboard_tetapkan', { currency: aktifCurrency })}</span>
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('myduit:buka-lokasi'))}
          className="clay-btn clay-btn-secondary btn-sm shrink-0 px-3 text-xs font-bold text-slate-600"
        >
          {t('onboard_lainnya')}
        </button>
      </div>
    </div>
  )
}

