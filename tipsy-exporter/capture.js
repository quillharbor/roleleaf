(function () {
  'use strict';
  const core = globalThis.TipsyExporterCore;
  if (!core || globalThis.__tipsyExporterCaptureInstalled) return;
  globalThis.__tipsyExporterCaptureInstalled = true;
  const cache = new Map();
  const send = entry => window.postMessage({ channel: core.CHANNEL, type: 'CAPTURE', entry }, location.origin);
  function accept(payload) {
    try {
      if (!payload || payload.code !== 0) return;
      const entry = core.record(payload.data);
      const id = entry.source.character.character_id;
      cache.delete(id);
      cache.set(id, entry);
      // Only keep the last four character responses, in page memory.
      while (cache.size > 4) cache.delete(cache.keys().next().value);
      send(entry);
    } catch { /* Invalid/oversized responses never break the host page. */ }
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.channel !== core.CHANNEL || data.type !== 'REQUEST' || typeof data.characterId !== 'string') return;
    const entry = cache.get(data.characterId);
    if (entry) send(entry);
  });
  const originalFetch = window.fetch;
  async function readResponse(response) {
    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder(), pieces = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > core.MAX_BYTES) { reader.cancel().catch(() => {}); return; }
        pieces.push(decoder.decode(value, { stream: true }));
      }
      pieces.push(decoder.decode());
      accept(JSON.parse(pieces.join('')));
    } finally { reader.releaseLock(); }
  }
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
    const result = Reflect.apply(originalFetch, this, args);
    if (core.publicEndpoint(url)) {
      result.then(response => {
        if (!response.ok || !core.publicEndpoint(response.url || url)) return;
        if (Number(response.headers.get('content-length')) > core.MAX_BYTES) return;
        readResponse(response.clone()).catch(() => {});
      }).catch(() => {});
    }
    return result;
  };
  const requestUrls = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    requestUrls.set(this, String(url));
    return Reflect.apply(originalOpen, this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const url = requestUrls.get(this);
    if (core.publicEndpoint(url)) {
      this.addEventListener('load', () => {
        try {
          if (this.status < 200 || this.status >= 300 || !core.publicEndpoint(this.responseURL || url)) return;
          if (this.responseType === 'json') accept(this.response);
          else if ((!this.responseType || this.responseType === 'text') && this.responseText.length <= core.MAX_BYTES) accept(JSON.parse(this.responseText));
        } catch { /* No response body is read from other endpoints. */ }
      }, { once: true });
    }
    return Reflect.apply(originalSend, this, args);
  };
})();
