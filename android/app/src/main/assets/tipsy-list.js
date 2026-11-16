// Only the background creator list requests pagination. The site's own
// scroll handler loads subsequent pages with its existing login session.
(() => {
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'BOT_ANDROID_LIST') return;
    if (message.scope === 'more' && BotCreator.profile(location.href)?.platform === 'tipsy') {
      const scroll = document.scrollingElement;
      scroll?.scrollTo(0, scroll.scrollHeight);
    }
    reply({ ok: true });
  });
})();
