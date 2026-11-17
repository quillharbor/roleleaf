(function () {
  'use strict';
  const C = globalThis.BotCreator, channel = 'roleleaf-creator-v1';
  if (window !== window.top) return;
  const platform = C.platformOf(location.href);
  const queries = new Map();
  function tipsy(action, characterId) {
    return new Promise(resolve => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { queries.delete(id); resolve({ ok: false, reason: 'waiting' }); }, 700);
      queries.set(id, { resolve, timer });
      window.postMessage({ channel, type: 'request', id, action, characterId }, location.origin);
    });
  }
  window.addEventListener('message', e => {
    const m = e.data;
    if (e.source !== window || e.origin !== location.origin || m?.channel !== channel || m.type !== 'response') return;
    const query = queries.get(m.id);
    if (!query) return;
    queries.delete(m.id); clearTimeout(query.timer); query.resolve(m.result);
  });
  const notReady = reason => ({ ok: false, reason });
  function nextData() {
    const text = document.getElementById('__NEXT_DATA__')?.textContent;
    if (!text || text.length > 12 * 1024 * 1024) return null;
    try { return JSON.parse(text); } catch { return null; }
  }
  function caiProfileURL() {
    const props = nextData()?.props?.pageProps;
    const username = [props?.user?.user?.username, props?.user?.username,
      props?.currentUser?.username, props?.account?.username]
      .find(value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value));
    if (username) return C.origins.character_ai + '/profile/' + encodeURIComponent(username);
    for (const a of document.querySelectorAll('a[href]')) {
      const route = C.profile(a.href);
      if (route?.platform !== platform || !/^\/profile\/[^/]+\/?$/.test(new URL(route.url).pathname)) continue;
      const labels = [a.getAttribute('aria-label'), a.textContent].filter(Boolean);
      if (labels.some(label => /^(?:my profile|profile|我的主页|个人资料|マイプロフィール|내 프로필|ملفي الشخصي)$/i.test(label.trim()))) return route.url;
    }
    return null;
  }
  function ownProfileURL() {
    if (platform === 'character_ai') return caiProfileURL();
    const footer = document.querySelector('[data-testid="nav.footer.containerView"]');
    for (const a of footer?.querySelectorAll('a[href]') ?? []) {
      const r = C.profile(a.href);
      if (r?.platform === 'tipsy') return r.url;
    }
    // On desktop the account menu exposes the profile link after opening.
    for (const a of document.querySelectorAll('a[href]')) {
      const r = C.profile(a.href);
      if (r?.platform === 'tipsy' && /^(?:my profile|profile|我的主页|个人资料)$/i.test((a.getAttribute('aria-label') || a.textContent).trim())) return r.url;
    }
    return null;
  }
  function caiList() {
    const here = C.profile(location.href);
    if (!here) return notReady('profile');
    const next = nextData(), props = next?.props?.pageProps;
    const username = decodeURIComponent(new URL(here.url).pathname.split('/')[2] || '');
    const owner = props?.user?.user?.username;
    const account = props?.prefetchedPublicUser;
    // Use first-party page state when the server identifies the viewer as the creator.
    if (next?.page === '/profile/[username]' && username && owner === username &&
        account?.username === username && Array.isArray(account.characters)) {
      const bots = account.characters.flatMap(c => {
        const id = c?.external_id, name = c?.participant__name || c?.name;
        return C.idOK(platform, id) && c.user__username === owner && typeof name === 'string' && name.trim()
          ? [{ id, name: name.slice(0, 500), avatar: C.caiAvatar(c), url: C.origins.character_ai + '/character/' + id + '/edit' }] : [];
      });
      return { ok: true, platform, bots: [...new Map(bots.map(bot => [bot.id, bot])).values()], more: false };
    }
    // After client-side navigation, Next's initial props may still refer to the previous page.
    // Liked and Personas tabs are only rendered on the viewer's own profile.
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const tab = key => tabs.find(el => el.getAttribute('aria-controls')?.toLowerCase().endsWith('content-' + key));
    const characters = tab('characters');
    if (!characters || !tab('liked') || !tab('personas')) return notReady('profile');
    if (characters.getAttribute('aria-selected') !== 'true') return notReady('characters_tab');
    const panel = document.getElementById(characters.getAttribute('aria-controls'));
    if (!panel) return notReady('waiting');
    const bots = new Map();
    for (const a of panel.querySelectorAll('a[href]')) {
      const r = globalThis.BotModel.route(a.href);
      if (r?.platform !== platform || bots.has(r.id)) continue;
      const img = a.querySelector('img');
      const name = img?.alt?.trim() || a.querySelector('.truncate')?.textContent?.trim();
      if (name) bots.set(r.id, { id: r.id, name, avatar: C.media(img?.currentSrc || img?.src), url: C.origins.character_ai + '/character/' + r.id + '/edit' });
    }
    return { ok: true, platform, bots: [...bots.values()], more: false };
  }
  const imageKey = value => {
    try { return decodeURIComponent(new URL(value, location.origin).pathname).replace(/![^/]*$/, ''); }
    catch { return ''; }
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  // Tipsy stores the loaded editor data during its own Edit action. Directly opening /update
  // would skip that load. Only activate the menu and its explicit edit icon on the matching card.
  let opening = false;
  async function openTipsyEditor(characterId) {
    if (opening || !C.profile(location.href) || !C.idOK(platform, characterId)) return notReady('unavailable');
    opening = true;
    try {
      const deadline = Date.now() + 10000;
      let bot, card, menu;
      while (Date.now() < deadline) {
        const list = await tipsy('list');
        bot = list.bots?.find(x => x.id === characterId);
        if (!bot && list.more) {
          const scrolling = document.scrollingElement;
          scrolling?.scrollTo(0, scrolling.scrollHeight);
        }
        if (bot) {
          const pool = [...document.querySelectorAll('button, div')].filter(el =>
            el.classList.contains('pt-[166%]') && !!el.querySelector('svg path[d^="M10.0003 10.8327"]'));
          const image = bot.image && imageKey(bot.image);
          const named = pool.filter(el => [...el.querySelectorAll('img')].some(img => img.alt === bot.name));
          const sameName = list.bots.filter(item => item.name === bot.name).length;
          const byImage = image && pool.filter(el => [...el.querySelectorAll('img,video')].some(img =>
            imageKey(img.getAttribute('src')) === image || imageKey(img.currentSrc) === image));
          const matches = byImage?.length === 1 ? byImage : sameName === 1 ? named : [];
          if (matches?.length === 1) {
            card = matches[0]; menu = card.querySelector('svg path[d^="M10.0003 10.8327"]')?.closest('svg')?.parentElement;
            if (menu) break;
          }
        }
        await sleep(350);
      }
      if (!bot || !card || !menu || !card.isConnected) return notReady('card_unavailable');
      const source = C.profile(location.href)?.url;
      menu.click();
      const until = Date.now() + 2200;
      while (Date.now() < until && card.isConnected && C.profile(location.href)?.url === source) {
        const edit = [...card.querySelectorAll('img')].find(img => /\/profile-edit\.[\da-f]+\.png$/i.test(imageKey(img.getAttribute('src'))));
        const control = edit?.parentElement?.parentElement;
        if (control && card.contains(control)) { control.click(); return { ok: true }; }
        await sleep(100);
      }
      return notReady('edit_unavailable');
    } finally { opening = false; }
  }
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (sender.id !== chrome.runtime.id || m?.type !== 'BOT_CREATOR') return;
    if (m.action === 'profile') { reply({ ok: true, url: ownProfileURL() }); return; }
    if (m.action === 'list') {
      if (platform === 'character_ai') { reply(caiList()); return; }
      if (!C.profile(location.href)) { reply(notReady('profile')); return; }
      void tipsy('list').then(reply);
      return true;
    }
    if (m.action === 'open_editor' && platform === 'tipsy') {
      openTipsyEditor(m.characterId).then(reply, () => reply(notReady('edit_unavailable')));
      return true;
    }
    if (m.action !== 'read') return;
    const editor = C.editor(location.href);
    if (editor?.id !== m.characterId) { reply(notReady('waiting')); return; }
    if (platform === 'tipsy') { void tipsy('read', m.characterId).then(reply); return true; }
    const page = nextData();
    const data = C.caiEditor(page, m.characterId);
    reply(data ? { ok: true, data: { ...data, url: editor.url } } :
      notReady(page?.page === '/character/[id]/edit' ? 'forbidden' : 'waiting'));
  });
})();
