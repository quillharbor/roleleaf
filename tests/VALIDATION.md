# Candidate validation

This record covers the independent 0.5.4 private review candidate. Results are recorded after each check completes; previous build results are not treated as evidence for this candidate.

## Pending checks

- Automated Node tests and generated bundle consistency.
- Chrome ZIP contents, CRC and source equality.
- macOS arm64 DMG, bundle identifier, archive and ad-hoc signature.
- Android build/lint, package identifier, signature and asset consistency.
- Candidate source and binary metadata review.

## Scope

Tests use synthetic fixtures. The originally reported long Tipsy conversation has not been retested live. Clean-device installation, account login, export and upgrade checks remain pending. No Developer ID notarization, production Android signing, or store publication is implied.
