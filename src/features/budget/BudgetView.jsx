import { useEffect, useMemo, useState } from 'react'
import { onSnapshot, query, where, orderBy, collection } from 'firebase/firestore'
import { getFirebase } from '../../lib/firebase.js'
import { formatRupiah } from '../../lib/format.js'
import { enrichTransaksi } from '../../lib/db.js'
import { useAkunKategori } from '../../lib/useAkunKategori.js'
import { useBudgetBulan } from './useBudgetBulan.js'
import BudgetPanel from './BudgetPanel.jsx'
import FormBudgetModal from './FormBudgetModal.jsx'
import RekeningPanel from './RekeningPanel.jsx'

const NAMA_BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

function rangeBulan(tahun, bulanIdx) {
  const awal = new Date(tahun, bulanIdx, 1)
  const akhir = new Date(tahun, bulanIdx + 1, 0)
  const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { start: f(awal), end: f(akhir) }
}

function labelPeriode(bulan, tahun) {
  return `${NAMA_BULAN_ID[bulan]} ${tahun}`
}

// Tab Budget = sub-tab Rekening | Budget (pola ViewBudget.html GAS).
// Layout mengikuti ViewBudget.html + DesktopPrototype-Budget.html:
// - Header mobile (md:hidden): logo savings biru + judul "Rekening" (placeholder sesuai GAS)
// - Sub-tab toggle pill (Rekening | Budget) — aktif = inset shadow
// - Hero "Total Saldo" (gradient biru) atau "Total Budget" (gradient biru)
// - Daftar (Rekening list atau Budget list)
export default function BudgetView({ user }) {
  const uid = user.uid
  const [sub, setSub] = useState('rekening')

  // State periode untuk sub-tab Budget
  const [bulan, setBulan] = useState(new Date().getMonth())
  const [tahun, setTahun] = useState(new Date().getFullYear())
  const today = useMemo(() => new Date(), [])

  // Data bersama
  const range = useMemo(() => rangeBulan(tahun, bulan), [bulan, tahun])
  const budgets = useBudgetBulan(uid, bulan, tahun)

  // Query transaksi bulanan TANPA batas pageSize — identik dengan pola StatistikView
  // sehingga totalPengeluaran/totalPemasukan di menu Budget selalu identik 100%
  // dengan angka "Total Pengeluaran/Pemasukan" di menu Statistik.
  const [transBulan, setTransBulan] = useState([])
  useEffect(() => {
    if (!uid) return
    const { db } = getFirebase()
    const q = query(
      collection(db, 'users', uid, 'transaksi'),
      where('deleted', '==', false),
      where('tanggal', '>=', range.start),
      where('tanggal', '<=', range.end),
      orderBy('tanggal', 'desc'),
    )
    const unsub = onSnapshot(
      q,
      (snap) => setTransBulan(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setTransBulan([]),
    )
    return () => unsub()
  }, [uid, range.start, range.end])

  const { akunList, kategoriList } = useAkunKategori(uid)
  const akunById = useMemo(() => Object.fromEntries(akunList.map((a) => [a.id, a])), [akunList])
  const katById = useMemo(() => Object.fromEntries(kategoriList.map((k) => [k.id, k.nama])), [kategoriList])
  const transEnriched = useMemo(() => enrichTransaksi(transBulan, akunById, katById), [transBulan, akunById, katById])

  // Modal Budget
  const [modal, setModal] = useState({ open: false, edit: null })
  const [hapusTarget, setHapusTarget] = useState(null)

  // Listen event dari FAB bottom nav (buka Tambah Rekening / Tambah Budget)
  useEffect(() => {
    const handler = () => {
      if (sub === 'budget') {
        setModal({ open: true, edit: null })
      } else {
        window.dispatchEvent(new CustomEvent('myduit:buka-tambah-rekening'))
      }
    }
    window.addEventListener('myduit:buka-tambah-budget-rekening', handler)
    return () => window.removeEventListener('myduit:buka-tambah-budget-rekening', handler)
  }, [sub])

  // Tombol "Aksi Cepat" di panel kanan (BudgetAsidePanel) mengirim event ini.
  // BUG LAMA: eventnya tidak punya pendengar SATU PUN sehingga kedua tombol
  // diam saat diklik. Modal rekening dimiliki RekeningPanel (hanya mount di
  // sub-tab Rekening) dan modal budget dimiliki komponen ini, jadi handlernya
  // harus di sini — lengkap dengan penyesuaian sub-tab dulu bila perlu.
  const [tambahRekeningTertunda, setTambahRekeningTertunda] = useState(false)
  useEffect(() => {
    function onTambahRekening() {
      if (sub === 'rekening') {
        window.dispatchEvent(new CustomEvent('myduit:buka-tambah-rekening'))
      } else {
        setSub('rekening')
        setTambahRekeningTertunda(true)
      }
    }
    function onTambahBudget() {
      setSub('budget')
      setModal({ open: true, edit: null })
    }
    window.addEventListener('myduit:budget-add-rekening', onTambahRekening)
    window.addEventListener('myduit:budget-add-budget', onTambahBudget)
    return () => {
      window.removeEventListener('myduit:budget-add-rekening', onTambahRekening)
      window.removeEventListener('myduit:budget-add-budget', onTambahBudget)
    }
  }, [sub])

  // RekeningPanel baru mount SETELAH sub-tab berganti, jadi event buka modal
  // ditunda sampai sub-tab 'rekening' aktif (kalau tidak, eventnya hilang
  // karena pendengarnya belum terpasang).
  useEffect(() => {
    if (!tambahRekeningTertunda || sub !== 'rekening') return
    setTambahRekeningTertunda(false)
    window.dispatchEvent(new CustomEvent('myduit:buka-tambah-rekening'))
  }, [tambahRekeningTertunda, sub])

  // Hitung agregat budget (mirip dengan yang lama, untuk kirim ke panel kanan)
  const ringkasan = useMemo(() => {
    const terpakaiPerKategori = {}
    let totalPemasukan = 0
    let totalPengeluaran = 0
    for (const t of transEnriched) {
      if (t.jenis === 'pemasukan') {
        totalPemasukan += t.jumlah || 0
        continue
      }
      if (t.jenis !== 'pengeluaran') continue
      totalPengeluaran += t.jumlah || 0
      // Hanya pengeluaran BERKATEGORI yang menagih budget; pindah saldo punya
      // kategoriId '' (falsy) dan tetap terlewati.
      if (t.kategoriId) terpakaiPerKategori[t.kategoriId] = (terpakaiPerKategori[t.kategoriId] || 0) + (t.jumlah || 0)
    }
    const list = budgets.map((b) => {
      const terpakai = terpakaiPerKategori[b.kategoriId] || 0
      const limit = b.limitNominal || 0
      const persen = limit > 0 ? Math.min(999, Math.round((terpakai / limit) * 100)) : 0
      const hampirHabis = persen >= 80
      const kategoriNama = b.kategoriNama ?? katById[b.kategoriId] ?? '?'
      // `lewat` PER budget — tanpa ini kartu BudgetPanel tidak pernah
      // menampilkan status "Lewat"/"+N%" karena b.lewat selalu undefined.
      const lewat = terpakai > limit
      return { ...b, kategoriNama, terpakai, persen, hampirHabis, lewat }
    })
    const totalLimit = budgets.reduce((s, b) => s + (b.limitNominal || 0), 0)
    const totalTerpakai = Object.values(terpakaiPerKategori).reduce((s, n) => s + n, 0)
    const sisa = totalLimit - totalTerpakai
    const persen = totalLimit > 0 ? Math.min(999, Math.round((totalTerpakai / totalLimit) * 100)) : 0
    const tglSekarang = today.getDate()
    const akhirBulan = new Date(tahun, bulan + 1, 0).getDate()
    const hariTersisa = Math.max(1, akhirBulan - tglSekarang + 1)
    const burnPerHari = totalTerpakai > 0 ? Math.round(totalTerpakai / Math.max(1, tglSekarang)) : 0
    const hampirHabis = list.filter((b) => b.hampirHabis).map((b) => ({
      kategoriId: b.kategoriId,
      nama: b.kategoriNama,
      terpakai: b.terpakai,
      limit: b.limitNominal,
      persen: b.persen,
    }))
    return { totalLimit, totalTerpakai, sisa, persen, lewat: totalTerpakai > totalLimit, hariTersisa, burnPerHari, hampirHabis, list, totalPemasukan, totalPengeluaran }
  }, [budgets, transEnriched, katById, tahun, bulan, today])

  // Emit ringkasan ke panel kanan Budget.
  // TANPA guard `sub === 'budget'`: panel kanan ikut tampil saat sub-tab
  // Rekening (Shell merendernya per TAB), jadi tanpa emit di sini panel
  // menampilkan angka placeholder Rp0 sampai user berpindah sub-tab.
  useEffect(() => {
    const event = new CustomEvent('myduit:budget-update', {
      detail: {
        totalLimit: ringkasan.totalLimit,
        terpakai: ringkasan.totalTerpakai,
        sisa: ringkasan.sisa,
        persen: ringkasan.persen,
        lewat: ringkasan.lewat,
        hariTersisa: ringkasan.hariTersisa,
        burnPerHari: ringkasan.burnPerHari,
        hampirHabis: ringkasan.hampirHabis,
        akunList: akunList.length,
      },
    })
    window.dispatchEvent(event)
  }, [sub, ringkasan, akunList])

  // Emit ringkasan ke sidebar kiri (Insight Budget) — juga tanpa guard sub-tab
  // karena sidebar kiri dirender per TAB, bukan per sub-tab.
  useEffect(() => {
    const event = new CustomEvent('myduit:sidebar-insight-budget', {
      detail: {
        kategoriTerdikit: ringkasan.hampirHabis[0] || null,
        totalLimit: ringkasan.totalLimit,
        totalTerpakai: ringkasan.totalTerpakai,
        persen: ringkasan.persen,
      },
    })
    window.dispatchEvent(event)
  }, [sub, ringkasan])

  // Navigate periode (bulan/tahun), pola sama dengan tab Statistik — retensi 1 tahun
  function navigatePeriode(dir) {
    let b = bulan + dir
    let th = tahun
    if (b < 0) { b = 11; th-- }
    else if (b > 11) { b = 0; th++ }
    // Cegah masa depan & hanya boleh mundur 1 tahun
    if (th > today.getFullYear() || (th === today.getFullYear() && b > today.getMonth())) return
    if (th < today.getFullYear() - 1) return
    setBulan(b)
    setTahun(th)
  }

  const bisaMundur = !(bulan === 0 && tahun === today.getFullYear() - 1)
  const bisaMaju = !(tahun === today.getFullYear() && bulan >= today.getMonth())

  // Sub-tab Rekening: hero Total Saldo + daftar rekening
  // Sub-tab Budget: navigator + hero Total Budget + daftar budget
  return (
    <section className="mx-auto max-w-3xl px-5 pb-32 md:pb-10">
      {/* Header mobile (md:hidden) — logo savings emerald + judul */}
      <header className="flex items-center gap-2.5 pt-3 pb-4 md:hidden">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-primary text-white shadow-sm">
          <span className="material-symbols-outlined icon-md" style={{ fontVariationSettings: "'FILL' 1" }}>savings</span>
        </div>
        <h2 className="font-display font-extrabold text-2xl sm:icon-2xl leading-tight tracking-tight text-slate-800">
          {sub === 'budget' ? 'Budget' : 'Rekening'}
        </h2>
      </header>

      {/* Sub-tab toggle pill (Rekening | Budget) — Tactile Segmented Track */}
      <div className="mb-5 px-1">
        <div className="clay-segmented-track">
          <button
            type="button"
            onClick={() => setSub('rekening')}
            aria-pressed={sub === 'rekening'}
            className={`clay-segment-item ${sub === 'rekening' ? 'is-active is-income' : ''}`}
          >
            <span className="material-symbols-outlined icon-sm" style={{ fontVariationSettings: sub === 'rekening' ? "'FILL' 1" : "'FILL' 0" }}>account_balance</span>
            Rekening
          </button>
          <button
            type="button"
            onClick={() => setSub('budget')}
            aria-pressed={sub === 'budget'}
            className={`clay-segment-item ${sub === 'budget' ? 'is-active is-income' : ''}`}
          >
            <span className="material-symbols-outlined icon-sm" style={{ fontVariationSettings: sub === 'budget' ? "'FILL' 1" : "'FILL' 0" }}>savings</span>
            Budget
          </button>
        </div>
      </div>

      {sub === 'rekening' ? (
        <RekeningPanel uid={uid} transBulan={transBulan} />
      ) : (
        <>
          {/* Period Navigator (bulan/tahun) */}
          <div className="mb-3 flex shrink-0 items-center justify-center gap-3">
            <button
              onClick={() => navigatePeriode(-1)}
              disabled={!bisaMundur}
              aria-label="Periode sebelumnya"
              className="clay-pagination-arrow clay-key-neutral flex h-9 w-9 items-center justify-center rounded-full shrink-0 aspect-square bg-surfaceContainerLowest"
            >
              <span className="material-symbols-outlined icon-md text-slate-600">chevron_left</span>
            </button>
            <span className="min-w-[140px] text-center text-sm font-bold text-slate-800">{labelPeriode(bulan, tahun)}</span>
            <button
              onClick={() => navigatePeriode(1)}
              disabled={!bisaMaju}
              aria-label="Periode berikutnya"
              className="clay-pagination-arrow clay-key-neutral flex h-9 w-9 items-center justify-center rounded-full shrink-0 aspect-square bg-surfaceContainerLowest"
            >
              <span className="material-symbols-outlined icon-md text-slate-600">chevron_right</span>
            </button>
          </div>

          {/* Total Budget — kartu clay (bukan gradient biru).
              Aksen warna dibawa .hero-blue; teks tetap gelap di atas putih
              supaya kontrasnya terukur dan tidak pernah white-on-white. */}
          <div className="hero-card hero-blue mb-4 shrink-0 p-5">
            <div className="mb-1 flex items-center gap-2">
              <span
                className="material-symbols-outlined icon-md text-info"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                wallet
              </span>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-600 sm:text-sm">
                Total Budget
              </p>
            </div>
            <p className="font-mono mb-2 text-xl font-extrabold tracking-tight text-slate-900 tabular-nums lg:text-2xl">
              {formatRupiah(ringkasan.totalLimit)}
            </p>
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-600">
              <span>Terpakai: {formatRupiah(ringkasan.totalTerpakai)}</span>
              <span>Sisa: {formatRupiah(ringkasan.sisa)}</span>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full transition-all ${ringkasan.lewat ? 'bg-danger' : 'bg-info'}`}
                style={{ width: `${Math.min(100, ringkasan.persen)}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 border-t border-slate-200 pt-3">
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-slate-500">Pemasukan bulan ini</p>
                <p className="font-mono truncate text-xs font-bold text-incomeText tabular-nums">
                  {formatRupiah(ringkasan.totalPemasukan)}
                </p>
              </div>
              <div className="min-w-0 text-right">
                <p className="text-[10px] font-medium text-slate-500">Pengeluaran bulan ini</p>
                <p className="font-mono truncate text-xs font-bold text-expenseText tabular-nums">
                  {formatRupiah(ringkasan.totalPengeluaran)}
                </p>
              </div>
            </div>
          </div>

          {/* Daftar budget */}
          <BudgetPanel
            uid={uid}
            kategoriList={kategoriList}
            budgets={ringkasan.list}
            setModal={setModal}
            hapusTarget={hapusTarget}
            setHapusTarget={setHapusTarget}
          />
        </>
      )}

      {/* Modal Form Budget */}
      <FormBudgetModal
        open={modal.open}
        edit={modal.edit}
        uid={uid}
        kategoriList={kategoriList}
        existing={ringkasan.list}
        bulan={bulan}
        tahun={tahun}
        onClose={() => setModal({ open: false, edit: null })}
      />
    </section>
  )
}
