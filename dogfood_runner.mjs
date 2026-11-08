import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT_DIR = 'C:\\Users\\dtimo\\.gemini\\antigravity\\brain\\945a7031-608a-46d9-b654-f708ce8ed2d0\\screenshots';

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function closeModal(page) {
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label*="Tutup" i], button[aria-label*="Batal" i], button[aria-label*="Close" i]');
    if (btn) btn.click();
    else {
      const backdrop = document.querySelector('.modal-backdrop-wrap, div[class*="fixed inset-0 z-"]');
      if (backdrop) backdrop.click();
    }
  });
  await page.waitForFunction(() => !document.querySelector('.clay-sheet, form[class*="neu-card"]'), { timeout: 3000 }).catch(() => {});
  await sleep(300);
}

async function run() {
  console.log('Launching Chrome for Visual QA Dogfooding...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(`Console Error: ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    errors.push(`Page Error: ${err.message}`);
  });

  // 1. Auth / Login Screen (Unauthenticated)
  console.log('1. Capturing Auth / Login Screen...');
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.removeItem('myduit:mock_user');
    localStorage.setItem('myduit:mock_unauth', '1');
    localStorage.setItem('myduit:theme', 'neumorphism');
  });
  await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
  await sleep(1200); // Wait for React to mount & Splash to fade
  await page.waitForFunction(() => !document.getElementById('splashScreen'), { timeout: 6000 });
  await sleep(400);
  await page.screenshot({ path: path.join(OUT_DIR, '01_auth_screen_login.png') });

  // 2. Set Mock User & Enter Main App
  console.log('2. Entering Authenticated App as Mock User...');
  await page.evaluate(() => {
    localStorage.removeItem('myduit:mock_unauth');
    localStorage.setItem('myduit:mock_user', '1');
    localStorage.setItem('myduit:theme', 'neumorphism');
  });
  await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
  await sleep(800);
  await page.waitForFunction(() => !document.getElementById('splashScreen'), { timeout: 6000 });
  await sleep(600);

  // Desktop Transaksi View
  console.log('3. Capturing Transaksi View (Desktop)...');
  await page.screenshot({ path: path.join(OUT_DIR, '02_transaksi_desktop.png') });

  // Mobile Transaksi View
  console.log('4. Capturing Transaksi View (Mobile)...');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await sleep(600);
  await page.screenshot({ path: path.join(OUT_DIR, '03_transaksi_mobile.png') });

  // Return to Desktop
  await page.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false });
  await sleep(600);

  // 5. Modal Catat Transaksi
  console.log('5. Capturing Modal Catat Transaksi...');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('myduit:aksi-cepat', { detail: { type: 'pengeluaran' } }));
  });
  await page.waitForFunction(() => document.querySelector('.clay-sheet'), { timeout: 4000 });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT_DIR, '04_modal_catat_transaksi.png') });

  // 5b. Buka Drawer OCR Engine
  console.log('5b. Capturing Modal Catat Transaksi (OCR Engine Drawer)...');
  await page.evaluate(() => {
    const configBtn = Array.from(document.querySelectorAll('button')).find(el => el.title?.includes('OCR') || el.getAttribute('aria-label')?.includes('OCR'));
    if (configBtn) configBtn.click();
  });
  await sleep(400);
  await page.screenshot({ path: path.join(OUT_DIR, '04b_modal_catat_ocr_drawer.png') });
  await closeModal(page);

  // 6. Modal Pindah Saldo
  console.log('6. Capturing Modal Pindah Saldo...');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('myduit:aksi-cepat', { detail: { type: 'pindah-saldo' } }));
  });
  await page.waitForFunction(() => document.querySelector('.clay-sheet'), { timeout: 4000 });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT_DIR, '05_modal_pindah_saldo.png') });
  await closeModal(page);

  // 7. Modal Filter Transaksi
  console.log('7. Capturing Modal Filter Transaksi...');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('myduit:buka-filter'));
  });
  await page.waitForFunction(() => document.querySelector('.clay-sheet'), { timeout: 4000 });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT_DIR, '06_modal_filter_transaksi.png') });
  await closeModal(page);

  // 8. Tab Statistik
  console.log('8. Capturing Tab Statistik (Desktop)...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.sidebar-nav-btn, nav button'));
    const b = btns.find(el => el.textContent.includes('Statistik'));
    if (b) b.click();
  });
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT_DIR, '07_tab_statistik_desktop.png') });

  // 9. Tab Budget (Rekening Subtab)
  console.log('9. Capturing Tab Budget - Rekening (Desktop)...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.sidebar-nav-btn, nav button'));
    const b = btns.find(el => el.textContent.includes('Budget'));
    if (b) b.click();
  });
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT_DIR, '08_tab_budget_rekening.png') });

  // 10. Modal Tambah Rekening (while on Rekening subtab)
  console.log('10. Capturing Modal Tambah Rekening...');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('myduit:rekening-add'));
  });
  await page.waitForFunction(() => document.querySelector('.clay-sheet'), { timeout: 4000 });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT_DIR, '10_modal_tambah_rekening.png') });
  await closeModal(page);

  // 11. Switch Subtab to Budget (Alokasi)
  console.log('11. Switching to Alokasi Budget Subtab...');
  await page.evaluate(() => {
    const toggleBtns = Array.from(document.querySelectorAll('.clay-segment-item'));
    const b = toggleBtns.find(el => el.textContent.includes('Budget'));
    if (b) b.click();
  });
  await sleep(1000);
  await page.screenshot({ path: path.join(OUT_DIR, '09_tab_budget_alokasi.png') });

  // 12. Modal Tambah Budget (while on Budget subtab)
  console.log('12. Capturing Modal Tambah Budget...');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('myduit:budget-add-budget'));
  });
  await page.waitForFunction(() => document.querySelector('.clay-sheet'), { timeout: 4000 });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT_DIR, '11_modal_tambah_budget.png') });
  await closeModal(page);

  // 13. Tab Utang
  console.log('13. Capturing Tab Utang (Desktop & Mobile)...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.sidebar-nav-btn, nav button'));
    const b = btns.find(el => el.textContent.includes('Utang'));
    if (b) b.click();
  });
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT_DIR, '12_tab_utang_desktop.png') });

  // Mobile Utang View
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await sleep(600);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('nav button'));
    const b = btns.find(el => el.textContent.includes('Utang'));
    if (b) b.click();
  });
  await sleep(800);
  await page.screenshot({ path: path.join(OUT_DIR, '12b_tab_utang_mobile.png') });
  await page.setViewport({ width: 1440, height: 900, isMobile: false, hasTouch: false });
  await sleep(600);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.sidebar-nav-btn, nav button'));
    const b = btns.find(el => el.textContent.includes('Utang'));
    if (b) b.click();
  });
  await sleep(600);

  // 14. Modal Tambah Utang
  console.log('14. Capturing Modal Tambah Utang...');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('myduit:utang-add', { detail: { mode: 'utang' } }));
  });
  await page.waitForFunction(() => document.querySelector('form[class*="neu-card"], .clay-sheet'), { timeout: 4000 });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT_DIR, '13_modal_tambah_utang.png') });
  await closeModal(page);

  // 14b. Modal Bayar Utang
  console.log('14b. Capturing Modal Bayar Utang...');
  await page.evaluate(() => {
    const bayarBtn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === 'Bayar');
    if (bayarBtn) bayarBtn.click();
  });
  await page.waitForFunction(() => document.querySelector('form[class*="neu-card"], .clay-sheet'), { timeout: 4000 });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT_DIR, '13b_modal_bayar_utang.png') });
  await closeModal(page);

  // 15. Modal Export PDF
  console.log('15. Capturing Modal Export PDF...');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('myduit:export-pdf'));
  });
  await page.waitForFunction(() => document.querySelector('.clay-sheet, .neu-card'), { timeout: 4000 });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT_DIR, '14_modal_export_pdf.png') });
  await closeModal(page);

  // 16. User Settings / Lokasi Modal
  console.log('16. Capturing User Profile / Lokasi Modal...');
  await page.evaluate(() => {
    const avatarBtn = document.querySelector('button[title*="lokasi"], button[aria-label*="lokasi"]');
    if (avatarBtn) avatarBtn.click();
  });
  await page.waitForFunction(() => document.querySelector('.clay-sheet, .neu-card'), { timeout: 4000 });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT_DIR, '15_modal_user_settings.png') });
  await closeModal(page);

  // 17. Switch to Claymorphism (Dual Theme Verification on Transaksi View)
  console.log('17. Toggling to Claymorphism (Legacy Style)...');
  await page.evaluate(() => {
    // Navigate back to Transaksi tab
    const btns = Array.from(document.querySelectorAll('.sidebar-nav-btn, nav button'));
    const b = btns.find(el => el.textContent.includes('Transaksi'));
    if (b) b.click();

    // Toggle theme to Claymorphism
    document.documentElement.setAttribute('data-theme', 'claymorphism');
    localStorage.setItem('myduit:theme', 'claymorphism');
    window.dispatchEvent(new CustomEvent('myduit:theme-update', { detail: { tema: 'claymorphism' } }));
  });
  await sleep(1000);
  await page.screenshot({ path: path.join(OUT_DIR, '16_theme_claymorphism_desktop.png') });

  await browser.close();
  console.log('ALL 16 SCREENSHOTS CAPTURED SUCCESSFULLY!');
  console.log('Errors caught during session:', errors.length);
  errors.forEach(e => console.log('  !', e));
}

run().catch(err => {
  console.error('QA Runner failed:', err);
  process.exit(1);
});
