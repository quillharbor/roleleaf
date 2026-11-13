/* global BotModel, chrome */
'use strict';

const $ = id => document.getElementById(id);
const selected = new Set();
const siteNames = { tipsy: 'Tipsy', character_ai: 'Character.AI' };
let tab, platform, current, bots = [], reading = false, launching = false;

document.querySelector('.eyebrow').textContent = 'BOT EXPORTER · ' + chrome.runtime.getManifest().version;

function platformOf(url) {
  const origin = url ? new URL(url).origin : '';
  if (origin === 'https://tipsy.chat') return 'tipsy';
  if (origin === 'https://character.ai') return 'character_ai';
  throw Error('Open Tipsy or Character.AI.');
}

function results() {
  const query = $('search').value.trim().toLowerCase();
  return bots.filter(bot => bot.name.toLowerCase().includes(query) || bot.id.toLowerCase().includes(query));
}

function updateSelection() {
  const shown = results();
  const count = shown.filter(bot => selected.has(bot.id)).length;
  $('select-all').checked = shown.length > 0 && count === shown.length;
  $('select-all').indeterminate = count > 0 && count < shown.length;
  $('select-all').disabled = !shown.length;
  $('clear').disabled = !selected.size;
  $('selected-count').textContent = `${selected.size} selected`;
  $('collect').textContent = selected.size ? `Export selected (${selected.size})` : 'Export characters';
  $('collect').disabled = reading || launching || !selected.size;
}

function avatarFor(bot) {
  const fallback = document.createElement('span');
  fallback.className = 'bot-avatar';
  fallback.textContent = Array.from(bot.name)[0]?.toUpperCase() || 'B';
  fallback.setAttribute('aria-hidden', 'true');
  try {
    const url = new URL(bot.avatar);
    if (url.protocol !== 'https:' || url.username || url.password ||
        !['img.tipsy.chat', 'characterai.io'].includes(url.hostname)) return fallback;
    const img = document.createElement('img');
    img.className = 'bot-avatar';
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.src = url.href;
    img.addEventListener('error', () => img.replaceWith(fallback), { once: true });
    return img;
  } catch {
    return fallback;
  }
}

function renderList() {
  const shown = results();
  const fragment = document.createDocumentFragment();
  for (const bot of shown) {
    const label = document.createElement('label');
    label.className = 'bot-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.has(bot.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(bot.id);
      else selected.delete(bot.id);
      updateSelection();
    });
    const name = document.createElement('span');
    name.className = 'bot-name';
    name.textContent = bot.name;
    name.title = bot.name;
    label.append(checkbox, avatarFor(bot), name);
    if (bot.id === current?.id) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Current';
      label.append(badge);
    }
    fragment.append(label);
  }
  $('bot-list').replaceChildren(fragment);
  $('empty').hidden = shown.length > 0;
  updateSelection();
}

async function readList(first = false) {
  if (reading || launching) return;
  reading = true;
  $('status').textContent = 'Reading the chat sidebar…';
  $('refresh-list').disabled = true;
  updateSelection();
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    platform = platformOf(tab?.url);
    current = BotModel.route(tab.url);
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { type: 'BOT_SIDEBAR' }, { frameId: 0 });
    } catch {
      throw Error('Reload the source page, then reopen RoleLeaf.');
    }
    if (!response?.ok || response.platform !== platform || response.current?.id !== current?.id) {
      throw Error('The source page changed. Refresh the list.');
    }
    bots = response.bots.filter(bot => {
      const route = BotModel.route(bot.url);
      return route?.platform === platform && route.id === bot.id && typeof bot.name === 'string';
    });
    const sidebarCount = bots.length;
    if (current && !bots.some(bot => bot.id === current.id)) {
      bots.unshift({ ...current, url: tab.url, name: tab.title || 'Current character' });
    }
    for (const id of selected) if (!bots.some(bot => bot.id === id)) selected.delete(id);
    if (first && current) selected.add(current.id);
    $('identity').textContent = `${siteNames[platform]} · ${sidebarCount} characters in the sidebar`;
    $('status').textContent = sidebarCount ? '' : 'Open the chat sidebar and refresh the list.';
    $('picker').hidden = !bots.length;
    renderList();
  } catch (error) {
    bots = [];
    selected.clear();
    $('identity').textContent = siteNames[platform] || 'Waiting for source site';
    $('status').textContent = error.message;
    $('picker').hidden = true;
    updateSelection();
  } finally {
    reading = false;
    $('refresh-list').disabled = false;
    updateSelection();
  }
}

$('search').addEventListener('input', renderList);
$('select-all').addEventListener('change', () => {
  for (const bot of results()) {
    if ($('select-all').checked) selected.add(bot.id);
    else selected.delete(bot.id);
  }
  renderList();
});
$('clear').onclick = () => { selected.clear(); renderList(); };
$('refresh-list').onclick = () => readList();
$('refresh-page').onclick = async () => {
  if (!tab || launching || reading) return;
  try {
    await chrome.tabs.reload(tab.id);
    $('status').textContent = 'Refresh the list once the source page finishes loading.';
  } catch (error) {
    $('status').textContent = error.message;
  }
};

$('collect').onclick = async () => {
  if (reading || launching || !selected.size) return;
  launching = true;
  updateSelection();
  const chosen = bots.filter(bot => selected.has(bot.id));
  let key;
  try {
    const source = await chrome.tabs.get(tab.id);
    if (platformOf(source.url) !== platform || BotModel.route(source.url)?.id !== current?.id) {
      throw Error('The source page changed. Refresh the list.');
    }
    let page = `collector.html?tab=${tab.id}`;
    if (chosen.length !== 1 || chosen[0].id !== current?.id) {
      const jobId = crypto.randomUUID();
      key = `batch:${jobId}`;
      await chrome.storage.session.set({
        [key]: {
          platform,
          sourceTab: tab.id,
          currentId: current?.id ?? null,
          bots: chosen.map(({ id, name, url }) => ({ id, name, url })),
        },
      });
      page += `&batch=${jobId}`;
    }
    await chrome.tabs.create({ url: chrome.runtime.getURL(page) });
    window.close();
  } catch (error) {
    if (key) await chrome.storage.session.remove(key).catch(() => {});
    $('status').textContent = error.message;
    launching = false;
    updateSelection();
  }
};

readList(true);
