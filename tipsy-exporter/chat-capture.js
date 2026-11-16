(function () {
  'use strict';
  const core = globalThis.TipsyExporterCore, chat = globalThis.TipsyExporterChat;
  if (!chat || globalThis.__tipsyChatCaptureInstalled) return;
  globalThis.__tipsyChatCaptureInstalled = true;
  let history = new chat.History(core.roleId(location.href)), running = false, job = 0, ticket = 0, latestTicket = 0, listTicket = 0;
  let latestPage = null;
  let olderPages = { observed: 0, pending: new Set() };
  const TRIGGER_WAIT = 3000, RESPONSE_WAIT = 20000, MAX_ATTEMPTS = 3, EXPORT_LIMIT = 600000;
  let notice = 'Waiting for chat history. Refresh Tipsy after updating RoleLeaf.';
  function stop(message) { running = false; job++; if (message) notice = message; }
  function reset(id, message) { stop(message); history = new chat.History(id); latestTicket = 0; listTicket = 0; latestPage = null; olderPages = { observed: 0, pending: new Set() }; }
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
  function observe(path, body, payloadPromise) {
    sync();
    const target = history, pages = olderPages, order = ++ticket;
    let requestScope, older = false;
    const request = Promise.resolve(body).then(body => {
      const q = requestScope = chat.request(body);
      older = path.endsWith('/chat/history') && /^\d{1,30}$/.test(q.sequence) &&
        BigInt(q.sequence) > 0n && q.character_id === target.id &&
        !(q.conversation_id && target.conversationId && q.conversation_id !== target.conversationId);
      if (older) {
        pages.observed++;
        pages.pending.add(order);
      }
      return q;
    });
    const response = payloadPromise.then(payload => ({ payload }), error => ({ error }));
    Promise.all([request, response]).then(([q, result]) => {
      if (q.character_id !== target.id) return;
      if ('error' in result) throw result.error;
      receive(path, q, result.payload, target, order);
    }).catch(error => {
      if (history === target && path.endsWith('/chat/history') && (!requestScope || requestScope.character_id === target.id)) {
        failure(older ? 'Earlier chat history request failed: ' + error.message : error.message || 'Could not read chat history');
      }
    }).finally(() => pages.pending.delete(order));
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
    if (reads.has(path) && body != null) {
      // Clone as soon as the response arrives, before the site consumes it.
      const payload = result.then(response => {
        if (!response.ok || chat.endpoint(response.url) !== path) throw Error(`History request failed (${response.status})`);
        return boundedJSON(response.clone());
      });
      observe(path, body, payload);
    }
    return result;
  };
  const urls = new WeakMap(), originalOpen = XMLHttpRequest.prototype.open, originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { urls.set(this, chat.endpoint(String(url))); return Reflect.apply(originalOpen, this, [method, url, ...rest]); };
  XMLHttpRequest.prototype.send = function (body) {
    const path = urls.get(this);
    if (writes.has(path)) reset(core.roleId(location.href), 'The chat is changing. Refresh the page and export again.');
    if (reads.has(path)) {
      const payload = new Promise((resolve, reject) => {
        this.addEventListener('loadend', () => {
          try {
            if (this.status < 200 || this.status >= 300 || chat.endpoint(this.responseURL) !== path) throw Error('History request failed');
            const value = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
            if (JSON.stringify(value).length > core.MAX_BYTES) throw Error('History response exceeds the size limit');
            resolve(value);
          } catch (error) { reject(error); }
        }, { once: true });
      });
      observe(path, body, payload);
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
    const originalScroller = chatScroller();
    if (!originalScroller) { failure('The chat cannot scroll. You can export the available messages.'); return; }
    history.error = '';
    running = true;
    const run = ++job, target = history, pages = olderPages;
    const bottomDistance = originalScroller.scrollHeight - originalScroller.clientHeight - originalScroller.scrollTop;
    const deadline = Date.now() + EXPORT_LIMIT;
    const active = () => {
      sync();
      return running && job === run && history === target && !target.ended && Date.now() < deadline;
    };
    async function waitWhile(condition, timeout) {
      const until = Date.now() + timeout;
      while (active() && condition() && Date.now() < until) await delay(150);
    }

    let attempts = 0, requestedWithoutProgress = false;
    notice = 'Loading earlier messages. Keep the current chat open. You can close the popup.';
    try {
      while (active()) {
        const count = target.records.size;
        const observed = pages.observed;
        const alreadyLoading = pages.pending.size > 0;
        if (!alreadyLoading) {
          // The site may replace its virtual list while loading messages.
          const scroller = chatScroller();
          if (scroller) {
            const range = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
            scroller.scrollTop = attempts ? range : Math.min(range, Math.max(256, scroller.clientHeight));
            await delay(120);
            if (active() && scroller.isConnected && pages.observed === observed) scroller.scrollTop = 0;
          }
          await waitWhile(() => pages.observed === observed, TRIGGER_WAIT);
        }
        if (!active()) break;

        const requested = alreadyLoading || pages.observed !== observed;
        if (requested) {
          await waitWhile(() => pages.pending.size > 0, RESPONSE_WAIT);
          if (!active()) break;
          if (pages.pending.size > 0) {
            failure('Timed out waiting for an earlier chat history response.');
            break;
          }
        }
        if (target.records.size > count) {
          attempts = 0;
          requestedWithoutProgress = false;
        } else {
          attempts++;
          requestedWithoutProgress ||= requested;
        }
        if (attempts >= MAX_ATTEMPTS) {
          failure(requestedWithoutProgress ? 'Earlier chat history did not contain new messages.' : 'The chat page did not request earlier messages.');
        }
      }
      if (running && job === run && history === target) {
        if (target.ended) stop('Reached the start of the current chat. Coverage of regenerated replies is unverified.');
        else failure('Export reached the 10 minute limit. You can continue collecting or save the available messages.');
      }
    } catch (e) { if (history === target) failure(e.message); }
    finally {
      if (history === target && originalScroller.isConnected) {
        originalScroller.scrollTop = Math.max(0, originalScroller.scrollHeight - originalScroller.clientHeight - bottomDistance);
      }
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
