# RoleLeaf for Chrome

RoleLeaf exports character cards, images, and the current chat from Tipsy and Character.AI. Each character gets a separate ZIP.

## Install or update

Use Chrome 111 or later. Unzip the download, open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**. Choose the `tipsy-exporter` folder that contains `manifest.json`.

To update, replace the files in the existing extension folder, click **Reload** on the extensions page, and refresh the source chat. Version 0.5.2 keeps earlier pages when the site repeats the latest page and triggers loading again when a virtual chat list is already at its oldest visible message.

Confirm that Chrome shows **RoleLeaf 0.5.4**. The current package is named `RoleLeaf-0.5.4.zip`; the folder to load is still `tipsy-exporter`. Unpacking into a different folder alone does not update the extension already loaded in Chrome.

## Export

1. Sign in on the source site, open a chat, and wait for the sidebar to load. Open RoleLeaf. It selects the current character by default.
2. Search by name or ID and choose characters. **Select all results** applies to the current search.
3. Wait for the character to finish replying, then start the export. Keep the source chat and export tab open and pause chat activity. RoleLeaf opens temporary tabs to reload Tipsy chats and to collect other Character.AI chats.
4. Choose a save location for a single current character. Batch exports are saved under `RoleLeaf/` in Chrome downloads. You can stop the queue and retry failed or skipped items.
5. Unzip a package and open `README.html`. It includes character fields, chat coverage, and missing content. The ZIP also contains JSON, a text transcript, available images, and character cards.

## Coverage

RoleLeaf exports the current chat and the reply candidates the site returned. Saved chats, archives, and earlier regenerated, edited, or deleted replies may be missing. When the selected reply is unknown, consult the JSON. Missing character fields remain empty.

RoleLeaf processes the first 100 images, with a 16 MB limit per image and 64 MB total. Supported formats are PNG, JPEG, GIF, and WebP. Audio and video remain references. Chat collection stops at 10,000 messages, 32 MB, or 10 minutes. It also stops after 20 seconds without a new page. Each ZIP is limited to 128 MB.

RoleLeaf reads supported chat and character responses from pages on Tipsy and Character.AI. It uses Chrome downloads to save ZIPs and extension storage to pass the character selection to the export tab. Image requests to `img.tipsy.chat` and `characterai.io` omit credentials. Exported content stays on your device.

## Troubleshooting

- If a character is missing, open or scroll the chat sidebar on the source site, then refresh the list.
- If RoleLeaf cannot read the chat, reload the extension and refresh the source page. Check that you are signed in and that no prompt is blocking the chat.
- If a multi-page Tipsy export is missing messages after scrolling to the first message, update to 0.5.4, reload the extension, refresh Tipsy, and export again. You do not need to scroll manually first. Messages are collected from history responses; reaching the first visible message does not by itself prove that all pages were captured.
- If messages changed during export, leave the chat open and try again.
- If a file is missing, check the save dialog and Chrome downloads. If the export is partial, check the report in the ZIP.

For Tipsy, `conversations/…/messages.json` includes a `completeness` object. `complete_current_mainline: true` requires the latest page, the retained thread's starting point, no sequence gaps, and no capture error. If it is false, review `error`, `sequence_gaps`, and the captured sequence range before treating the export as complete.

The 0.5.2 pagination fix passed 63 automated checks on November 12, 2026, including synthetic virtual-list and repeated-page cases. The user's reported Tipsy conversation has not yet been verified live. A saved ZIP alone is not evidence of complete history.
