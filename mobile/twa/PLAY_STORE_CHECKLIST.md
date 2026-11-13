# Google Play Store Release Checklist — MyDuit (`app.web.myduit001.twa`)

## 1. Technical & Digital Asset Links Verification
- [ ] Generate release keystore (`android.keystore`) safely (keep backup in password manager, **never** commit to git).
- [ ] Build `.aab` via `mobile/twa` (`npx @bubblewrap/cli update && npx @bubblewrap/cli build`) or GitHub Actions `.github/workflows/release-android.yml`.
- [ ] Copy **both** SHA-256 fingerprints into `public/.well-known/assetlinks.json`:
  1. Upload key SHA-256 (from `keytool -list -v -keystore android.keystore`)
  2. Google Play App Signing SHA-256 (from **Play Console → Setup → App signing**)
- [ ] Run `npm run deploy:hosting` and confirm `https://myduit001.web.app/.well-known/assetlinks.json` returns HTTP `200` with `Content-Type: application/json`.
- [ ] Verify APK opens without a Chrome URL bar on Android device (`adb install app-release-signed.apk`).

## 2. Play Console Policy & Declarations
- [ ] **Privacy Policy URL**: `https://myduit001.web.app/privacy.html`
- [ ] **Account & Data Deletion URL**: `https://myduit001.web.app/` (in-app deletion verified at *Backup & Restore → Delete All Data / Account*).
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

