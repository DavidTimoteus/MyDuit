import { useEffect, useRef, useState } from 'react'
import { formatInputTampil, formatNominal, isoHariIni, konversiKeBasis, parseInputTampil, sanitizeKetikNominal, simbolUang, uangAktif } from '../../lib/format.js'
import { bacaBasisMataUang, buatSnapshotKurs, desimalMataUang, konversiNilai } from '../../lib/kurs.js'
import { ambilAtauBuatKategori, buatTransaksiId, simpanTransaksi, tambahAkun, updateTransaksi } from '../../lib/db.js'
import { ClayCombobox, ClayDateInput, ClaySelect } from '../../components/clay-ui.jsx'
import InfoLensaKurs from '../../components/InfoLensaKurs.jsx'
import { portalBody } from '../../lib/portal.js'
import { pesanErrorSimpan } from '../../lib/pesanError.js'
import { matikanOcr } from '../../lib/ocrStruk.js'
import { evaluasiEkspresiNominal, formatEkspresiPreview, sisipTokenKalkulator } from './kalkulatorNominal.js'
import {
  scanDokumenKeuangan,
  bacaOcrConfig,
  simpanOcrConfig,
  bacaGeminiKey,
  simpanGeminiKey,
  hapusGeminiKey,
  ujiKoneksiGemini,
  cekStatusPuterOcr,
  sambungkanPuterOcr,
  muatPuterSdk,
} from '../../lib/ocrProvider.js'

function bulatkanUntukTampil(nilai) {
  const { currency } = uangAktif()
  const d = desimalMataUang(currency)
  const f = d > 0 ? 10 ** d : 1
  return Math.round((Number(nilai) || 0) * f) / f
}

function formatHasilOcrTampil(totalIdr) {
  const { currency, locale } = uangAktif()
  const d = desimalMataUang(currency)
  const val = konversiNilai(totalIdr, 'IDR', currency)
  const f = d > 0 ? 10 ** d : 1
  const dibulat = Math.round(val * f) / f
  return dibulat > 0 ? dibulat.toLocaleString(locale, { maximumFractionDigits: d }) : ''
}

// Modal Catat / Edit / Salin transaksi — mendukung Pemasukan & Pengeluaran
// dengan Segmented Clay Toggle interaktif, penyesuaian label rekening dinamis,
// dan pemindaian struk otomatis (OCR) pada pengeluaran.
export default function FormTransaksiModal({ uid, open, onClose, onSalin, onAkunBaru, akunList, kategoriList, mode, doc: sumber }) {
  const isEditAtauSalin = (mode === 'edit' || mode === 'salin') && Boolean(sumber)
  const [jenis, setJenis] = useState(() =>
    isEditAtauSalin ? (sumber.jenis ?? 'pengeluaran') : (sumber?.preset === 'pemasukan' ? 'pemasukan' : 'pengeluaran')
  )
  const [jumlah, setJumlah] = useState(() =>
    isEditAtauSalin
      ? formatInputTampil(sumber.jumlah, mode === 'edit' ? { kursSnapshot: sumber.kursSnapshot } : undefined)
      : ''
  )
  const [kategoriNama, setKategoriNama] = useState(() =>
    isEditAtauSalin ? (sumber.kategoriNama ?? '') : ''
  )
  const [akunId, setAkunId] = useState(() =>
    isEditAtauSalin ? (sumber.akunId ?? akunList?.[0]?.id ?? '') : (akunList?.[0]?.id ?? '')
  )
  const [tanggal, setTanggal] = useState(() =>
    isEditAtauSalin ? (sumber.tanggal ?? isoHariIni()) : isoHariIni()
  )
  const [catatan, setCatatan] = useState(() =>
    isEditAtauSalin ? (sumber.catatan ?? '') : ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [calcOpen, setCalcOpen] = useState(false)
  const [calcExpr, setCalcExpr] = useState('')
  const [calcErr, setCalcErr] = useState('')
  const fileUploadRef = useRef(null)
  const fileCameraRef = useRef(null)

  // ===== Status OCR Scan Struk =====
  const [scan, setScan] = useState(null) // { nama, url } pratinjau gambar
  const [scanProses, setScanProses] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)
  const [scanHasil, setScanHasil] = useState(null) // hasil bacaStruk()
  const [scanPesan, setScanPesan] = useState('') // info/kesalahan OCR
  const [ocrEnginePref, setOcrEnginePref] = useState(() => {
    const e = bacaOcrConfig().engine
    return e === 'ppocr' ? 'local' : e
  })
  const [puterProvider, setPuterProvider] = useState(() => bacaOcrConfig().puterProvider)
  const [puterStatusMsg, setPuterStatusMsg] = useState('')
  const [puterSignedIn, setPuterSignedIn] = useState(false)
  const [puterTesting, setPuterTesting] = useState(false)
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
  const submittedRef = useRef(false)
  const scanUrlRef = useRef(null)

  useEffect(() => {
    scanUrlRef.current = scan?.url || null
  }, [scan])

  useEffect(() => {
    if (!showOcrConfig && ocrEnginePref !== 'unlimited') return
    let aktif = true
    muatPuterSdk().catch(() => {})
    if (showOcrConfig && (ocrEnginePref === 'unlimited' || ocrEnginePref === 'auto')) {
      cekStatusPuterOcr().then((st) => {
        if (!aktif || !masihTerpasang.current) return
        setPuterSignedIn(Boolean(st.signedIn))
        if (!st.online) {
          setPuterStatusMsg('Sedang offline — Puter OCR butuh koneksi internet.')
        } else if (st.signedIn) {
          setPuterStatusMsg('Akun Puter aktif — Unlimited OCR siap dipakai tanpa API Key.')
        }
      })
    }
    return () => {
      aktif = false
    }
  }, [showOcrConfig, ocrEnginePref])

  useEffect(() => {
    masihTerpasang.current = true
    return () => {
      masihTerpasang.current = false
      if (scanUrlRef.current) {
        URL.revokeObjectURL(scanUrlRef.current)
        scanUrlRef.current = null
      }
      // Worker Tesseract memakan memori; lepas saat modal dilepas.
      matikanOcr()
    }
  }, [])

  useEffect(() => {
    if (!open) return
    submittedRef.current = false
    setError('')
    setSaving(false)
    setCalcOpen(false)
    setCalcExpr('')
    setCalcErr('')
    // Bersihkan sisa hasil scan dari sesi sebelumnya
    if (scanUrlRef.current) {
      URL.revokeObjectURL(scanUrlRef.current)
      scanUrlRef.current = null
    }
    setScan(null)
    setScanHasil(null)
    setScanPesan('')
    setScanProses(false)
    setScanProgress(0)
    if ((mode === 'edit' || mode === 'salin') && sumber) {
      setJenis(sumber.jenis ?? 'pengeluaran')
      setJumlah(formatInputTampil(sumber.jumlah, mode === 'edit' ? { kursSnapshot: sumber.kursSnapshot } : undefined))
      setKategoriNama(sumber.kategoriNama ?? '')
      setAkunId(sumber.akunId ?? akunList[0]?.id ?? '')
      setTanggal(sumber.tanggal ?? isoHariIni())
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
        setGeminiStatus(res.message || 'Kunci API valid & aktif! Gemini Vision siap digunakan.')
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

  async function hubungkanAtauCekPuter() {
    setPuterTesting(true)
    setPuterStatusMsg('Menghubungkan ke Puter Unlimited OCR...')
    try {
      simpanOcrConfig({ puterProvider })
      const res = await sambungkanPuterOcr()
      if (!masihTerpasang.current) return
      setPuterSignedIn(Boolean(res.signedIn))
      if (res.signedIn) {
        const labelUser = res.username ? ` (${res.username})` : ''
        setPuterStatusMsg(`Terhubung ke Puter${labelUser} — siap scan struk gratis tanpa API Key.`)
      } else {
        setPuterStatusMsg('Autentikasi Puter belum selesai. Klik lagi untuk menghubungkan.')
      }
    } catch (err) {
      if (masihTerpasang.current) {
        setPuterStatusMsg(err?.message || 'Gagal menghubungkan ke Puter.js.')
      }
    } finally {
      if (masihTerpasang.current) setPuterTesting(false)
    }
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

    if (scanUrlRef.current) {
      URL.revokeObjectURL(scanUrlRef.current)
      scanUrlRef.current = null
    }
    setScanPesan('')
    setScanHasil(null)
    setSumberSaran(null)
    setSumberBaru('')
    setSumberMenyimpan(false)
    setScanProses(true)
    setScanProgress(0)
    const objekUrl = URL.createObjectURL(file)
    scanUrlRef.current = objekUrl
    setScan({ nama: file.name, url: objekUrl })

    try {
      const hasil = await scanDokumenKeuangan(file, {
        engine: ocrEnginePref,
        puterProvider,
        geminiApiKey: geminiKeyInput,
        onProgress: (p) => {
          if (masihTerpasang.current) setScanProgress(Math.round(p * 100))
        },
      })
      if (!masihTerpasang.current) return
      setScanHasil(hasil)

      // Isi otomatis: hanya timpa field yang belum diisi user (jangan ganggu
      // ketikan manual), kecuali nominal & tanggal yang memang target scan.
      if (hasil.total && hasil.total > 0) setJumlah(formatHasilOcrTampil(hasil.total))
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
      if (hasil.total && hasil.total > 0) bagian.push(`Total ${formatHasilOcrTampil(hasil.total)}.`)
      if (hasil.kategoriNama) bagian.push(`Kategori disarankan: ${hasil.kategoriNama}.`)
      if (hasil.keterangan) bagian.push(`Keterangan: ${hasil.keterangan}.`)
      if (hasil.sumberBayar?.nama && !(akunList || []).some((a) => (a?.nama ?? "").toLowerCase().includes(String(hasil.sumberBayar.nama).toLowerCase())))
        bagian.push(`Rekening ${hasil.sumberBayar.nama} belum ada — bisa ditambah di bawah.`)
      if (hasil.bayarTunai) bagian.push('Pembayaran tunai terdeteksi — pastikan rekening Kas / Dompet dipilih.')

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
      if (masihTerpasang.current) setScanPesan(err?.message ? `Gagal membaca struk: ${err.message}` : 'Gagal membaca struk. Coba foto yang lebih terang & tegak, atau isi manual.')
    } finally {
      if (masihTerpasang.current) setScanProses(false)
    }
  }

  function terapkanUlang() {
    if (!scanHasil) return
    if (scanHasil.total && scanHasil.total > 0) setJumlah(formatHasilOcrTampil(scanHasil.total))
    if (scanHasil.tanggal) setTanggal(scanHasil.tanggal)
    if (scanHasil.jenis) setJenis(scanHasil.jenis)
    if (scanHasil.kategoriNama) setKategoriNama(scanHasil.kategoriNama)
    const teksKeterangan = scanHasil.keterangan || scanHasil.merchant
    if (teksKeterangan) setCatatan(teksKeterangan)
    if (scanHasil.sumberBayar?.nama) {
      const cocok = (akunList || []).find((a) =>
        (a?.nama ?? '').toLowerCase().includes(String(scanHasil.sumberBayar.nama).toLowerCase()),
      )
      if (cocok) {
        setAkunId(cocok.id)
        setSumberSaran(null)
      } else {
        setSumberSaran(scanHasil.sumberBayar)
        setSumberBaru(scanHasil.sumberBayar.nama)
      }
    }
  }

  function tutupModal() {
    if (scanUrlRef.current) {
      URL.revokeObjectURL(scanUrlRef.current)
      scanUrlRef.current = null
    }
    onClose()
  }

  // Beralih dari mode Edit ke mode Salin agar pengguna dapat meninjau
  // dan menyunting draf salinan terlebih dahulu sebelum mencatat transaksi baru.
  function beralihKeModeSalin() {
    const nominalSaatIni = konversiKeBasis(
      parseInputTampil(jumlah),
      mode === 'edit' ? sumber?.kursSnapshot : null,
    )
    const jumlahSalinan = nominalSaatIni > 0 ? nominalSaatIni : (Number(sumber?.jumlah) || 0)
    const drafSalinan = {
      ...sumber,
      jenis: jenis || sumber?.jenis || 'pengeluaran',
      jumlah: jumlahSalinan,
      kategoriNama: kategoriNama.trim() || (sumber?.kategoriNama ?? ''),
      akunId: akunId || sumber?.akunId || akunList?.[0]?.id || '',
      tanggal: tanggal || sumber?.tanggal || isoHariIni(),
      catatan: catatan ?? sumber?.catatan ?? '',
    }
    setError('')
    onSalin?.(drafSalinan)
  }

  function bukaKalkulatorDengan(initialOp = '') {
    const angkaAwal = parseInputTampil(jumlah)
    const dasar = angkaAwal > 0 ? String(angkaAwal) : ''
    const nextExpr = initialOp ? sisipTokenKalkulator(dasar, initialOp) : dasar
    setCalcExpr(nextExpr)
    setCalcErr('')
    setCalcOpen(true)
  }

  function toggleKalkulator() {
    if (calcOpen) {
      setCalcOpen(false)
      setCalcErr('')
      return
    }
    bukaKalkulatorDengan('')
  }

  function tekanKeypad(token) {
    setCalcErr('')
    if (token === '=') {
      const res = evaluasiEkspresiNominal(calcExpr)
      if (!res.ok) {
        setCalcErr(res.error)
        return
      }
      const hasilTampil = bulatkanUntukTampil(res.nilai)
      if (hasilTampil <= 0) {
        setCalcErr('Hasil harus lebih dari 0.')
        return
      }
      const { currency, locale } = uangAktif()
      setJumlah(hasilTampil.toLocaleString(locale, { maximumFractionDigits: desimalMataUang(currency) }))
      setCalcExpr(String(hasilTampil))
      setCalcOpen(false)
      setError('')
      return
    }
    setCalcExpr((prev) => sisipTokenKalkulator(prev, token))
  }

  async function submit(e) {
    e.preventDefault()
    if (submittedRef.current) return
    let nTampil = parseInputTampil(jumlah)
    if (calcOpen && calcExpr.trim()) {
      const calcRes = evaluasiEkspresiNominal(calcExpr)
      if (!calcRes.ok) {
        setCalcErr(calcRes.error)
        return setError(calcRes.error)
      }
      const hasilTampil = bulatkanUntukTampil(calcRes.nilai)
      if (hasilTampil <= 0) {
        setCalcErr('Hasil harus lebih dari 0.')
        return setError('Nominal harus lebih dari nol.')
      }
      nTampil = hasilTampil
    }
    const n = konversiKeBasis(nTampil, mode === 'edit' ? sumber?.kursSnapshot : null)
    if (n <= 0) return setError('Nominal harus lebih dari nol.')
    if (!akunId) return setError(jenis === 'pemasukan' ? 'Pilih rekening tujuan penerima dulu.' : 'Pilih rekening sumber dulu.')
    if (!kategoriNama.trim()) return setError('Isi kategori dulu.')
    submittedRef.current = true

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

    // Resolusi awal kategori dari cache bila sudah ada
    const targetKat = String(namaKatSnap ?? '').trim().toLowerCase()
    const katAwal =
      (kategoriList || []).find((k) => String(k?.nama ?? '').trim().toLowerCase() === targetKat && k?.jenis === jenisSnap) ??
      (kategoriList || []).find((k) => String(k?.nama ?? '').trim().toLowerCase() === targetKat)

    // ID dokumen: pertahankan bila edit, atau buat ID resmi sinkron sebelum submit
    const docId = modeSnap === 'edit' && sumberSnap?.id ? sumberSnap.id : buatTransaksiId(uid)
    const kursSnapshot =
      modeSnap === 'edit'
        ? (sumberSnap?.kursSnapshot || null)
        : buatSnapshotKurs(bacaBasisMataUang() || 'IDR', tanggalSnap)

    const optTx = {
      id: docId,
      jumlah: n,
      jenis: jenisSnap,
      kategoriId: katAwal?.id ?? '',
      kategoriNama: namaKatSnap,
      akunId: akunIdSnap,
      akunNama: akun?.nama ?? '',
      tanggal: tanggalSnap,
      catatan: catatanSnap,
      kursSnapshot,
      deleted: false,
      createdAt: new Date().toISOString(),
    }

    // OPTIMISTIC: kirim event optimis seketika, tutup modal SEKARANG, commit ke Firestore di background.
    if (modeSnap === 'edit') {
      window.dispatchEvent(new CustomEvent('myduit:transaksi-updated', { detail: { item: optTx } }))
    } else {
      window.dispatchEvent(new CustomEvent('myduit:transaksi-added', { detail: { item: optTx } }))
      if (modeSnap === 'salin') {
        window.dispatchEvent(
          new CustomEvent('myduit:toast', {
            detail: { type: 'success', msg: 'Transaksi berhasil disalin & dicatat!' },
          })
        )
      }
    }

    setError('')
    setSaving(false)
    onClose()

    ;(async () => {
      try {
        let kategoriId = katAwal?.id ?? ''
        if (!kategoriId) kategoriId = await ambilAtauBuatKategori(uid, namaKatSnap, jenisSnap)
        const data = {
          id: docId,
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
        if (modeSnap === 'edit' && sumberSnap) {
          window.dispatchEvent(new CustomEvent('myduit:transaksi-updated', { detail: { item: sumberSnap } }))
        } else {
          window.dispatchEvent(new CustomEvent('myduit:transaksi-deleted', { detail: { ids: [docId] } }))
        }
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
    <>
      {portalBody(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm modal-backdrop-wrap" onClick={tutupModal}>
      <div className={`clay-sheet ${isPemasukan ? 'clay-key-primary' : 'clay-key-danger'} flex max-h-[92vh] w-full max-w-md sm:max-w-[540px] flex-col overflow-hidden`} onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-4 sm:px-5 pb-2 pt-3.5">
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
                onClick={beralihKeModeSalin}
                title="Salin & edit sebagai transaksi baru"
                aria-label="Salin transaksi"
                className="clay-chip clay-key-primary solid-primary inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-white"
              >
                <span className="material-symbols-outlined icon-sm">content_copy</span>
              </button>
            )}
            <button
              type="button"
              onClick={tutupModal}
              aria-label="Tutup"
              className="clay-chip clay-key-neutral flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-600"
            >
              <span className="material-symbols-outlined icon-lg">close</span>
            </button>
          </div>
        </div>

        {/* Segmented Clay Toggle: Pengeluaran vs Pemasukan (Bespoke tactile track) */}
        <div className="px-4 sm:px-5 pt-2 pb-1">
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

        <form onSubmit={submit} className="min-h-0 space-y-2.5 sm:space-y-2 overflow-y-auto px-4 sm:px-5 py-2.5">
          {mode === 'salin' && (
            <div className="flex items-start gap-2 rounded-xl border border-sky-200/80 bg-sky-50/90 px-3 py-2 text-[11px] font-medium text-sky-800">
              <span className="material-symbols-outlined icon-sm mt-px shrink-0 text-sky-600">content_copy</span>
              <span>Mode salin: sesuaikan data di bawah, lalu simpan sebagai transaksi baru tanpa mengubah transaksi asli.</span>
            </div>
          )}
          {/* Hero Input Nominal (Paling Atas: Tak Tertutup Keyboard Virtual Mobile, Teks Kontras Tinggi + Kalkulator Sederhana) */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="tx-jumlah" className="block text-[11px] font-bold tracking-wide uppercase text-textSecondary">
                Nominal Transaksi ({simbolUang()})
              </label>
              <span className="hidden sm:inline text-[10px] font-medium text-slate-400">
                Ketik + − × ÷ atau tekan ikon untuk hitung
              </span>
            </div>
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
                onChange={(e) => {
                  if (calcOpen) return
                  setJumlah(sanitizeKetikNominal(e.target.value))
                }}
                onKeyDown={(e) => {
                  if (['+', '-', '*', '/'].includes(e.key)) {
                    e.preventDefault()
                    if (!calcOpen) bukaKalkulatorDengan(e.key)
                    else tekanKeypad(e.key)
                  } else if (e.key === '=') {
                    e.preventDefault()
                    if (calcOpen) tekanKeypad('=')
                    else toggleKalkulator()
                  } else if (calcOpen && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    if (/^[0-9]$/.test(e.key) || e.key === ',' || e.key === '.') {
                      e.preventDefault()
                      tekanKeypad(e.key)
                    } else if (e.key === 'Backspace') {
                      e.preventDefault()
                      tekanKeypad('DEL')
                    } else if (e.key === 'Delete') {
                      e.preventDefault()
                      tekanKeypad('C')
                    }
                  }
                }}
                inputMode="decimal"
                placeholder="0"
                required
                autoFocus
                className={`clay-input field-lg w-full rounded-2xl pl-11 pr-12 text-xl font-black font-mono tracking-tight ${
                  isPemasukan ? 'tx-nominal-income !text-[#36AE7C]' : 'tx-nominal-expense !text-[#EB5353]'
                }`}
              />
              <button
                type="button"
                onClick={toggleKalkulator}
                title="Kalkulator nominal (+ − × ÷)"
                aria-label="Buka kalkulator nominal"
                aria-expanded={calcOpen}
                className={`clay-chip absolute right-2 flex h-8 w-8 items-center justify-center rounded-xl touch-manipulation ${
                  calcOpen
                    ? (isPemasukan ? 'solid-primary text-white' : 'solid-danger text-white')
                    : 'clay-key-neutral text-slate-600'
                }`}
              >
                <span className="material-symbols-outlined icon-md">calculate</span>
              </button>
            </div>

            {/* Kalkulator Sederhana (+, -, ×, ÷) selaras tema Neumorphism & Claymorphism */}
            {calcOpen && (() => {
              const live = calcExpr.trim() ? evaluasiEkspresiNominal(calcExpr) : null
              return (
                <div
                  role="region"
                  aria-label="Kalkulator nominal sederhana"
                  tabIndex={-1}
                  onKeyDown={(e) => {
                    if (/^[0-9]$/.test(e.key)) {
                      e.preventDefault()
                      tekanKeypad(e.key)
                    } else if (['+', '-', '*', '/', ',', '.'].includes(e.key)) {
                      e.preventDefault()
                      tekanKeypad(e.key)
                    } else if (e.key === 'Backspace') {
                      e.preventDefault()
                      tekanKeypad('DEL')
                    } else if (e.key === 'Enter' || e.key === '=') {
                      e.preventDefault()
                      tekanKeypad('=')
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setCalcOpen(false)
                    }
                  }}
                  className="accordion-slide-down neu-inset mt-1.5 space-y-2 rounded-2xl bg-[#E5E5E5] p-2.5 outline-none"
                >
                  <div className="neu-well flex items-center justify-between gap-2 rounded-xl bg-[#E5E5E5] px-3 py-1.5">
                    <span className="min-w-0 truncate font-mono text-xs font-bold text-slate-600">
                      {formatEkspresiPreview(calcExpr) || '0'}
                    </span>
                    <span className={`shrink-0 font-mono text-sm font-black ${
                      calcErr || (live && (!live.ok || live.dibulatkan <= 0))
                        ? 'text-[#EB5353]'
                        : isPemasukan
                          ? 'text-[#36AE7C]'
                          : 'text-[#EB5353]'
                    }`}>
                      {calcErr
                        ? calcErr
                        : live && live.ok
                          ? (() => {
                              const tampil = bulatkanUntukTampil(live.nilai)
                              const { currency, locale } = uangAktif()
                              return tampil > 0
                                ? `= ${simbolUang()} ${tampil.toLocaleString(locale, { maximumFractionDigits: desimalMataUang(currency) })}`
                                : `= ${tampil}`
                            })()
                          : live && !live.ok
                            ? live.error
                            : ''}
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { k: 'C', label: 'C', cls: 'text-[#EB5353]', aria: 'Bersihkan hitungan' },
                      { k: 'DEL', label: '⌫', cls: 'text-slate-600', aria: 'Hapus karakter terakhir' },
                      { k: '/', label: '÷', cls: 'text-[#187498]', aria: 'Bagi' },
                      { k: '*', label: '×', cls: 'text-[#187498]', aria: 'Kali' },
                      { k: '7', label: '7' },
                      { k: '8', label: '8' },
                      { k: '9', label: '9' },
                      { k: '-', label: '−', cls: 'text-[#187498]', aria: 'Kurang' },
                      { k: '4', label: '4' },
                      { k: '5', label: '5' },
                      { k: '6', label: '6' },
                      { k: '+', label: '+', cls: 'text-[#187498]', aria: 'Tambah' },
                      { k: '1', label: '1' },
                      { k: '2', label: '2' },
                      { k: '3', label: '3' },
                      { k: ',', label: ',', aria: 'Koma desimal' },
                      { k: '0', label: '0' },
                      { k: '000', label: '000' },
                    ].map((btn) => (
                      <button
                        key={btn.k}
                        type="button"
                        onClick={() => tekanKeypad(btn.k)}
                        aria-label={btn.aria || btn.label}
                        className="clay-btn clay-btn-secondary flex h-9 items-center justify-center rounded-xl font-mono text-sm font-extrabold touch-manipulation"
                      >
                        <span className={btn.cls || 'text-slate-700'}>{btn.label}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => tekanKeypad('=')}
                      aria-label="Hitung dan terapkan hasil ke nominal"
                      className={`clay-btn ${isPemasukan ? 'clay-key-primary solid-primary' : 'clay-key-danger solid-danger'} col-span-2 flex h-9 items-center justify-center gap-1 rounded-xl text-xs font-extrabold text-white touch-manipulation`}
                    >
                      <span className="font-mono text-sm">=</span>
                      <span>Terapkan</span>
                    </button>
                  </div>
                </div>
              )
            })()}

            <InfoLensaKurs
              nilaiBasis={konversiKeBasis(
                parseInputTampil(jumlah),
                mode === 'edit' ? sumber?.kursSnapshot : null,
              )}
              kursSnapshot={mode === 'edit' ? sumber?.kursSnapshot : null}
              mode={mode === 'edit' && sumber?.kursSnapshot ? 'edit' : 'form'}
            />
          </div>
          {/* Scan Struk / Foto — HANYA mode tambah pengeluaran (GAS menyembunyikannya saat edit / pemasukan).
              Di web (sm:) ditata 1 baris ringkas agar modal muat 1 layar tanpa scrolling. */}
          {mode === 'add' && !isPemasukan && (
            <div className="neu-inset flex flex-col gap-2 rounded-2xl p-2.5 sm:px-3 sm:py-2 bg-[#E5E5E5]">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="material-symbols-outlined icon-sm shrink-0 text-[#EB5353]">document_scanner</span>
                  <label className="truncate text-[11px] font-semibold text-textSecondary">Scan Struk</label>
                  {scanHasil?.engine === 'gemini-flash' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                      <span className="material-symbols-outlined icon-2xs">smart_toy</span>
                      Gemini AI
                    </span>
                  ) : scanHasil?.engine === 'puter-ocr' || scanHasil?.engine === 'unlimited-ocr' || scanHasil?.engine === 'unlimited-ocr-sglang' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                      <span className="material-symbols-outlined icon-2xs">smart_toy</span>
                      Unlimited AI
                    </span>
                  ) : scanHasil?.engine === 'tesseract-gundam' && scanHasil?.confidence > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800">
                      <span className="material-symbols-outlined icon-2xs">view_agenda</span>
                      Gundam {Math.round(scanHasil.confidence)}%
                    </span>
                  ) : scanHasil?.confidence > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary-light px-2 py-0.5 text-[10px] font-bold text-primary">
                      <span className="material-symbols-outlined icon-2xs">bolt</span>
                      {Math.round(scanHasil.confidence)}%
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setShowOcrConfig((s) => !s)}
                    title="Pengaturan Engine OCR"
                    aria-label="Pengaturan Engine OCR"
                    className={`neu-btn ml-auto sm:ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#E5E5E5] transition-transform active:scale-95 ${
                      showOcrConfig ? 'text-[#36AE7C]' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <span className="material-symbols-outlined icon-xs">tune</span>
                  </button>
                </div>

                {!scanProses && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => fileUploadRef.current?.click()}
                      className="clay-btn-secondary clay-btn btn-sm flex-1 sm:flex-initial bg-surface text-textSecondary hover:bg-gray-100 px-3"
                    >
                      <span className="material-symbols-outlined icon-sm">upload_file</span>
                      Upload Struk
                    </button>
                    <button
                      type="button"
                      onClick={() => fileCameraRef.current?.click()}
                      className="clay-btn-secondary clay-btn btn-sm flex-1 sm:flex-initial bg-surface text-textSecondary hover:bg-gray-100 px-3"
                    >
                      <span className="material-symbols-outlined icon-sm">photo_camera</span>
                      Foto Struk
                    </button>
                  </div>
                )}
              </div>

              {/* Panel Pengaturan Engine OCR */}
              {showOcrConfig && (
                <div className="accordion-slide-down neu-card flex flex-col gap-2.5 rounded-2xl bg-[#E5E5E5] p-3.5 text-[11px] text-slate-700 border border-white/60">
                  <div className="flex items-center justify-between font-bold text-slate-800">
                    <span>Pilihan Engine OCR:</span>
                    <span className="text-[10px] text-slate-500 font-medium">
                      {ocrEnginePref === 'auto'
                        ? (geminiKeyInput ? 'Auto (Puter/Gemini/Lokal)' : 'Auto (Puter/Lokal Gundam)')
                        : ocrEnginePref === 'unlimited'
                          ? 'Puter Unlimited OCR (Gratis Serverless)'
                          : ocrEnginePref === 'gemini'
                            ? 'Google Gemini Vision (Cloud)'
                            : 'Lokal Offline (Gundam + Tesseract)'}
                    </span>
                  </div>
                  <div className="neu-inset grid grid-cols-4 gap-1 p-1 rounded-xl bg-[#E5E5E5]">
                    {[
                      { id: 'auto', label: 'Auto Cerdas' },
                      { id: 'unlimited', label: 'Unlimited' },
                      { id: 'gemini', label: 'Gemini AI' },
                      { id: 'local', label: 'Lokal' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setOcrEnginePref(opt.id)
                          simpanOcrConfig({ engine: opt.id })
                          if (opt.id === 'unlimited') muatPuterSdk().catch(() => {})
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

                  {/* Konfigurasi Puter Free Unlimited OCR (Mistral / AWS Textract) */}
                  {(ocrEnginePref === 'unlimited' || ocrEnginePref === 'auto') && (
                    <div className="border-t border-black/5 pt-2 mt-0.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-800">Puter Unlimited OCR (Gratis):</span>
                        <div className="inline-flex rounded-lg bg-black/5 p-0.5 text-[9.5px] font-bold">
                          {[
                            { id: 'mistral', label: 'Mistral OCR' },
                            { id: 'aws-textract', label: 'AWS Textract' },
                          ].map((prov) => (
                            <button
                              key={prov.id}
                              type="button"
                              onClick={() => {
                                setPuterProvider(prov.id)
                                simpanOcrConfig({ puterProvider: prov.id })
                              }}
                              className={`rounded-md px-2 py-0.5 transition-all ${
                                puterProvider === prov.id
                                  ? 'bg-white text-[#36AE7C] shadow-sm'
                                  : 'text-slate-500 hover:text-slate-800'
                              }`}
                            >
                              {prov.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 rounded-xl bg-black/[0.04] px-2.5 py-2">
                        <p className="text-[9.5px] leading-snug text-slate-600">
                          Berjalan langsung di HP &amp; Desktop tanpa API Key atau server GPU. Hanya perlu masuk akun Puter gratis sekali pakai.
                        </p>
                        <button
                          type="button"
                          onClick={hubungkanAtauCekPuter}
                          disabled={puterTesting}
                          className="neu-btn shrink-0 px-3 py-1.5 rounded-xl bg-[#E5E5E5] text-[#36AE7C] font-extrabold text-[10.5px] transition-all hover:text-emerald-700 active:scale-95 disabled:opacity-50"
                        >
                          {puterTesting ? '...' : puterSignedIn ? 'Terhubung' : 'Hubungkan Puter'}
                        </button>
                      </div>
                      {puterStatusMsg && (
                        <p className={`text-[9.5px] font-medium ${puterSignedIn || puterStatusMsg.startsWith('Terhubung') || puterStatusMsg.startsWith('Akun Puter') ? 'text-emerald-700' : 'text-slate-600'}`}>
                          {puterStatusMsg}
                        </p>
                      )}
                    </div>
                  )}

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
                          <div className="progress-bar-fill h-full rounded-full bg-primary" style={{ width: `${scanProgress}%` }} />
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
                      Nominal: {formatHasilOcrTampil(scanHasil.total)}
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

          {/* Grid 2 Kolom di Web (sm:) supaya kartu Catat Pengeluaran/Pemasukan muat 1 layar tanpa scroll */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-x-3 sm:gap-y-2">
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
            </div>

            {/* Struk terdeteksi provider pembayaran (GoPay/SeaBank/SPayLater/...)
                yang BELUM ada di daftar rekening user. */}
            {sumberSaran && !sumberMenyimpan && (
              <div className="clay-key-info sm:col-span-2 rounded-2xl p-3">
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
              <div className="flex flex-col gap-2 sm:col-span-2">
                <label
                  htmlFor="tx-sumber-baru"
                  className="block text-[11px] font-semibold text-slate-600"
                >
                  Nama rekening baru
                </label>
                <input
                  id="tx-sumber-baru"
                  type="text"
                  maxLength={120}
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

            <div className="flex flex-col gap-1">
              <label htmlFor="tx-kategori" className="block text-[11px] font-semibold text-textSecondary">Kategori</label>
              <ClayCombobox
                id="tx-kategori"
                value={kategoriNama}
                onChange={setKategoriNama}
                placeholder="Pilih atau ketik kategori..."
                required
                inputProps={{ maxLength: 100 }}
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

            <div className="flex flex-col gap-1">
              <label htmlFor="tx-catatan" className="block text-[11px] font-semibold text-textSecondary">Keterangan</label>
              <input
                id="tx-catatan"
                type="text"
                maxLength={500}
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                placeholder="Keterangan opsional"
                className="clay-input field-lg w-full text-sm"
              />
            </div>

            {akunList.length === 0 && (
              <div className="sm:col-span-2 flex items-start gap-2 rounded-lg bg-red-50 px-2.5 py-2 text-[11px] text-red-600">
                <span className="material-symbols-outlined icon-xs mt-px shrink-0">error</span>
                <span>Belum ada rekening. Tambahkan rekening dulu sebagai sumber akun.</span>
              </div>
            )}
          </div>

          {error && (
            <p role="alert" aria-live="assertive" className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className={`clay-btn ${isPemasukan ? 'clay-key-primary solid-primary' : 'clay-key-danger solid-danger'} btn-lg w-full text-white disabled:opacity-60`}
          >
            <span className="material-symbols-outlined icon-md">save</span>
            {saving ? 'Menyimpan…' : mode === 'edit' ? 'Simpan Perubahan' : mode === 'salin' ? 'Salin & Catat Transaksi' : isPemasukan ? 'Simpan Pemasukan' : 'Simpan Pengeluaran'}
          </button>
        </form>
      </div>
    </div>,
      )}

      {/* Modal Panduan Ambil Kunci Gemini Gratis */}
      {showTutorialModal && portalBody(
        <div
          className="modal-backdrop-wrap fixed inset-0 z-[10001] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
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
        </div>,
      )}
    </>
  )
}
