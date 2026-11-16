# Try RoleLeaf Demo

The demo is downloaded directly. No official app-store installation is offered.

## Android

1. Open the download page in your phone browser, or scan its Android QR code using your phone camera. Download the file ending in `.apk`.
2. Open the completed download. If Android asks, allow **this browser** to install unknown apps, then return to the installer and confirm installation. Manufacturer wording varies. If an in-app browser blocks the download, open the page in your system browser.
3. Open RoleLeaf, sign in to Tipsy or Character.AI, then use Batch Export. Keep Android System WebView updated and the app in the foreground while exporting.

Android 8 or later is required. This is a Demo, not a Google Play release. The dedicated demo application ID is `io.github.quillharbor.roleleaf.demo`. It installs separately from earlier private test builds; sessions do not migrate automatically. Later demos must keep the same signing key and application ID and use a higher versionCode so they can update in place. Do not uninstall the demo just to update it.

The device still requires installation confirmation. A QR code cannot bypass system security checks; support varies with device policy, region and developer-verification requirements.

## Chrome on a computer

1. Download the Chrome ZIP and **extract it** to a permanent folder such as Documents/RoleLeaf. Do not select the ZIP itself.
2. Paste `chrome://extensions` in Chrome's address bar and turn on **Developer mode** at the top right.
3. Choose **Load unpacked** and select the extracted **tipsy-exporter** folder containing `manifest.json`. Confirm that the version on the RoleLeaf card matches the ZIP you downloaded, then pin RoleLeaf from the puzzle-piece Extensions menu.
4. Open or refresh Tipsy or Character.AI, sign in, then click RoleLeaf. Keep the source and export tabs open until export completes.

Chrome for Android does not support this desktop extension; use the Android demo instead. An administrator-managed browser may prohibit Developer mode.

### Update the local extension

Extract the new ZIP and copy its contents into the same `tipsy-exporter` folder that Chrome loaded. At `chrome://extensions`, click **Reload** on the RoleLeaf card and confirm that the displayed version matches the new ZIP. Then refresh your Tipsy or Character.AI tab. The reload button reads files from the original folder. Keep that folder in its original location.

## Troubleshooting

- “Manifest missing”: select the inner `tipsy-exporter` folder, not the ZIP or its outer folder.
- No characters: verify you are signed in to the correct source account. On Android, entering Recent or My Characters requests the list automatically; site failures or expired sessions can still prevent loading.
- Partial export: in Chrome, Tipsy may save only the latest page when the site does not request earlier messages. You can retry the character from the batch results and check the coverage report in the ZIP for missing history.
- Send only the platform, version and redacted error when reporting a problem. Never share credentials or private exports.
