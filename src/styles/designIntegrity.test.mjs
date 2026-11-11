// Uji integritas standar desain & anti-regresi tata letak UI (Design Integrity Contract)
// Mencegah kerusakan layout toolbar, layout-thrashing, dan visual clutter lolos uji.
// Jalankan via: node src/styles/designIntegrity.test.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../..')
let total = 0
let lulus = 0
const galat = []

function cek(nama, ok, info = '') {
  total++
  if (ok) {
    lulus++
    console.log(`  ok    ${nama}`)
  } else {
    galat.push(`${nama} ${info}`.trim())
    console.log(`  GAGAL ${nama} ${info}`.trim())
  }
}

// 1. Periksa TransaksiView.jsx: Tombol Catat Transaksi toolbar TIDAK BOLEH tampil di mobile (< 768px)
// Di mobile hanya ada satu pemicu aksi utama: Central FAB bottom nav (standar Clean Mobile UX).
const fileTransaksiView = readFileSync(join(root, 'src/features/transaksi/TransaksiView.jsx'), 'utf8')
const toolbarButtonHiddenOnMobile = fileTransaksiView.includes('hidden h-14 shrink-0 items-center gap-1.5 rounded-[22px] px-4 text-xs font-bold text-white transition-all hover:brightness-105 active:scale-95 md:flex xl:hidden')
cek('toolbar TransaksiView: tombol CTA desktop tersembunyi di mobile (hidden ... md:flex xl:hidden)', toolbarButtonHiddenOnMobile)

// 2. Periksa FormTransaksiModal.jsx: Bebas dari quick chips statis yang mengotori form modal
const fileFormModal = readFileSync(join(root, 'src/features/transaksi/FormTransaksiModal.jsx'), 'utf8')
const tanpaQuickChipsKategori = !fileFormModal.includes('Quick Category Chips')
cek('modal transaksi: bebas dari quick chips redundan di bawah combobox', tanpaQuickChipsKategori)

// 3. Periksa Shell.jsx: Bebas dari key={tab} yang merusak state dan memicu flashing unmount saat ganti menu
const fileShell = readFileSync(join(root, 'src/components/Shell.jsx'), 'utf8')
const tanpaKeyTabUnmount = !fileShell.includes('key={tab}')
cek('shell: navigasi bebas dari key={tab} unmount flashing', tanpaKeyTabUnmount)

// 4. Periksa index.css: Bebas dari content-visibility auto pada kartu transaksi (penyebab scrollbar loncat)
const fileCss = readFileSync(join(root, 'src/styles/index.css'), 'utf8')
const tanpaContentVisibilityTx = !fileCss.includes('content-visibility: auto')
cek('css: .tx-card-item bebas dari content-visibility auto (mencegah scrollbar loncat)', tanpaContentVisibilityTx)

// 5. Periksa index.css: .clay-sheet stabil tanpa scale jump yang berlebihan
const tanpaSheetPopJump = !fileCss.includes('animation: claySheetIn')
cek('css: .clay-sheet stabil tanpa scale/pop animation yang memicu jitter', tanpaSheetPopJump)

// 6. Periksa index.css: Bebas dari kurva overshoot liar 1.56 (mencegah wobble kartun pada aksi utilitas)
const tanpaOvershootWobble = !fileCss.includes('1.56')
cek('css: bebas dari kurva overshoot liar 1.56 (mencegah wobble pada tombol & kartu utilitas)', tanpaOvershootWobble)

// 7. Periksa index.css: Sistem motion physics terdefinisi (--motion-ease-spring dan durasi sinkron)
const motionPhysicsTerdefinisi = fileCss.includes('--motion-ease-spring') && fileCss.includes('--motion-dur-fast')
cek('css: sistem motion physics terdefinisi (--motion-ease-spring dan durasi sinkron)', motionPhysicsTerdefinisi)

// 8. Periksa FormTransaksiModal.jsx: Menggunakan .clay-segmented-track taktil, bebas dari tombol template bg-red-500
const segmentedTrackTaktil = fileFormModal.includes('clay-segmented-track') && !fileFormModal.includes('bg-red-500 text-white shadow-')
cek('modal transaksi: memakai .clay-segmented-track taktil (bebas dari template button bg-red-500)', segmentedTrackTaktil)

// 9. Periksa TransaksiView.jsx: Bebas dari kelas generik bg-blue-700 shadow-md di toolbar
const toolbarBebasGenericShadow = !fileTransaksiView.includes('bg-blue-700 text-white shadow-md')
cek('toolbar TransaksiView: chip filter memakai token solid-blue (bebas dari bg-blue-700 shadow-md generik)', toolbarBebasGenericShadow)

// 10. Periksa index.css: Kanvas tanah liat hangat styleguide (--clay-bg: #f0f3f0) terdefinisi
const kanvasClayHangat = fileCss.includes('--clay-bg: #f0f3f0;')
cek('css: kanvas tanah liat hangat styleguide (--clay-bg: #f0f3f0) terdefinisi', kanvasClayHangat)

// 11. Periksa index.css: Token ekstrusi 3D claymorphism terdefinisi di :root
const tokenEkstrusi3DTerdefinisi =
  fileCss.includes('--clay-lip-btn-primary') &&
  fileCss.includes('--clay-lip-card') &&
  fileCss.includes('--clay-lip-chip')
cek('css: token ekstrusi 3D claymorphism (--clay-lip-*) terdefinisi di :root', tokenEkstrusi3DTerdefinisi)

// 12. Periksa index.css: Cincin fokus zamrud luminous terdefinisi pada focus-visible
const cincinFokusZamrud = fileCss.includes('rgba(45, 106, 79, 0.35)') && fileCss.includes('--clay-focus-ring')
cek('css: cincin fokus zamrud luminous terpasang pada focus-visible', cincinFokusZamrud)

// 13. Periksa index.css: Sumur galian input (excavated trench) terpasang pada .clay-field & .clay-input
const sumurGalianInput =
  fileCss.includes('inset 3px 3px 6px rgba(0, 0, 0, 0.10)') &&
  fileCss.includes('inset -2px -2px 5px rgba(255, 255, 255, 0.95)')
cek('css: sumur galian input (excavated trench) terpasang pada .clay-field & .clay-input', sumurGalianInput)

// 14. Periksa index.css: Tombol 3D extruded shelf terpasang pada .clay-btn-primary
const tombol3DExtrudedShelf =
  fileCss.includes('0 4px 0 var(--clay-lip-btn-primary)') &&
  fileCss.includes('0 1px 0 var(--clay-lip-btn-primary)')
cek('css: tombol 3D extruded shelf dan kompresi tekan terpasang pada tombol aksi', tombol3DExtrudedShelf)

// 15. Periksa index.css: FAB dome 3D extruded shelf terpasang pada .clay-fab
const fab3DDomeShelf =
  fileCss.includes('0 5px 0 var(--clay-lip-btn-primary)') &&
  fileCss.includes('0 1.5px 0 var(--clay-lip-btn-primary)')
cek('css: FAB central dome 3D extruded shelf terpasang pada .clay-fab', fab3DDomeShelf)

// 16. Periksa Shell.jsx: Tombol FAB speed dial bebas dari utilitas penimpa shadow-md
const speedDialTanpaShadowMd = !fileShell.includes('fab-dial-btn flex items-center justify-center rounded-full border-4 border-surfaceContainerLowest text-white shadow-md')
cek('shell: speed-dial FAB bebas dari utility shadow-md yang menimpa kubah clay 3D', speedDialTanpaShadowMd)

// 17. Periksa FormTransaksiModal.jsx: Hero nominal berada di atas kategori & catatan
const posJumlah = fileFormModal.indexOf('id="tx-jumlah"')
const posKategori = fileFormModal.indexOf('id="tx-kategori"')
const posCatatan = fileFormModal.indexOf('id="tx-catatan"')
const heroNominalDiAtas = posJumlah > -1 && posJumlah < posKategori && posJumlah < posCatatan
cek('modal transaksi: input nominal diposisikan sebagai hero di puncak form (di atas kategori & catatan)', heroNominalDiAtas)

// 18. Periksa index.css & Shell.jsx: Sidebar nav memakai .sidebar-nav-btn dan bebas dari bug ghost button
const fileShellUpdated = readFileSync(join(root, 'src/components/Shell.jsx'), 'utf8')
const sidebarNavTaktil = fileCss.includes('.sidebar-nav-btn.is-active') && fileShellUpdated.includes('sidebar-nav-btn') && !fileShellUpdated.includes('navActiveClass')
cek('shell: navigasi sidebar memakai .sidebar-nav-btn 3D taktil (bebas dari bug ghost button putih-di-atas-putih)', sidebarNavTaktil)

// 19. Periksa Shell.jsx: Identitas brand MyDuit konsisten (bebas dari penukar logo sidebarTheme bunglon)
const brandMyDuitKonsisten = !fileShellUpdated.includes('sidebarTheme(tab)') && fileShellUpdated.includes('from-emerald-600 to-primary')
cek('shell: identitas logo MyDuit konsisten zamrud (bebas dari chameleon sidebarTheme per-tab)', brandMyDuitKonsisten)

// 20. Periksa UtangView.jsx: Filter "Semua" tidak menggunakan clay-chip-active-danger
const fileUtangView = readFileSync(join(root, 'src/features/utang/UtangView.jsx'), 'utf8')
const filterSemuaTenang = !fileUtangView.includes("filter === f.id ? 'clay-chip-active-danger'")
cek('utang: filter aktif umum memakai palet tenang (danger hanya untuk terlambat)', filterSemuaTenang)

// 21. Larangan ornamen semu lingkaran / noda sudut pada kartu hero (.hero-card::before)
const bebasLingkaranSemu = !fileCss.includes('.hero-card::before') && !fileCss.includes('radial-gradient(circle at 100% 0%')
cek('css: kartu bebas dari ornamen semu lingkaran (.hero-card::before dan radial-gradient kotor)', bebasLingkaranSemu)

// 22. Standardisasi Kanvas Netral Seluruh Aside Panel (Anti-Chameleon Aside Wrappers)
const fileRightPanel = readFileSync(join(root, 'src/features/transaksi/RightPanel.jsx'), 'utf8')
const fileStatistikPanel = readFileSync(join(root, 'src/features/statistik/StatistikAsidePanel.jsx'), 'utf8')
const fileBudgetPanel = readFileSync(join(root, 'src/features/budget/BudgetAsidePanel.jsx'), 'utf8')
const fileUtangPanel = readFileSync(join(root, 'src/features/utang/UtangAsidePanel.jsx'), 'utf8')

const asidePanelSemuaNetral =
  fileRightPanel.includes('clay clay-key-neutral') &&
  fileStatistikPanel.includes('clay clay-key-neutral') &&
  fileBudgetPanel.includes('clay clay-key-neutral') &&
  fileUtangPanel.includes('clay clay-key-neutral')
cek('aside: seluruh wrapper panel samping memakai kanvas clay netral (clay-key-neutral)', asidePanelSemuaNetral)

// 23. Larangan Kartu Slab Monolitik Gelap (solid-* pada clay-card) di Seluruh Aside Panel
const bebasSolidCards =
  !fileRightPanel.includes('clay-card clay-key-primary solid-primary') &&
  !fileBudgetPanel.includes('clay-card clay-key-blue solid-blue') &&
  !fileUtangPanel.includes('clay-card clay-key-primary solid-primary') &&
  !fileStatistikPanel.includes('clay-card clay-key-danger')
cek('aside: seluruh kartu informasi aside panel bebas dari slab monolitik gelap (solid-* pada clay-card)', bebasSolidCards)

// 24. Neumorphism harus mendefinisikan :hover pada kartu, tombol netral, dan tombol solid
const neuHoverTerdefinisi =
  fileCss.includes('[data-theme="neumorphism"] .tx-card-item:hover') &&
  fileCss.includes('[data-theme="neumorphism"] .neu-card:not(.is-lunas):hover') &&
  fileCss.includes('[data-theme="neumorphism"] .clay-btn:hover:not(:disabled)') &&
  fileCss.includes('[data-theme="neumorphism"] .neu-btn-primary:hover:not(:disabled)') &&
  fileCss.includes('[data-theme="neumorphism"] .neu-btn-danger:hover:not(:disabled)')
cek('css: tema default neumorphism memiliki aturan :hover eksplisit untuk kartu & tombol', neuHoverTerdefinisi)

// 25. TransaksiRow memakai hidden saat tertutup (tanpa celah flex 12px) & .tx-action-pop pegas saat terbuka (tanpa clipping shadow)
const fileTransaksiRow = readFileSync(join(root, 'src/features/transaksi/TransaksiRow.jsx'), 'utf8')
const aksiRowZeroGap =
  fileTransaksiRow.includes("deleteOpen ? 'flex items-center gap-1.5 ml-2 shrink-0' : 'hidden'") &&
  fileTransaksiRow.includes('tx-action-pop') &&
  !fileTransaksiRow.includes('tx-actions-reveal')
cek('transaksi row: bebas celah flex 12px (hidden saat tutup) & memakai .tx-action-pop bebas clipping', aksiRowZeroGap)

// 26. Arsitektur Zero-Trap Motion di CSS (viewFadeIn tanpa transform, modal stabil, FAB speed-dial :not(.fab-dial-btn), tombol specificity rendah)
const blokViewEnter = fileCss.match(/\.view-panel-enter\s*\{[^}]*\}/)?.[0] ?? ''
const viewEnterBebasTransform = blokViewEnter.includes('viewFadeIn') && !fileCss.includes('@keyframes viewEnter')
const modalSheetBebasScaleJump = !/\.modal-backdrop-wrap\s+\.clay-sheet[^}]*animation:\s*modalCardIn/.test(fileCss)
const btnSpecificityRendah = fileCss.includes('button:hover:where(') && fileCss.includes('button:active:where(')
const fabSpeedDialIsolated =
  fileCss.includes('[data-theme="neumorphism"] .clay-fab:not(.fab-dial-btn)') &&
  fileCss.includes('.clay-fab.solid-primary:not(.fab-dial-btn)') &&
  !fileCss.includes('animate-toast-unlayered')
const stickyBebasBoxCutoff =
  !fileTransaksiView.includes('sticky-scroll-bar') &&
  !readFileSync(join(root, 'src/features/statistik/StatistikView.jsx'), 'utf8').includes('sticky-scroll-bar')
const zeroTrapCssContract =
  viewEnterBebasTransform &&
  modalSheetBebasScaleJump &&
  btnSpecificityRendah &&
  fabSpeedDialIsolated &&
  stickyBebasBoxCutoff &&
  fileCss.includes('.tx-action-pop') &&
  fileCss.includes('.scroll-reveal-pending') &&
  fileCss.includes('.scroll-reveal-run') &&
  fileCss.includes('.progress-bar-fill') &&
  fileCss.includes('clayDropdownUp')
cek('css: kontrak Zero-Trap Motion (viewFadeIn bebas transform, FAB :not(.fab-dial-btn), specificity :where, reveal self-cleaning)', zeroTrapCssContract)

// 27. Tidak ada .clay-btn atau .clay-chip yang memakai transition-colors (mematikan animasi transform/shadow)
const fileBudgetModal = readFileSync(join(root, 'src/features/budget/FormBudgetModal.jsx'), 'utf8')
const fileRekeningModal = readFileSync(join(root, 'src/features/budget/FormRekeningModal.jsx'), 'utf8')
const fileFilterModal = readFileSync(join(root, 'src/features/transaksi/FilterTransaksiModal.jsx'), 'utf8')
const filePindahModal = readFileSync(join(root, 'src/features/transaksi/ModalPindahSaldo.jsx'), 'utf8')
const fileMutasiModal = readFileSync(join(root, 'src/features/budget/RiwayatMutasiModal.jsx'), 'utf8')
const gabunganBtnFiles = [fileFormModal, fileShell, fileTransaksiView, fileBudgetModal, fileRekeningModal, fileFilterModal, filePindahModal, fileMutasiModal].join('\n')
const tanpaTransitionColorsDiBtn = !/clay-(btn|chip)[^"\n`]*transition-colors/.test(gabunganBtnFiles)
cek('jsx: tombol .clay-btn/.clay-chip bebas dari transition-colors yang memotong transisi transform/box-shadow', tanpaTransitionColorsDiBtn)

// 28. Seluruh modal fitur di-portal ke document.body agar tidak terperangkap overflow/stacking ancestor
const fileUtangModals = readFileSync(join(root, 'src/features/utang/UtangModals.jsx'), 'utf8')
const fileStatistikView = readFileSync(join(root, 'src/features/statistik/StatistikView.jsx'), 'utf8')
const fileBudgetListPanel = readFileSync(join(root, 'src/features/budget/BudgetPanel.jsx'), 'utf8')
const fileRekeningPanel = readFileSync(join(root, 'src/features/budget/RekeningPanel.jsx'), 'utf8')
const fileExportPdf = readFileSync(join(root, 'src/features/laporan/ExportPdfModal.jsx'), 'utf8')
const fileBackupModal = readFileSync(join(root, 'src/features/backup/BackupModal.jsx'), 'utf8')
const fileUserMenu = readFileSync(join(root, 'src/components/UserMenuSheet.jsx'), 'utf8')
const modalFilesToCheck = [
  ['FormTransaksiModal', fileFormModal],
  ['ModalPindahSaldo', filePindahModal],
  ['FilterTransaksiModal', fileFilterModal],
  ['TransaksiView', fileTransaksiView],
  ['FormBudgetModal', fileBudgetModal],
  ['FormRekeningModal', fileRekeningModal],
  ['RiwayatMutasiModal', fileMutasiModal],
  ['BudgetPanel', fileBudgetListPanel],
  ['RekeningPanel', fileRekeningPanel],
  ['UtangModals', fileUtangModals],
  ['UtangView', fileUtangView],
  ['StatistikView', fileStatistikView],
  ['ExportPdfModal', fileExportPdf],
  ['BackupModal', fileBackupModal],
  ['UserMenuSheet', fileUserMenu],
  ['Shell', fileShell],
]
const missingPortal = modalFilesToCheck.filter(([, txt]) => !txt.includes('portalBody(')).map(([n]) => n)
cek(`modal isolation: seluruh modal fitur memakai portalBody() ke document.body (${modalFilesToCheck.length - missingPortal.length}/${modalFilesToCheck.length})`, missingPortal.length === 0, missingPortal.length ? `tanpa portalBody: ${missingPortal.join(', ')}` : '')

// 29. Blok aturan motion komponen di index.css wajib berada di dalam @layer components (bukan unlayered setelah keyframes)
const idxScrollRevealCss = fileCss.indexOf('.scroll-reveal-pending')
const idxLayerSecondOpen = fileCss.indexOf('@layer components {', fileCss.indexOf('@keyframes modalBackdropFadeIn'))
const motionCssInsideLayer = idxScrollRevealCss > -1 && idxLayerSecondOpen > -1 && idxScrollRevealCss > idxLayerSecondOpen
cek('css: aturan kelas motion (.view-panel-enter, .tx-action-pop, .scroll-reveal-*) berada di dalam @layer components', motionCssInsideLayer)

// 30. Performa kartu list: contain: layout style (TANPA contain: paint yang memotong bayangan) & .progress-bar-fill tanpa barGrowX ulang
const blokContain = fileCss.match(/\.tx-card-item\s*\{[^}]*\}/)?.[0] ?? ''
const neuCardContain = /contain:\s*layout style;/.test(fileCss)
const bebasContainPaint = !/\.tx-card-item[^}]*contain:[^;]*paint/.test(fileCss) && !/\.neu-card[^}]*contain:[^;]*paint/.test(fileCss)
const blokProgressFill = fileCss.match(/\.progress-bar-fill\s*\{[^}]*\}/)?.[0] ?? ''
const progressBebasBarGrowUlang = !blokProgressFill.includes('barGrowX') && blokProgressFill.includes('transition: width')
cek('css perf: kartu list memiliki contain: layout style (tanpa paint) & progress-bar-fill transisi halus tanpa barGrowX ulang', blokContain.includes('contain: layout style') && neuCardContain && bebasContainPaint && progressBebasBarGrowUlang)

// 31. Performa list swipe & paginasi: TransaksiView & UtangMobile bebas dari remount key halaman/kartu dan state setDragOffset
const fileUtangMobile = readFileSync(join(root, 'src/features/utang/UtangMobile.jsx'), 'utf8')
const txTanpaRemountDanDragState =
  !fileTransaksiView.includes('key={`tx-page-') &&
  !fileTransaksiView.includes('setDragOffset')
const utangTanpaRemountDanDragState =
  !fileUtangMobile.includes('key={`utang-card-') &&
  !fileUtangMobile.includes('setDragOffset')
cek('list perf: TransaksiView & UtangMobile bebas dari remount key wrapper & setDragOffset per touchmove', txTanpaRemountDanDragState && utangTanpaRemountDanDragState)

// 32. Kalkulator nominal aman CSP (bebas eval/Function), FormTransaksiModal responsif 2-kolom web, & .tx-card-just-added di @layer components
const fileKalkulator = readFileSync(join(root, 'src/features/transaksi/kalkulatorNominal.js'), 'utf8')
const kalkulatorAmanCsp = !/\beval\s*\(/.test(fileKalkulator) && !/new\s+Function\b/.test(fileKalkulator)
const modalWebDuaKolom = fileFormModal.includes('sm:grid-cols-2') && fileFormModal.includes('sm:max-w-[540px]')
const justAddedInsideLayer = fileCss.indexOf('.tx-card-just-added') > idxLayerSecondOpen
cek('keamanan & ux transaksi: kalkulator bebas eval, modal web 2-kolom anti-scroll, dan .tx-card-just-added di @layer components', kalkulatorAmanCsp && modalWebDuaKolom && justAddedInsideLayer)

console.log(`\n${galat.length ? 'GAGAL' : 'LULUS'}: ${lulus}/${total} cek lolos`)
if (galat.length) throw new Error(`Uji designIntegrity gagal: ${galat.join(' | ')}`)
