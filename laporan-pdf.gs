/*******************************************************
 * MyDuit — laporan-pdf.gs
 * Domain: Export Laporan PDF (gaya rekening koran bank)
 * 
 * Kompatibel dengan ViewJS.html:
 * - generateLaporanPDFServer(bulan, tahun)
 *******************************************************/

function generateLaporanPDFServer(bulan, tahun, pakaiAI) {
  try {
    const bulanNum = Number(bulan);
    const tahunNum = Number(tahun);
    if (isNaN(bulanNum) || bulanNum < 0 || bulanNum > 11 || isNaN(tahunNum)) {
      return { status: 'error', message: 'Bulan/tahun tidak valid.' };
    }

    const stats = getStatistikPeriodeServer('bulanan', bulanNum, tahunNum);
    const items = getSemuaTransaksiBulanServer(bulanNum, tahunNum);

    // Ringkasan utang
    let ringkasanUtang = { jumlahAktif: 0, totalSisa: 0 };
    try {
      const utangRes = getUtangServer();
      const aktif = (utangRes.list || []).filter(function (u) { return u.status !== 'Lunas'; });
      ringkasanUtang = {
        jumlahAktif: aktif.length,
        totalSisa: aktif.reduce(function (a, u) { return a + (u.sisa || 0); }, 0)
      };
    } catch (e) {}

    // Rekomendasi AI hanya diambil jika user memilih menyertakannya (toggle di modal export)
    let rekomendasiTeks = '';
    if (pakaiAI) {
      try {
        const rek = getRekomendasiKeuanganServer('bulanan', bulanNum, tahunNum);
        rekomendasiTeks = (rek && rek.rekomendasi) || '';
      } catch (e) {}
    }

    const html = buildLaporanHTML(items, bulanNum, tahunNum, stats, ringkasanUtang, rekomendasiTeks);
    const blob = Utilities.newBlob(html, 'text/html', 'laporan.html').getAs('application/pdf');
    const fileName = 'Laporan-Keuangan-' + BULAN_NAMA[bulanNum] + '-' + tahunNum + '.pdf';

    return {
      status: 'success',
      base64: Utilities.base64Encode(blob.getBytes()),
      fileName: fileName
    };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

function escapeHtmlServer_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildLaporanHTML(items, bulan, tahun, stats, ringkasanUtang, rekomendasiTeks) {
  const timeZone = Session.getScriptTimeZone();
  const now = new Date();
  const labelPeriode = BULAN_NAMA[bulan] + ' ' + tahun;
  const lastDay = new Date(tahun, bulan + 1, 0).getDate();
  const periodeRange = '01 ' + BULAN_NAMA[bulan].substring(0, 3).toUpperCase() + ' ' + tahun + ' sampai ' + lastDay + ' ' + BULAN_NAMA[bulan].substring(0, 3).toUpperCase() + ' ' + tahun;

  const st = stats || {};
  const utang = ringkasanUtang || { jumlahAktif: 0, totalSisa: 0 };

  // Totals dihitung dari items (sumber sama dgn tabel) -> dipakai baris TOTAL di tfoot.
  const isIncomeType = function (j) {
    j = String(j || '').toLowerCase();
    return j === 'pemasukan' || j === 'pendapatan';
  };
  let sumIncome = 0, sumExpense = 0;
  items.forEach(function (it) {
    if (String(it.jenis || '').toLowerCase() === 'pindah saldo') return;
    if (isIncomeType(it.jenis)) sumIncome += Number(it.nominal) || 0;
    else sumExpense += Number(it.nominal) || 0;
  });

  // Baris transaksi: warna semantik per kolom Masuk/Keluar + zebra via INLINE STYLE
  // pada TD (konverter PDF sering mengabaikan background pada TR).
  const rowsHtml = items.length ? items.map(function (it, i) {
    const isIncome = isIncomeType(it.jenis);
    const mainLabel = it.keterangan || it.kategori || '-';
    const nominalFmt = Number(it.nominal || 0).toLocaleString('id-ID');
    const bg = (i % 2 === 1) ? ';background:#F1F5F9;' : ';';
    return '<tr>' +
      '<td style="white-space:nowrap;font-size:9px;color:#64748B;padding:9px 10px;' + bg + '">' + escapeHtmlServer_(it.tanggal) + '</td>' +
      '<td style="' + bg + '"><div style="font-size:10.5px;font-weight:600;color:#0F172A;">' + escapeHtmlServer_(mainLabel) + '</div><div style="font-size:8.5px;color:#94A3B8;margin-top:2px;">' + escapeHtmlServer_(it.kategori) + '</div></td>' +
      '<td style="text-align:right;vertical-align:top;font-size:10px;font-weight:700;color:#047857;padding:10px;' + bg + '">' + (isIncome ? nominalFmt : '&nbsp;') + '</td>' +
      '<td style="text-align:right;vertical-align:top;font-size:10px;font-weight:700;color:#B91C1C;padding:10px;' + bg + '">' + (isIncome ? '&nbsp;' : nominalFmt) + '</td>' +
      '</tr>';
  }).join('')
    : '<tr><td colspan="4" style="text-align:center;color:#94A3B8;font-style:italic;padding:24px 10px;">Belum ada transaksi pada periode ini.</td></tr>';

  const kategoriHtml = '';

  // Alert utang aktif (soft red, konsisten dgn bahasa visual danger aplikasi)
  const utangHtml = utang.jumlahAktif > 0
    ? '<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:11px 14px;margin-bottom:6px;">' +
      '<span style="font-size:10.5px;color:#B91C1C;font-weight:700;">Total Utang Aktif: Rp ' + Number(utang.totalSisa).toLocaleString('id-ID') + '</span> ' +
      '<span style="font-size:9.5px;color:#7C2D12;">(' + utang.jumlahAktif + ' utang berjalan)</span>' +
      '</div>'
    : '';

  const bulanS = [
    'JAN', 'FEB', 'MAR', 'APR', 'MEI', 'JUN', 'JUL', 'AGU', 'SEP', 'OKT', 'NOV', 'DES'
  ];
  const refNumber = 'MYD-' + bulanS[bulan] + tahun + '-' + Utilities.formatDate(now, timeZone, 'HHmmss');
  const tanggalCetak = Utilities.formatDate(now, timeZone, 'dd') + ' ' + bulanS[now.getMonth()] + ' ' + tahun;

  return `
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      @page { size: A4; margin: 13mm 11mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Helvetica', Arial, sans-serif; color: #1a1b1e; font-size: 10.5px; margin: 0; }
      h2.sec-title { font-size: 12.5px; font-weight: 800; color: #0F172A; margin: 20px 0 2px 0; }
      p.sec-sub { font-size: 8.5px; color: #94A3B8; margin: 0 0 10px 0; }
      table { border-collapse: collapse; }
      table.tx { width: 100%; }
      table.tx thead { display: table-header-group; }
      table.tx tr { page-break-inside: avoid; }
      table.tx th { text-align: left; padding: 7px 9px; font-size: 7.5px; letter-spacing: 1px; color: #64748B; text-transform: uppercase; font-weight: 700; background: #F8FAFC; border-bottom: 1.5px solid #CBD5E1; }
      table.tx td { padding: 9px; border-bottom: 1px solid #EEF2F7; font-size: 10px; vertical-align: top; }
      table.tx tfoot td { background: #F1F5F9; font-weight: 800; font-size: 10px; border-bottom: none; padding: 9px; }
      .footer-note { margin-top: 24px; padding-top: 10px; border-top: 1px solid #E2E8F0; font-size: 8px; color: #94A3B8; text-align: center; }
      .stat-label { font-size: 7px; letter-spacing: 1.2px; text-transform: uppercase; color: #64748B; font-weight: 700; }
      .stat-value { font-size: 13.5px; font-weight: 800; margin-top: 4px; }
    </style>
  </head>
  <body>

    <!-- HEADER BAND -->
    <table style="width:100%;background:#1B4332;border-radius:10px;">
      <tr>
        <td style="padding:15px 18px;">
          <table style="width:100%;">
            <tr>
              <td style="vertical-align:middle;">
                <div style="font-size:17px;font-weight:800;color:#FFFFFF;letter-spacing:0.5px;">MyDuit</div>
                <div style="font-size:8.5px;color:rgba(255,255,255,0.75);margin-top:2px;">Catatan Keuangan Pribadi</div>
              </td>
              <td style="vertical-align:middle;text-align:right;">
                <div style="font-size:9.5px;color:rgba(255,255,255,0.85);font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">Laporan Keuangan</div>
                <div style="font-size:9px;color:rgba(255,255,255,0.95);margin-top:3px;">${labelPeriode}</div>
                <div style="font-size:7.5px;color:rgba(255,255,255,0.6);margin-top:3px;">S/N ${refNumber} &#183; Dicetak ${tanggalCetak}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- RINGKASAN KEUANGAN -->
    <h2 class="sec-title">Ringkasan Keuangan</h2>
    <p class="sec-sub">${periodeRange} &#183; ${items.length} transaksi tercatat</p>
    <table style="width:100%;border-collapse:separate;border-spacing:5px 0;margin-bottom:4px;">
      <tr>
        <td style="width:33%;padding-right:5px;">
          <div style="background:#ECFDF5;border:1px solid #BBF7D0;border-radius:10px;padding:11px 12px;">
            <div class="stat-label">Pemasukan</div>
            <div class="stat-value" style="color:#047857;">Rp ${Number(st.pemasukan || 0).toLocaleString('id-ID')}</div>
          </div>
        </td>
        <td style="width:33%;padding-right:5px;">
          <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:11px 12px;">
            <div class="stat-label">Pengeluaran</div>
            <div class="stat-value" style="color:#B91C1C;">Rp ${Number(st.pengeluaran || 0).toLocaleString('id-ID')}</div>
          </div>
        </td>
        <td style="width:34%;">
          <div style="background:#1B4332;border-radius:10px;padding:11px 12px;">
            <div class="stat-label" style="color:rgba(255,255,255,0.75);">Saldo Bersih</div>
            <div class="stat-value" style="color:#FFFFFF;">Rp ${Number(st.total || 0).toLocaleString('id-ID')}</div>
          </div>
        </td>
      </tr>
    </table>

    ${utangHtml}

    ${kategoriHtml}

    <!-- RINCIAN TRANSAKSI -->
    <h2 class="sec-title">Rincian Transaksi</h2>
    <p class="sec-sub">${periodeRange}</p>
    <table class="tx">
      <thead><tr><th style="width:64px;">Tanggal</th><th>Transaksi</th><th style="width:78px;text-align:right;">Masuk</th><th style="width:78px;text-align:right;">Keluar</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr>
        <td colspan="2">Total (${items.length} transaksi)</td>
        <td style="text-align:right;color:#047857;">Rp ${sumIncome.toLocaleString('id-ID')}</td>
        <td style="text-align:right;color:#B91C1C;">Rp ${sumExpense.toLocaleString('id-ID')}</td>
      </tr></tfoot>
    </table>

    ${rekomendasiTeks ? `
    <div style="margin-top:22px;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;page-break-inside:avoid;">
      <div style="background:#2D6A4F;color:#fff;padding:12px 15px;">
        <div style="font-size:11.5px;font-weight:700;">Rekomendasi AI</div>
        <div style="font-size:8.5px;opacity:0.75;margin-top:2px;">Periode ${labelPeriode} &#183; dianalisis otomatis dari pola transaksi</div>
      </div>
      <div style="padding:14px 15px;background:#FFFFFF;">
        <p style="font-size:10px;color:#334155;line-height:1.65;white-space:pre-wrap;margin:0;">${escapeHtmlServer_(rekomendasiTeks)}</p>
        <p style="font-size:8px;color:#94A3B8;margin:10px 0 0 0;font-style:italic;">Rekomendasi ini bukan pengganti nasihat keuangan profesional.</p>
      </div>
    </div>
    ` : ''}

    <div class="footer-note">
      Laporan dibuat otomatis oleh MyDuit &#8212; seluruh angka bersumber dari catatan transaksi Anda.
    </div>
  </body>
  </html>`;
}
