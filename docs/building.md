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
