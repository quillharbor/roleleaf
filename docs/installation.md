# Install RoleLeaf

Use the three artifacts from the same candidate release and compare their hashes with `SHA256SUMS`.

## Chrome

1. Extract `RoleLeaf-0.5.4.zip`.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the extracted `tipsy-exporter/` directory. Check that the extension displays version 0.5.4.

After an update, reload the extension and refresh the source site's chat page. Do not scroll manually to the first message; let the exporter collect pages and report any gaps.

## macOS

The reviewed DMG targets **macOS 13+ on Apple Silicon**. Open `RoleLeaf-TEST-ONLY-0.5.4-arm64.dmg` and drag RoleLeaf to Applications. It is a development build with ad-hoc signing, not a Developer ID signed or notarized release. Gatekeeper may prevent opening it; use a local source build or wait for a signed release if needed.

This candidate uses a new application identifier. Existing app sessions and saved settings are not migrated automatically; exported ZIPs remain ordinary files. Windows, Linux and Intel installers are not included in this review.

## Android

Install `RoleLeaf-TEST-ONLY-0.5.4-android.15.apk` on Android 8 or later. Allow installation from the file manager only if prompted and if you trust this test build. Keep System WebView updated and keep RoleLeaf in the foreground while exporting.

This candidate has its own application ID and debug signing key. It installs separately from builds with another ID. Future debug builds signed with a different key may require uninstalling the prior test app, which deletes that app's local sessions.

## Troubleshooting

Sign in to the source site, open the intended conversation, refresh the character list and retry. A partial-history warning is meaningful: retain the available export and report the platform, version and error message. Do not post account credentials, private chat contents, HAR files or unredacted screenshots.
