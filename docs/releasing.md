# Release procedure

1. Review the changed platforms and bump their versions. Shared exporter changes require all three installers. Keep the root, desktop, extension and Android versions consistent.
2. Run the automated tests and build the artifacts described in [building](building.md). Verify archives, package IDs, signatures, byte sizes and SHA-256 hashes.
3. Review tracked files and artifacts for credentials, private URLs, personal author details, absolute home paths, source maps, logs and unintended files. Scan the history of the candidate repository as well as its current tree. Review binary metadata and signing identities separately.
4. Record actual validation and limits in `tests/VALIDATION.md` and `docs/releases/current.json`. Create one `SHA256SUMS` for the three files. Never rename old artifacts to imply a newer build.
5. Create a draft release in the **private** `quillharbor/roleleaf` repository and upload only the three installers and their checksum file. Read the release back and verify asset names and sizes.
6. Stop before public distribution. The owner must select a license and approve publication. Resolve the production signing and clean-device acceptance requirements before calling any package a formal release.

Never upload local signing keys, browser profiles, recovery documents, credentials, raw exports or complete local build logs. Preserve upstream licenses and dependency notices.
