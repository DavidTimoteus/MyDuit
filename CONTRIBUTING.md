# Contributing to MyDuit

Thank you for considering contributing to **MyDuit**!

## Development Workflow

1. **Fork & Clone**
   ```bash
   git clone https://github.com/DavidTimoteus/MyDuit.git
   cd MyDuit
   npm install
   ```
2. **Create a Feature Branch**
   ```bash
   git checkout -b feat/your-feature-name
   ```
3. **Follow Core Architectural Contracts**
   - **Historical FX & Display Lens Only**: Display-currency changes must NEVER rewrite existing transaction nominals in Firestore. Any new financial record that stores historical conversion context must attach `kursSnapshot` cleanly within `firestore.rules` schema constraints.
   - **Single Source of Truth**: Financial collections (`transaksi`, `budget`, `pembayaranUtang`) store normalized document IDs (`kategoriId`, `akunId`, `utangId`) rather than duplicated display strings.
   - **Formatting & Currency Helpers**: Never hardcode `Rp` or locale separators in UI components. Always use helpers in `src/lib/format.js` (`formatRupiah`, `formatCurrency`, `formatNominal`, `formatInputTampil`, `parseInputTampil`).
   - **Optimistic Modals**: Close submission modals synchronously before background Firestore commits so offline-first usage stays responsive.

## Quality Gate (Required Before PR)

Every pull request must pass the full automated check suite with zero warnings or errors:

```bash
npm run check
```

This runs formatting checks, historical-FX tests, backup/account deletion tests, i18n parity tests, theme & class contract tests, event bus contract checks, ESLint, and Vite production bundling.

