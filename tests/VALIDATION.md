# Candidate validation

This record covers the independent 0.5.4 private review candidate. Results are recorded after each check completes; previous build results are not treated as evidence for this candidate.

## Completed on 2026-11-13

- 58 Node tests passed, covering pagination, runtime bridges, archive contents, desktop release gates and Android batch behavior.
- Chrome ZIP: all 24 files match the candidate source byte for byte; CRC passed.
- macOS arm64 DMG: integrity, application architecture, ASAR contents and local signature checks passed. The 28 ASAR files were reviewed; runtime files match source. Bundle ID is `io.github.quillharbor.roleleaf`; signature is ad-hoc with no Apple Team ID.
- Android: `assembleDebug` and `lintDebug` passed. APK CRC and v2 signature verification passed. All 10 shared assets, mobile assets and project logo match source. Package is `io.github.quillharbor.roleleaf.test`, version code 15. A fresh per-checkout debug key was used.
- Candidate source and application-payload scans found no configured internal identity markers or personal home paths. PNG assets contain no textual or EXIF metadata. This is a scoped metadata check, not a guarantee of anonymity.
- The repository starts with independent history, using the `quillharbor` GitHub noreply identity. No private source history, account records, local dependency links or signing keys are tracked.

Artifact sizes and hashes are recorded in `docs/releases/current.json`.

## Scope

Tests use synthetic fixtures. The originally reported long Tipsy conversation has not been retested live. Clean-device installation, account login, export and upgrade checks remain pending. No Developer ID notarization, production Android signing, or store publication is implied.
