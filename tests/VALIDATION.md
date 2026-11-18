# Demo validation — 2026-11-16

Candidate version: 0.5.7 / Android 0.5.7-demo.22. Android and Chrome are the only visitor-facing demo packages; no store publication. macOS is built only for internal shared-runtime verification.

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
