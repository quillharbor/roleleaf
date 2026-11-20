# Demo validation — 2026-11-20

Candidate version: 0.5.16 / Android 0.5.16-demo.37. Android and Chrome are the only visitor-facing demo packages; no store publication. macOS is built only for internal shared-runtime verification.

- 67 Node tests passed, including synthetic C.AI Recent/My Characters and Tipsy creator-list cases, creator backup boundaries and chat history handling.
- Chrome ZIP CRC passed; manifest version 0.5.7; unpacked folder and packaged source verified.
- Android assembleRelease and lintRelease passed. APK v2 signature, application ID, versionCode 22 and non-debuggable status verified. Fixed demo signer; separate app ID from older private debug builds.
- Internal macOS arm64 DMG build verifies DMG integrity, ASAR, version, architecture and ad-hoc code signature; no public desktop download.
- Current candidate source and Android/Chrome payloads scanned for known identity markers and previously removed character identifiers: no matches.
- Download-page English/Chinese switching, Chrome address copy and 390px mobile layout checked; no horizontal overflow.

Live source-account exports in the new signed demo have not been re-verified. Prior live results from another app ID are not treated as acceptance for this package. Developer verification registration has not been completed. Same-version reinstall does not prove a future higher-version upgrade; preserve the fixed key and increment versionCode for updates.

Actual artifacts, hashes, installation checks and publication status are recorded in docs/releases/current.json and docs/releases/demo.json. Do not treat a planned URL as a live download.

Publication: the Android/Chrome download page and demo prerelease are live. Anonymous downloads matched both package SHA-256 values; the QR SVG matched the locally generated one. The page was viewed in the browser with both platforms and no macOS download. Live account and physical installation acceptance limits above remain unchanged.

## 0.5.8 language support

English, Arabic, Japanese, Korean, and Traditional Chinese. English is the default. Chrome popup and download page language switching, Arabic RTL, download links and a 390 px layout passed in Chromium. Both builds passed 69 Node tests. Android assembly, lint, APK signing/CRC and source-to-package checks passed. The signed Demo installed on the emulator. The 0.5.8 release has not been tested against live source accounts. The public APK and Chrome ZIP downloaded anonymously through GitHub Pages with matching SHA-256 hashes.

## Android toolbar .24

Both Android builds passed 69 Node tests, assembly, lint, and signature verification. The signer matched the previous package for each channel. The internal build upgraded over .23 on the USB phone. The top-bar overflow displayed Open ZIP and opened the five-language picker. Public Pages files and package hashes were verified using anonymous downloads. This Android-only update retains the existing Chrome and macOS builds.

## Tipsy history and retry in 0.5.9

73 automated tests passed. After a simulated virtual list remount, pagination recovered records 1–16 from an initial page of records 17–26. No-request and in-flight timeout cases keep the available history and report distinct outcomes. Chrome batch retries only the selected partial row. A failed retry preserves the prior saved result. The original live conversation has not been retested.

## Private review 0.5.12

77 automated tests passed. Synthetic exports verify stable match IDs across repeated exports and both export modes. Synthetic Tipsy cases verify history recovery and visible missing sequence ranges. The candidate ZIP, arm64 DMG and debug APK were rebuilt, and their archives, bundled exporter and available signatures were checked. Candidate live-account export and clean-device installation remain pending.

## 0.5.13 Tipsy source gaps

78 automated tests passed. Captured Tipsy responses spanning every missing sequence range produce a saved result with the gap notice and no retry button. Cursor jumps without evidence, capture errors and incomplete pagination remain partial. The ZIP report retains sequence gaps and marks full mainline coverage as false. The three packages were built and verified; live-account and clean-device acceptance for this revision are pending.

## 0.5.13 Chrome package layout

85 automated tests passed. The Chrome ZIP now always contains an `exporter/` entry with 29 runtime files and no `tipsy-exporter/` archive prefix. Documentation and localized install guides use the same folder name. The refreshed public Demo ZIP, GitHub Release asset and Pages checksum matched after publication.

## 0.5.14 creator source IDs

85 automated tests passed. Synthetic Character.AI and Tipsy creator exports now contain the same non-empty source ID in `manifest.json` `bot_id` and `character/character.json` `id`; ordinary conversation packages retain their existing name-only character file and `match_id` matching. The Chrome ZIP contains 29 files under `exporter/`, passes CRC and identity scans, and was verified from its packaged runtime. The macOS and Android builds were not rebuilt because the required signing identity and Android toolchain were unavailable. Live-account import remains pending.

## 0.5.15 image assets and import acceptance

111 automated tests passed. The suite checks ordinary links and file attachments, signed image references, Character.AI portrait and cover fallback, and ZIPs whose optional images exceed the size limit. It also simulates a Chrome message-channel closure during Tipsy creator navigation and Character.AI chat exports with verified history and missing character details. Verified the Chrome ZIP under `exporter/`, the internal arm64 test DMG, the fixed-signature Android Demo APK and three synthetic export ZIPs for the same character. Archive scans found none of the known internal or personal identity markers or private-key blocks. The macOS installer uses ad-hoc signing. Android `0.5.15-demo.31` passed `assembleRelease`, `lintRelease`, APK v2 signature verification and shared-runtime file comparison. Its certificate matches the existing public Demo signer, and `versionCode` increased from 29 to 31. The demo site packager rejects mixed base versions unless the record explicitly marks an older Android package as retained.

Run `node scripts/sample-image-ref.cjs` to regenerate the creator, chat, and missing-image ZIPs in `dist/`. Import the creator sample and then the chat sample to exercise matching by `match_id`. Read images from the paths in `assets/assets.json`. The missing-image sample keeps its message and reports one expected image (`image_attachment_count`) with no matching asset, so the importer can display a placeholder. The same import can be run in isolation to test the importer's behavior when the corresponding character is absent.

The automated decryption test uses a synthetic key pair. The test samples use the configured public key, so decryption with the server's private key must be confirmed by the importer owner. Android fixed-signature assembly and upgrade, on-device testing, fresh source-account export, and target import remain pending. Production macOS distribution requires a Developer ID identity and notarization.

## Android export responsiveness

115 automated tests passed. Android list avatars now load directly from the approved media hosts and fall back to the native proxy only on error; unchanged polling results no longer rebuild the list. Image downloads use at most two concurrent workers, already validated PNG bytes skip a redundant decode, and image references keep the same stable ID and JWE format. ZIP assembly yields between files and Android transfers image and ZIP data in 512 KiB chunks instead of 128 KiB chunks.

Synthetic measurements reduced 30 image downloads from about 667 ms to 343 ms while preserving asset order and deduplication. A 10 MiB synthetic archive produced the same ZIP bytes; bridge calls fell from 80 to 20. Chrome `0.5.15`, arm64 macOS `0.5.15` test DMG, Android `0.5.15-demo.33` test APK and the fixed-signature Demo APK were rebuilt and checked. The emitted APK contains the updated assets, and the Demo certificate still matches the existing signer. No Android device or emulator was attached, so installation, upgrade and live-account latency remain unverified.

## Android login persistence and OAuth popups

Android `0.5.16-demo.37` enables persistent cookies, DOM and database storage for source pages, permits third-party cookies required by sign-in flows, flushes cookies on pause and stop, and mirrors the desktop popup policy: allowlisted auth pages may open even when Firebase requests the window after an async step, nested popups are stacked, and `about:blank` bootstrap frames are permitted. The debug test application ID is `io.github.quillharbor.roleleaf.demo.test`; the Demo remains `io.github.quillharbor.roleleaf.demo`. This prevents a test-channel switch from forcing an uninstall and deleting WebView login state.

Both APKs passed the 115-test suite, debug/release assembly and lint. The Demo certificate still matches `9ee94ddc…82855f`, and versionCode increased to 37. Live Google/Apple login persistence and Character.AI access on the reporting device remain unverified. A Cloudflare network-reputation block is not an allowlist failure and cannot be bypassed by the app.
