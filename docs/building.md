# Build from source

Use Node.js 22 or later. Run all commands from the repository root.

## Chrome

```sh
npm run build
npm test
npm run package
```

The ZIP is written to `dist/`. Load `tipsy-exporter/` unpacked when developing.

## macOS

On a Mac, install the locked dependencies:

```sh
npm ci
npm ci --prefix desktop
npm run package:desktop:test -- --arch arm64 --local-electron
```

The test release script validates the DMG, architecture, ASAR contents and local signature before producing a release directory under `desktop/release/`. `--local-electron` requires the build architecture to match the host. Remove it when building for another architecture. Cross-architecture support must be tested before it is advertised.

A formal release requires a valid Developer ID identity in the macOS Keychain, `CSC_NAME` and an `APPLE_KEYCHAIN_PROFILE` configured using Apple's `notarytool`. Use `npm run desktop:check-release` before `npm run package:desktop:release`. Certificate identities are visible in signed artifacts; select the intended publisher before signing. Never store credentials in the repository.

## Android

Install JDK 17 and Android SDK Platform 35. Set `ANDROID_HOME` to the SDK location, or create an ignored `android/local.properties` with `sdk.dir` pointing to your SDK.

```sh
npm run package:android:test
```

The Gradle Wrapper runs `assembleDebug` and `lintDebug`. A per-checkout debug key is generated in ignored `android/.signing/`; it is for development only. Output and checksums are under `android/release/`. `-- --offline` may be used after all required dependencies are cached.

## Verify

Compare the APK package/version/signature, DMG bundle identifier and archive, and ZIP files with the source tree. Keep real accounts and private conversation exports outside the repository. See [validation](../tests/VALIDATION.md) for the current review boundary.

## Fixed-signature Android demo

Run `npm run package:android:demo -- --offline` with `ROLELEAF_DEMO_KEYSTORE` pointing to the existing PKCS12 file and `ROLELEAF_DEMO_STORE_PASSWORD` provided securely through the environment. The key alias is `roleleaf-demo`. The release variant is non-debuggable but is still a Demo, not a store release. Never commit or upload key material or passwords. Keep a protected backup of the fixed identity; a lost key prevents in-place updates. The builder fails if the identity is missing and never regenerates it.

The dedicated demo application ID differs from historical private test builds. To test upgrades, install the current demo with `adb install -r` and verify application ID, increasing versionCode and identical certificate fingerprint.

`npm run package:demo-site` creates the Android/Chrome-only static download bundle from `site/` and the recorded artifacts. It validates their SHA-256 and refuses missing or mismatched packages. macOS stays out of this bundle.

GitHub hosting now uses branch publication of the standalone `docs/` directory. `demo-hosting/deployment/prepare-pages.py` verifies packages and generates the QR using the real `DEMO_PAGES_URL`; the optional Actions workflow is an inactive example.
