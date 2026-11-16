/* global BotModel, BotPackage, collectBot, readChat */
'use strict';
const $ = id => document.getElementById(id), pending = new Map();
let serial = 0, platform = 'tipsy', route = null, job = null, output = null;
let phase = 'empty', saved = false, saving = false;
let creator = false, profileLink = null;
let opening = false, listedBots = [], pickerRevision = 0;
const selectedBots = new Set();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function renderBots() {
  $('chat-mode').disabled = $('creator-mode').disabled = Boolean(job || saving || opening);
  $('load-list').disabled = Boolean(job || saving || opening);
  $('bot-search').disabled = Boolean(job || saving || opening);
  const query = $('bot-search').value.trim().toLocaleLowerCase();
  const matches = matchingBots();
  $('list-count').textContent = opening ? (creator ? 'Loading your characters…' : 'Loading chats…') : `${listedBots.length} characters loaded${query ? ` · ${matches.length} matches` : ''}`;
  $('bot-list').replaceChildren();
  for (const bot of matches) {
    const row = document.createElement('label'); row.className = 'bot-row'; row.dataset.botId = bot.id;
    row.dataset.selected = String(selectedBots.has(bot.id));
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selectedBots.has(bot.id); checkbox.setAttribute('aria-label', `Select ${bot.name}`);
    checkbox.onchange = () => { checkbox.checked ? selectedBots.add(bot.id) : selectedBots.delete(bot.id); renderSelection(); };
    const avatar = document.createElement('span'); avatar.className = 'bot-avatar'; avatar.textContent = Array.from(bot.name || 'B')[0]; avatar.setAttribute('aria-hidden', 'true');
    if (BotPackage.mediaURL(bot.avatar)) {
      const image = document.createElement('img');
      image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
      image.onerror = () => image.remove();
      image.src = '/avatar?url=' + encodeURIComponent(bot.avatar);
      avatar.append(image);
    }
    const name = document.createElement('span'); name.className = 'bot-name'; name.textContent = bot.name;
    row.append(checkbox, avatar, name); $('bot-list').append(row);
  }
  $('list-empty').hidden = opening || matches.length > 0;
  $('list-empty').textContent = query ? 'No matching characters.' : creator ? 'No saved characters found.' : 'Sign in on the source site, then refresh the list.';
  renderSelection();
}
function matchingBots() {
  const query = $('bot-search').value.trim().toLocaleLowerCase();
  return listedBots.filter(bot => `${bot.name} ${bot.id}`.toLocaleLowerCase().includes(query));
}
function renderSelection() {
  const matches = matchingBots();
  const count = matches.filter(bot => selectedBots.has(bot.id)).length;
  $('select-visible').checked = count > 0 && count === matches.length;
  $('select-visible').indeterminate = count > 0 && count < matches.length;
  $('select-visible').disabled = opening || !matches.length;
  $('clear-selection').disabled = opening || !selectedBots.size;
  $('selection-count').textContent = `${selectedBots.size} selected`;
  Array.from($('bot-list').children).forEach(row => {
    const selected = selectedBots.has(row.dataset.botId);
    row.dataset.selected = String(selected);
    row.firstElementChild.checked = selected;
    row.firstElementChild.disabled = opening;
  });
  renderActions();
}
// C.AI's mobile home does not mount the Recent sidebar. Read a fresh,
// attached background page at desktop width without navigating the user's page.
async function loadCaiBots(request, ownCharacters) {
  let profile;
  if (ownCharacters) profile = await liveTabs.sendMessage(1, { type: 'BOT_ANDROID_LIST', scope: 'profile' }).catch(() => null);
  await call('openCaiList', { scope: ownCharacters ? 'creator' : 'recent', url: profile?.url });
  if (ownCharacters && !profile?.url) {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (request !== pickerRevision) return;
      profile = await workerTabs.sendMessage(1, { type: 'BOT_ANDROID_LIST', scope: 'profile' }).catch(() => null);
      if (profile?.url) break;
      await pause(500);
    }
    if (!profile?.url) throw Error('Sign in to Character.AI to load your characters.');
    await call('openCaiList', { scope: 'creator', url: profile.url });
  }
  let previous = '', stable = 0, found = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (request !== pickerRevision) return;
    await workerTabs.sendMessage(1, { type: 'BOT_ANDROID_LIST', scope: ownCharacters ? 'creator' : 'recent' });
    const response = await workerTabs.sendMessage(1, ownCharacters
      ? { type: 'BOT_CREATOR', action: 'list' } : { type: 'BOT_SIDEBAR' }).catch(() => null);
    if (request !== pickerRevision) return;
    if (response?.platform === 'character_ai' && (ownCharacters ? response.ok : response.found)) {
      found = true;
      listedBots = (response.bots || []).filter(bot => typeof bot.name === 'string' &&
        (ownCharacters ? BotCreator.target('character_ai', bot.id, bot.url) : BotModel.route(bot.url)?.platform === 'character_ai'));
      const signature = JSON.stringify(listedBots.map(bot => [bot.id, bot.name, bot.avatar]));
      stable = signature === previous ? stable + 1 : 0; previous = signature;
      renderBots();
      if (stable >= 4 && (listedBots.length || attempt >= 12)) break;
    }
    if (attempt < 39) await pause(500);
  }
  if (!found) throw Error('Could not load this list. Check your connection and sign in to Character.AI.');
  for (const id of selectedBots) if (!listedBots.some(bot => bot.id === id)) selectedBots.delete(id);
  if (!listedBots.length) listNotice(ownCharacters ? 'No saved characters found.' : 'No recent chats found.');
}
async function loadTipsyCreatorBots(request) {
  const ownProfile = async tabs => {
    const response = await tabs.sendMessage(1, { type: 'BOT_CREATOR', action: 'profile' }).catch(() => null);
    const profile = BotCreator.profile(response?.url);
    return profile?.platform === 'tipsy' ? profile : null;
  };
  let profile = await ownProfile(liveTabs);
  if (!profile) {
    // A chat may still be hydrating its account navigation. A fresh mobile
    // Recent page exposes the signed-in account link without moving the source.
    await call('openRecent');
    for (let attempt = 0; attempt < 30; attempt++) {
      if (request !== pickerRevision) return;
      profile = await ownProfile(workerTabs);
      if (profile) break;
      await pause(500);
    }
  }
  if (request !== pickerRevision) return;
  if (!profile) throw Error('Sign in to Tipsy to load your characters.');
  await call('openCreatorWorker', { url: profile.url });
  let previous = '', stable = 0, response, found = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (request !== pickerRevision) return;
    response = await workerTabs.sendMessage(1, { type: 'BOT_CREATOR', action: 'list' }).catch(() => null);
    if (request !== pickerRevision) return;
    if (response?.ok && response.platform === 'tipsy') {
      found = true;
      listedBots = (response.bots || []).filter(bot => typeof bot.name === 'string' &&
        BotCreator.target('tipsy', bot.id, bot.url)?.url === profile.url);
      const signature = JSON.stringify(listedBots.map(bot => [bot.id, bot.name, bot.avatar]));
      stable = signature === previous ? stable + 1 : 0; previous = signature;
      renderBots();
      if (!response.more && stable >= 4 && (listedBots.length || attempt >= 12)) break;
      if (response.more) await workerTabs.sendMessage(1, { type: 'BOT_ANDROID_LIST', scope: 'more' });
    }
    if (attempt < 39) await pause(500);
  }
  if (!found) throw Error('Could not load your characters. Check your connection and sign in to Tipsy.');
  for (const id of selectedBots) if (!listedBots.some(bot => bot.id === id)) selectedBots.delete(id);
  if (response?.more) listNotice('Some characters could not finish loading. The loaded characters are available to export.');
  else if (!listedBots.length) listNotice('No saved characters found.');
}
async function loadBots() {
  if (job || saving || opening) return;
  const request = ++pickerRevision;
  opening = true; listNotice(''); renderBots();
  try {
    const current = await call('current');
    if (request !== pickerRevision) return;
    platform = current.platform;
    route = creator ? null : BotModel.route(current.url);
    $('picker-platform').textContent = platform === 'tipsy' ? 'Tipsy' : 'Character.AI';
    if (platform === 'character_ai') {
      profileLink = null; $('open-profile').hidden = true;
      await loadCaiBots(request, creator);
      return;
    }
    if (creator) {
      profileLink = null; $('open-profile').hidden = true;
      await loadTipsyCreatorBots(request);
      return;
    }
    const onRecent = platform === 'tipsy' && new URL(current.url).pathname.replace(/\/$/, '') === '/chat/recent';
    let sidebar = await liveTabs.sendMessage(1, { type: 'BOT_SIDEBAR' }).catch(() => null);
    if (request !== pickerRevision) return;
    const useWorker = platform === 'tipsy' ? !onRecent : !sidebar?.bots?.length;
    if (useWorker) await call('openRecent');
    const tabs = useWorker ? workerTabs : liveTabs;
    let previous = '', stable = 0, found = false;
    for (let attempt = 0; attempt < 25; attempt++) {
      if (request !== pickerRevision) return;
      sidebar = await tabs.sendMessage(1, { type: 'BOT_SIDEBAR' });
      if (request !== pickerRevision) return;
      if (sidebar.found) {
        found = true; listedBots = sidebar.bots;
        const signature = JSON.stringify(listedBots.map(bot => [bot.id, bot.name, bot.avatar]));
        stable = signature === previous ? stable + 1 : 0; previous = signature;
        if (listedBots.length && stable >= 4) break;
      }
      if (attempt < 24) await pause(500);
    }
    if (!found) throw Error('Open the source site, sign in, and go to your chat list.');
    for (const id of selectedBots) if (!listedBots.some(bot => bot.id === id)) selectedBots.delete(id);
  } catch (error) {
    if (request === pickerRevision) listNotice(error.message);
  } finally {
    if (request === pickerRevision) {
      await call('closeWorker').catch(() => {});
      if (request === pickerRevision) { opening = false; renderBots(); }
    }
  }
}
window.nativeReply = response => {
  const p = pending.get(response.id); if (!p) return;
  pending.delete(response.id); clearTimeout(p.timer);
  response.ok ? p.resolve(response.data) : p.reject(Error(response.error || 'Operation failed'));
};
function call(method, params = {}, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const id = String(++serial);
    const timer = setTimeout(() => { pending.delete(id); reject(Error('Request timed out. Try again.')); }, timeout);
    pending.set(id, { resolve, reject, timer });
    try { NativeApp.postMessage(JSON.stringify({ id, method, params })); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}
const status = text => { $('status').textContent = text; };
function listNotice(text) {
  $('list-notice').textContent = text;
  $('list-notice').hidden = !text;
}
function showExport() {
  const dialog = $('export-dialog');
  if (!dialog.open) dialog.showModal();
}
function tabsFor(worker) {
  return { get: () => call('current', { worker }), sendMessage: (_id, message) => call('capture', { worker, message }) };
}
const liveTabs = tabsFor(false), workerTabs = tabsFor(true);
function renderActions() {
  const working = Boolean(job), hasOutput = Boolean(output);
  $('cancel-picker').disabled = working || saving;
  $('export').hidden = creator || !route;
  $('export').disabled = working || saving || opening || !route;
  $('export-selected').disabled = working || saving || opening || !selectedBots.size;
  $('export-selected').textContent = `Export (${selectedBots.size})`;
  $('close-export').disabled = working || saving;
  $('export-progress').hidden = !working && !saving;
  $('stop').hidden = !working;
  $('stop').disabled = job?.signal.aborted ?? false;
  $('save').hidden = !hasOutput || saved;
  $('save-label').textContent = output?.files ? 'Save ZIPs' : 'Save ZIP';
  $('share').hidden = !hasOutput || !saved || Boolean(output?.files);
  $('save-copy').hidden = !hasOutput || !saved;
  $('result').hidden = !hasOutput;
  $('save').disabled = saving; $('save-copy').disabled = saving; $('share').disabled = saving;
}
function setPhase(value) {
  phase = value;
  const labels = {
    collecting: 'Exporting', done: 'Export ready',
    saving: output?.files ? 'Saving ZIPs' : 'Saving ZIP', saved: output?.files ? 'ZIPs saved' : 'ZIP saved', error: 'Export incomplete',
  };
  $('status-title').textContent = labels[value];
  renderActions();
}
function updateScope() {
  $('chat-mode').setAttribute('aria-pressed', String(!creator));
  $('creator-mode').setAttribute('aria-pressed', String(creator));
  $('picker-title').textContent = creator ? 'My Characters' : 'Choose characters';
  $('message-stat').hidden = creator;
  $('open-profile').hidden = true;
  profileLink = null;
}
function setScope(value) {
  if (job || saving || opening || creator === value) return;
  creator = value; selectedBots.clear(); listedBots = []; route = null;
  $('bot-search').value = '';
  updateScope(); void loadBots();
}
$('chat-mode').onclick = () => setScope(false);
$('creator-mode').onclick = () => setScope(true);
$('open-profile').onclick = async () => {
  if (job || saving || opening || profileLink?.platform !== platform) return;
  try { await call('openCreatorProfile', { url: profileLink.url }); }
  catch (error) { listNotice(error.message); }
};
window.openBatchPicker = () => {
  if (job || saving || opening) return;
  selectedBots.clear(); listedBots = []; route = null; output = null; saved = false;
  $('bot-search').value = '';
  updateScope(); void loadBots();
};
async function closeBatchPicker() {
  if (job || saving) return;
  // A completed export returns to the source. A failed export returns to selection.
  if ($('export-dialog').open) {
    $('export-dialog').close();
    if (!output) return;
  }
  pickerRevision++; opening = false;
  await call('dismissPicker').catch(error => listNotice(error.message));
}
window.closeBatchPicker = closeBatchPicker;
function decode(base64) { const s = atob(base64); return Uint8Array.from(s, c => c.charCodeAt(0)); }
function encode(bytes) {
  let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
async function imageDownload(url, signal) {
  if (!BotPackage.mediaURL(url)) throw Error('Media host is not allowed');
  signal.throwIfAborted();
  const id = crypto.randomUUID();
  const cancel = () => { void call('imageCancel', { id }).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const meta = await call('imageDownload', { url, id });
    signal.throwIfAborted();
    const data = new Uint8Array(meta.size);
    for (let offset = 0; offset < data.length; offset += 131072) {
      signal.throwIfAborted(); data.set(decode(await call('imageRead', { id, offset })), offset);
    }
    return { data, ext: BotPackage.imageType(data) };
  } finally { signal.removeEventListener('abort', cancel); await call('imageCancel', { id }).catch(() => {}); }
}
function startExport(character = '') {
  job = new AbortController(); output = null; saved = false;
  $('export-character').textContent = character;
  $('export-character').hidden = !character;
  status('Preparing export…');
  setPhase('collecting'); showExport();
}
async function collectFreshChat(target, url, onCharacter, progress) {
  let expectedConversationId = null;
  if (target.platform === 'tipsy' && target.id === route?.id) {
    globalThis.chrome = { tabs: liveTabs };
    const source = await liveTabs.get();
    const { status } = await readChat(1, target, 'status', false);
    if (status.running) throw Error('This chat is already being exported. Wait for it to finish.');
    expectedConversationId = status.conversation_id || null;
    url = source.url;
  }
  job.signal.throwIfAborted();
  await call('openChatPage', { url });
  job.signal.throwIfAborted();
  globalThis.chrome = { tabs: workerTabs };
  const result = await collectBot({ tabId: 1, route: target, worker: true, expectedConversationId,
    signal: job.signal, progress, onCharacter, downloadImage: imageDownload });
  if (expectedConversationId) {
    globalThis.chrome = { tabs: liveTabs };
    const { status } = await readChat(1, target, 'status', false);
    if (status.conversation_id !== expectedConversationId) throw Error('The current chat changed. Export again.');
  }
  return result;
}
async function collect() {
  if (job || saving || opening || !route) return;
  startExport(listedBots.find(bot => bot.id === route.id)?.name);
  try {
    await call('busy', { value: true });
    const source = await liveTabs.get();
    const actual = BotModel.route(source.url);
    if (actual?.id !== route.id || actual.platform !== route.platform) throw Error('The source chat changed. Open Batch export again.');
    status('Loading the latest messages…');
    output = await collectFreshChat(route, source.url,
      name => { $('export-character').textContent = name; $('export-character').hidden = false; }, status);
    $('message-count').textContent = String(output.messages);
    $('image-count').textContent = String(output.images);
    $('result-label').textContent = output.partial ? 'Partial export ready' : 'Export ready';
    $('result').dataset.partial = String(output.partial);
    const megabytes = output.bytes.length >= 1024 * 1024;
    $('package-size').textContent = (output.bytes.length / (megabytes ? 1024 * 1024 : 1024)).toFixed(1);
    $('size-unit').textContent = megabytes ? 'MB' : 'KB';
    status(output.partial ? 'You can save the partial export. See the report for missing content.' : 'Save and unzip the export to view the character and chat.');
    setPhase('done');
  } catch (error) { status(error.message); setPhase('error'); }
  finally { await call('closeWorker').catch(() => {}); await call('busy', { value: false }).catch(() => {}); job = null; renderActions(); }
}
async function collectSelected() {
  if (job || saving || opening || !selectedBots.size) return;
  const bots = listedBots.filter(b => selectedBots.has(b.id));
  startExport();
  try {
    await call('busy', { value: true });
    const batch = await MobileBatch.run({ bots, signal: job.signal,
      successStatus: creator ? 'creator_settings_saved' : 'complete_current_conversation',
      progress: (index, total, bot) => {
        $('export-character').textContent = bot.name;
        $('export-character').hidden = false;
        status(`Exporting character ${index + 1} of ${total}…`);
      },
      collect: async bot => {
        const target = creator ? BotCreator.target(platform, bot.id, bot.url) : BotModel.route(bot.url);
        if (!target || target.platform !== platform) throw Error('Character belongs to a different source. Refresh the list.');
        const progress = text => status(`${bots.indexOf(bot) + 1} / ${bots.length} · ${text}`);
        if (creator) {
          job.signal.throwIfAborted();
          await call('openCreatorWorker', { url: target.url });
          await openCreatorEditor(workerTabs, 1, target, job.signal);
          return collectCreator({ tabs: workerTabs, tabId: 1, route: target, signal: job.signal, progress, downloadImage: imageDownload });
        }
        return collectFreshChat(target, bot.url, name => { $('export-character').textContent = name; }, progress);
      } });
    if (!batch.files.length) throw Error(batch.stopped ? 'Export stopped before any character packages were ready.' : batch.results[0]?.error || 'No character packages were created. Try again.');
    const count = batch.files.length;
    output = { files: batch.files, messages: batch.messages, images: batch.images, savedFiles: new Set() };
    $('message-count').textContent = String(output.messages); $('image-count').textContent = String(output.images);
    const mb = batch.bytes >= 1024 * 1024;
    $('package-size').textContent = (batch.bytes / (mb ? 1024 * 1024 : 1024)).toFixed(1); $('size-unit').textContent = mb ? 'MB' : 'KB';
    $('export-character').hidden = true;
    $('result-label').textContent = `${count} of ${bots.length} character packages ready`;
    $('result').dataset.partial = String(batch.partial);
    const issues = batch.results.filter(item => !['complete_current_conversation','creator_settings_saved'].includes(item.status));
    const explain = issues.slice(0, 5).map(item => {
      const name = bots.find(bot => bot.id === item.id)?.name || item.id;
      return `${name}: ${item.error || (item.status === 'partial' ? 'Partial; see the ZIP report.' : 'Skipped.')}`;
    });
    status([`Exported ${count} of ${bots.length} characters. Each character saves as a separate ZIP.`,
      ...explain, ...(issues.length > explain.length ? [`And ${issues.length - explain.length} more.`] : [])].join('\n'));
    setPhase('done');
  } catch (error) { status(error.message); setPhase('error'); }
  finally { await call('closeWorker').catch(() => {}); await call('busy', { value: false }).catch(() => {}); job = null; renderActions(); }
}
async function stageZip(file) {
  await call('zipBegin', { filename: file.filename, size: file.bytes.length });
  for (let offset = 0; offset < file.bytes.length; offset += 131072) {
    await call('zipChunk', { offset, data: encode(file.bytes.subarray(offset, offset + 131072)) });
  }
}
async function saveBatch(copy) {
  if (!output.folderChosen || copy) {
    if (!await call('chooseZipFolder', {}, 600000)) return false;
    output.folderChosen = true;
    if (copy) output.savedFiles.clear();
  }
  try {
    for (const file of output.files) {
      if (output.savedFiles.has(file)) continue;
      status(`Saving ${output.savedFiles.size + 1} of ${output.files.length} ZIPs…`);
      await stageZip(file);
      await call('zipSaveToFolder');
      output.savedFiles.add(file);
    }
    return true;
  } catch (error) {
    throw Error(`Saved ${output.savedFiles.size} of ${output.files.length} ZIPs. ${error.message} Tap Save ZIPs to retry the remaining files.`);
  }
}
async function save() {
  if (!output || saving || job) return;
  saving = true; status(output.files ? 'Choose a folder for the ZIPs.' : 'Choose where to save the ZIP.'); setPhase('saving');
  try {
    await call('busy', { value: true });
    if (!output.files) await stageZip(output);
    const result = output.files ? await saveBatch(saved) : await call('zipSave', {}, 600000);
    saved = output.files ? output.savedFiles.size === output.files.length : result || saved;
    status(result ? output.files ? `Saved ${output.files.length} separate ZIPs. Use Open ZIP on the toolbar to browse them.` : 'File saved. Unzip it and open README.html to view the export.' : 'Save canceled. You can still save this export.');
    setPhase(saved ? 'saved' : 'done');
  } catch (error) { if (output.files) saved = false; status(error.message); setPhase('error'); await call('zipAbort').catch(() => {}); }
  finally { await call('busy', { value: false }).catch(() => {}); saving = false; renderActions(); }
}
$('export').onclick = collect; $('save').onclick = save;
$('cancel-picker').onclick = closeBatchPicker;
$('close-export').onclick = closeBatchPicker;
$('export-dialog').oncancel = event => { event.preventDefault(); void closeBatchPicker(); };
$('bot-search').oninput = renderBots; $('load-list').onclick = loadBots;
$('export-selected').onclick = collectSelected;
$('select-visible').onchange = () => {
  for (const bot of matchingBots()) $('select-visible').checked ? selectedBots.add(bot.id) : selectedBots.delete(bot.id);
  renderSelection();
};
$('clear-selection').onclick = () => { selectedBots.clear(); renderSelection(); };
$('save-copy').onclick = save;
$('stop').onclick = () => {
  job?.abort(); $('stop').disabled = true;
  status('Stopping export…');
};
window.addEventListener('capture-background', () => { if (job) { job.abort(); status('Export stopped when RoleLeaf moved to the background. Check the export report.'); } });
$('share').onclick = () => call('share').catch(e => status(e.message));
