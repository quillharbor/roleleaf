// Android-only preparation for the background C.AI list page.
(() => {
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'BOT_ANDROID_LIST') return;
    if (message.scope === 'profile') {
      let username;
      try {
        const raw = document.getElementById('__NEXT_DATA__')?.textContent;
        if (raw && raw.length < 12 * 1024 * 1024) username = JSON.parse(raw).props?.pageProps?.user?.user?.username;
      } catch {}
      const url = typeof username === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(username)
        ? 'https://character.ai/profile/' + username : null;
      reply({ ok: Boolean(url), url });
      return;
    }
    if (message.scope === 'creator' && BotCreator.profile(location.href)) {
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      const tab = key => tabs.find(el => el.getAttribute('aria-controls')?.toLowerCase().endsWith('content-' + key));
      const characters = tab('characters');
      // Liked and Personas identify the signed-in viewer's own profile.
      if (characters && tab('liked') && tab('personas') && characters.getAttribute('aria-selected') !== 'true') {
        characters.click();
      }
    }
    reply({ ok: true });
  });
})();
