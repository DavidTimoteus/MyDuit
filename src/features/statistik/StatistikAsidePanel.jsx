import { useEffect, useMemo, useState } from 'react'
import { formatRupiah, parseTanggalIsoAman } from '../../lib/format.js'

// Panel kanan khusus tab Statistik (desktop only). Render di Shell dengan
// `tab === 'statistik'`. Subscribe ringkasan via event `myduit:statistik-update`
// yang dikirim StatistikView tiap data berubah — menjaga panel ini tidak
// menggandakan query Firestore.
//
// Layout konsisten standar 3D Claymorphism:
//   - Kanvas netral clay (clay-key-neutral)
//   - 2 Kartu konsolidasi (Ringkasan Pengeluaran & Rasio Tabungan + Pola & Kategori Boros)
//   - 1 Baris metrik cepat 3-kolom (menggantikan tumpukan kartu yang sebelumnya berjejal)
//   - Bebas dari penumpukan konten, bebas tabrakan bayangan, dan ramah pembacaan
export default function StatistikAsidePanel() {
  const [data, setData] = useState(null)

  useEffect(() => {
    function onUpdate(e) {
      setData(e.detail)
    }
    window.addEventListener('myduit:statistik-update', onUpdate)
    return () => window.removeEventListener('myduit:statistik-update', onUpdate)
  }, [])

  // Placeholder saat pertama kali dimuat. Dibungkus useMemo supaya identitasnya
  // stabil antar-render — kalau tidak, useMemo di bawah dianggap selalu berubah.
  const ringkas = useMemo(
    () =>
      data || {
        in: 0, out: 0, saldo: 0, rataHarian: 0, akunList: 0,
        jmlTransaksi: 0, kategoriAktif: 0,
        pengeluaranTerbesar: null,
        hariAktif: 0, jumlahHariBulan: 0,
        rataPengeluaranHariAktif: 0,
        hariPalingBoros: null,
        terbesarPemasukan: null,
        topKategoriBoros: [],
      },
    [data],
  )
  const { pengeluaranTerbesar } = ringkas

  const rasioTabungan = useMemo(() => {
    if (ringkas.in === 0) return 0
    return Math.round((ringkas.saldo / ringkas.in) * 100)
  }, [ringkas])

  const rasioBadge = useMemo(() => {
    if (ringkas.in === 0) return '—'
    if (rasioTabungan >= 30) return 'Hebat'
    if (rasioTabungan >= 15) return 'Baik'
    if (rasioTabungan >= 0) return 'Cukup'
    return 'Boros'
  }, [rasioTabungan, ringkas])

  function handleCetakPdf() {
    window.dispatchEvent(new CustomEvent('myduit:export-pdf'))
  }

  return (
    <aside className="hidden xl:flex xl:h-full xl:w-[350px] xl:min-w-[350px] xl:max-w-[350px] xl:shrink-0 xl:grow-0 xl:flex-col xl:overflow-hidden xl:p-4 xl:pl-2">
      <div className="clay clay-key-neutral flex h-full flex-col overflow-y-auto hide-scrollbar rounded-[28px] bg-surfaceContainerLowest p-5 w-full min-w-0">
        {/* Header — judul "Statistik Cepat" + tombol Cetak PDF di kanan */}
        <div className="flex shrink-0 items-center justify-between px-1 pb-3">
          <h2 className="text-base font-extrabold tracking-tight text-slate-800">Statistik Cepat</h2>
          <button
            onClick={handleCetakPdf}
            aria-label="Cetak PDF"
            title="Cetak PDF"
            className="pdf-action-btn clay-key-danger"
          >
            <span className="material-symbols-outlined icon-md">picture_as_pdf</span>
          </button>
        </div>
        <div className="mb-3.5 h-px shrink-0 bg-slate-200/70"></div>

        {/* Kontainer Konten: vertikal gap yang lega, tanpa penumpukan kartu */}
        <div className="flex flex-1 flex-col gap-3.5">
          {/* KARTU 1: Ringkasan Pengeluaran Terbesar & Rasio Tabungan (Tersatukan) */}
          <div className="clay-card clay-key-neutral shrink-0 rounded-[22px] bg-surfaceContainerLowest p-4 space-y-3">
            {/* Bagian A: Pengeluaran Terbesar */}
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Pengeluaran Terbesar</p>
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                  <span className="material-symbols-outlined icon-md">shopping_cart</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">{pengeluaranTerbesar?.nama ?? '—'}</p>
                  <p className="text-[11px] font-medium leading-tight text-textSecondary">
                    {pengeluaranTerbesar ? `${((pengeluaranTerbesar.total / Math.max(1, ringkas.out)) * 100).toFixed(0)}% dari total` : 'Belum ada data periode ini'}
                  </p>
                </div>
                <p className="shrink-0 font-mono text-xs font-bold text-expenseText">{formatRupiah(pengeluaranTerbesar?.total ?? 0)}</p>
              </div>
            </div>

            <div className="h-px bg-slate-100"></div>

            {/* Bagian B: Rasio Tabungan */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Rasio Tabungan</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${rasioTabungan >= 15 ? 'bg-emerald-100 text-emerald-800' : rasioTabungan >= 0 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>
                  {rasioBadge}
                </span>
              </div>
              <div className="mb-2 flex items-baseline justify-between">
                <span className={`font-mono text-xl font-extrabold ${rasioTabungan >= 0 ? 'text-incomeText' : 'text-expenseText'}`}>
                  {rasioTabungan}%
                </span>
                <span className="text-[11px] font-medium text-textSecondary">Sisa pemasukan setelah belanja</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 border border-slate-200/50">
                <div
                  className={`h-full rounded-full transition-all ${rasioTabungan >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.max(0, Math.min(100, Math.abs(rasioTabungan)))}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* KARTU 2: Pola Pengeluaran & Kategori Paling Boros (Tersatukan) */}
          <div className="clay-card clay-key-neutral shrink-0 rounded-[22px] bg-surfaceContainerLowest p-4 space-y-3">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Pola Pengeluaran</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-textSecondary">
                    <span className="material-symbols-outlined icon-sm text-blue-600">event_available</span>
                    {ringkas.periodeLabel || 'Hari aktif catat'}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] font-bold text-slate-800">
                    {ringkas.hariAktif}
                    {ringkas.jumlahHariBulan > 0 && (
                      <span className="font-sans font-medium text-textSecondary">
                        {' '}/ {ringkas.jumlahHariBulan}
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-textSecondary">
                    <span className="material-symbols-outlined icon-sm text-amber-600">local_fire_department</span>
                    Rata-rata / hari aktif
                  </span>
                  <span className="shrink-0 font-mono text-[11px] font-bold text-slate-800">
                    {formatRupiah(ringkas.rataPengeluaranHariAktif)}
                  </span>
                </div>
              </div>

              {ringkas.hariPalingBoros && (
                <>
                  <div className="my-2 h-px bg-slate-100" />
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-textSecondary">
                      <span className="material-symbols-outlined icon-sm text-red-600">trending_up</span>
                      Hari paling boros
                    </span>
                    <span className="shrink-0 font-mono text-[11px] font-bold text-expenseText">
                      {formatRupiah(ringkas.hariPalingBoros.total)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] font-medium text-textSecondary">
                    {(() => {
                      const dBoros = parseTanggalIsoAman(ringkas.hariPalingBoros.tgl)
                      return dBoros
                        ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(dBoros)
                        : ringkas.hariPalingBoros.tgl
                    })()}
                    {ringkas.terbesarPemasukan && (
                      <> · pemasukan {ringkas.terbesarPemasukan.nama}</>
                    )}
                  </p>
                </>
              )}
            </div>

            {/* Top 3 kategori boros */}
            {ringkas.topKategoriBoros.length > 0 && (
              <>
                <div className="h-px bg-slate-100"></div>
                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Kategori Paling Boros
                  </p>
                  <div className="space-y-1.5">
                    {ringkas.topKategoriBoros.map((k, i) => {
                      const bagian = ringkas.out > 0 ? Math.round((k.total / ringkas.out) * 100) : 0
                      return (
                        <div key={k.id} className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-textSecondary">
                            <span className="w-3 shrink-0 font-mono text-[10px] font-bold text-slate-500">
                              {i + 1}.
                            </span>
                            <span className="truncate">{k.nama}</span>
                          </span>
                          <span className="shrink-0 font-mono text-[11px] font-bold text-slate-800">
                            {bagian}%
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* KARTU 3: Metrik Ringkas 3-Kolom (Menggantikan 3 kartu vertikal yang berdesakan) */}
          <div className="mt-auto shrink-0 pt-1">
            <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Metrik Ringkas</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="clay-card-soft flex flex-col items-center justify-center rounded-[16px] bg-surfaceContainerLowest p-2.5 text-center">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 truncate w-full">Rata Harian</span>
                <span className="mt-1 font-mono text-[11px] font-extrabold text-slate-800 truncate w-full" title={formatRupiah(ringkas.rataHarian)}>
                  {formatRupiah(ringkas.rataHarian)}
                </span>
              </div>
              <div className="clay-card-soft flex flex-col items-center justify-center rounded-[16px] bg-surfaceContainerLowest p-2.5 text-center">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 truncate w-full">Transaksi</span>
                <span className="mt-1 font-mono text-sm font-extrabold text-slate-800">
                  {ringkas.jmlTransaksi ?? 0}
                </span>
              </div>
              <div className="clay-card-soft flex flex-col items-center justify-center rounded-[16px] bg-surfaceContainerLowest p-2.5 text-center">
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 truncate w-full">Kategori</span>
                <span className="mt-1 font-mono text-sm font-extrabold text-slate-800">
                  {ringkas.kategoriAktif ?? 0}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
