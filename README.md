# MyDuit

An **offline-first** personal finance Progressive Web App (PWA) crafted with tactile **Claymorphism & Neumorphism UI**, built with **React 19, Vite, Tailwind CSS v4, and Firebase (Auth & Firestore)** — engineered for instant local logging, historical-FX currency viewing, smart receipt OCR, and clean vector PDF reporting.

- **Live Web App**: [https://myduit001.web.app](https://myduit001.web.app)
- **Privacy Policy**: [https://myduit001.web.app/privacy.html](https://myduit001.web.app/privacy.html)
- **Terms of Service**: [https://myduit001.web.app/terms.html](https://myduit001.web.app/terms.html)

---

## Key Features

- **Offline-First Cloud Sync**: Record income, expenses, transfers, budgets, and debt payments even without internet connectivity. Data persists locally in IndexedDB and syncs cleanly with Cloud Firestore when online.
- **Historical-FX Money Changer (Lens-Only Architecture)**:
  - Choose your account's base accounting currency when starting with an empty ledger (`IDR Rp`, `USD $`, or any supported world currency).
  - Switch your display & PDF export currency lens at any time without rewriting database records.
  - Every new transaction captures an immutable light `kursSnapshot` on creation so historical records retain their creation-date conversion value while new records and live account balances convert at live exchange rates.
- **Bilingual Interface (`English` & `Bahasa Indonesia`)**: Switch UI language seamlessly alongside currency lens selection with shared locale rules and Latin-safe vector PDF exports.
- **Multi-Account & Transfer Management**: Separate bank accounts, e-wallets, and cash with automatic balance updates, negative balance warnings, and per-account mutation audit logs.
- **Smart Receipt OCR**: Scan receipts via camera or upload using local on-device **Tesseract.js** OCR or optional bring-your-own **Gemini AI** Vision API key.
- **Monthly Budgets & Debt Tracking**: Set category spending limits per month, track burn rate per day, and manage payables/receivables with partial or full installment payments.
- **Vector PDF Reports & Complete Backup/Account Deletion**: Generate multi-page client-side PDF reports via **jsPDF**, export/import full JSON backups (including legacy `.xlsx` migration), or permanently wipe data and delete the Google-linked account from inside **Backup & Restore**.

---

## Multi-Platform Support

| Platform | Distribution Target | Status |
| :--- | :--- | :--- |
| **Web / Mobile PWA** | Browser & Installable PWA (`https://myduit001.web.app`) | Live (`v2.3.0`) |
| **Android (Play Store)** | Trusted Web Activity via Bubblewrap (`mobile/twa/`, `.aab` / `.apk`) | Wrapper, Checklist & Release Workflow Ready |
| **Windows Desktop** | Standalone Electron App (`desktop/`, `.exe` Setup & Portable) with Google OAuth | Wrapper & Release Workflow Ready |

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | [React 19](https://react.dev/) + [Vite 6](https://vite.dev/) + [@vite-pwa](https://vite-pwa-org.netlify.app/) |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com/) + Custom Claymorphism / Neumorphism Tokens |
| **Backend & Sync** | [Firebase Auth](https://firebase.google.com/) (Google Sign-In) + [Cloud Firestore](https://firebase.google.com/) (Persistent Multi-Tab Cache) |
| **Receipt OCR** | [Tesseract.js](https://tesseract.projectnaptha.com/) (Local) & Optional [Google Gemini API](https://ai.google.dev/) |
| **Charts & PDF** | [Chart.js](https://www.chartjs.org/), [jsPDF](https://github.com/parallax/jsPDF), [jspdf-autotable](https://github.com/simonbengtsson/jsPDF-AutoTable) |
| **Spreadsheets** | [SheetJS (xlsx)](https://sheetjs.com/) |

---

## Project Structure

```text
├── .github/workflows/          # CI verification + Windows EXE & Android TWA release workflows
├── desktop/                    # Windows Electron wrapper + OAuth loopback + installer config
├── mobile/twa/                 # Android Bubblewrap TWA manifest & Google Play submission checklist
├── public/                     # Static PWA icons, privacy.html, terms.html, .well-known/assetlinks.json
├── src/
│   ├── components/             # Shell layout, clay/neu primitives, currency onboarding & FX lens notices
│   ├── features/
│   │   ├── auth/               # Firebase Authentication gate & Google sign-in hook
│   │   ├── backup/             # JSON backup/restore, XLSX migration, full account/data deletion
│   │   ├── budget/             # Multi-account wallet cards, balance mutation log, monthly budgets
│   │   ├── laporan/            # Vector jsPDF financial report generator & export modal
│   │   ├── statistik/          # Interactive Chart.js trend charts & deterministic analytics rules
│   │   ├── transaksi/          # Transaction list, bulk actions, modal form, calculator & OCR scanner
│   │   └── utang/              # Payable/receivable tracking & installment payment flows
│   ├── lib/                    # Firestore CRUD, historical-FX rate helpers, currency/locale formatters, i18n
│   └── styles/                 # Design system CSS variables, tokens & contract tests
├── firebase.json               # Hosting headers, rewrites & named Firestore DB routing
├── firestore.rules             # Per-user security rules with schema & kursSnapshot validation
└── vite.config.js              # Vite chunks, PWA manifest & workbox offline caching
```

---

## Local Development

### 1. Prerequisites
- **Node.js 20+** and **npm**
- A Firebase project with **Google Authentication** enabled and **Cloud Firestore** created

### 2. Clone & Install
```bash
git clone https://github.com/DavidTimoteus/MyDuit.git
cd MyDuit
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env.local` and fill in your Firebase project credentials:
```bash
cp .env.example .env.local
```

```env
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_DATABASE_ID=(default)
```

> **Note**: In `.env.local`, set `VITE_FIREBASE_DATABASE_ID` to `(default)` or your named Firestore database ID matching `firebase.json`.

### 4. Run Dev Server & Quality Checks
```bash
# Start local development server at http://localhost:5173
npm run dev

# Run all 20+ automated unit/contract tests, ESLint, and production build
npm run check

# Build production bundle into dist/
npm run build
```

---

## Contributing

Contributions, bug reports, and UI/localization improvements are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a Pull Request.

---

## License

Licensed under the [MIT License](LICENSE).
