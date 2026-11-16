(function () {
  'use strict';
  const C = globalThis.BotCreator, channel = 'roleleaf-creator-v1';
  if (location.origin !== C.origins.tipsy || window !== window.top) return;
  const pages = new Map(), details = new Map(), richDetails = new Map();
  let profileURL = null;
  function resetProfile() {
    const here = C.profile(location.href)?.url;
    if (here && here !== profileURL) { profileURL = here; pages.clear(); }
    return here;
  }
  function endpoint(value) {
    try {
      const u = new URL(value, location.origin);
      if (u.origin !== 'https://api.tipsy.chat' || u.username || u.password) return null;
      const path = u.pathname;
      if (path === '/api/v1/user/created/list') return 'list';
      if (path === '/api/v1/user/created/detail') return 'detail';
      if (path === '/api/v1/character/rich_content/get') return 'rich';
    } catch {}
    return null;
  }
  function accept(kind, payload, request, url) {
    if (payload?.code !== 0 || !request) return;
    const data = payload.data;
    if (kind === 'list') {
      const here = resetProfile();
      if (!here || here !== C.profile(url)?.url || !Array.isArray(data?.list)) return;
      const page = Number(request.page ?? 0);
      if (!Number.isInteger(page) || page < 0 || page > 30) return;
      const bots = data.list.filter(x => x?.item_type === 'character').flatMap(x => {
        const c = x.character, id = c?.character_id;
        if (!C.idOK('tipsy', id) || typeof c.nickname !== 'string' || !c.nickname.trim()) return [];
        return [{ id, name: c.nickname.slice(0, 500), avatar: C.media(c.face_url || c.image_url),
          image: C.media(c.image_url), url: here }];
      });
      if (pages.size && pages.values().next().value.filter !== JSON.stringify(request.review_stage)) pages.clear();
      pages.set(page, { bots, filter: JSON.stringify(request.review_stage), count: data.list.length, total: Number(data.total) });
    } else {
      const id = kind === 'detail' ? request.item_id : request.character_id;
      if (!C.idOK('tipsy', id)) return;
      if (kind === 'detail' && request.item_type === 'character') {
        const normalized = C.snapshot('tipsy', id, data?.character, null, richDetails.get(id));
        if (normalized) details.set(id, { raw: data.character, data: normalized });
        while (details.size > 4) details.delete(details.keys().next().value);
      } else if (kind === 'rich') {
        const rich = Object.fromEntries(['tagline','greeting_rich_text','optimization_code','output_format_config']
          .filter(k => typeof data?.[k] === 'string' && data[k].length < 300000).map(k => [k,data[k]]));
        richDetails.set(id, rich);
        if (details.has(id)) {
          const item = details.get(id);
          item.data = C.snapshot('tipsy', id, item.raw, null, rich);
        }
        while (richDetails.size > 4) richDetails.delete(richDetails.keys().next().value);
      }
    }
  }
  async function boundedJSON(response) {
    const reader = response.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder(); let size = 0, text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 5 * 1024 * 1024) { void reader.cancel().catch(() => {}); return null; }
        text += decoder.decode(value, { stream: true });
      }
      return JSON.parse(text + decoder.decode());
    } finally { reader.releaseLock(); }
  }
  function body(value) {
    try { return typeof value === 'string' && value.length <= 8192 ? JSON.parse(value) : null; }
    catch { return null; }
  }
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const input = args[0], value = input instanceof Request ? input.url : input;
    const kind = endpoint(value), url = location.href;
    const result = Reflect.apply(originalFetch, this, args);
    if (kind && String(args[1]?.method ?? input?.method ?? 'GET').toUpperCase() === 'POST') {
      result.then(async response => {
        if (!response.ok || endpoint(response.url || value) !== kind) return;
        const request = body(args[1]?.body);
        if (request) accept(kind, await boundedJSON(response.clone()), request, url);
      }).catch(() => {});
    }
    return result;
  };
  const xhrs = new WeakMap(), open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const kind = typeof method === 'string' && method.toUpperCase() === 'POST' && endpoint(url);
    if (kind) xhrs.set(this, { kind, url: location.href });
    else xhrs.delete(this);
    return Reflect.apply(open, this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const info = xhrs.get(this);
    if (info) this.addEventListener('load', () => {
      try {
        if (this.status < 200 || this.status >= 300 || endpoint(this.responseURL) !== info.kind) return;
        const request = body(args[0]);
        if (!request) return;
        const payload = this.responseType === 'json' ? this.response :
          (!this.responseType || this.responseType === 'text') && this.responseText.length <= 5 * 1024 * 1024
            ? JSON.parse(this.responseText) : null;
        accept(info.kind, payload, request, info.url);
      } catch {}
    }, { once: true });
    return Reflect.apply(send, this, args);
  };
  window.addEventListener('message', event => {
    const m = event.data;
    if (event.source !== window || event.origin !== location.origin || m?.channel !== channel || m.type !== 'request') return;
    let result;
    if (m.action === 'list') {
      const here = resetProfile();
      if (here && pages.size) {
        const ordered = [...pages.entries()].sort(([a],[b]) => a-b).map(([,page]) => page);
        const total = ordered[0].total;
        result = { ok: true, platform: 'tipsy', bots: [...new Map(ordered.flatMap(x => x.bots)
          .map(bot => [bot.id, bot])).values()], more: Number.isFinite(total) && ordered.reduce((n,p) => n+p.count,0) < total };
      }
    } else if (m.action === 'read') {
      const route = C.editor(location.href);
      const data = route?.id === m.characterId && details.get(route.id)?.data;
      if (data) result = { ok: true, data: { ...data, url: route.url } };
    }
    window.postMessage({ channel, type: 'response', id: m.id, result: result || { ok: false, reason: 'waiting' } }, location.origin);
  });
})();
