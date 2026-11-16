# RoleLeaf maintenance

This independent repository is a private release candidate. Keep it private until the owner chooses a license and authorizes publication. The package metadata is intentionally `UNLICENSED` during review.

- Keep credentials, recovery material, personal data, private exports, local configuration and signing keys out of Git, build artifacts and issue reports.
- Use synthetic fixtures for tests. Never claim live service behavior was verified based only on mocks.
- Rebuild affected installers after runtime changes; shared exporter or branding changes require Chrome, macOS and Android builds. Record actual versions and hashes in `docs/releases/current.json`.
- Preserve `TEST-ONLY` on unsigned/unnotarized desktop packages and debug APKs. Do not publish to stores or change repository visibility automatically.
- Follow `docs/releasing.md`. Validate distribution contents, application IDs, signatures, source paths and author metadata before uploading assets.
- Keep dependency licenses and required third-party notices intact.

## Demo distribution decision (2026-11-16)

The owner selected direct-download Android and unpacked Chrome demos only, with no official store submissions. Hide macOS from all demo download pages and demo release assets; preserve existing internal desktop builds. Shared runtime changes still require internal three-platform verification/builds. The source repository remains private; demo installer/page distribution does not authorize making repository history public. Use a fixed, separately protected Android demo signing key; never generate a replacement during an update.

Follow-up authorization on 2026-11-16: upload the internal and GitHub demo deliverables. Sync the private candidate source, and publish only Android/Chrome through a separate GitHub demo download repository and Pages. Do not change source repository visibility or use Sites hosting.
