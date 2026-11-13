(function () {
  'use strict';
  const core = globalThis.TipsyExporterCore, chat = globalThis.TipsyExporterChat;
  if (!chat || globalThis.__tipsyChatCaptureInstalled) return;
  globalThis.__tipsyChatCaptureInstalled = true;
  let history = new chat.History(core.roleId(location.href)), running = false, job = 0, ticket = 0, latestTicket = 0, listTicket = 0;
  let latestPage = null;
  let notice = 'Waiting for chat history. Refresh Tipsy after updating RoleLeaf.';
  function stop(message) { running = false; job++; if (message) notice = message; }
  function reset(id, message) { stop(message); history = new chat.History(id); latestTicket = 0; listTicket = 0; latestPage = null; }
  function sync() { const id = core.roleId(location.href); if (history.id !== id) reset(id, 'The character changed. Export again.'); return id; }
  function status() {
    sync();
    const s = history.summary();
    const visibleSequences = Array.from(document.querySelectorAll('[data-rum-chat-message]')).map(el => el.getAttribute('data-rum-chat-message')?.split(':')[1]).filter(v => /^\d+$/.test(v || ''));
    if (s.latest_page_captured && s.max_sequence && visibleSequences.some(v => BigInt(v) > BigInt(s.max_sequence))) {
      failure('New messages arrived. Refresh the page and export again.');
    }
    return { ...history.summary(), running, notice };
  }
  function failure(message) { history.error = message; stop(message); }
  // Only the normal page history/list requests are observed. No authentication
  // headers, cookies or browser login storage are read, cached or replayed.
  const reads = new Set(['/api/v1/chat/history', '/api/v1/conversation/list']);
  const writes = new Set(['/api/v1/conversation/switch', '/api/v1/conversation/branch', '/api/v1/conversation/delete',
    '/api/v1/chat/backtrack', '/api/v1/chat/retell', '/api/v1/chat/edit_reply']);
  async function boundedJSON(response) {
    const reader = response.body?.getReader();
    if (!reader) throw Error('Could not read the history response');
    const chunks = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > core.MAX_BYTES) throw Error('A history page exceeds 16 MB'); chunks.push(value); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
      return JSON.parse(new TextDecoder().decode(bytes));
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  function receive(path, q, payload, target, order) {
    sync(); if (history !== target || q.character_id !== history.id) return;
    if (path.endsWith('/conversation/list')) {
      if (order < listTicket || payload?.code !== 0) return;
      listTicket = order;
      const id = payload.data?.active_conversation?.conversation_id;
      if (history.bind(id)) { reset(history.id, 'The current chat changed. Refresh the page and export again.'); history.bind(id); }
      // Attaching a first observed identity does not alter already captured page context.
      return;
    }
    if (q.sequence === '0') {
      if (order < latestTicket) return;
      if (payload?.code !== 0 || !Array.isArray(payload.data)) { failure('Could not read chat history. Sign in and refresh the page.'); return; }
      // Virtual lists/refetches can request the same latest page after older
      // pages have loaded. Validate it before comparing, and keep those pages
      // (and any in-flight pagination) when the snapshot is unchanged.
      let fingerprint;
      try {
        const snapshot = new chat.History(history.id);
        snapshot.bind(history.conversationId);
        snapshot.accept(q, payload);
        fingerprint = JSON.stringify([snapshot.context, snapshot.sorted()]);
      } catch (e) { failure(e.message); return; }
      if (fingerprint === latestPage) { latestTicket = order; return; }
      if (history.latest) {
        const id = history.id, cid = history.conversationId;
        reset(id, 'Chat history reloaded. You can export again.'); history.bind(cid);
      }
      latestTicket = order;
      latestPage = fingerprint;
    }
    try {
      history.accept(q, payload);
      notice = history.ended ? 'Reached the start of the current chat. Coverage of regenerated replies is unverified.' : 'Partial history available. Start an export to collect earlier messages.';
    } catch (e) { failure(e.message); }
  }
  function observe(path, body, responsePromise) {
    sync(); const target = history, order = ++ticket;
    // Register cloning before returning the fetch promise to the site. Waiting
    // for request parsing first lets the site consume the response stream.
    const copy = responsePromise.then(response => {
      if (!response.ok || chat.endpoint(response.url) !== path) throw Error(`History request failed (${response.status})`);
      return boundedJSON(response.clone());
    });
    Promise.all([Promise.resolve(body).then(chat.request), copy]).then(([q, payload]) => {
      if (q.character_id === target.id) receive(path, q, payload, target, order);
    }).catch(e => { if (history === target && path.endsWith('/chat/history')) failure(e.message || 'Could not read chat history'); });
  }
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const input = args[0], init = args[1], url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const path = chat.endpoint(url);
    if (writes.has(path)) reset(core.roleId(location.href), 'The chat is changing. Refresh the page and export again.');
    let body;
    if (reads.has(path)) {
      try { body = init?.body ?? (typeof input?.clone === 'function' ? input.clone().text() : null); } catch { body = null; }
    }
    const result = Reflect.apply(originalFetch, this, args);
    if (reads.has(path) && body != null) observe(path, body, result);
    return result;
  };
  const urls = new WeakMap(), originalOpen = XMLHttpRequest.prototype.open, originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { urls.set(this, chat.endpoint(String(url))); return Reflect.apply(originalOpen, this, [method, url, ...rest]); };
  XMLHttpRequest.prototype.send = function (body) {
    const path = urls.get(this);
    if (writes.has(path)) reset(core.roleId(location.href), 'The chat is changing. Refresh the page and export again.');
    if (reads.has(path)) {
      sync(); const target = history, order = ++ticket;
      this.addEventListener('load', () => {
        try {
          if (history !== target) return;
          if (this.status < 200 || this.status >= 300 || chat.endpoint(this.responseURL) !== path) throw Error('History request failed');
          const value = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
          if (JSON.stringify(value).length > core.MAX_BYTES) throw Error('History response exceeds the size limit');
          receive(path, chat.request(body), value, target, order);
        } catch (e) { if (history === target && path.endsWith('/chat/history')) failure(e.message); }
      }, { once: true });
    }
    return Reflect.apply(originalSend, this, arguments);
  };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  function chatScroller() {
    // Prefer the actual message ancestor on both desktop and mobile. A shared
    // scrollbar class can also match a sidebar or an inactive container.
    for (const message of document.querySelectorAll('[data-rum-chat-message]')) {
      for (let parent = message.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        if (parent.clientHeight > 0 && /^(auto|scroll)$/.test(getComputedStyle(parent).overflowY)) return parent;
      }
    }
    return document.querySelector('div.no-transition-scrollbar');
  }
  async function collect() {
    sync(); if (running) return;
    if (!history.latest) { notice = 'Recent history is unavailable. Refresh the Tipsy chat and let it load before exporting.'; return; }
    if (history.ended && !history.error) return;
    const scroller = chatScroller();
    if (!scroller) { failure('The chat cannot scroll. You can export the available messages.'); return; }
    history.error = ''; running = true; const run = ++job, target = history;
    const bottomDistance = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    let lastCount = history.records.size, lastProgress = Date.now(), started = Date.now();
    notice = 'Loading earlier messages. Keep the current chat open. You can close the popup.';
    try {
      while (running && job === run && history === target) {
        sync(); if (!running || history !== target) break;
        if (history.ended) { stop('Reached the start of the current chat. Coverage of regenerated replies is unverified.'); break; }
        if (Date.now() - started > 10 * 60 * 1000) { failure('Export reached the 10 minute limit. You can continue collecting or save the available messages.'); break; }
        // Trigger the site's own loader; no synthetic authenticated API requests.
        // Leave the top loading threshold before returning. A 1px nudge stays
        // inside a virtual list's overscan/sentinel and may never rearm it.
        scroller.scrollTop = Math.min(Math.max(0, scroller.scrollHeight - scroller.clientHeight), Math.max(256, scroller.clientHeight));
        await delay(120);
        if (!running || job !== run || history !== target) break;
        scroller.scrollTop = 0;
        await delay(1200);
        if (history.records.size !== lastCount) { lastCount = history.records.size; lastProgress = Date.now(); }
        if (Date.now() - lastProgress > 20000) { failure('No earlier messages arrived within 20 seconds. Check that the page loaded. You can retry or save the partial export.'); break; }
      }
    } catch (e) { if (history === target) failure(e.message || 'Export failed'); }
    finally {
      if (history === target && scroller.isConnected) scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - bottomDistance);
    }
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const m = event.data;
    if (m?.channel !== core.CHANNEL || m.type !== 'CHAT_COMMAND' || typeof m.requestId !== 'string') return;
    sync();
    if (m.characterId !== history.id) return;
    if (m.action === 'start') collect();
    else if (m.action === 'cancel') stop('Export stopped. You can save the available messages.');
    else if (m.action !== 'status' && m.action !== 'export') return;
    const result = { ok: true, status: status() };
    if (m.action === 'export') result.data = history.export(typeof m.name === 'string' ? m.name.slice(0,200) : '');
    window.postMessage({ channel: core.CHANNEL, type: 'CHAT_RESULT', requestId: m.requestId, result }, location.origin);
  });
})();
