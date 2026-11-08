import { useEffect, useRef, useState } from 'react'
import { formatNominal, formatRibuanInput, isoHariIni, parseNominal, simbolUang } from '../../lib/format.js'
import { ambilAtauBuatKategori, simpanTransaksi, tambahAkun, updateTransaksi } from '../../lib/db.js'
import { ClayCombobox, ClayDateInput, ClaySelect } from '../../components/clay-ui.jsx'
import { pesanErrorSimpan } from '../../lib/pesanError.js'
import { matikanOcr } from '../../lib/ocrStruk.js'
import {
  scanDokumenKeuangan,
  bacaOcrConfig,
  simpanOcrConfig,
  bacaGeminiKey,
  simpanGeminiKey,
  hapusGeminiKey,
  ujiKoneksiGemini,
} from '../../lib/ocrProvider.js'

// Modal Catat / Edit / Salin transaksi — mendukung Pemasukan & Pengeluaran
// dengan Segmented Clay Toggle interaktif, penyesuaian label rekening dinamis,
// dan pemindaian struk otomatis (OCR) pada pengeluaran.
export default function FormTransaksiModal({ uid, open, onClose, onSalin, onAkunBaru, akunList, kategoriList, mode, doc: sumber }) {
  const [jenis, setJenis] = useState(() => {
    if ((mode === 'edit' || mode === 'salin') && sumber) {
      return sumber.jenis ?? 'pengeluaran'
    }
    return sumber?.preset === 'pemasukan' ? 'pemasukan' : 'pengeluaran'
  })
  const [jumlah, setJumlah] = useState('')
  const [kategoriNama, setKategoriNama] = useState('')
  const [akunId, setAkunId] = useState('')
  const [tanggal, setTanggal] = useState(isoHariIni())
  const [catatan, setCatatan] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileUploadRef = useRef(null)
  const fileCameraRef = useRef(null)

  // ===== Status OCR Scan Struk =====
  const [scan, setScan] = useState(null) // { nama, url } pratinjau gambar
  const [scanProses, setScanProses] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)
  const [scanHasil, setScanHasil] = useState(null) // hasil bacaStruk()
  const [scanPesan, setScanPesan] = useState('') // info/kesalahan OCR
  const [ocrEnginePref, setOcrEnginePref] = useState(() => bacaOcrConfig().engine)
  const [showOcrConfig, setShowOcrConfig] = useState(false)
  const [geminiKeyInput, setGeminiKeyInput] = useState(() => bacaGeminiKey())
  const [geminiStatus, setGeminiStatus] = useState('')
  const [geminiTesting, setGeminiTesting] = useState(false)
  const [showTutorialModal, setShowTutorialModal] = useState(false)
  // Sumber pembayaran yang terdeteksi dari struk tapi BELUM ada di akunList
  // (mis. user punya struk SeaBank tapi belum menambah rekening SeaBank).
  // null = tidak ada saran. Object = { nama, jenis } siap ditawarkan ke user.
  const [sumberSaran, setSumberSaran] = useState(null)
  const [sumberBaru, setSumberBaru] = useState('') // input nama rekening baru
  const [sumberMenyimpan, setSumberMenyimpan] = useState(false)
  const [tambahAkunBusy, setTambahAkunBusy] = useState(false)
  const masihTerpasang = useRef(true)

  useEffect(() => {
    masihTerpasang.current = true
    return () => {
      masihTerpasang.current = false
      // Worker Tesseract memakan memori; lepas saat modal dilepas.
      matikanOcr()
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setError('')
    setSaving(false)
    // Bersihkan sisa hasil scan dari sesi sebelumnya
    setScan(null)
    setScanHasil(null)
    setScanPesan('')
    setScanProses(false)
    setScanProgress(0)
    if ((mode === 'edit' || mode === 'salin') && sumber) {
      setJenis(sumber.jenis ?? 'pengeluaran')
      setJumlah(formatRibuanInput(String(sumber.jumlah ?? '')))
      setKategoriNama(sumber.kategoriNama ?? '')
      setAkunId(sumber.akunId ?? akunList[0]?.id ?? '')
      setTanggal(mode === 'salin' ? isoHariIni() : (sumber.tanggal ?? isoHariIni()))
      setCatatan(sumber.catatan ?? '')
    } else {
      // Preset dari pemicu (Aksi Cepat / speed-dial) atau default pengeluaran
      setJenis(sumber?.preset === 'pemasukan' ? 'pemasukan' : 'pengeluaran')
      setJumlah('')
      setKategoriNama('')
      setAkunId(akunList[0]?.id ?? '')
      setTanggal(isoHariIni())
      setCatatan('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, sumber?.id, sumber?.preset])

  // Sinkronisasi defensif akunId jika akunList baru selesai termuat setelah modal terbuka
  useEffect(() => {
    if (open && !akunId && akunList.length > 0) {
      setAkunId(akunList[0].id)
    }
  }, [open, akunId, akunList])

  if (!open) return null

  // ===== Handler OCR Scan Struk =====
  // Simpan rekening baru hasil deteksi struk, lalu PAKAI langsung sebagai
  // akun transaksi. Sengaja tidak diam-diam menebak: user menekan tombol dulu.
  async function tambahSumberBaru(saran, nama) {
    const bersih = nama.trim()
    if (!bersih || tambahAkunBusy) return
    setTambahAkunBusy(true)
    setError('')
    try {
      const tipe = saran?.tipe || 'Dompet Digital'
      const id = await tambahAkun(uid, { nama: bersih, tipe, saldoAwal: 0 })
      setAkunId(id)
      onAkunBaru?.({ id, nama: bersih, tipe, saldo: 0 })
      setSumberMenyimpan(false)
      setSumberSaran(null)
      setSumberBaru('')
    } catch (e) {
      setError(pesanErrorSimpan('Menambah rekening', e))
    } finally {
      setTambahAkunBusy(false)
    }
  }

  async function simpanDanUjiGeminiKey() {
    const key = geminiKeyInput.trim()
    if (!key) {
      hapusGeminiKey()
      setGeminiStatus('Kunci API dikosongkan. Sistem akan menggunakan engine lokal.')
      return
    }
    setGeminiTesting(true)
    setGeminiStatus('Memverifikasi kunci dengan Google AI Studio...')
    try {
      const res = await ujiKoneksiGemini(key)
      if (res.ok) {
        simpanGeminiKey(key)
        setGeminiStatus('Kunci API valid & aktif! Gemini Vision siap digunakan.')
      } else {
        setGeminiStatus(res.message || 'Kunci API tidak valid. Periksa kembali.')
      }
    } catch (err) {
      setGeminiStatus('Gagal menghubungi Google: ' + err.message)
    } finally {
      setGeminiTesting(false)
    }
  }

  function hapusKey() {
    hapusGeminiKey()
    setGeminiKeyInput('')
    setGeminiStatus('Kunci API berhasil dihapus.')
  }

  async function prosesStruk(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // izinkan pilih file yang sama dua kali
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setScanPesan('File harus berupa gambar (JPG/PNG/WebP).')
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      setScanPesan('Gambar terlalu besar (maks 15 MB).')
      return
    }

    setScanPesan('')
    setScanHasil(null)
    setSumberSaran(null)
    setSumberBaru('')
    setSumberMenyimpan(false)
    setScanProses(true)
    setScanProgress(0)
    setScan({ nama: file.name, url: URL.createObjectURL(file) })

    try {
      const hasil = await scanDokumenKeuangan(file, {
        engine: ocrEnginePref,
        geminiApiKey: geminiKeyInput,
        onProgress: (p) => {
          if (masihTerpasang.current) setScanProgress(Math.round(p * 100))
        },
      })
      if (!masihTerpasang.current) return
      setScanHasil(hasil)

      // Isi otomatis: hanya timpa field yang belum diisi user (jangan ganggu
      // ketikan manual), kecuali nominal & tanggal yang memang target scan.
      if (hasil.total && hasil.total > 0) setJumlah(formatRibuanInput(String(hasil.total)))
      if (hasil.tanggal) setTanggal(hasil.tanggal)
      if (hasil.jenis) setJenis(hasil.jenis)

      // Keterangan = NAMA BARANG yang dibeli, bukan nama merchant. Merchant
      // dipindah ke kolom Sumber/Akun (dan dicadangkan di catatan hanya kalau
      // tidak ada barang yang terbaca, supaya kolom tidak pernah kosong).
      if (hasil.keterangan) setCatatan((c) => c || hasil.keterangan)
      else if (hasil.merchant) setCatatan((c) => c || hasil.merchant)

      // Kategori: pakai hasil pemetaan isi struk. Falls back ke Lainnya kalau
      // tak ada keyword yang cocok, jadi kolom kategori TIDAK PERNAH kosong
      // dan user tinggal menyetujui/koreksi lewat combobox.
      if (hasil.kategoriNama) setKategoriNama(hasil.kategoriNama)

      // Sumber/Akun: kalau struk menyebut dompet/bank pembayar, pakai rekening
      // yang SUDAH ADA. Kalau belum ada rekening dengan nama itu, tawarkan ke
      // user untuk menambah (bukan diam-diam menebak).
      setSumberSaran(null)
      if (hasil.sumberBayar?.nama) {
        const cocok = (akunList || []).find((a) => (a?.nama ?? "").toLowerCase().includes(String(hasil.sumberBayar?.nama ?? "").toLowerCase()))
        if (cocok) {
          setAkunId(cocok.id)
        } else {
          setSumberSaran(hasil.sumberBayar)
          setSumberBaru(hasil.sumberBayar.nama)
        }
      }

      const bagian = []
      if (hasil.total && hasil.total > 0) bagian.push(`Total ${formatRibuanInput(String(hasil.total))}.`)
      if (hasil.kategoriNama) bagian.push(`Kategori disarankan: ${hasil.kategoriNama}.`)
      if (hasil.keterangan) bagian.push(`Keterangan: ${hasil.keterangan}.`)
      if (hasil.sumberBayar?.nama && !(akunList || []).some((a) => (a?.nama ?? "").toLowerCase().includes(String(hasil.sumberBayar.nama).toLowerCase())))
        bagian.push(`Rekening ${hasil.sumberBayar.nama} belum ada — bisa ditambah di bawah.`)
      if (hasil.bayarTunai) bagian.push('Dibayar tunai, jadi tidak perlu pilih rekening? Tetap pilih rekening yang dipakai Receive.')

      if (!hasil.total || hasil.total <= 0) {
        if (hasil.fotoBuram) {
          setScanPesan('Foto struk terlihat buram atau gelap sehingga teks tidak tertangkap. Silakan foto ulang dengan pencahayaan lebih terang dan posisi tegak lurus.')
        } else {
          setScanPesan('Teks struk terbaca, tetapi baris total pembayaran tidak teridentifikasi. Silakan masukkan nominal secara manual di bawah (teks struk telah dicatat).')
        }
      } else if ((hasil.confidence ?? 0) < 55) {
        setScanPesan(`${bagian.join(' ')} Catatan: Keyakinan pembacaan sedang — silakan periksa nominal sebelum disimpan.`)
      } else if (bagian.length) {
        setScanPesan(bagian.join(' '))
      }
    } catch (err) {
      console.warn('[scan-struk] gagal:', err?.message ?? err)
      if (masihTerpasang.current) setScanPesan('Gagal membaca struk. Coba foto yang lebih terang & tegak, atau isi manual.')
    } finally {
      if (masihTerpasang.current) setScanProses(false)
    }
  }

  function terapkanUlang() {
    if (!scanHasil) return
    if (scanHasil.total) setJumlah(formatRibuanInput(String(scanHasil.total)))
    if (scanHasil.tanggal) setTanggal(scanHasil.tanggal)
    if (scanHasil.jenis) setJenis(scanHasil.jenis)
    if (scanHasil.merchant) setCatatan((c) => c || scanHasil.merchant)
  }

  function tutupModal() {
    if (scan?.url) URL.revokeObjectURL(scan.url)
    onClose()
  }

  async function submit(e) {
    e.preventDefault()
    const n = parseNominal(jumlah)
    if (n <= 0) return setError('Nominal harus lebih dari nol.')
    if (!akunId) return setError(jenis === 'pemasukan' ? 'Pilih rekening tujuan penerima dulu.' : 'Pilih rekening sumber dulu.')
    if (!kategoriNama.trim()) return setError('Isi kategori dulu.')

    // Snapshot data SEBELUM tutup modal — state komponen boleh berubah setelahnya.
    const jenisSnap = jenis
    const tanggalSnap = tanggal
    const catatanSnap = catatan.trim()
    const akunIdSnap = akunId
    const namaKatSnap = kategoriNama.trim()
    const modeSnap = mode
    const sumberSnap = sumber

    const akun = akunList.find((a) => a.id === akunIdSnap)
    if (jenisSnap === 'pengeluaran' && akun) {
      const saldoSaatIni = Number(akun.saldo) || 0
      const saldoSetelah = modeSnap === 'edit' && sumberSnap?.akunId === akunIdSnap
        ? saldoSaatIni + (Number(sumberSnap.jumlah) || 0) - n
        : saldoSaatIni - n

      if (saldoSetelah < 0) {
        window.dispatchEvent(
          new CustomEvent('myduit:toast', {
            detail: {
              type: 'warning',
              msg: `Perhatian: Saldo ${akun.nama} tidak boleh minus! Sisa saldo saat ini ${formatNominal(saldoSaatIni)}. Periksa kembali debit & kredit rekening Anda.`,
            },
          })
        )
      }
    }

    // OPTIMISTIC: tutup modal SEKARANG, commit ke Firestore di background.
    // Promise tulis Firestore baru resolve setelah server ack — kalau ditunggu,
    // modal menggantung "Menyimpan…" saat jaringan lambat/offline (padahal data
    // sudah masuk cache lokal & UI list langsung ter-update via onSnapshot).
    setError('')
    setSaving(false)
    onClose()

    ;(async () => {
      try {
        // Boundary: kategori bebas-ketik WAJIB jadi dokumen kategori resmi.
        const targetKat = String(namaKatSnap ?? '').trim().toLowerCase()
        const kat =
          (kategoriList || []).find((k) => String(k?.nama ?? '').trim().toLowerCase() === targetKat && k?.jenis === jenisSnap) ??
          (kategoriList || []).find((k) => String(k?.nama ?? '').trim().toLowerCase() === targetKat)
        let kategoriId = kat?.id ?? ''
        if (!kategoriId) kategoriId = await ambilAtauBuatKategori(uid, namaKatSnap, jenisSnap)
        const data = {
          jumlah: n,
          jenis: jenisSnap,
          kategoriId,
          kategoriNama: namaKatSnap,
          akunId: akunIdSnap,
          akunNama: akun?.nama ?? '',
          tanggal: tanggalSnap,
          catatan: catatanSnap,
        }
        if (modeSnap === 'edit' && sumberSnap) await updateTransaksi(uid, sumberSnap, data)
        else await simpanTransaksi(uid, data)
      } catch (e2) {
        console.warn('[transaksi-simpan] gagal:', e2?.message ?? e2)
        window.dispatchEvent(new CustomEvent('myduit:toast', { detail: { type: 'error', msg: pesanErrorSimpan('Menyimpan transaksi', e2) } }))
      }
    })()
  }

  const isPemasukan = jenis === 'pemasukan'
  const judul = mode === 'edit'
    ? (isPemasukan ? 'Edit Pemasukan' : 'Edit Pengeluaran')
    : mode === 'salin'
      ? (isPemasukan ? 'Salin Pemasukan' : 'Salin Pengeluaran')
      : (isPemasukan ? 'Catat Pemasukan' : 'Catat Pengeluaran')

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm modal-backdrop-wrap" onClick={tutupModal}>
      <div className={`clay-sheet ${isPemasukan ? 'clay-key-primary' : 'clay-key-danger'} flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden`} onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-4 pb-2 pt-4">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-800 sm:text-base">
            <span className={`material-symbols-outlined icon-lg shrink-0 ${isPemasukan ? 'text-primary' : 'text-danger'}`}>
              {isPemasukan ? 'trending_up' : 'trending_down'}
            </span>
            <span className="truncate">{judul}</span>
          </h3>
          <div className="flex shrink-0 items-center gap-1.5">
            {mode === 'edit' && (
              <button
                type="button"
                onClick={() => onSalin?.(sumber)}
                title="Salin transaksi"
                className="clay-chip clay-key-primary solid-primary inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-primary transition-colors "
              >
                <span className="material-symbols-outlined icon-sm">content_copy</span>
              </button>
            )}
            <button
              type="button"
              onClick={tutupModal}
              aria-label="Tutup"
              className="clay-chip clay-key-neutral flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <span className="material-symbols-outlined icon-lg">close</span>
            </button>
          </div>
        </div>

        {/* Segmented Clay Toggle: Pengeluaran vs Pemasukan (Bespoke tactile track) */}
        <div className="px-4 pt-2.5 pb-1">
          <div className="clay-segmented-track">
            <button
              type="button"
              onClick={() => {
                setJenis('pengeluaran')
                setError('')
              }}
              aria-pressed={!isPemasukan}
              className={`clay-segment-item ${!isPemasukan ? 'is-active is-expense !text-white' : ''}`}
            >
              <span className="material-symbols-outlined icon-sm">trending_down</span>
              Pengeluaran
            </button>
            <button
              type="button"
              onClick={() => {
                setJenis('pemasukan')
                setError('')
              }}
              aria-pressed={isPemasukan}
              className={`clay-segment-item ${isPemasukan ? 'is-active is-income !text-white' : ''}`}
            >
              <span className="material-symbols-outlined icon-sm">trending_up</span>
              Pemasukan
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="min-h-0 space-y-2.5 overflow-y-auto px-4 py-2">
          {/* Hero Input Nominal (Paling Atas: Tak Tertutup Keyboard Virtual Mobile, Teks Kontras Tinggi) */}
          <div className="flex flex-col gap-1">
            <label htmlFor="tx-jumlah" className="block text-[11px] font-bold tracking-wide uppercase text-textSecondary">
              Nominal Transaksi ({simbolUang()})
            </label>
            <div className="relative flex items-center">
              <span className={`pointer-events-none absolute left-3.5 text-base font-extrabold font-mono transition-colors ${
                isPemasukan ? 'text-[#36AE7C]' : 'text-[#EB5353]'
              }`}>
                {simbolUang()}
              </span>
              <input
                id="tx-jumlah"
                type="text"
                value={jumlah}
                onChange={(e) => setJumlah(formatRibuanInput(e.target.value))}
                inputMode="numeric"
                placeholder="0"
                required
                autoFocus
                className={`clay-input field-lg w-full rounded-2xl pl-11 pr-4 text-xl font-black font-mono tracking-tight transition-colors ${
                  isPemasukan ? 'tx-nominal-income !text-[#36AE7C]' : 'tx-nominal-expense !text-[#EB5353]'
                }`}
              />
            </div>
          </div>
          {/* Scan Struk / Foto — HANYA mode tambah pengeluaran (GAS menyembunyikannya saat edit / pemasukan).
              OCR berjalan 100% di browser: total, tanggal, jenis, dan merchant terisi otomatis. */}
          {mode === 'add' && !isPemasukan && (
            <div className="neu-inset flex flex-col gap-2 rounded-2xl p-3 bg-[#E5E5E5]">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined icon-sm text-[#EB5353]">document_scanner</span>
                <label className="text-[11px] font-semibold text-textSecondary">Scan Struk / Foto Transaksi</label>
                {scanHasil?.engine === 'gemini-flash' ? (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    <span className="material-symbols-outlined icon-2xs">smart_toy</span>
                    Gemini Flash AI (99%)
                  </span>
                ) : scanHasil?.engine === 'pp-ocrv4' ? (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">
                    <span className="material-symbols-outlined icon-2xs">psychology</span>
                    PP-OCRv4 AI
                  </span>
                ) : scanHasil?.engine === 'unlimited-ocr' ? (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    <span className="material-symbols-outlined icon-2xs">smart_toy</span>
                    Unlimited-OCR AI
                  </span>
                ) : scanHasil?.confidence > 0 ? (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary-light px-2 py-0.5 text-[10px] font-bold text-primary">
                    <span className="material-symbols-outlined icon-2xs">bolt</span>
                    Lokal ({Math.round(scanHasil.confidence)}%)
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setShowOcrConfig((s) => !s)}
                  title="Pengaturan Engine OCR"
                  aria-label="Pengaturan Engine OCR"
                  className={`neu-btn flex h-7 w-7 items-center justify-center rounded-full bg-[#E5E5E5] transition-all active:scale-95 ${
                    showOcrConfig ? 'text-[#36AE7C]' : 'text-slate-500 hover:text-slate-800'
                  } ${!scanHasil ? 'ml-auto' : ''}`}
                >
                  <span className="material-symbols-outlined icon-xs">tune</span>
                </button>
              </div>

              {/* Panel Pengaturan Engine OCR */}
              {showOcrConfig && (
                <div className="accordion-slide-down neu-card flex flex-col gap-2.5 rounded-2xl bg-[#E5E5E5] p-3.5 text-[11px] text-slate-700 border border-white/60">
                  <div className="flex items-center justify-between font-bold text-slate-800">
                    <span>Pilihan Engine OCR:</span>
                    <span className="text-[10px] text-slate-500 font-medium">
                      {ocrEnginePref === 'auto'
                        ? (geminiKeyInput ? 'Auto (Gemini AI Prioritas)' : 'Auto (On-Device Cerdas)')
                        : ocrEnginePref === 'gemini'
                          ? 'Google Gemini Vision (Cloud)'
                          : ocrEnginePref === 'ppocr'
                            ? 'PP-OCRv4 Mobile (On-Device)'
                            : 'Tesseract (Lokal Offline)'}
                    </span>
                  </div>
                  <div className="neu-inset grid grid-cols-4 gap-1 p-1 rounded-xl bg-[#E5E5E5]">
                    {[
                      { id: 'auto', label: 'Auto Cerdas' },
                      { id: 'gemini', label: 'Gemini AI' },
                      { id: 'ppocr', label: 'PP-OCR' },
                      { id: 'local', label: 'Tesseract' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setOcrEnginePref(opt.id)
                          simpanOcrConfig({ engine: opt.id })
                        }}
                        className={`rounded-lg py-1.5 text-center text-[10.5px] font-bold transition-all ${
                          ocrEnginePref === opt.id
                            ? 'neu-btn bg-[#E5E5E5] text-[#36AE7C] shadow-sm font-extrabold'
                            : 'text-slate-600 hover:text-slate-900 bg-transparent'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* Kunci API Gemini Section */}
                  <div className="border-t border-black/5 pt-2 mt-0.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800">Kunci API Gemini (Akurasi &gt;99%):</span>
                      <button
                        type="button"
                        onClick={() => setShowTutorialModal(true)}
                        className="inline-flex items-center gap-1 text-[#36AE7C] hover:underline font-bold text-[10px]"
                      >
                        <span className="material-symbols-outlined icon-2xs">help</span>
                        Panduan Kunci Gratis
                      </button>
                    </div>
                    <div className="mt-1.5 flex gap-2">
                      <input
                        type="password"
                        placeholder="Tempel API Key AI Studio..."
                        value={geminiKeyInput}
                        onChange={(e) => setGeminiKeyInput(e.target.value)}
                        className="neu-inset flex-1 rounded-xl bg-[#E5E5E5] px-3 py-1.5 text-[11px] font-semibold text-slate-800 placeholder:text-slate-400 outline-none"
                      />
                      <button
                        type="button"
                        onClick={simpanDanUjiGeminiKey}
                        disabled={geminiTesting}
                        className="neu-btn px-3 py-1.5 rounded-xl bg-[#E5E5E5] text-[#36AE7C] font-extrabold text-[11px] transition-all hover:text-emerald-700 active:scale-95 disabled:opacity-50"
                      >
                        {geminiTesting ? '...' : 'Simpan'}
                      </button>
                      {geminiKeyInput && (
                        <button
                          type="button"
                          onClick={hapusKey}
                          className="neu-btn px-3 py-1.5 rounded-xl bg-[#E5E5E5] text-[#EB5353] font-extrabold text-[11px] active:scale-95"
                        >
                          Hapus
                        </button>
                      )}
                    </div>
                    {geminiStatus && (
                      <p className={`mt-1 text-[9.5px] font-medium ${geminiStatus.includes('valid') ? 'text-emerald-700' : 'text-slate-600'}`}>
                        {geminiStatus}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {!scanProses && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => fileUploadRef.current?.click()}
                    className="clay-btn-secondary clay-btn btn-sm flex-1 bg-surface text-textSecondary transition-colors hover:bg-gray-100"
                  >
                    <span className="material-symbols-outlined icon-md">upload_file</span>
                    Upload Struk
                  </button>
                  <button
                    type="button"
                    onClick={() => fileCameraRef.current?.click()}
                    className="clay-btn-secondary clay-btn btn-sm flex-1 bg-surface text-textSecondary transition-colors hover:bg-gray-100"
                  >
                    <span className="material-symbols-outlined icon-md">photo_camera</span>
                    Foto Struk
                  </button>
                </div>
              )}

              {/* Pratinjau + progress OCR */}
              {scan && (
                <div className="flex items-center gap-2.5 rounded-lg bg-surface p-2">
                  <img
                    src={scan.url}
                    alt="Pratinjau struk"
                    className="h-14 w-14 shrink-0 rounded-md object-cover ring-1 ring-slate-200"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium text-slate-600">{scan.nama}</p>
                    {scanProses ? (
                      <>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${scanProgress}%` }} />
                        </div>
                        <p className="mt-0.5 text-[10px] text-textSecondary">Membaca struk… {scanProgress}%</p>
                      </>
                    ) : (
                      <p className="mt-0.5 text-[10px] text-incomeText">Selesai diproses</p>
                    )}
                  </div>
                </div>
              )}

              {/* Hasil baca: chip ringkas + tombol terapkan ulang */}
              {scanHasil && !scanProses && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {scanHasil.total ? (
                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      Nominal: {formatRibuanInput(String(scanHasil.total))}
                    </span>
                  ) : null}
                  {scanHasil.tanggal && (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{scanHasil.tanggal}</span>
                  )}
                  {scanHasil.merchant && (
                    <span className="max-w-[10rem] truncate rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                      {scanHasil.merchant}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={terapkanUlang}
                    className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary-light"
                  >
                    <span className="material-symbols-outlined icon-xs">refresh</span>
                    Terapkan ulang
                  </button>
                </div>
              )}

              {scanPesan && (
                <p className="rounded-md bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700">{scanPesan}</p>
              )}

              <input type="file" accept="image/*" ref={fileUploadRef} style={{ display: 'none' }} onChange={prosesStruk} />
              {/* Di Android Chrome, input capture="environment" sering memicu 'Unable to complete previous operation due to low memory'
                  karena kamera native 50MP/108MP menguras RAM sistem saat browser berada di background. Menghilangkan atribut capture
                  memberikan pengguna opsi memilih kamera langsung ATAU galeri file tanpa crash OOM. */}
              <input type="file" accept="image/*" ref={fileCameraRef} style={{ display: 'none' }} onChange={prosesStruk} />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="tx-tanggal" className="block text-[11px] font-semibold text-textSecondary">Tanggal</label>
            <ClayDateInput id="tx-tanggal" value={tanggal} onChange={setTanggal} />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="tx-akun" className="block text-[11px] font-semibold text-textSecondary">
              {isPemasukan ? 'Rekening Tujuan / Penerima' : 'Sumber / Rekening'}
            </label>
            <ClaySelect
              id="tx-akun"
              value={akunId}
              onChange={setAkunId}
              placeholder="Pilih Sumber/Akun"
              options={akunList.map((a) => ({ value: a.id, label: a.nama }))}
            />

            {/* Strok terdeteksi provider pembayaran (GoPay/SeaBank/SPayLater/...)
                yang BELUM ada di daftar rekening user. Bukan menebak diam-diam:
                user dikonfirmasi dulu, dan rekening baru benar-benar tersimpan
                ke Firestore sebelum dipakai sebagai akun transaksi. */}
            {sumberSaran && !sumberMenyimpan && (
              <div className="clay-key-info mt-1 rounded-2xl p-3">
                <div className="flex items-start gap-2">
                  <span
                    className="material-symbols-outlined icon-sm shrink-0 text-info"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    account_balance
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold text-slate-700">
                      Struk dibayar via {sumberSaran.nama}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                      Rekening ini belum ada di daftarmu. Tambahkan dulu supaya transaksi
                      tercatat di sumber yang benar.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setSumberMenyimpan(true)}
                        className="clay-chip-primary inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[11px] font-bold"
                      >
                        <span className="material-symbols-outlined icon-2xs">add</span>
                        Tambah {sumberSaran.nama}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSumberSaran(null)
                          setSumberBaru('')
                        }}
                        className="clay-chip clay-key-neutral inline-flex min-h-11 items-center rounded-full px-3.5 text-[11px] font-semibold text-slate-600"
                      >
                        Nanti saja
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {sumberMenyimpan && (
              <div className="mt-1 flex flex-col gap-2">
                <label
                  htmlFor="tx-sumber-baru"
                  className="block text-[11px] font-semibold text-slate-600"
                >
                  Nama rekening baru
                </label>
                <input
                  id="tx-sumber-baru"
                  type="text"
                  value={sumberBaru}
                  onChange={(e) => setSumberBaru(e.target.value)}
                  placeholder="mis. GoPay"
                  className="clay-input min-h-11 w-full rounded-2xl px-3 text-sm text-slate-800"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!sumberBaru.trim() || tambahAkunBusy}
                    onClick={() => tambahSumberBaru(sumberSaran, sumberBaru)}
                    className="clay-chip-primary inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[11px] font-bold disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined icon-2xs">save</span>
                    {tambahAkunBusy ? 'Menyimpan...' : 'Simpan & pakai'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSumberMenyimpan(false)
                      setSumberSaran(null)
                    }}
                    className="clay-chip clay-key-neutral inline-flex min-h-11 items-center rounded-full px-3.5 text-[11px] font-semibold text-slate-600"
                  >
                    Batal
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="tx-kategori" className="block text-[11px] font-semibold text-textSecondary">Kategori</label>
            <ClayCombobox
              id="tx-kategori"
              value={kategoriNama}
              onChange={setKategoriNama}
              placeholder="Pilih atau ketik kategori..."
              required
              // Filter kategori berdasarkan JENIS transaksi (pengeluaran → hanya
              // kategori jenis pengeluaran; pemasukan → hanya pemasukan). Untuk
              // mode edit/salin, jika kategori sumber tidak masuk filter (mis.
              // data legacy jenis berbeda), tetap sertakan agar tidak hilang opsi.
              options={(() => {
                const sesuaiJenis = (kategoriList || []).filter((k) => k && k.jenis === jenis && k.nama)
                if ((mode === 'edit' || mode === 'salin') && sumber?.kategoriId) {
                  const ada = sesuaiJenis.some((k) => k.id === sumber.kategoriId)
                  if (!ada) {
                    const sumberKat = (kategoriList || []).find((k) => k?.id === sumber.kategoriId)
                    if (sumberKat?.nama) return [{ value: sumberKat.id, label: sumberKat.nama + ' (lama)' }, ...sesuaiJenis]
                  }
                }
                return sesuaiJenis
              })().map((k) => ({ value: k.id, label: String(k?.nama ?? '') }))}
            />
          </div>

          {akunList.length === 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 px-2.5 py-2 text-[11px] text-red-600">
              <span className="material-symbols-outlined icon-xs mt-px shrink-0">error</span>
              <span>Belum ada rekening. Tambahkan rekening dulu sebagai sumber akun.</span>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor="tx-catatan" className="block text-[11px] font-semibold text-textSecondary">Keterangan</label>
            <input
              id="tx-catatan"
              type="text"
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="Keterangan opsional"
              className="clay-input field-lg w-full text-sm"
            />
          </div>

          {error && (
            <p role="alert" aria-live="assertive" className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className={`clay-btn ${isPemasukan ? 'clay-key-primary solid-primary' : 'clay-key-danger solid-danger'} btn-lg w-full text-white transition-colors disabled:opacity-60`}
          >
            <span className="material-symbols-outlined icon-md">save</span>
            {saving ? 'Menyimpan…' : mode === 'edit' ? 'Simpan Perubahan' : isPemasukan ? 'Simpan Pemasukan' : 'Simpan Pengeluaran'}
          </button>
        </form>
      </div>

      {/* Modal Panduan Ambil Kunci Gemini Gratis */}
      {showTutorialModal && (
        <div
          className="fixed inset-0 z-[10001] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
          onClick={() => setShowTutorialModal(false)}
        >
          <div
            className="clay-sheet clay-key-neutral flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <span className="material-symbols-outlined icon-sm text-primary">key</span>
                Cara Ambil Kunci Gemini Gratis
              </h4>
              <button
                type="button"
                onClick={() => setShowTutorialModal(false)}
                className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <span className="material-symbols-outlined icon-sm">close</span>
              </button>
            </div>

            <div className="space-y-2.5 overflow-y-auto py-3 text-[11px] leading-relaxed text-slate-600">
              <div className="rounded-xl bg-emerald-50 p-2.5 border border-emerald-100 text-emerald-800 text-[10.5px]">
                <p className="font-bold flex items-center gap-1">
                  <span className="material-symbols-outlined icon-xs">check_circle</span>
                  100% Gratis Selamanya
                </p>
                <p className="mt-0.5 text-emerald-700">
                  Disediakan gratis resmi oleh Google (kuota 1.500 struk per hari). Tidak perlu kartu kredit atau pembayaran.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    1
                  </span>
                  <div>
                    <p className="font-semibold text-slate-800">Buka Google AI Studio</p>
                    <p className="text-[10px] text-slate-500">Kunjungi halaman pembuatan kunci resmi Google:</p>
                    <a
                      href="https://aistudio.google.com/apikey"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[10.5px] font-bold text-primary hover:bg-primary/20"
                    >
                      <span className="material-symbols-outlined icon-xs">open_in_new</span>
                      Buka aistudio.google.com/apikey
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    2
                  </span>
                  <div>
                    <p className="font-semibold text-slate-800">Masuk dengan Akun Google</p>
                    <p className="text-[10px] text-slate-500">Login menggunakan akun Gmail / Google Anda seperti biasa.</p>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    3
                  </span>
                  <div>
                    <p className="font-semibold text-slate-800">Klik "Create API Key"</p>
                    <p className="text-[10px] text-slate-500">
                      Klik tombol biru <strong>"Create API key"</strong>, pilih proyek sembarang, lalu klik <strong>Copy</strong> untuk menyalin kuncinya.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    4
                  </span>
                  <div>
                    <p className="font-semibold text-slate-800">Tempel di MyDuit</p>
                    <p className="text-[10px] text-slate-500">
                      Kembali ke aplikasi ini, tempelkan kunci di kotak Kunci API, lalu tekan <strong>Simpan</strong>.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-2">
              <button
                type="button"
                onClick={() => setShowTutorialModal(false)}
                className="w-full rounded-xl bg-primary py-2 text-center text-xs font-bold text-white hover:bg-primary-hover shadow-sm"
              >
                Saya Mengerti, Tutup Panduan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
