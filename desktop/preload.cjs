'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  chooseFolder: () => ipcRenderer.invoke('desktop:choose-folder'),
  saveZip: (filename, bytes) => ipcRenderer.invoke('desktop:save-zip', filename, bytes),
  showFolder: () => ipcRenderer.invoke('desktop:show-folder'),
  siteSwitch: platform => ipcRenderer.invoke('desktop:site-switch', platform),
  siteNavigation: (action, value) => ipcRenderer.invoke('desktop:site-navigation', action, value),
  siteCurrent: () => ipcRenderer.invoke('desktop:site-current'),
  siteTab: id => ipcRenderer.invoke('desktop:site-tab', id),
  siteWorker: url => ipcRenderer.invoke('desktop:site-worker', url),
  siteClose: id => ipcRenderer.invoke('desktop:site-close', id),
  siteRequest: (id, message) => ipcRenderer.invoke('desktop:site-request', id, message),
  onSiteState: callback => { ipcRenderer.on('desktop:site-state', (_event, state) => callback(state)); },
  onSiteNotice: callback => { ipcRenderer.on('desktop:site-notice', (_event, notice) => callback(notice)); },
  onSiteAuthFallback: callback => { ipcRenderer.on('desktop:site-auth-fallback', (_event, notice) => callback(notice)); },
  downloadImage: (id, url) => ipcRenderer.invoke('desktop:download-image', id, url),
  cancelImage: id => ipcRenderer.send('desktop:cancel-image', id),
});
