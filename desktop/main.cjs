'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { attachSiteBrowser } = require('./site-browser.cjs');
require('../tipsy-exporter/bot-package.js');

const page = path.join(__dirname, 'index.html');
const demo = process.argv.includes('--demo');
const pageUrl = pathToFileURL(page);
if (demo) pageUrl.searchParams.set('demo', '1');
let window;
let outputFolder;

// Keep existing site sessions when upgrading from the old product name.
app.setPath('userData', path.join(app.getPath('appData'), 'Bot Exporter Desktop'));
app.name = 'RoleLeaf';

function authorize(event) {
  if (event.sender !== window?.webContents || event.senderFrame?.url !== pageUrl.href) {
    throw new Error('Invalid desktop request.');
  }
}

ipcMain.handle('desktop:choose-folder', async event => {
  authorize(event);
  const result = await dialog.showOpenDialog(window, {
    title: 'Choose an export folder',
    defaultPath: outputFolder || app.getPath('downloads'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled) return null;
  outputFolder = result.filePaths[0];
  return outputFolder;
});

ipcMain.handle('desktop:save-zip', async (event, filename, bytes) => {
  authorize(event);
  if (!outputFolder) throw new Error('Choose an export folder first.');
  if (typeof filename !== 'string' || !/^(tipsy|character_ai)_[^\\/:*?"<>\u0000-\u001f]+\.zip$/u.test(filename) ||
      Buffer.byteLength(filename) > 240 || !(bytes instanceof Uint8Array) ||
      bytes.length < 4 || bytes.length > 129 * 1024 * 1024 ||
      Buffer.from(bytes.subarray(0, 4)).readUInt32LE() !== 0x04034b50) {
    throw new Error('Invalid ZIP export.');
  }
  const file = path.join(outputFolder, filename);
  const handle = await fs.open(file, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(file, { force: true });
    throw error;
  }
  return file;
});

ipcMain.handle('desktop:show-folder', async event => {
  authorize(event);
  if (!outputFolder) return;
  const error = await shell.openPath(outputFolder);
  if (error) throw new Error(error);
});

const imageRequests = new Map();
ipcMain.handle('desktop:download-image', async (event, id, url) => {
  authorize(event);
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || imageRequests.size >= 2 || imageRequests.has(id)) {
    throw Error('Invalid image download request.');
  }
  const controller = new AbortController();
  imageRequests.set(id, controller);
  const timer = setTimeout(() => controller.abort(), 15000);
  try { return await globalThis.BotPackage.downloadImage(url, controller.signal); }
  finally { clearTimeout(timer); imageRequests.delete(id); }
});
ipcMain.on('desktop:cancel-image', (event, id) => {
  if (event.sender === window?.webContents && event.senderFrame?.url === pageUrl.href) imageRequests.get(id)?.abort();
});

app.whenReady().then(() => {
  window = new BrowserWindow({
    title: 'RoleLeaf', width: 1160, height: 800,
    minWidth: 830, minHeight: 620, backgroundColor: '#151821',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), sandbox: true,
      contextIsolation: true, nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  attachSiteBrowser(window, authorize);
  window.loadURL(pageUrl.href).catch(console.error);
});

app.on('window-all-closed', () => app.quit());
