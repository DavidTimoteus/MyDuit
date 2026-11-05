import { useEffect, useRef, useState } from 'react'
import { formatNominal, formatRibuanInput, isoHariIni, parseNominal, simbolUang } from '../../lib/format.js'
import { ambilAtauBuatKategori, simpanTransaksi, tambahAkun, updateTransaksi } from '../../lib/db.js'
import { ClayCombobox, ClayDateInput, ClaySelect } from '../../components/clay-ui.jsx'
import { pesanErrorSimpan } from '../../lib/pesanError.js'
import { bacaStruk, matikanOcr } from '../../lib/ocrStruk.js'

// Modal Catat / Edit / Salin transaksi — markup persis GAS #viewTambah.
// JENIS TIDAK dipilih user: di-set sistem dari titik masuk (Aksi Cepat /
// speed-dial mengirim preset pemasukan|pengeluaran; default pengeluaran).
// Grup Scan Struk (mode add) menjalankan OCR 100% di browser (lihat ocrStruk.js):
// pengguna memilih/memfoto struk → total, tanggal, dan keterangan terisi otomatis.
export default function FormTransaksiModal({ uid, open, onClose, onSalin, onAkunBaru, akunList, kategoriList, mode, doc: sumber }) {
  const [jenis, setJenis] = useState('pengeluaran')
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
      // Jenis di-set sistem: preset dari pemicu (Aksi Cepat / speed-dial), default pengeluaran
      setJenis(sumber?.preset === 'pemasukan' ? 'pemasukan' : 'pengeluaran')
      setJumlah('')
      setKategoriNama('')
      setAkunId(akunList[0]?.id ?? '')
      setTanggal(isoHariIni())
      setCatatan('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, sumber?.id])

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
      const hasil = await bacaStruk(file, (p) => {
        if (masihTerpasang.current) setScanProgress(Math.round(p * 100))
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
        const cocok = akunList.find((a) => a.nama.toLowerCase().includes(hasil.sumberBayar.nama.toLowerCase()))
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
      if (hasil.sumberBayar?.nama && !akunList.some((a) => a.nama.toLowerCase().includes(hasil.sumberBayar.nama.toLowerCase())))
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
    if (!akunId) return setError('Pilih rekening sumber dulu.')
    if (!kategoriNama.trim()) return setError('Isi kategori dulu.')

    const akun = akunList.find((a) => a.id === akunId)
    if (jenisSnap === 'pengeluaran' && akun) {
      const saldoSaatIni = Number(akun.saldo) || 0
      const saldoSetelah = modeSnap === 'edit' && sumberSnap?.akunId === akunId
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

    // Snapshot data SEBELUM tutup modal — state komponen boleh berubah setelahnya.
    const jenisSnap = jenis
    const tanggalSnap = tanggal
    const catatanSnap = catatan.trim()
    const akunIdSnap = akunId
    const namaKatSnap = kategoriNama.trim()
    const modeSnap = mode
    const sumberSnap = sumber

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
        const kat =
          kategoriList.find((k) => k.nama.toLowerCase() === namaKatSnap.toLowerCase() && k.jenis === jenisSnap) ??
          kategoriList.find((k) => k.nama.toLowerCase() === namaKatSnap.toLowerCase())
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

  const judul = mode === 'edit' ? 'Edit Transaksi' : mode === 'salin' ? 'Salin Transaksi' : 'Catat Transaksi'

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={tutupModal}>
      <div className="clay-sheet clay-key-primary flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-4 pb-2 pt-4">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-800 sm:text-base">
            <span className="material-symbols-outlined icon-lg shrink-0 text-primary">receipt_long</span>
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

        <form onSubmit={submit} className="min-h-0 space-y-2 overflow-y-auto px-4 py-2">
          {/* Scan Struk / Foto — HANYA mode tambah (GAS menyembunyikannya saat edit).
              OCR berjalan 100% di browser: total, tanggal, jenis, dan merchant terisi otomatis. */}
          {mode === 'add' && (
            <div className="flex flex-col gap-1.5 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-2.5">
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined icon-sm text-primary">document_scanner</span>
                <label className="text-[11px] font-semibold text-textSecondary">Scan Struk / Foto Transaksi</label>
                {scanHasil?.confidence > 0 && (
                  <span className="ml-auto rounded-full bg-primary-light px-2 py-0.5 text-[10px] font-bold text-primary">
                    Akurasi {Math.round(scanHasil.confidence)}%
                  </span>
                )}
              </div>

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
            <label htmlFor="tx-akun" className="block text-[11px] font-semibold text-textSecondary">Sumber / Akun</label>
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
                const sesuaiJenis = kategoriList.filter((k) => k.jenis === jenis)
                if ((mode === 'edit' || mode === 'salin') && sumber?.kategoriId) {
                  const ada = sesuaiJenis.some((k) => k.id === sumber.kategoriId)
                  if (!ada) {
                    const sumberKat = kategoriList.find((k) => k.id === sumber.kategoriId)
                    if (sumberKat) return [{ value: sumberKat.id, label: sumberKat.nama + ' (lama)' }, ...sesuaiJenis]
                  }
                }
                return sesuaiJenis
              })().map((k) => ({ value: k.id, label: k.nama }))}
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
              className="clay-input field-lg w-full bg-surface text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="tx-jumlah" className="block text-[11px] font-semibold text-textSecondary">Nominal ({simbolUang()})</label>
            <input
              id="tx-jumlah"
              type="text"
              value={jumlah}
              onChange={(e) => setJumlah(formatRibuanInput(e.target.value))}
              inputMode="numeric"
              placeholder="0"
              required
              className="clay-input field-lg w-full bg-surface text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary font-mono"
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
            className="clay-btn clay-key-primary solid-primary btn-lg w-full text-white transition-colors disabled:opacity-60"
          >
            <span className="material-symbols-outlined icon-md">save</span>
            {saving ? 'Menyimpan…' : mode === 'edit' ? 'Simpan Perubahan' : 'Simpan Transaksi'}
          </button>
        </form>
      </div>
    </div>
  )
}
