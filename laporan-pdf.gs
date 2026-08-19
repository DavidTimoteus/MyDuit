/*******************************************************
 * MyDuit — laporan-pdf.gs
 * Domain: Export Laporan PDF (gaya rekening koran bank)
 * 
 * Kompatibel dengan ViewJS.html:
 * - generateLaporanPDFServer(bulan, tahun)
 *******************************************************/

function generateLaporanPDFServer(bulan, tahun) {
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

    let rekomendasiTeks = '';
    try {
      const rek = getRekomendasiKeuanganServer('bulanan', bulanNum, tahunNum);
      rekomendasiTeks = (rek && rek.rekomendasi) || '';
    } catch (e) {}

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

  const rowsHtml = items.map(function (it) {
    const isIncome = ['pemasukan', 'pendapatan'].includes(String(it.jenis).toLowerCase());
    const mainLabel = it.keterangan || it.kategori || '-';
    const nominalFmt = Number(it.nominal || 0).toLocaleString('id-ID');
    return '<tr>' +
      '<td style="white-space:nowrap;font-size:9.5px;color:#64748B;padding-top:11px;">' + escapeHtmlServer_(it.tanggal) + '</td>' +
      '<td><div style="font-size:10.5px;font-weight:600;color:#0F172A;">' + escapeHtmlServer_(mainLabel) + '</div><div style="font-size:9px;color:#94A3B8;margin-top:2px;">' + escapeHtmlServer_(it.kategori) + '</div></td>' +
      '<td style="text-align:right;font-weight:700;color:#0F172A;">' + (isIncome ? nominalFmt : '') + '</td>' +
      '<td style="text-align:right;font-weight:700;color:#0F172A;">' + (isIncome ? '' : nominalFmt) + '</td>' +
      '</tr>';
  }).join('');

  const utangHtml = utang.jumlahAktif > 0
    ? '<div style="background:#FDE8E0;border-radius:10px;padding:10px 14px;margin-bottom:18px;">' +
      '<div style="font-size:10.5px;color:#7C2D12;font-weight:600;">Total Utang Aktif: Rp ' + Number(utang.totalSisa).toLocaleString('id-ID') + ' (' + utang.jumlahAktif + ' aktif)</div>' +
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
      @page { margin: 32px 36px; }
      body { font-family: 'Helvetica', Arial, sans-serif; color: #1a1b1e; font-size: 11px; }
      .big-heading { text-align: center; font-size: 14px; font-weight: 800; color: #0F172A; margin: 30px 0 4px 0; }
      .big-heading-sub { text-align: center; font-size: 9.5px; color: #94A3B8; margin: 0 0 16px 0; }
      table.bank-summary { width: 100%; border-collapse: collapse; margin-bottom: 22px; }
      table.bank-summary th { text-align: left; padding: 8px 10px; font-size: 8.5px; color: #64748B; text-transform: uppercase; font-weight: 700; border-bottom: 1.5px solid #0F172A; }
      table.bank-summary td { padding: 11px 10px; font-size: 10.5px; color: #334155; border-bottom: 1px solid #E5E7EB; }
      table.tx { width: 100%; border-collapse: collapse; }
      table.tx th { text-align: left; padding: 9px 10px; font-size: 8.5px; color: #64748B; text-transform: uppercase; font-weight: 700; border-bottom: 1.5px solid #0F172A; }
      table.tx td { padding: 11px 10px; border-bottom: 1px solid #E5E7EB; font-size: 10px; }
      .footer-note { margin-top: 26px; padding-top: 10px; border-top: 1px solid #E2E8F0; font-size: 8.5px; color: #94A3B8; text-align: center; }
    </style>
  </head>
  <body>
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
      <tr>
        <td style="width:55%;">
          <div style="font-size:19px;font-weight:800;color:#0F172A;">MyDuit</div>
          <div style="font-size:9px;color:#94A3B8;margin-top:1px;">Catatan Keuangan Pribadi</div>
        </td>
        <td style="width:45%;text-align:right;">
          <div style="font-size:11px;color:#94A3B8;font-weight:700;text-transform:uppercase;">Laporan Keuangan</div>
          <div style="font-size:9px;color:#94A3B8;margin-top:4px;">S/N ${refNumber}</div>
          <div style="font-size:9px;color:#94A3B8;">${tanggalCetak}</div>
        </td>
      </tr>
    </table>
    <div style="border-bottom:2.5px solid #0F172A;margin-bottom:20px;"></div>

    <p class="big-heading">Ringkasan Keuangan</p>
    <p class="big-heading-sub">${periodeRange}</p>

    <table class="bank-summary">
      <thead>
        <tr><th>Periode</th><th style="text-align:right;">Pemasukan</th><th style="text-align:right;">Pengeluaran</th><th style="text-align:right;">Saldo Bersih</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${labelPeriode}</td>
          <td style="text-align:right;color:#047857;font-weight:700;">${Number(st.pemasukan || 0).toLocaleString('id-ID')}</td>
          <td style="text-align:right;color:#B91C1C;font-weight:700;">${Number(st.pengeluaran || 0).toLocaleString('id-ID')}</td>
          <td style="text-align:right;color:#0F172A;font-weight:700;">${Number(st.total || 0).toLocaleString('id-ID')}</td>
        </tr>
      </tbody>
    </table>

    ${utangHtml}

    <p class="big-heading">Rincian Transaksi</p>
    <p class="big-heading-sub">${periodeRange}</p>
    <table class="tx">
      <thead><tr><th>Tanggal</th><th>Transaksi</th><th style="text-align:right;">Masuk</th><th style="text-align:right;">Keluar</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    ${rekomendasiTeks ? `
    <div style="margin-top:26px;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;page-break-inside:avoid;">
      <div style="background:linear-gradient(135deg,#2D6A4F 0%,#1B4332 100%);color:#fff;padding:14px 16px;">
        <div style="font-size:12.5px;font-weight:700;">Rekomendasi AI</div>
        <div style="font-size:9px;opacity:0.72;margin-top:2px;">Periode ${labelPeriode}</div>
      </div>
      <div style="padding:16px;background:#fff;">
        <p style="font-size:10.5px;color:#334155;line-height:1.6;white-space:pre-wrap;">${escapeHtmlServer_(rekomendasiTeks)}</p>
        <p style="font-size:8.5px;color:#94A3B8;margin-top:12px;font-style:italic;">Dihasilkan otomatis oleh AI. Bukan pengganti nasihat profesional.</p>
      </div>
    </div>
    ` : ''}

    <div class="footer-note">
      Laporan dibuat otomatis oleh MyDuit. Seluruh angka bersumber dari catatan transaksi.
    </div>
  </body>
  </html>`;
}
