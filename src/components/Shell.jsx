import { signOut } from "firebase/auth";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import InstallButton from "./InstallButton.jsx";
import ModulSkeleton from "./ModulSkeleton.jsx";
import UserMenuSheet from "./UserMenuSheet.jsx";
import { getFirebase } from "../lib/firebase.js";
import {
  detectCountryInfo,
  simpanNegaraManual,
  formatRupiah,
  NEGARA,
  EVENT_LOKASI,
} from "../lib/format.js";

// Lazy-load per modul. Shell merender 4 tab + 4 aside panel; sebelumnya semuanya
// masuk bundle utama, jadi chart.js (via StatistikView) ikut terunduh walau user
// cuma membuka tab Transaksi. Modal pun lazy: tidak ada yang perlu menarik jsPDF
// sebelum user benar-benar menekan tombol Ekspor.
const TransaksiView = lazy(
  () => import("../features/transaksi/TransaksiView.jsx"),
);
const BudgetView = lazy(() => import("../features/budget/BudgetView.jsx"));
const UtangView = lazy(() => import("../features/utang/UtangView.jsx"));
const StatistikView = lazy(
  () => import("../features/statistik/StatistikView.jsx"),
);
const RightPanel = lazy(() => import("../features/transaksi/RightPanel.jsx"));
const StatistikAsidePanel = lazy(
  () => import("../features/statistik/StatistikAsidePanel.jsx"),
);
const BudgetAsidePanel = lazy(
  () => import("../features/budget/BudgetAsidePanel.jsx"),
);
const UtangAsidePanel = lazy(
  () => import("../features/utang/UtangAsidePanel.jsx"),
);
const BackupModal = lazy(() => import("../features/backup/BackupModal.jsx"));
const ExportPdfModal = lazy(
  () => import("../features/laporan/ExportPdfModal.jsx"),
);

const TABS = [
  { id: "transaksi", label: "Transaksi", icon: "home", fase: "Fase 2" },
  { id: "statistik", label: "Statistik", icon: "monitoring", fase: "Fase 4" },
  { id: "budget", label: "Budget", icon: "savings", fase: "Fase 3" },
  { id: "utang", label: "Utang", icon: "handshake", fase: "Fase 3" },
];

// Tema sidebar mengikuti tab aktif (sama persis GAS: Budget=biru, Utang=merah, lainnya=hijau)
function sidebarTheme(tab) {
  if (tab === "budget") return { panel: "clay-key-blue", logo: "bg-blue-600" };
  if (tab === "utang") return { panel: "clay-key-danger", logo: "bg-red-600" };
  return { panel: "clay-key-primary", logo: "bg-primary" };
}

// clay-key saat tombol TIDAK aktif (identitas tiap menu)
const NAV_BASE_KEY = {
  transaksi: "clay-key-primary",
  statistik: "clay-key-neutral",
  budget: "clay-key-blue",
  utang: "clay-key-danger",
};

// class saat tombol AKTIF: gradient + shadow mengikuti tema tab
function navActiveClass(id) {
  if (id === "budget") return "clay-key-blue bg-blue-600 text-white";
  if (id === "utang") return "clay-key-danger bg-red-600 text-white";
  return "clay-key-primary bg-primary text-white";
}

function Avatar({ user, size = "h-9 w-9 text-sm" }) {
  if (user.photoURL) {
    return (
      <img
        src={user.photoURL}
        alt=""
        className={`${size} rounded-full object-cover`}
        referrerPolicy="no-referrer"
      />
    );
  }
  const inisial = (user.displayName || user.email || "?")
    .charAt(0)
    .toUpperCase();
  return (
    <div
      className={`${size} flex items-center justify-center rounded-full bg-primary font-extrabold text-white`}
    >
      {inisial}
    </div>
  );
}

// Ikon nav bawah mobile — pill clay di belakang ikon (aktif = inset), tanpa label
// (GAS menyembunyikan label di bawah md), warna mengikuti tab.
function dispatchAksi(type) {
  window.dispatchEvent(
    new CustomEvent("myduit:aksi-cepat", { detail: { type } }),
  );
}

function NavIkona({ t, active, onClick }) {
  let activeColor = "text-primary";
  let activeKey = "clay-key-primary";
  if (t.id === "budget") {
    activeColor = "text-blue-700";
    activeKey = "clay-key-blue";
  } else if (t.id === "utang") {
    activeColor = "text-danger";
    activeKey = "clay-key-danger";
  }

  // Bottom nav sebelumnya HANYA ikon tanpa label → tab aktif sulit dikenali dan
  // secara aksesibilitas ikon saja tidak cukup jelas. Sekarang: label teks selalu
  // tampil, ikon terisi (FILL 1) + pil inset saat aktif, dan titik indikator.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t.label}
      aria-current={active ? "page" : undefined}
      className={`nav-item group relative flex h-[54px] min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl py-0 transition-all active:scale-95 touch-manipulation ${
        active ? activeColor : "text-textSecondary"
      }`}
    >
      <span
        className={`nav-icon-wrap ${active ? `nav-icon-active ${activeKey}` : "nav-icon-inactive"}`}
      >
        <span
          className="material-symbols-outlined icon-lg"
          style={{
            fontVariationSettings: active
              ? "'FILL' 1, 'wght' 600"
              : "'FILL' 0, 'wght' 400, 'GRAD' 0",
          }}
        >
          {t.icon}
        </span>
      </span>
      <span
        className={`w-full shrink-0 whitespace-nowrap text-center text-[11px] leading-tight ${active ? "font-extrabold" : "font-semibold"}`}
      >
        {t.label}
      </span>
      {/* Titik indikator aktif — sinyal kedua selain warna (ramah buta warna) */}
      <span
        className={`h-1 w-1 rounded-full transition-opacity ${active ? "bg-current opacity-100" : "opacity-0"}`}
      />
    </button>
  );
}

// ===== Sidebar Insight Cards (subscribe event dari view terkait) =====

const TIPS_KEUANGAN = [
  "Catat pengeluaran segera setelah transaksi terjadi supaya tidak ada yang terlewat.",
  "Sisihkan minimal 10% pemasukan untuk tabungan di awal bulan, bukan di akhir.",
  "Bedakan dulu kebutuhan dan keinginan sebelum membeli sesuatu.",
  "Coba metode 50/30/20: 50% kebutuhan, 30% keinginan, 20% tabungan.",
  "Review langganan bulanan Anda - matikan yang jarang dipakai.",
  "Masak di rumah 2x seminggu untuk memangkas pengeluaran makan.",
  "Siapkan dana darurat idealnya 3x pengeluaran bulanan.",
  "Bandingkan harga sebelum checkout; gunakan promo dengan bijak.",
  "Tetapkan limit belanja harian agar pengeluaran mudah dikontrol.",
  "Evaluasi pengeluaran terbesar Anda setiap akhir pekan.",
];

function functionTipHarian() {
  const doy = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000,
  );
  return TIPS_KEUANGAN[doy % TIPS_KEUANGAN.length];
}

function SidebarInsightStatistik() {
  const [data, setData] = useState(null);
  useEffect(() => {
    function onUpdate(e) {
      setData(e.detail);
    }
    window.addEventListener("myduit:sidebar-statistik-update", onUpdate);
    return () =>
      window.removeEventListener("myduit:sidebar-statistik-update", onUpdate);
  }, []);

  const streak = data?.streak ?? 0;
  const last = data?.last ?? "";

  return (
    <div
      id="sidebarStatistikInsightCard"
      className="clay clay-card clay-key-blue bg-white mt-2 flex w-full min-w-0 flex-col gap-2 rounded-[18px] p-4"
    >
      <div className="flex items-center gap-2">
        <span
          className="material-symbols-outlined icon-sm text-primary"
          style={{ fontVariationSettings: '"FILL" 1' }}
        >
          local_fire_department
        </span>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Streak Pencatatan
        </p>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono font-extrabold text-xl text-primary">
          {streak}
        </span>
        <span className="text-[11px] font-semibold text-textSecondary">
          hari beruntun mencatat
        </span>
      </div>
      <p className="text-[10px] font-medium text-textSecondary">
        {last
          ? `Catatan terakhir: ${new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${last}T00:00:00`))}`
          : "Belum ada catatan pada periode ini"}
      </p>
      <div className="h-px bg-slate-200/70"></div>
      <div className="flex items-start gap-2">
        <span
          className="material-symbols-outlined icon-sm text-amber-600 shrink-0"
          style={{ fontVariationSettings: '"FILL" 1' }}
        >
          tips_and_updates
        </span>
        <p className="text-[11px] leading-snug text-slate-600">
          {functionTipHarian()}
        </p>
      </div>
    </div>
  );
}

function SidebarInsightBudget() {
  const [data, setData] = useState(null);
  useEffect(() => {
    function onUpdate(e) {
      setData(e.detail);
    }
    window.addEventListener("myduit:sidebar-insight-budget", onUpdate);
    return () =>
      window.removeEventListener("myduit:sidebar-insight-budget", onUpdate);
  }, []);

  const totalLimit = data?.totalLimit ?? 0;
  const terpakai = data?.totalTerpakai ?? 0;
  const persen = data?.persen ?? 0;
  const hampirHabis = data?.kategoriTerdikit;

  return (
    <div
      id="sidebarBudgetInsightCard"
      className="clay clay-card clay-key-blue bg-white mt-2 flex w-full min-w-0 flex-col gap-2 rounded-[18px] p-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="material-symbols-outlined icon-sm text-blue-600 shrink-0"
          style={{ fontVariationSettings: '"FILL" 1' }}
        >
          insights
        </span>
        <p className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Insight Budget
        </p>
      </div>
      {totalLimit > 0 ? (
        <>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span className="font-mono font-extrabold text-xl text-blue-600">
              {persen}%
            </span>
            <span className="text-[11px] font-semibold text-textSecondary">
              terpakai bulan ini
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all ${persen > 100 ? "bg-red-400" : persen >= 80 ? "bg-amber-400" : "bg-primary"}`}
              style={{ width: `${Math.min(100, persen)}%` }}
            />
          </div>
          <p className="break-words text-[10px] font-medium leading-snug text-textSecondary">
            {formatRupiah(terpakai)} / {formatRupiah(totalLimit)}
          </p>
          {hampirHabis && (
            <>
              <div className="h-px bg-slate-200/70"></div>
              <div className="flex min-w-0 items-start gap-2">
                <span
                  className="material-symbols-outlined icon-sm text-amber-600 shrink-0"
                  style={{ fontVariationSettings: '"FILL" 1' }}
                >
                  warning
                </span>
                <p className="min-w-0 break-words text-[11px] leading-snug text-slate-600">
                  <span className="font-bold text-slate-700">
                    {hampirHabis.nama}
                  </span>{" "}
                  hampir mencapai limit ({hampirHabis.persen}%)
                </p>
              </div>
            </>
          )}
        </>
      ) : (
        <p className="break-words text-[11px] leading-snug text-slate-600">
          Belum ada budget bulan ini. Tekan + untuk membatasi pengeluaran per
          kategori.
        </p>
      )}
    </div>
  );
}

function SidebarInsightUtang() {
  const [data, setData] = useState(null);
  useEffect(() => {
    function onUpdate(e) {
      setData(e.detail);
    }
    window.addEventListener("myduit:sidebar-utang-update", onUpdate);
    return () =>
      window.removeEventListener("myduit:sidebar-utang-update", onUpdate);
  }, []);

  const bulan = data?.bulanEstimasi;
  const perkiraan = data?.perkiraan ?? "—";
  const terbesar = data?.terbesar;

  return (
    <div
      id="sidebarUtangInfoCard"
      className="clay clay-card clay-key-danger bg-white mt-2 flex w-full min-w-0 flex-col gap-2 rounded-[18px] p-4"
    >
      <div className="flex items-center gap-2">
        <span
          className="material-symbols-outlined icon-sm text-red-600"
          style={{ fontVariationSettings: '"FILL" 1' }}
        >
          flag
        </span>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Perkiraan Bebas Utang
        </p>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono font-extrabold text-xl text-red-600">
          {bulan ? `≈${bulan}` : "—"}
        </span>
        <span className="text-[11px] font-semibold text-textSecondary">
          bulan lagi
        </span>
      </div>
      <p className="text-[10px] font-medium text-textSecondary">{perkiraan}</p>
      <div className="h-px bg-slate-200/70"></div>
      <div className="flex min-w-0 items-start gap-2">
        <span
          className="material-symbols-outlined icon-sm text-amber-600 shrink-0"
          style={{ fontVariationSettings: '"FILL" 1' }}
        >
          warning
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-bold text-slate-700">
            {terbesar?.nama ?? "—"}
          </p>
          <p className="text-[10px] font-medium text-textSecondary">
            {terbesar
              ? `Sisa ${formatRupiah(terbesar.sisa ?? 0)}`
              : "Tidak ada utang aktif"}
          </p>
        </div>
      </div>
    </div>
  );
}

// Modal pilih lokasi — dibuka dari foto profil (sidebar kiri / header mobile).
// Hasil pilihan dipakai detectCurrency() & detectCountryInfo() lewat localStorage.
function LokasiModal({ open, onClose, aktifCode, otomatis }) {
  if (!open) return null;
  const daftar = Object.entries(NEGARA).sort((a, b) =>
    a[1].nama.localeCompare(b[1].nama),
  );
  function pilih(code) {
    simpanNegaraManual(code);
    onClose();
  }
  return (
    <div
      className="fixed inset-0 z-[10000] flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="clay-sheet clay-key-primary flex max-h-[90vh] w-full flex-col overflow-hidden bg-white sm:max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 pb-4 pt-5">
          <div className="min-w-0">
            <h3 className="text-lg font-extrabold text-slate-800">
              Lokasi & Mata Uang
            </h3>
            <p className="mt-0.5 text-[11px] font-semibold text-textSecondary">
              {otomatis
                ? "Saat ini terdeteksi otomatis dari perangkat"
                : "Saat ini diatur manual"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="clay-chip clay-key-neutral flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:text-slate-600"
          >
            <span className="material-symbols-outlined icon-lg">close</span>
          </button>
        </div>
        <div className="space-y-2 overflow-y-auto px-5 py-4">
          {daftar.map(([code, n]) => {
            const pilihan = !otomatis && code === aktifCode;
            return (
              <button
                key={code}
                type="button"
                onClick={() => pilih(code)}
                className={`clay-btn ${pilihan ? "clay-key-primary bg-primary text-white" : "clay-key-neutral bg-white text-slate-700 hover:bg-slate-50"} btn-lg flex w-full items-center gap-3`}
              >
                <span className="text-base leading-none">{n.bendera}</span>
                <span className="min-w-0 flex-1 truncate text-left">
                  {n.nama}
                </span>
                <span
                  className={`font-mono text-xs font-bold ${pilihan ? "text-white/90" : "text-textSecondary"}`}
                >
                  {n.symbol}
                </span>
                {pilihan && (
                  <span className="material-symbols-outlined icon-md">
                    check
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="shrink-0 border-t border-slate-100 px-5 py-4">
          <button
            onClick={() => pilih("")}
            disabled={otomatis}
            className="clay-btn clay-btn-secondary btn-md w-full text-textSecondary disabled:opacity-50"
          >
            <span className="material-symbols-outlined icon-md">
              my_location
            </span>
            Deteksi otomatis
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Shell({ user }) {
  const [tab, setTab] = useState("transaksi");
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [backupOpen, setBackupOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [lokasiOpen, setLokasiOpen] = useState(false);
  const [fabDial, setFabDial] = useState(false);
  const [filterLabel, setFilterLabel] = useState("Hari Ini");
  const aktif = TABS.find((t) => t.id === tab);
  const mainScrollRef = useRef(null);

  // Mode "pas layar": dipakai tab Utang di mobile. Konten dikunci setinggi
  // viewport dikurangi bottom-nav dan dilarang scroll — UtangMobile memakai
  // pager satu kartu per halaman supaya semuanya muat tanpa menggeser layar.
  const [lebarLayar, setLebarLayar] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1280,
  );
  useEffect(() => {
    const onResize = () => setLebarLayar(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const pasLayar = tab === "utang" && lebarLayar < 1024;

  // Info negara + mata uang untuk indikator lokasi di sidebar kiri.
  // Sumber: pilihan manual pengguna (localStorage) > timezone perangkat.
  const [countryInfo, setCountryInfo] = useState(() =>
    detectCountryInfo(navigator.language || "id-ID"),
  );
  useEffect(() => {
    const onLokasi = () =>
      setCountryInfo(detectCountryInfo(navigator.language || "id-ID"));
    window.addEventListener(EVENT_LOKASI, onLokasi);
    return () => window.removeEventListener(EVENT_LOKASI, onLokasi);
  }, []);
  const countryFlag = countryInfo.bendera;
  const countryNama = countryInfo.nama;
  const currencySymbol = countryInfo.symbol;

  // Setiap pindah tab, scroll main content kembali ke atas (smooth).
  useEffect(() => {
    const el = mainScrollRef.current;
    if (el && typeof el.scrollTo === "function") {
      el.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [tab]);

  useEffect(() => {
    const onLabel = (e) => setFilterLabel(e.detail?.label ?? "Hari Ini");
    const onPdf = () => setPdfOpen(true);
    window.addEventListener("myduit:filter-label", onLabel);
    window.addEventListener("myduit:export-pdf", onPdf);
    return () => {
      window.removeEventListener("myduit:filter-label", onLabel);
      window.removeEventListener("myduit:export-pdf", onPdf);
    };
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  async function keluar() {
    const { auth } = getFirebase();
    const uid = auth.currentUser?.uid;
    await signOut(auth);

    // Bersihkan penanda migrasi milik user yang keluar saja.
    //
    // Cache Firestore di IndexedDB SENGAJA tidak dihapus: itu yang membuat app
    // bisa dibuka offline, dan di perangkat sendiri data memang seharusnya
    // tetap ada saat login lagi. Yang dibersihkan hanya penanda per-user supaya
    // user berikutnya di perangkat ini tidak mewarisi state lama.
    //
    // CATATAN: jangan memanggil db.terminate() di sini. getFirebase() meng-cache
    // instance db di variabel modul, jadi terminate() membuat referensi itu mati
    // permanen — login berikutnya di sesi yang sama tidak akan bisa menulis
    // sama sekali sampai halaman di-reload.
    try {
      if (uid) localStorage.removeItem(`myduit-migrasi-norm-${uid}`);
    } catch (e) {
      console.warn("bersihkan penanda lokal gagal:", e?.message);
    }
  }

  // RESPONSIF - grid 2 sampai 3 kolom, sesuai jumlah panel yang tampil.
  //
  // Ada 3 grid item: aside (sidebar kiri), main (isi), dan panel kanan
  // (RightPanel/StatistikAsidePanel/BudgetAsidePanel/UtangAsidePanel).
  // Panel kanan itu punya `hidden xl:flex xl:w-[350px]` sendiri, jadi
  // kolom ke-3 HARUS ada di lg ke atas atau panel kanan hilang.
  //
  //   <768px : 1 kolom, sidebar kiri jadi bottom-nav fixed
  //   768+   : 2 kolom -> sidebar 240px + isi   (panel kanan masih hidden)
  //   1024+  : 3 kolom -> sidebar 260px + isi + panel kanan 350px
  //   1280+  : 3 kolom -> sidebar 300px + isi + panel kanan 350px
  //   1536+  : 3 kolom -> sidebar 350px + isi + panel kanan 350px
  //
  // Kolom isi memakai minmax(0,1fr) + min-w-0 di main supaya angka rupiah
  // dan tabel panjang tidak melebarkan kolom (sumber scroll horizontal).

  return (
    <div className="min-h-full md:grid md:h-screen md:grid-rows-[minmax(0,1fr)] md:overflow-hidden md:grid-cols-[240px_minmax(0,1fr)_0px] xl:grid-cols-[260px_minmax(0,1fr)_350px] 2xl:grid-cols-[300px_minmax(0,1fr)_350px]">
      {/* ===== SIDEBAR DESKTOP ===== */}
      <aside className="hidden md:flex md:shrink-0 md:grow-0 md:w-[240px] md:min-w-[240px] md:max-w-[240px] xl:w-[260px] xl:min-w-[260px] xl:max-w-[260px] 2xl:w-[300px] 2xl:min-w-[300px] 2xl:max-w-[300px] md:h-full md:p-4 md:pr-2 md:gap-4">
        <div
          className={`clay ${sidebarTheme(tab).panel} bg-surfaceContainerLowest flex flex-col h-full w-full min-w-0 overflow-y-auto hide-scrollbar rounded-[28px] p-4 xl:p-5`}
        >
          <div className="flex items-center gap-3 px-1 pb-4 pt-1">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-2xl ${sidebarTheme(tab).logo} text-white shadow-sm shrink-0`}
            >
              <span
                className="material-symbols-outlined icon-lg"
                style={{ fontVariationSettings: '"FILL" 1' }}
              >
                savings
              </span>
            </div>
            <div>
              <p className="text-lg font-extrabold leading-tight tracking-tight">
                MyDuit
              </p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-textSecondary">
                Catat · Pantau · Kendalikan
              </p>
            </div>
          </div>
          <div className="mx-1 h-px bg-slate-200/70"></div>

          <nav className="-mx-1 mt-4 flex min-h-0 flex-1 flex-col gap-2 px-1">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`clay-btn ${active ? navActiveClass(t.id) : `${NAV_BASE_KEY[t.id]} bg-surfaceContainerLowest text-slate-600 hover:bg-slate-50 hover:text-slate-800`} flex w-full items-center gap-3 px-4 py-3 text-sm font-semibold transition-all`}
                >
                  <span
                    className="material-symbols-outlined icon-lg"
                    style={{
                      fontVariationSettings: active
                        ? '"FILL" 1'
                        : '"FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24',
                    }}
                  >
                    {t.icon}
                  </span>
                  {t.label}
                </button>
              );
            })}
          </nav>

          {/* Insight card per-tab (sama GAS: sidebarStatistikInsightCard / sidebarBudgetInsightCard / sidebarUtangInfoCard) */}
          {tab === "statistik" && <SidebarInsightStatistik />}
          {tab === "budget" && <SidebarInsightBudget />}
          {tab === "utang" && <SidebarInsightUtang />}

          <div className="mt-3 shrink-0 border-t border-gray-100 pt-3">
            <div className="flex items-center gap-2.5 px-1">
              <button
                type="button"
                onClick={() => setLokasiOpen(true)}
                title="Ubah lokasi & mata uang"
                aria-label="Ubah lokasi & mata uang"
                className="shrink-0 rounded-full transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <Avatar user={user} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-slate-800">
                  {user.displayName ?? "Pengguna"}
                </p>
                <p className="truncate text-[10px] text-textSecondary">
                  {user.email}
                </p>
                <button
                  type="button"
                  onClick={() => setLokasiOpen(true)}
                  className="mt-0.5 block max-w-full truncate rounded-md text-left text-[9px] text-textSecondary hover:text-slate-600"
                >
                  {countryFlag} {countryNama} · {currencySymbol}
                </button>
              </div>
              <button
                onClick={() => setBackupOpen(true)}
                title="Backup"
                className="clay-chip flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200"
              >
                <span className="material-symbols-outlined icon-md">
                  backup
                </span>
              </button>
              <button
                onClick={keluar}
                title="Keluar"
                className="clay-chip clay-key-danger flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:!bg-red-50 hover:!text-red-500"
              >
                <span className="material-symbols-outlined icon-md">
                  logout
                </span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ===== KONTEN UTAMA =====
          min-w-0 wajib: sebagai anak grid, `1fr` = minmax(auto,1fr), jadi
          konten panjang bisa melebarkan kolom dan memicu scroll horizontal.

          Mode "pas layar" (mobile, tab utang): konten mengunci tinggi ke
          100dvh - bottom-nav dan TIDAK boleh scroll. Tampilan utang mobile
          memakai pager satu-kartu-per-halaman supaya semua muat. Di luar itu
          (dan di desktop) tetap bisa scroll normal. */}
      <main
        className={`flex-1 min-w-0 md:flex md:flex-col md:h-full md:overflow-hidden md:pb-6 md:px-6 ${pasLayar ? "pb-24" : "pb-24"}`}
      >
        <div
          className={`min-w-0 md:h-full md:overflow-y-auto md:pr-2 md:rounded-[28px] ${pasLayar ? "h-full" : ""}`}
        >
          <div
            ref={mainScrollRef}
            className={`main-scroll max-w-3xl mx-auto relative w-full min-w-0 overflow-x-hidden px-4 md:max-w-none md:px-6 md:mx-0 md:bg-transparent md:h-full md:overflow-y-auto ${pasLayar ? "h-full overflow-y-auto" : "overflow-y-auto"}`}
            style={{ touchAction: "pan-y" }}
          >
            {!online && (
              <div className="sticky top-0 z-10 flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-[11px] font-bold text-amber-900">
                <span className="material-symbols-outlined icon-xs">
                  wifi_off
                </span>
                Mode offline — perubahan tersimpan di perangkat & otomatis
                tersinkron saat daring.
              </div>
            )}
            {/* Header mobile — HANYA di tab transaksi (persis GAS ViewTransaksi.html).
            Di tab lain (Budget/Rekening, Utang, Statistik), modul memiliki header mobile sendiri.
            -mx-4 px-4: bleed ke tepi layar penuh karena parent main-scroll punya px-4. */}
            {tab === "transaksi" && (
              <header className="sticky top-0 z-30 flex items-center justify-between gap-2
                                 -mx-4 px-4 md:hidden
                                 py-2 bg-surface
                                 relative">
                <button
                  type="button"
                  onClick={() => setLokasiOpen(true)}
                  title="Ubah lokasi & mata uang"
                  aria-label="Ubah lokasi & mata uang"
                  className="clay-chip flex h-9 shrink-0 items-center gap-1.5 rounded-full border-none px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 active:scale-95"
                  style={{ border: "none", outline: "none" }}
                >
                  <span className="text-sm leading-none">{countryFlag}</span>
                  <span className="font-extrabold text-slate-800">
                    {currencySymbol}
                  </span>
                  <span className="material-symbols-outlined icon-xs text-slate-500">
                    expand_more
                  </span>
                </button>

                {/* Action buttons di kanan. Di layar sempit (<=360px) hanya yang
                benar-benar sering dipakai yang ditampilkan; Backup & Keluar
                sudah tersedia di UserMenuSheet (tombol avatar di bottom bar),
                jadi tidak perlu memaksa header meluber. */}
                <div className="flex min-w-0 items-center gap-1.5">
                  <button
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent("myduit:buka-filter"),
                      )
                    }
                    aria-label="Filter Transaksi"
                    className="clay-chip flex min-w-0 h-9 shrink-0 items-center gap-1 rounded-full bg-surfaceContainerLowest px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 active:scale-95"
                  >
                    <span className="material-symbols-outlined icon-md text-incomeText">
                      tune
                    </span>
                    <span className="truncate max-w-[85px] sm:max-w-none">
                      {filterLabel}
                    </span>
                  </button>
                  <button
                    onClick={() =>
                      window.dispatchEvent(new CustomEvent("myduit:export-pdf"))
                    }
                    title="Cetak Laporan PDF"
                    aria-label="Cetak Laporan PDF"
                    className="clay-chip flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-red-500 transition-colors hover:bg-red-50 active:scale-95"
                    style={{ border: "none", outline: "none" }}
                  >
                    <span className="material-symbols-outlined icon-md">
                      picture_as_pdf
                    </span>
                  </button>
                  <InstallButton variant="chip" />
                  {/* Menu pengguna (Keluar / Backup / Lokasi). Pindah ke header sejak
                  tombol avatar dihapus dari bottom nav agar FAB bisa presisi di
                  tengah (nav kini grid 5 kolom simetris). */}
                  <button
                    type="button"
                    onClick={() => setUserMenuOpen(true)}
                    aria-label="Menu pengguna"
                    aria-haspopup="dialog"
                    className="clay-chip flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 active:scale-95"
                  >
                    <span className="material-symbols-outlined icon-lg">
                      account_circle
                    </span>
                  </button>
                </div>
              </header>
            )}

            {/* Konten modul aktif */}
            <Suspense fallback={<ModulSkeleton />}>
              <div key={tab} className="tab-pane-transition min-w-0">
                {tab === "transaksi" ? (
                  <TransaksiView user={user} />
                ) : tab === "budget" ? (
                  <BudgetView user={user} />
                ) : tab === "utang" ? (
                  <UtangView user={user} />
                ) : tab === "statistik" ? (
                  <StatistikView user={user} />
                ) : (
                  <section className="mx-auto mt-6 max-w-3xl px-5">
                    <h2 className="text-2xl font-extrabold tracking-tight text-slate-800">
                      {aktif.label}
                    </h2>
                    <div className="clay-card-soft mt-4 flex flex-col items-center justify-center px-6 py-16 text-center">
                      <span className="material-symbols-outlined mb-3 text-5xl text-primary/40">
                        {aktif.icon}
                      </span>
                      <p className="text-sm font-bold text-slate-700">
                        Modul {aktif.label} menyusul di {aktif.fase}.
                      </p>
                      <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
                        Fondasi offline-first (Auth + Firestore persistence) sudah
                        siap — konten modul dibangun bertahap sesuai roadmap.
                      </p>
                    </div>
                  </section>
                )}
              </div>
            </Suspense>
          </div>
        </div>
      </main>

      {/* ===== BOTTOM NAV MOBILE — grid simetris: 2 tab | FAB | 2 tab ===== */}
      {fabDial && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          onClick={() => setFabDial(false)}
        />
      )}
      <nav
        id="navShell"
        className="fixed inset-x-0 bottom-0 z-50 h-[76px] md:hidden"
      >
        <div className="clay-nav absolute inset-0" aria-hidden="true"></div>
        {/* Grid 5 kolom sama lebar mengunci FAB tepat di tengah. Sebelumnya
            flex justify-between dengan 6 item (4 tab + FAB + tombol user) membuat
            FAB bergeser ke kiri dan tampak "tidak pas" dengan notch. */}
        <div className="relative z-10 grid h-full grid-cols-5 items-center px-1">
          <NavIkona
            t={TABS[0]}
            active={tab === TABS[0].id}
            onClick={() => setTab(TABS[0].id)}
          />
          <NavIkona
            t={TABS[1]}
            active={tab === TABS[1].id}
            onClick={() => setTab(TABS[1].id)}
          />

          {/* FAB tengah + speed-dial 3 pilihan (aksi via event bus ke TransaksiView) */}
          {/* Wrapper WAJIB w-full: ia adalah item grid kolom ke-3 (lebar kolom
              ±76px). Dengan lebar tetap w-14/w-16, FAB rata-kiri di dalam
              kolom dan bergeser ±6px dari pusat notch (yang dipatok di 50%
              nav) — persis keluhan "FAB tidak pas dengan notch". w-full
              membuat kolom yang memusatkan FAB. */}
          <div className="relative -mt-10 flex w-full justify-center">
            {tab === "transaksi" && (
              <div className={`fab-speed-dial ${fabDial ? "open" : ""}`}>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFabDial(false);
                    dispatchAksi("pemasukan");
                  }}
                  aria-label="Catat Pemasukan"
                  title="Catat Pemasukan"
                  className="clay-fab clay-key-primary solid-primary fab-dial-btn flex items-center justify-center rounded-full border-4 border-surfaceContainerLowest text-white shadow-md touch-manipulation"
                  style={{
                    "--tx": "-58px",
                    "--ty": "-40px",
                    transitionDelay: ".02s",
                  }}
                >
                  <span className="material-symbols-outlined icon-sm">
                    trending_up
                  </span>
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFabDial(false);
                    dispatchAksi("pindah-saldo");
                  }}
                  aria-label="Pindah Saldo"
                  title="Pindah Saldo"
                  className="clay-fab clay-key-blue solid-blue fab-dial-btn flex items-center justify-center rounded-full border-4 border-surfaceContainerLowest text-white shadow-md touch-manipulation"
                  style={{
                    "--tx": "0px",
                    "--ty": "-78px",
                    transitionDelay: ".07s",
                  }}
                >
                  <span className="material-symbols-outlined icon-sm">
                    sync_alt
                  </span>
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFabDial(false);
                    dispatchAksi("pengeluaran");
                  }}
                  aria-label="Catat Pengeluaran"
                  title="Catat Pengeluaran"
                  className="clay-fab clay-key-danger solid-danger fab-dial-btn flex items-center justify-center rounded-full border-4 border-surfaceContainerLowest text-white shadow-md touch-manipulation"
                  style={{
                    "--tx": "58px",
                    "--ty": "-40px",
                    transitionDelay: ".12s",
                  }}
                >
                  <span className="material-symbols-outlined icon-sm">
                    trending_down
                  </span>
                </button>
              </div>
            )}
            <button
              onClick={() => {
                if (tab === "transaksi") {
                  setFabDial((v) => !v);
                } else if (tab === "budget") {
                  window.dispatchEvent(
                    new CustomEvent("myduit:buka-tambah-budget-rekening"),
                  );
                } else if (tab === "utang") {
                  window.dispatchEvent(
                    new CustomEvent("myduit:buka-tambah-utang"),
                  );
                }
              }}
              aria-label={
                tab === "budget"
                  ? "Tambah Rekening/Budget"
                  : tab === "utang"
                    ? "Tambah Utang"
                    : "Quick Add Transaksi"
              }
              className={`clay-fab group relative z-10 flex h-14 w-14 items-center justify-center rounded-full border-4 border-surfaceContainerLowest text-white transition-all duration-200 active:scale-95 touch-manipulation ${
                tab === "budget"
                  ? "clay-key-blue bg-blue-600"
                  : tab === "utang"
                    ? "clay-key-danger bg-red-600"
                    : "clay-key-primary bg-primary"
              }`}
            >
              <span
                className={`material-symbols-outlined icon-2xl transition-transform duration-200 group-hover:scale-110 ${
                  tab === "transaksi" && fabDial ? "fab-icon-open" : ""
                }`}
                style={{ fontVariationSettings: "'FILL' 1, 'wght' 500" }}
              >
                add
              </span>
            </button>
          </div>

          <NavIkona
            t={TABS[2]}
            active={tab === TABS[2].id}
            onClick={() => setTab(TABS[2].id)}
          />
          <NavIkona
            t={TABS[3]}
            active={tab === TABS[3].id}
            onClick={() => setTab(TABS[3].id)}
          />
        </div>
      </nav>

      <Suspense fallback={null}>
        <div key={tab} className="tab-pane-transition hidden xl:block xl:h-full">
          {tab === "transaksi" && <RightPanel uid={user.uid} />}
          {tab === "statistik" && <StatistikAsidePanel />}
          {tab === "budget" && <BudgetAsidePanel />}
          {tab === "utang" && <UtangAsidePanel />}
        </div>
      </Suspense>

      <Suspense fallback={null}>
        <BackupModal
          open={backupOpen}
          uid={user.uid}
          onClose={() => setBackupOpen(false)}
        />
        <ExportPdfModal
          open={pdfOpen}
          uid={user.uid}
          userName={user.displayName ?? user.email ?? "Pengguna"}
          onClose={() => setPdfOpen(false)}
        />
      </Suspense>
      <LokasiModal
        open={lokasiOpen}
        aktifCode={countryInfo.code}
        otomatis={!countryInfo.manual}
        onClose={() => setLokasiOpen(false)}
      />

      {/* Menu pengguna untuk mobile: satu-satunya jalan ke Keluar / Backup /
          ganti lokasi dari tab mana pun (sidebar desktop tersembunyi di mobile). */}
      <UserMenuSheet
        open={userMenuOpen}
        onClose={() => setUserMenuOpen(false)}
        onLokasi={() => setLokasiOpen(true)}
        onBackup={() => setBackupOpen(true)}
        onKeluar={keluar}
        user={user}
        countryFlag={countryFlag}
        currencySymbol={currencySymbol}
        negara={countryInfo.nama}
      />
    </div>
  );
}
