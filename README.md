# RoleLeaf Demo

English · [العربية](docs/readme/ar.md) · [日本語](docs/readme/ja.md) · [한국어](docs/readme/ko.md) · [繁體中文](docs/readme/zh-Hant.md)

Keep a local copy of your AI characters and conversations from Tipsy and Character.AI.

**Demo 0.5.9 · Android and Chrome · No app-store release.**

| Platform | Requirements | Install |
| --- | --- | --- |
| Android | Android 8+ | Download the Demo APK, allow installation from your browser when prompted, then open RoleLeaf |
| Chrome extension | Desktop Chrome 111+ | Extract the ZIP, open `chrome://extensions`, enable Developer mode and load the `tipsy-exporter` folder |

[Download the Android and Chrome demos](https://quillharbor.github.io/roleleaf-demo/). Publication and validation details are recorded in `docs/releases/demo.json`. See the [installation guide](docs/installation.md), [privacy notes](PRIVACY.md) and [validation record](tests/VALIDATION.md). The demo distribution includes only Android and Chrome. macOS remains internal and has no visitor-facing download.

## Use

RoleLeaf opens in English. On Android, tap **⋮ → Language** in the toolbar. In Chrome, use the language menu in the extension popup.

1. Sign in to a supported source site in Chrome or the Android app.
2. Open **Export** on Android or the extension in Chrome, choose Recent or My Characters, select characters and start exporting.
3. Keep the app or source tabs open. Extract the saved ZIP and open `README.html`.

Creator backups and current-conversation exports have different coverage. Missing fields and incomplete history are reported; a successful ZIP does not guarantee a complete account backup.

The 0.5.12 candidate exposes a stable `match_id` in exported ZIPs. See the [ZIP parsing rules](docs/character-id.md).

## Development

Node.js 22+ is required. Run `npm test` and `npm run package` for Chrome; see [building](docs/building.md) for other build commands. The source repository remains private and `UNLICENSED` pending the owner's open-source license decision. Demo distribution does not publish repository history or grant an open-source license. Third-party components retain their licenses in [THIRD_PARTY.md](THIRD_PARTY.md).
