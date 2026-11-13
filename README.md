# RoleLeaf

Keep a local copy of your AI characters and conversations.

RoleLeaf exports character profiles, images and the current conversation from Tipsy and Character.AI. Each character gets a ZIP with JSON, readable text, and an offline HTML viewer. Missing fields and incomplete history are reported rather than invented.

**Private review candidate · 0.5.4 · License pending.** This repository is not yet an open-source release. Desktop and Android packages are development test builds.

| Platform | Requirements | Install |
| --- | --- | --- |
| Chrome extension | Chrome 111+ | Unpack the ZIP and load `tipsy-exporter/` in Developer mode |
| macOS desktop | macOS 13+, Apple Silicon for the reviewed DMG | Open the test DMG and drag RoleLeaf to Applications |
| Android | Android 8+ | Install the test APK; keep Android System WebView current |

See the [installation guide](docs/installation.md), [privacy notes](PRIVACY.md) and [validation record](tests/VALIDATION.md). Candidate downloads will be attached to this repository's private release after verification.

## Use

1. Sign in to a supported site and open a character chat.
2. Select characters and start the export. Keep the app open until it finishes.
3. Extract a saved ZIP and open `README.html`.

The export covers the current conversation. Other saved chats, deleted or edited history, and older regenerated candidates may be unavailable. A successful ZIP does not imply a complete account backup. Review the completeness information in the export.

## Develop

Node.js 22+ is required. Extension builds and automated tests have no npm runtime dependencies.

```sh
npm run build
npm test
npm run package
```

For desktop development, run `npm ci --prefix desktop`, then `npm run desktop:start`. For installer builds, see [building](docs/building.md). Contributions and issue reports should follow [CONTRIBUTING.md](CONTRIBUTING.md).

## License

The project owner has not selected a license. Keep this candidate private; no open-source license is granted yet. Existing third-party components retain their own licenses; see [THIRD_PARTY.md](THIRD_PARTY.md).
