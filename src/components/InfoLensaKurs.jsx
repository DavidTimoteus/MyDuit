import { NEGARA, formatCurrency, negaraUntukMataUang, uangAktif } from '../lib/format.js'
import { ambilRasioKurs, bacaBasisMataUang } from '../lib/kurs.js'
import { useKursVersi } from '../lib/useKurs.js'
import { useBahasa } from '../lib/i18n.js'

/**
 * Penanda transparan ketika pengguna melihat/mencatat dalam lensa mata uang berbeda
 * dari Mata Uang Dasar database (`baseCurrency`), menampilkan perkiraan nilai tersimpan
 * serta kurs konversi yang dipakai.
 */
export default function InfoLensaKurs({
  nilaiBasis = 0,
  kursSnapshot = null,
  mode = 'form',
  className = '',
}) {
  useKursVersi()
  const { t } = useBahasa()

  const basis = (kursSnapshot?.basis && /^[A-Z]{3}$/.test(String(kursSnapshot.basis).toUpperCase()))
    ? String(kursSnapshot.basis).toUpperCase()
    : (bacaBasisMataUang() || 'IDR')
  const { currency: aktif } = uangAktif()

  if (!aktif || aktif === basis) return null

  const kodeNegaraBasis = negaraUntukMataUang(basis)
  const localeBasis = kodeNegaraBasis ? NEGARA[kodeNegaraBasis].locale : 'id-ID'
  const perkiraan = formatCurrency(Number(nilaiBasis) || 0, basis, localeBasis)

  if (mode === 'pdf') {
    return (
      <div className={`flex items-start gap-2 rounded-xl bg-blue-50 px-3 py-2 text-[11px] font-semibold text-blue-800 ${className}`}>
        <span className="material-symbols-outlined icon-xs mt-0.5 shrink-0">currency_exchange</span>
        <span>{t('lensa_info_pdf', { aktif, basis })}</span>
      </div>
    )
  }

  const rasio = ambilRasioKurs(aktif, basis, kursSnapshot)
  const localeAktif = uangAktif().locale || 'id-ID'
  const teksKurs =
    rasio >= 0.01
      ? `1 ${aktif} ≈ ${formatCurrency(rasio, basis, localeAktif)}`
      : `1 ${basis} ≈ ${formatCurrency(1 / rasio, aktif, localeAktif)}`

  return (
    <div className={`flex items-start gap-2 rounded-xl bg-blue-50/90 px-3 py-2 text-[11px] font-semibold leading-snug text-blue-800 ${className}`}>
      <span className="material-symbols-outlined icon-xs mt-0.5 shrink-0">currency_exchange</span>
      <span>
        {mode === 'edit' && kursSnapshot
          ? t('lensa_info_historis', { basis, perkiraan })
          : t('lensa_info_basis', { basis, perkiraan, kurs: teksKurs })}
      </span>
    </div>
  )
}
