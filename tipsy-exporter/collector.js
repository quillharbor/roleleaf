/* global BotModel, collectBot, readChat, saveBot, chrome */
'use strict';

const $ = id => document.getElementById(id);
const { t, render } = RoleLeafI18n;
render();
const params = new URL(location.href).searchParams;
const sourceTab = Number(params.get('tab'));
const batchId = params.get('batch');
const statuses = {
  pending: 'Queued', running: 'Exporting', saved: 'Saved',
  partial: 'Saved · Partial', failed: 'Failed', skipped: 'Skipped',
};
let controller, working = false, workerTab, job;

$('version').textContent = t('BOT EXPORTER') + ' · ' + chrome.runtime.getManifest().version;

function showProgress(text, error = false) {
  $('progress').textContent = t(text);
  $('progress').classList.toggle('error', error);
}

function startTask() {
  if (working) return false;
  working = true;
  controller = new AbortController();
  $('stop').disabled = false;
  $('retry').hidden = true;
  return true;
}

function finishTask(retry) {
  working = false;
  $('stop').disabled = true;
  $('retry').hidden = !retry;
}

function counts(output) {
  return t("Images: {saved} of {total} · Messages: {messages}", { saved: output.images, total: output.imageCount, messages: output.messages });
}

async function collectSelectedBot({ route, url, current, progress, onCharacter }) {
  let expectedConversationId = null;
  if (current && route.platform === 'tipsy') {
    // The source page observes initial history, but subsequent streamed replies
    // are not history responses. Capture a new normal page load for each export.
    const tab = await chrome.tabs.get(sourceTab);
    const actual = BotModel.route(tab.url);
    if (actual?.platform !== route.platform || actual.id !== route.id) {
      throw Error('The source chat changed. Select the character again.');
    }
    const { status } = await readChat(sourceTab, route, 'status', false);
    if (status.running) throw Error('This chat is already being exported. Wait for it to finish.');
    expectedConversationId = status.conversation_id || null;
    url = tab.url; // Preserve any explicit conversation/language query.
  }
  controller.signal.throwIfAborted();
  const worker = route.platform === 'tipsy' || !current;
  if (worker) {
    progress(t('Reloading chat history to get the latest messages…'));
    const tab = await chrome.tabs.create({ url, active: false });
    workerTab = tab.id;
    controller.signal.throwIfAborted();
  }
  const output = await collectBot({
    tabId: worker ? workerTab : sourceTab, route, worker, expectedConversationId,
    signal: controller.signal, progress, onCharacter,
  });
  if (current && route.platform === 'tipsy') {
    const { status } = await readChat(sourceTab, route, 'status', false);
    if (expectedConversationId && status.conversation_id !== expectedConversationId) {
      throw Error('The current chat changed. Export again.');
    }
  }
  return output;
}

async function runSingle() {
  if (!startTask()) return;
  $('summary').textContent = '';
  showProgress('Connecting to source page…');
  try {
    const tab = await chrome.tabs.get(sourceTab);
    const route = BotModel.route(tab.url);
    if (!route) throw Error('Open a character chat on Tipsy or Character.AI to export it.');
    const output = await collectSelectedBot({
      route, url: tab.url, current: true,
      progress: showProgress, onCharacter: name => { $('name').textContent = name; },
    });
    $('summary').textContent =
      counts(output) + ' · ' + t('Chats: {count}', { count: output.conversations }) + '\n' + t('See the export report for coverage and missing content.');
    $('stop').disabled = true;
    showProgress('Export ready. Choose where to save it.');
    await saveBot(output, { saveAs: true });
    showProgress('Character ZIP saved.');
    $('summary').textContent += '\n' + t('File saved. Unzip it and open README.html.');
  } catch (error) {
    showProgress(error.message || 'Export failed.', true);
  } finally {
    await closeWorker();
    finishTask(true);
  }
}

async function loadBatch() {
  if (!/^[a-f0-9-]{36}$/.test(batchId)) throw Error('Invalid export job ID.');
  const key = `batch:${batchId}`;
  const stored = (await chrome.storage.session.get(key))[key];
  if (!stored || stored.sourceTab !== sourceTab || !stored.bots?.length) {
    throw Error('This queue is already open or has expired. Select the characters again.');
  }
  const ids = new Set();
  const bots = stored.bots.map(({ id, url, name }) => {
    const route = stored.creator ? BotCreator.target(stored.platform, id, url) : BotModel.route(url);
    if (route?.platform !== stored.platform || route?.id !== id || ids.has(id) || typeof name !== 'string') {
      throw Error('The queue contains an invalid character. Refresh the sidebar and select again.');
    }
    ids.add(id);
    return { id, url, name, route, status: 'pending', detail: '' };
  });
  await chrome.storage.session.remove(key);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    bots, currentId: stored.currentId, creator: stored.creator === true,
    folder: `RoleLeaf/${stored.platform}_${timestamp}_${batchId.slice(0, 8)}`,
  };
}

function renderBatch() {
  const rows = job.bots.map(bot => {
    const row = document.createElement('li');
    const label = document.createElement('strong');
    const state = document.createElement('span');
    const detail = document.createElement('small');
    label.dir = 'auto';
    label.textContent = bot.name;
    state.className = `queue-status ${bot.status}`;
    state.textContent = t(statuses[bot.status]);
    detail.textContent = t(bot.detail);
    row.append(label, state, detail);
    if (bot.status === 'partial') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'queue-retry';
      retry.textContent = t('Retry this character');
      retry.disabled = working;
      retry.onclick = () => runBatch([bot]);
      row.append(retry);
    }
    return row;
  });
  $('queue').replaceChildren(...rows);
}

async function closeWorker() {
  if (workerTab == null) return;
  const id = workerTab;
  workerTab = null;
  await chrome.tabs.remove(id).catch(() => {});
}

async function runBot(bot) {
  const previousPartial = bot.status === 'partial' ? bot.savedDetail : null;
  bot.status = 'running';
  bot.detail = job.creator ? 'Opening character editor…' : 'Opening chat…';
  renderBatch();
  try {
    const progress = detail => { bot.detail = detail; renderBatch(); };
    let output;
    if (job.creator) {
      workerTab = (await chrome.tabs.create({ url: bot.route.url, active: false })).id;
      if (bot.route.platform === 'tipsy') {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          controller.signal.throwIfAborted();
          const state = await chrome.tabs.get(workerTab);
          if (state.status === 'complete') break;
          await collectionDelay(350);
        }
      }
      await openCreatorEditor(chrome.tabs, workerTab, bot.route, controller.signal);
      output = await collectCreator({ tabId: workerTab, route: bot.route, signal: controller.signal, progress });
    } else {
      output = await collectSelectedBot({
        route: bot.route, url: bot.url, current: bot.id === job.currentId, progress,
        onCharacter: name => { bot.name = name; },
      });
    }
    bot.detail = 'Saving ZIP…';
    renderBatch();
    await saveBot(output, { folder: job.folder, saveAs: false });
    bot.status = output.partial ? 'partial' : 'saved';
    bot.detail = job.creator ? t("Images: {saved} of {total} · Creator settings", { saved: output.images, total: output.imageCount }) : counts(output);
    if (output.partial && output.partialReason) bot.detail += ' · ' + t(output.partialReason);
    bot.savedDetail = bot.detail;
  } catch (error) {
    bot.status = controller.signal.aborted && error === controller.signal.reason ? 'skipped' : 'failed';
    bot.detail = bot.status === 'skipped' ? 'Export stopped.' : error.message || 'Export failed.';
    if (previousPartial !== null) {
      bot.status = 'partial';
      bot.detail = previousPartial + ' · ' + t('Retry failed: {reason}', { reason: t(bot.detail) });
    }
  } finally {
    await closeWorker();
    renderBatch();
  }
}

async function runBatch(pending = job.bots.filter(bot => ['pending', 'failed', 'skipped'].includes(bot.status))) {
  if (!startTask()) return;
  for (const bot of pending) {
    if (bot.status !== 'partial') Object.assign(bot, { status: 'pending', detail: '' });
  }
  renderBatch();
  for (const [index, bot] of pending.entries()) {
    if (controller.signal.aborted) break;
    showProgress(t("Exporting {current} of {total}", { current: index + 1, total: pending.length }));
    await runBot(bot);
  }
  for (const bot of pending.filter(bot => bot.status === 'pending')) {
    Object.assign(bot, { status: 'skipped', detail: 'Export stopped.' });
  }

  const saved = job.bots.filter(bot => ['saved', 'partial'].includes(bot.status)).length;
  const failed = job.bots.filter(bot => bot.status === 'failed').length;
  const skipped = job.bots.filter(bot => bot.status === 'skipped').length;
  showProgress(controller.signal.aborted ? 'Queue stopped.' : 'Queue finished.');
  $('summary').textContent = t("Saved: {saved} · Failed: {failed} · Skipped: {skipped}", { saved, failed, skipped });
  finishTask(failed + skipped > 0);
  renderBatch();
}

$('stop').onclick = () => {
  controller?.abort();
  $('stop').disabled = true;
  showProgress(batchId ? 'Stopping the queue and saving available content…' : 'Stopping and saving available content…');
};

window.addEventListener('pagehide', () => {
  controller?.abort();
  void closeWorker();
});

if (batchId) {
  $('name').textContent = t('Batch export');
  $('batch').hidden = false;
  $('stop').textContent = t('Stop queue');
  $('retry').textContent = t('Retry failed or skipped items');
  $('retry').onclick = () => runBatch();
  loadBatch().then(loaded => {
    job = loaded;
    if (job.creator) $('name').textContent = t('My Characters export');
    $('destination').textContent = t("Chrome downloads / {folder}", { folder: job.folder });
    return runBatch();
  }).catch(error => showProgress(error.message, true));
} else {
  $('retry').onclick = runSingle;
  runSingle();
}
