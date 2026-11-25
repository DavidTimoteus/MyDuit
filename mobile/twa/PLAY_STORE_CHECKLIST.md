# Google Play Store Release Checklist — MyDuit (`app.web.myduit001.twa`)

## 1. Technical & Digital Asset Links Verification
- [x] Generate release keystore (`android.keystore`) safely (keep backup in password manager, **never** commit to git). — SELESAI 25 Nov 2026 18:14 WIB: alias `myduit`, RSA 2048, validity 10000 hari, fingerprint SHA-256 `B9:F9:F9:F8:2B:FE:04:7B:7D:FB:F4:4C:9D:1D:B2:12:3E:F8:60:85:F5:21:8C:CF:86:02:36:F6:91:CA:B6:D2`. Password + base64 ada di file `MyDuit-keystore-credentials.txt` (di luar repo, mode 600) — pindahkan ke password manager + pasang 3 GitHub secrets (ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_PASSWORD), lalu hapus file itu dari VM. Keystore WAJIB di-backup ke PC — kalau hilang, app Play Store tidak bisa di-update lagi.
- [ ] Build `.aab` via `mobile/twa` (`npx @bubblewrap/cli update && npx @bubblewrap/cli build`) or GitHub Actions `.github/workflows/release-android.yml`. — MENUNGGU 3 GitHub secrets di atas.
- [ ] Copy **both** SHA-256 fingerprints into `public/.well-known/assetlinks.json`:
  1. Upload key SHA-256 (from `keytool -list -v -keystore android.keystore`) — SELESAI 25 Nov 2026 18:14 WIB (fingerprint di atas, sudah live).
  2. Google Play App Signing SHA-256 (from **Play Console → Setup → App signing**) — MENUNGGU pembuatan app di Play Console; tambahkan sebagai fingerprint kedua di entry yang sama.
- [ ] Run `npm run deploy:hosting` and confirm `https://myduit001.web.app/.well-known/assetlinks.json` returns HTTP `200` with `Content-Type: application/json`.
- [ ] Verify APK opens without a Chrome URL bar on Android device (`adb install app-release-signed.apk`).

## 2. Play Console Policy & Declarations
- [ ] **Privacy Policy URL**: `https://myduit001.web.app/privacy.html`
- [x] **Account & Data Deletion URL**: `https://myduit001.web.app/delete-account.html` — SELESAI 25 Nov 2026 18:33 WIB: halaman khusus penghapusan akun (dwi-bahasa, gaya sama dengan privacy.html) dengan 2 jalur — (A) hapus dari dalam aplikasi, (B) permintaan web yang membuka GitHub Issues terisi otomatis. In-app deletion verified at *Backup & Restore → Delete All Data / Account*.
- [ ] **Data Safety Form**:
  - Account info: *Name, Email address, User IDs* (Collected via Google Sign-In for app functionality & sync; not shared with third-party data brokers).
  - Financial info: *User-entered transactions/budgets/debts* (Encrypted in transit via HTTPS/Firestore TLS; user-initiated deletion supported).
  - Photos/Camera: *Optional receipt OCR*, processed locally on-device by default (Tesseract.js) or user-supplied Gemini API key.
  - Encryption & Deletion: Yes, encrypted in transit; Yes, users can delete data & account inside app.
- [ ] **Financial Features Declaration**: Select *"Personal expense/budget manager / bookkeeping only"* (MyDuit does not issue loans, hold funds, facilitate P2P transfers, or act as a regulated financial institution).
- [ ] **App Category**: `Finance` (`IARC` Content Rating questionnaire completed — expected **Everyone / 3+**).

## 3. Store Listing Assets
- [ ] App Icon: `512 × 512 px` PNG (`public/icons/icon-512.png`)
- [ ] Feature Graphic: `1024 × 500 px` PNG/JPG
- [ ] Phone Screenshots: at least **2–4** clear screenshots showing Transactions, Statistics, Budgets/Accounts, and Debts/PDF export.
- [ ] 7-inch & 10-inch Tablet Screenshots (recommended).

## 4. Closed Testing Requirement (Personal Developer Accounts)
For personal Play Console accounts created after November 2023:
- [ ] Create a **Closed testing** track and upload `.aab`.
- [ ] Invite at least **12 testers** who opt in and remain opted in continuously for **14 days** before applying for Production access.

