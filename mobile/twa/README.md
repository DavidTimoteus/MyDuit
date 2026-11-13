# MyDuit Android TWA (`mobile/twa/`)

Trusted Web Activity (TWA) configuration using **Bubblewrap** to package `https://myduit001.web.app` as an Android **`.aab` (Play Store)** and **`.apk` (sideload testing)** while keeping Google Sign-In (`Chrome Custom Tabs`), offline Firestore IndexedDB cache, and camera receipt scanning intact.

## Prerequisites
- **JDK 17** (`java`, `keytool`)
- **Android SDK** (`platform-tools`, `build-tools;34.0.0`, `platforms;android-34`)
- Node.js 20+ & `@bubblewrap/cli`

## Build `.aab` & `.apk` Locally

From `mobile/twa/`:

```bash
# 1. Generate release keystore (ONE TIME — store passwords safely, never commit android.keystore)
keytool -genkeypair -v -keystore android.keystore -alias myduit -keyalg RSA -keysize 2048 -validity 10000

# 2. Extract SHA-256 fingerprint for Digital Asset Links
keytool -list -v -keystore android.keystore -alias myduit

# 3. Generate/update Android Gradle project from twa-manifest.json
npx @bubblewrap/cli update

# 4. Build signed .apk & .aab
npx @bubblewrap/cli build
```

> **IMPORTANT (Fullscreen TWA Without Browser Bar):**
> Copy the `SHA-256` fingerprint from step 2 **AND** the **App signing key certificate SHA-256** provided by Google Play Console (*Setup → App signing*) into [`public/.well-known/assetlinks.json`](../../public/.well-known/assetlinks.json), then run `npm run deploy:hosting` from the repo root.

