/* global sites, demoTab, collectBot, readChat, BotModel, desktop */
'use strict';

const $ = id => document.getElementById(id);
const platformButtons = [...document.querySelectorAll('[data-platform]')];
const selected = new Set();
const authFallbacks = new Map();
let platform;
let creator = false, profileLink = null;
let current;
let controller;
let demo = new URLSearchParams(location.search).has('demo');
let liveBots = [];
let refreshTimer;
let revision = 0;

const liveTabs = { get: id => desktop.siteTab(id), sendMessage: (id, message) => desktop.siteRequest(id, message) };

function platformBots() {
  return demo ? sites[platform].bots : liveBots;
}

function avatar(element, bot) {
  element.dataset.color = bot.color;
  element.textContent = bot.letter;
}

function showBot(bot) {
  current = bot;
  avatar($('current-avatar'), bot);
  $('site-label').textContent = sites[platform].name;
  $('current-name').textContent = bot.name;
  $('current-bio').textContent = bot.bio;
  $('messages').replaceChildren(...bot.messages.map(message => {
    const article = document.createElement('article');
    article.className = `message ${message.role}`;
    const who = document.createElement('strong');
    who.textContent = message.role === 'user' ? 'You' : bot.name;
    const body = document.createElement('p');
    body.textContent = message.content;
    article.append(who, body);
    return article;
  }));
}

function visibleBots() {
  const query = $('search').value.trim().toLowerCase();
  return platformBots().filter(bot => `${bot.name} ${bot.id}`.toLowerCase().includes(query));
}

function renderSelection() {
  const visible = visibleBots();
  const count = visible.filter(bot => selected.has(bot.id)).length;
  $('select-all').disabled = !visible.length || Boolean(controller);
  $('select-all').checked = visible.length > 0 && count === visible.length;
  $('select-all').indeterminate = count > 0 && count < visible.length;
  $('selected-count').textContent = `${selected.size} selected`;
  $('export').disabled = !selected.size || Boolean(controller);
  $('export').textContent = selected.size ? `Export selected (${selected.size})` : 'Export';
}

function renderBots() {
  const rows = visibleBots().map(bot => {
    const row = document.createElement('li');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = selected.has(bot.id);
    check.disabled = Boolean(controller);
    check.setAttribute('aria-label', `Select ${bot.name}`);
    check.onchange = () => {
      if (check.checked) selected.add(bot.id);
      else selected.delete(bot.id);
      renderSelection();
    };
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bot';
    button.setAttribute('aria-current', String(bot.id === current?.id));
    button.disabled = Boolean(controller);
    const icon = document.createElement('span');
    icon.className = 'avatar';
    icon.setAttribute('aria-hidden', 'true');
    avatar(icon, bot);
    const name = document.createElement('span');
    name.textContent = bot.name;
    button.append(icon, name);
    button.onclick = () => {
      if (demo) { showBot(bot); renderBots(); }
      else if (creator) { check.checked = !check.checked; check.onchange(); }
      else void navigate('open', bot.url);
    };
    row.append(check, button);
    return row;
  });
  $('bots').replaceChildren(...rows);
  renderSelection();
}

async function switchPlatform(value) {
  const request = ++revision;
  clearTimeout(refreshTimer);
  platform = value;
  for (const button of platformButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.platform === value));
  }
  $('search').value = '';
  $('status').textContent = '';
  const authFallback = authFallbacks.get(value);
  $('auth-fallback').textContent = authFallback || '';
  $('auth-fallback').hidden = !authFallback;
  $('queue').replaceChildren();
  selected.clear();
  liveBots = [];
  current = null;
  document.querySelector('.chat').hidden = !demo;
  document.querySelector('.site').hidden = demo;
  $('mode').textContent = demo ? 'Back to source site' : 'View demo';
  $('mode').setAttribute('aria-pressed', String(demo));
  $('refresh-bots').hidden = demo;
  $('chat-mode').hidden = $('creator-mode').hidden = demo;
  profileLink = null;
  $('open-profile').hidden = true;
  updateScope();
  $('address').value = sites[value].origin;
  if (demo) {
    const bot = sites[value].bots[0];
    selected.add(bot.id);
    showBot(bot);
  } else $('status').textContent = 'Opening source site…';
  renderBots();
  try {
    await desktop.siteSwitch(demo ? null : value);
    if (!demo && request === revision) void refreshBots();
  } catch (error) {
    if (request === revision) $('status').textContent = error.message;
  }
}

function setBusy(busy) {
  for (const button of platformButtons) button.disabled = busy;
  $('mode').disabled = busy;
  $('refresh-bots').disabled = busy;
  $('chat-mode').disabled = $('creator-mode').disabled = $('open-profile').disabled = busy;
  $('back').disabled = busy;
  $('reload').disabled = busy;
  $('address').disabled = busy;
  $('search').disabled = busy;
  $('stop').hidden = !busy;
  renderBots();
}

async function navigate(action, value) {
  if (controller || demo) return;
  try { await desktop.siteNavigation(action, value); }
  catch (error) { $('status').textContent = error.message; }
}

async function refreshBots() {
  if (demo || controller) return;
  const request = ++revision;
  try {
    const tab = await desktop.siteCurrent();
    if (creator) {
      const result = tab && await desktop.siteRequest(tab.id, { type: 'BOT_CREATOR', action: 'list' });
      const profile = tab && await desktop.siteRequest(tab.id, { type: 'BOT_CREATOR', action: 'profile' });
      if (request !== revision || controller || demo || !creator) return;
      profileLink = BotCreator.profile(profile?.url);
      $('open-profile').hidden = profileLink?.platform !== platform;
      current = null;
      liveBots = result?.ok && result.platform === platform ? result.bots.flatMap(bot => {
        const route = BotCreator.target(platform, bot.id, bot.url);
        return route && typeof bot.name === 'string' ? [{ ...bot, route, letter: Array.from(bot.name)[0] || 'B', color: 'violet' }] : [];
      }) : [];
      for (const id of selected) if (!liveBots.some(bot => bot.id === id)) selected.delete(id);
      $('status').textContent = result?.ok ? result.more ? 'Scroll down on the source profile and refresh to load more.' :
        liveBots.length ? '' : 'No saved characters on this profile.' : 'Open your own profile on the source site and select Characters.';
      renderBots();
      return;
    }
    const route = BotModel.route(tab?.url);
    const result = tab && await desktop.siteRequest(tab.id, { type: 'BOT_SIDEBAR' });
    if (request !== revision || controller || demo) return;
    if (!result?.ok || result.platform !== platform || result.current?.id !== route?.id) {
      $('status').textContent = 'Sign in on the source site, open a chat, and refresh the list.';
      return;
    }
    current = route;
    liveBots = result.bots.flatMap(bot => {
      const botRoute = BotModel.route(bot.url);
      if (botRoute?.platform !== platform || botRoute.id !== bot.id || typeof bot.name !== 'string') return [];
      return [{ ...bot, route: botRoute, letter: Array.from(bot.name)[0] || 'B', color: 'violet' }];
    });
    if (route && !liveBots.some(bot => bot.id === route.id)) {
      liveBots.unshift({ id: route.id, route, url: tab.url, name: tab.title || 'Current character', letter: 'B', color: 'violet' });
    }
    for (const id of selected) if (!liveBots.some(bot => bot.id === id)) selected.delete(id);
    if (!selected.size && route) selected.add(route.id);
    $('status').textContent = liveBots.length ? '' : 'Sign in on the source site, open the chat sidebar, and refresh the list.';
    if (liveBots.length) {
      authFallbacks.delete(platform);
      $('auth-fallback').hidden = true;
    }
    renderBots();
  } catch (error) {
    if (request === revision && !demo) $('status').textContent = error.message;
  }
}

async function downloadImage(url, signal) {
  signal.throwIfAborted();
  const id = crypto.randomUUID();
  const stop = () => desktop.cancelImage(id);
  signal.addEventListener('abort', stop, { once: true });
  try { return await desktop.downloadImage(id, url); }
  finally { signal.removeEventListener('abort', stop); }
}

async function collectLive(bot, signal, progress) {
  if (creator) {
    signal.throwIfAborted();
    const id = await desktop.siteWorker(bot.route.url);
    try {
      // A worker can still be loading when its ID first becomes available.
      await openCreatorEditor(liveTabs, id, bot.route, signal);
      return await collectCreator({ tabs: liveTabs, tabId: id, route: bot.route, signal, progress, downloadImage });
    } finally { await desktop.siteClose(id); }
  }
  globalThis.chrome.tabs = liveTabs;
  const source = await desktop.siteCurrent();
  const route = BotModel.route(source?.url);
  const fromCurrent = route?.id === bot.id && route.platform === bot.route.platform;
  const expected = fromCurrent && bot.route.platform === 'tipsy'
    ? (await readChat(source.id, bot.route, 'status', false)).status.conversation_id
    : null;
  signal.throwIfAborted();
  const id = await desktop.siteWorker(fromCurrent ? source.url : bot.url);
  try {
    const output = await collectBot({ tabId: id, route: bot.route, worker: true,
      expectedConversationId: expected, signal, progress, onCharacter: () => {}, downloadImage });
    if (expected && (await readChat(source.id, bot.route, 'status', false)).status.conversation_id !== expected) {
      throw Error('The source chat changed. Export again.');
    }
    return output;
  } finally { await desktop.siteClose(id); }
}

async function exportSelected() {
  if (controller || !selected.size) return;
  const job = new AbortController();
  controller = job;
  setBusy(true);
  $('status').textContent = '';
  try {
    if (!await desktop.chooseFolder() || job.signal.aborted) {
      $('status').textContent = 'Export canceled.';
      return;
    }
    $('folder').hidden = false;
    const bots = platformBots().filter(bot => selected.has(bot.id));
    const entries = bots.map(bot => {
      const row = document.createElement('li');
      row.textContent = `${bot.name} · Queued`;
      return row;
    });
    $('queue').replaceChildren(...entries);
    let saved = 0;
    let failed = 0;
    for (const [index, bot] of bots.entries()) {
      if (job.signal.aborted) {
        entries[index].textContent = `${bot.name} · Skipped`;
        continue;
      }
      const row = entries[index];
      $('status').textContent = `Exporting ${index + 1} of ${bots.length}`;
      try {
        const progress = detail => { row.textContent = `${bot.name} · ${detail}`; };
        if (demo) globalThis.chrome.tabs = demoTab(bot);
        const output = demo
          ? await collectBot({ tabId: 1, route: bot.route, signal: job.signal, progress, onCharacter: () => {} })
          : await collectLive(bot, job.signal, progress);
        const filename = demo ? `${bot.route.platform}_demo_${output.filename.slice(bot.route.platform.length + 1)}` : output.filename;
        await desktop.saveZip(filename, output.bytes);
        saved++;
        row.dataset.state = 'saved';
        row.textContent = `${bot.name} · Saved · ${creator ? 'Creator settings' : output.messages + ' messages'} · ${output.images} images${output.partial ? ' · Partial' : ''}`;
      } catch (error) {
        failed++;
        row.dataset.state = 'error';
        row.textContent = `${bot.name} · ${error.message}`;
      }
    }
    const skipped = bots.length - saved - failed;
    $('status').textContent = `Saved ${saved} ZIP files${failed ? ` · Failed: ${failed}` : ''}${skipped ? ` · Skipped: ${skipped}` : ''}`;
  } catch (error) {
    $('status').textContent = error.message;
  } finally {
    controller = null;
    setBusy(false);
  }
}

for (const button of platformButtons) button.onclick = () => { void switchPlatform(button.dataset.platform); };
function updateScope() {
  $('chat-mode').setAttribute('aria-pressed', String(!creator));
  $('creator-mode').setAttribute('aria-pressed', String(creator));
  $('refresh-bots').textContent = creator ? 'Refresh character list' : 'Refresh chat list';
  $('scope-note').textContent = creator ? 'Back up saved settings from your own profile. Each character gets a ZIP without chats.' :
    'Each ZIP includes the character name, current chat, and chat images.';
}
function setScope(value) {
  if (controller || demo || value === creator) return;
  creator = value; selected.clear(); liveBots = []; current = null;
  profileLink = null; $('open-profile').hidden = true;
  $('search').value = ''; $('status').textContent = ''; $('queue').replaceChildren();
  updateScope(); renderBots(); void refreshBots();
}
$('chat-mode').onclick = () => setScope(false);
$('creator-mode').onclick = () => setScope(true);
$('open-profile').onclick = () => { if (profileLink?.platform === platform) void navigate('open', profileLink.url); };
$('mode').onclick = () => { demo = !demo; creator = false; void switchPlatform(platform); };
$('refresh-bots').onclick = () => { void refreshBots(); };
$('back').onclick = () => { void navigate('back'); };
$('reload').onclick = () => { void navigate('refresh'); };
$('address-form').onsubmit = event => {
  event.preventDefault();
  const value = $('address').value.trim();
  $('address').value = sites[platform].origin;
  $('address').blur();
  void navigate('open', value);
};
desktop.onSiteState(state => {
  if (demo || state.platform !== platform) return;
  if (document.activeElement !== $('address')) $('address').value = state.url;
  if (controller) return;
  if (state.error) { $('status').textContent = state.error; return; }
  clearTimeout(refreshTimer);
  if (!state.loading) refreshTimer = setTimeout(refreshBots, 500);
});
desktop.onSiteNotice(notice => { if (!demo && !controller) $('status').textContent = notice; });
desktop.onSiteAuthFallback(notice => {
  if (demo || controller) return;
  authFallbacks.set(platform, notice);
  $('auth-fallback').textContent = notice;
  $('auth-fallback').hidden = false;
});
$('search').oninput = renderBots;
$('select-all').onchange = () => {
  for (const bot of visibleBots()) {
    if ($('select-all').checked) selected.add(bot.id);
    else selected.delete(bot.id);
  }
  renderBots();
};
$('export').onclick = exportSelected;
$('stop').onclick = () => controller?.abort();
$('folder').onclick = async () => {
  try { await desktop.showFolder(); }
  catch (error) { $('status').textContent = error.message; }
};
void switchPlatform('tipsy');
