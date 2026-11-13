'use strict';

const { ipcRenderer, webFrame } = require('electron');
const site = CAPTURE_BUNDLES[location.origin];

if (site && process.isMainFrame) {
  const listeners = [];
  const chrome = { runtime: { id: 'desktop', onMessage: { addListener: listener => listeners.push(listener) } } };
  site.bridge(chrome);
  webFrame.executeJavaScript(site.page).catch(() => {});

  ipcRenderer.on('desktop:site-request', (_event, requestId, message) => {
    let responded = false;
    const respond = result => {
      if (responded) return;
      responded = true;
      ipcRenderer.send('desktop:site-response', requestId, result);
    };
    const pending = listeners.map(listener => listener(message, { id: chrome.runtime.id }, respond)).includes(true);
    if (!pending) respond({ ok: false, reason: 'unavailable' });
  });
}
