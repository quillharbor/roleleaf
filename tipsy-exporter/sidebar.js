(function (root) {
  'use strict';

  function read() {
    const current = root.BotModel.route(location.href);
    const platform = location.origin === 'https://tipsy.chat' ? 'tipsy' : 'character_ai';
    const container = document.querySelector(platform === 'tipsy'
      ? '.recent-talk-wrapper .chatted-list-scrollbar, .chatted-list-scrollbar'
      : '#guide-recent-chats-scroll [role="listbox"], [role="listbox"][aria-label="Recent Chats"]');
    const bots = new Map();

    for (const link of container?.querySelectorAll('a[href]') ?? []) {
      const route = root.BotModel.route(link.href);
      if (!route || route.platform !== platform || bots.has(route.id)) continue;
      const avatar = link.querySelector('img');
      bots.set(route.id, {
        id: route.id,
        url: link.href,
        name: avatar?.alt?.trim() || link.textContent.trim() || route.id,
        avatar: avatar?.currentSrc || avatar?.src || null,
      });
    }

    const mobileRows = platform === 'tipsy' && /\/chat\/recent\/?$/.test(location.pathname)
      ? document.querySelectorAll('[data-recent-chat-row]') : [];
    for (const row of mobileRows) {
      const id = /^chatlist\.item\.(\d{6,30})\.view$/.exec(row.getAttribute('data-testid') || '')?.[1];
      if (!id || bots.has(id)) continue;
      const avatar = row.querySelector('.swipeable-content img.object-cover');
      const name = row.querySelector('.swipeable-content span.truncate.text-white')?.textContent?.trim();
      bots.set(id, { id, url: `https://tipsy.chat/chat/${id}`, name: name || id,
        avatar: avatar?.currentSrc || avatar?.src || null });
    }
    return { ok: true, platform, found: !!container || mobileRows.length > 0, current, bots: [...bots.values()] };
  }

  root.BotSidebar = { read };
})(globalThis);
