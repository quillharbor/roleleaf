# RoleLeaf demo download hosting

This standalone directory contains only the download page, Android demo APK, unpacked Chrome ZIP and checksums. No macOS installer, signing keys or application repository history is included.

## GitHub Pages

Use a separate download repository and keep the application source repository private. Pages publishes `docs/` from `main`. Before each push, set `DEMO_PAGES_URL` to the actual URL returned by GitHub Pages and run `python3 deployment/prepare-pages.py --site docs` (requires qrcode 8.2). The script validates package hashes and generates a matching Android QR. Do not guess a live address.

The optional Actions example under `deployment/` is not active. Branch publishing does not require permission to upload GitHub Actions workflow files. A push to the configured branch publishes the reviewed page; it does not submit to an app store.

## Local preview

Run `python3 -m http.server 8765 --directory docs`. A newly generated bundle hides the QR until a real Pages URL is configured. Both package links work locally.

## Updates

Generate the reviewed bundle from the private checkout with `npm run package:demo-site`, replace the download repository's `docs/` directory, regenerate the QR using its existing URL, commit and push. Verify the resulting page and both downloaded hashes without signing in. Keep Android package ID and signing key unchanged and increase versionCode. Preserve old packages privately.
