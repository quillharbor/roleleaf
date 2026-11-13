(function () {
  'use strict';
  const core = globalThis.TipsyExporterCore;
  const cache = new Map();
  const pending = new Map();
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const m = event.data;
    if (m?.channel !== core.CHANNEL || m.type !== 'CHAT_RESULT') return;
    const item = pending.get(m.requestId);
    if (!item) return;
    pending.delete(m.requestId); clearTimeout(item.timer);
    if (core.roleId(location.href) !== item.id || m.result?.status?.character_id !== item.id) {
      item.respond({ ok: false, reason: 'navigated' }); return;
    }
    item.respond(m.result);
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === 'BOT_SIDEBAR') {
      respond(globalThis.BotSidebar.read());
      return;
    }
    if (message?.type !== 'TIPSY_CHAT') return;
    const id = core.roleId(location.href);
    if (!id || (message.characterId && id !== message.characterId)) { respond({ ok: false, reason: 'navigated' }); return; }
    if (!['status', 'start', 'cancel', 'export'].includes(message.action)) return;
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(requestId); respond({ ok: false, reason: 'chat_unavailable' }); }, 5000);
    pending.set(requestId, { id, timer, respond });
    window.postMessage({ channel: core.CHANNEL, type: 'CHAT_COMMAND', requestId, characterId: id,
      action: message.action, name: message.name }, location.origin);
    return true;
  });
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.channel !== core.CHANNEL || event.data.type !== 'CAPTURE') return;
    try {
      const incoming = event.data.entry;
      if (typeof incoming?.capturedAt !== 'string' || !Number.isFinite(Date.parse(incoming.capturedAt))) return;
      const entry = core.record(incoming.source, incoming.capturedAt);
      const id = entry.source.character.character_id;
      cache.delete(id);
      cache.set(id, entry);
      while (cache.size > 4) cache.delete(cache.keys().next().value);
    } catch { /* Ignore malformed messages from the page. */ }
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'TIPSY_GET_CURRENT') return;
    const id = core.roleId(location.href);
    if (!id) { respond({ ok: false, reason: 'not_character' }); return; }
    window.postMessage({ channel: core.CHANNEL, type: 'REQUEST', characterId: id }, location.origin);
    setTimeout(() => {
      // The user can navigate while the bridge message is in flight.
      if (core.roleId(location.href) !== id) { respond({ ok: false, reason: 'navigated' }); return; }
      const entry = cache.get(id);
      respond(entry ? { ok: true, entry } : { ok: false, reason: 'waiting' });
    }, 100);
    return true;
  });
})();
