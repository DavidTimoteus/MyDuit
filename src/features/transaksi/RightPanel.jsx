import { useMemo } from 'react'
import { formatCurrency, formatNominal, isoHariIni, konversiUntukTampil, simbolUang, uangAktif } from '../../lib/format.js'
import { useAkunKategori } from '../../lib/useAkunKategori.js'
import { useKursVersi } from '../../lib/useKurs.js'
import { BATAS_DOKUMEN_QUERY, enrichTransaksi } from '../../lib/db.js'
import { useTransaksi } from '../transaksi/useTransaksi.js'
import { useBahasa } from '../../lib/i18n.js'

const rp = (n) => `${simbolUang()} ${formatNominal(n)}`
const rpSudahTampil = (nilaiTampil) => {
  const { currency, locale } = uangAktif()
  return formatCurrency(nilaiTampil, currency, locale)
}

// Bulan berjalan: yyyy-mm-01 .. yyyy-mm-akhir
function rangeBulanIni() {
  const now = new Date()
  const awal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const akhir = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const akhirIso = `${akhir.getFullYear()}-${String(akhir.getMonth() + 1).padStart(2, '0')}-${String(akhir.getDate()).padStart(2, '0')}`
  return { start: awal, end: akhirIso }
}

// Panel kanan "Ringkasan" — markup persis GAS #asideGroupTransaksi:
// Total Saldo (gradient hijau) · Pengeluaran Hari Ini · Top Kategori (badge jenis)
// · Aksi Cepat 3 tombol gradient penuh (Pemasukan/Pengeluaran/Pindah Saldo).
export default function RightPanel({ uid }) {
  const { t: tr } = useBahasa()
  const kursVer = useKursVersi()
  const { akunList, kategoriList } = useAkunKategori(uid)
  const bulan = useMemo(rangeBulanIni, [])
  // R-03 Fase 5: listener TIDAK BOLEH tanpa batas. Dulu tanpa batas
  // (pageSize nol) agar Surplus/Defisit dan Top Kategori 100% konsisten
  // dengan StatistikView & BudgetView — tapi satu snapshot bulan bisa
  // menarik ribuan dokumen. Batas 1000/bulan tetap jauh di atas pemakaian
  // wajar (33 transaksi/hari); bila terpotong, hasMore menyalakan catatan
  // di bawah kartu supaya angka tidak diam-diam salah.
  const { docs: transBulan, hasMore: adaLagiBulan } = useTransaksi(uid, {
    range: bulan,
    jenis: 'semua',
    pageSize: BATAS_DOKUMEN_QUERY,
  })
  const { docs: transHariIni } = useTransaksi(uid, {
    range: { start: isoHariIni(), end: isoHariIni() },
    jenis: 'pengeluaran',
    pageSize: BATAS_DOKUMEN_QUERY,
  })

  const akunById = useMemo(() => Object.fromEntries(akunList.map((a) => [a.id, a])), [akunList])
  const katById = useMemo(() => Object.fromEntries(kategoriList.map((k) => [k.id, k.nama])), [kategoriList])
  const bulanEnriched = useMemo(() => enrichTransaksi(transBulan, akunById, katById), [transBulan, akunById, katById])

  const totalSaldo = useMemo(() => akunList.reduce((s, a) => s + (Number(a.saldo) || 0), 0), [akunList])

  const arusBulan = useMemo(() => {
    let masuk = 0
    let keluar = 0
    for (const t of bulanEnriched) {
      const jml = konversiUntukTampil(Number(t.jumlah) || 0, t.kursSnapshot)
      if (t.jenis === 'pemasukan') masuk += jml
      else if (t.jenis === 'pengeluaran') keluar += jml
    }
    return masuk - keluar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulanEnriched, kursVer])

  const pengeluaranHariIni = useMemo(
    () => transHariIni.reduce((s, t) => s + konversiUntukTampil(Number(t.jumlah) || 0, t.kursSnapshot), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transHariIni, kursVer],
  )

  // Top kategori bulan ini — kategori dgn total terbesar di antara KEDUA jenis
  // (badge menunjukkan jenisnya, persis perilaku GAS summaryTopCategory*).
  const topKategori = useMemo(() => {
    const map = {}
    for (const t of bulanEnriched) {
      if (t.jenis !== 'pemasukan' && t.jenis !== 'pengeluaran') continue
      const key = `${t.jenis}||${t.kategoriNama || 'Lainnya'}`
      map[key] = (map[key] || 0) + konversiUntukTampil(Number(t.jumlah) || 0, t.kursSnapshot)
    }
    const terbaik = Object.entries(map).sort((a, b) => b[1] - a[1])[0]
    if (!terbaik) return null
    const [jenis, nama] = terbaik[0].split('||')
    return { jenis, nama, total: terbaik[1] }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulanEnriched, kursVer])

  function aksi(type) {
    window.dispatchEvent(new CustomEvent('myduit:aksi-cepat', { detail: { type } }))
  }

  return (
    <aside className="hidden xl:flex xl:h-full xl:w-[350px] xl:min-w-[350px] xl:max-w-[350px] xl:shrink-0 xl:grow-0 xl:flex-col xl:overflow-hidden xl:p-4 xl:pl-2">
      <div className="clay clay-key-neutral flex h-full flex-col overflow-y-auto hide-scrollbar rounded-[28px] bg-surfaceContainerLowest p-5 w-full min-w-0">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-1 pb-3">
          <h2 className="brand-title-embossed text-base font-extrabold tracking-tight">{tr('ringkasan')}</h2>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('myduit:export-pdf'))}
            aria-label={tr('pdf_judul')}
            title={tr('pdf_judul')}
            className="pdf-action-btn clay-key-danger"
          >
            <span className="material-symbols-outlined icon-md">picture_as_pdf</span>
          </button>
        </div>
        <div className="mb-3.5 h-px shrink-0 bg-slate-200/70"></div>

        <div className="flex shrink-0 flex-col">
          <div className="flex shrink-0 flex-col gap-3">
            {/* Total Saldo - Premier Neutral Clay Card */}
            <div className="clay-card clay-key-neutral flex flex-col gap-1 rounded-[22px] bg-surfaceContainerLowest p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-primary">
                    <span className="material-symbols-outlined icon-sm" style={{ fontVariationSettings: "'FILL' 1" }}>account_balance_wallet</span>
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{tr('total_saldo')}</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  {tr(arusBulan < 0 ? 'defisit' : 'surplus')}
                </span>
              </div>
              <p className="brand-title-embossed mt-1 font-mono text-2xl font-black tracking-tight">{rp(totalSaldo)}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-textSecondary">
                <span className={`material-symbols-outlined icon-2xs ${arusBulan < 0 ? 'text-expenseText' : 'text-incomeText'}`}>
                  {arusBulan < 0 ? 'trending_down' : 'trending_up'}
                </span>
                <span className={arusBulan < 0 ? 'text-expenseText font-bold' : 'text-incomeText font-bold'}>
                  {arusBulan < 0 ? '−' : '+'}{rpSudahTampil(Math.abs(arusBulan))}
                </span>
                <span>{tr('bulan_ini')}</span>
              </p>
            </div>

            {/* Pengeluaran Hari Ini */}
            <div className="clay-card clay-key-neutral flex flex-col gap-0.5 rounded-[20px] bg-surfaceContainerLowest p-3.5">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-100 text-expenseText">
                  <span className="material-symbols-outlined icon-sm" style={{ fontVariationSettings: "'FILL' 1" }}>today</span>
                </div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{tr('pengeluaran_hari_ini')}</p>
              </div>
              <p className="mt-1 font-mono text-lg font-extrabold tracking-tight text-expenseText">{rpSudahTampil(pengeluaranHariIni)}</p>
              <p className="text-[11px] font-medium text-textSecondary">{tr('transaksi_hari_ini', { n: transHariIni.length })}</p>
            </div>

            {/* Top Kategori */}
            <div className="clay-card clay-key-neutral flex flex-col gap-0.5 rounded-[20px] bg-surfaceContainerLowest p-3.5">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                    <span className="material-symbols-outlined icon-sm" style={{ fontVariationSettings: "'FILL' 1" }}>category</span>
                  </div>
                  <p className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-500">{tr('top_kategori')}</p>
                </div>
                {topKategori && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${topKategori.jenis === 'pemasukan' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                      }`}
                  >
                    {tr(topKategori.jenis === 'pemasukan' ? 'pemasukan' : 'pengeluaran')}
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-base font-extrabold tracking-tight text-slate-800">
                {topKategori ? topKategori.nama : '-'}
              </p>
              <p className={`font-mono text-sm font-extrabold tracking-tight ${topKategori?.jenis === 'pengeluaran' ? 'text-expenseText' : 'text-incomeText'}`}>
                {rpSudahTampil(topKategori ? topKategori.total : 0)}
              </p>
            </div>
            {adaLagiBulan && (
              <p className="px-1 text-[11px] font-medium leading-snug text-warning">
                {tr('ringkasan_terpotong', { batas: BATAS_DOKUMEN_QUERY })}
              </p>
            )}
          </div>

          <div className="my-3 h-px shrink-0 bg-slate-200/70"></div>

          {/* Aksi Cepat */}
          <div className="shrink-0">
            <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{tr('aksi_cepat')}</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => aksi('pemasukan')}
                className="neu-btn flex h-10 w-full items-center justify-start gap-2.5 rounded-2xl bg-[#E5E5E5] px-3.5 text-xs font-bold text-slate-700 transition-[transform,box-shadow,color] duration-150 hover:text-slate-900 active:scale-98"
              >
                <span className="material-symbols-outlined icon-md text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>add_circle</span>
                <span>{tr('tambah_pemasukan')}</span>
              </button>
              <button
                type="button"
                onClick={() => aksi('pengeluaran')}
                className="neu-btn flex h-10 w-full items-center justify-start gap-2.5 rounded-2xl bg-[#E5E5E5] px-3.5 text-xs font-bold text-slate-700 transition-[transform,box-shadow,color] duration-150 hover:text-slate-900 active:scale-98"
              >
                <span className="material-symbols-outlined icon-md text-danger" style={{ fontVariationSettings: "'FILL' 1" }}>remove_circle</span>
                <span>{tr('tambah_pengeluaran')}</span>
              </button>
              <button
                type="button"
                onClick={() => aksi('pindah-saldo')}
                className="neu-btn flex h-10 w-full items-center justify-start gap-2.5 rounded-2xl bg-[#E5E5E5] px-3.5 text-xs font-bold text-slate-700 transition-[transform,box-shadow,color] duration-150 hover:text-slate-900 active:scale-98"
              >
                <span className="material-symbols-outlined icon-md text-info" style={{ fontVariationSettings: "'FILL' 1" }}>swap_horiz</span>
                <span>{tr('pindah_saldo')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
