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
