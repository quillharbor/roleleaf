/* global BotModel, BotPackage, TipsyExporterPNG, chrome */
'use strict';

const collectionDelay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readChat(tabId, route, action, worker) {
  const tab = await chrome.tabs.get(tabId);
  const actual = BotModel.route(tab.url);
  // Chrome may omit the URL of a background tab. The site's bridge also
  // validates the requested character against its own document location.
  if ((!worker || tab.url) && (actual?.id !== route.id || actual?.platform !== route.platform)) {
    throw Error('The chat page changed or closed.');
  }

  const result = await chrome.tabs.sendMessage(tabId, {
    type: route.platform === 'tipsy' ? 'TIPSY_CHAT' : 'BOT_CAI',
    action,
    characterId: route.id,
  }, { frameId: 0 });
  if (!result?.ok || result.status?.character_id !== route.id) {
    throw Error('Chat capture is unavailable or a different character is open.');
  }
  return result;
}

async function readCharacter(tabId, route, worker) {
  if (route.platform === 'character_ai') {
    return (await readChat(tabId, route, 'export', worker)).entry;
  }
  const result = await chrome.tabs.sendMessage(tabId, { type: 'TIPSY_GET_CURRENT' }, { frameId: 0 });
  return result?.ok ? result.entry : null;
}

async function waitForCharacter({ tabId, route, worker, expectedConversationId, signal, progress }) {
  if (!worker) {
    const entry = await readCharacter(tabId, route, worker);
    if (!entry) throw Error('Character data is unavailable. Refresh the chat page and try again.');
    return BotModel.normalize(route, entry);
  }

  progress('Waiting for the chat to load…');
  const deadline = Date.now() + 30000;
  let model;
  do {
    signal.throwIfAborted();
    try {
      const entry = await readCharacter(tabId, route, worker);
      if (entry) {
        model = BotModel.normalize(route, entry);
        const { status } = await readChat(tabId, route, 'status', worker);
        if (status.latest_page_captured && (!expectedConversationId || status.conversation_id)) return model;
      }
    } catch {
      // The normal site and its document_start scripts may still be loading.
    }
    await collectionDelay(700);
  } while (Date.now() < deadline);
  signal.throwIfAborted();
  if (model) throw Error('No recent history received after 30 seconds. Let the page finish loading and try again.');
  throw Error('No character data received after 30 seconds. Sign in and open the chat, then try again.');
}

function readConversations(route, snapshot) {
  return route.platform === 'tipsy'
    ? [BotModel.tipsyMessages(snapshot.data)]
    : snapshot.conversations;
}

async function createPngCard(data, card) {
  const bitmap = await createImageBitmap(new Blob([data]));
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw Error('Could not convert the image to PNG');
    return TipsyExporterPNG.embed(new Uint8Array(await blob.arrayBuffer()), card);
  } finally {
    bitmap.close();
  }
}

function addChatImages(model, conversations) {
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      const add = url => model.assets.push({
        role: 'message_image', url, conversation_id: conversation.id, message_id: message.id,
      });
      const texts = [message.content, ...(message.candidates ?? []).map(candidate => candidate.raw_content)];
      for (const content of texts) {
        if (typeof content !== 'string') continue;
        for (const match of content.matchAll(/!\[[^\]]*\]\((https:\/\/[^\s)]+)\)/g)) add(match[1]);
      }
      for (const key of ['image_url', 'image_uri']) {
        if (typeof message.source?.[key] === 'string') add(message.source[key]);
      }
    }
  }
}

async function collectImages(model, signal, progress, warnings, downloadImage) {
  const assets = [], files = [], byURL = new Map(), byHash = new Map();
  let totalBytes = 0, cardPNG = null;
  const limit = Math.min(100, model.assets.length);
  if (model.assets.length > limit) warnings.push('Only the first 100 images were processed. Original references remain in the character or message data.');

  for (const asset of model.assets.slice(0, limit)) {
    progress(globalThis.RoleLeafI18n?.t('Images processed: {count} of {total}', { count: assets.length, total: limit }) ?? `Images processed: ${assets.length} of ${limit}`);
    const record = { ...asset, status: 'failed', path: null };
    assets.push(record);
    if (signal.aborted) {
      record.error = 'Stopped by user';
      continue;
    }

    try {
      let saved = byURL.get(asset.url);
      if (!saved) {
        const controller = new AbortController();
        const stop = () => controller.abort();
        signal.addEventListener('abort', stop, { once: true });
        const timeout = setTimeout(stop, 15000);
        let image;
        try {
          image = await downloadImage(asset.url, controller.signal);
        } finally {
          clearTimeout(timeout);
          signal.removeEventListener('abort', stop);
        }
        totalBytes += image.data.length;
        if (totalBytes > 64 * 1024 * 1024) throw Error('Images exceed the combined 64 MB limit');
        const hash = await BotPackage.sha(image.data);
        saved = byHash.get(hash);
        if (!saved) {
          saved = { path: `assets/${hash}.${image.ext}`, data: image.data, sha256: hash };
          files.push({ path: saved.path, data: saved.data });
          byHash.set(hash, saved);
        }
        byURL.set(asset.url, saved);
      }
      Object.assign(record, { path: saved.path, status: 'saved', sha256: saved.sha256 });
      if (asset.role === 'avatar' && !cardPNG) {
        try { cardPNG = await createPngCard(saved.data, model.card); }
        catch (error) { warnings.push(error.message); }
      }
    } catch (error) {
      record.error = error.message;
    }
  }
  return { assets, files, cardPNG };
}

async function collectBot({ tabId, route, worker = false, expectedConversationId = null, signal, progress, onCharacter,
  downloadImage = BotPackage.downloadImage }) {
  const started = new Date().toISOString();
  const warnings = [];
  const command = action => readChat(tabId, route, action, worker);
  let ownsCapture = false;
  try {
    const character = await waitForCharacter({ tabId, route, worker, expectedConversationId, signal, progress });
    const model = { id: character.id, platform: character.platform, name: character.name, assets: [] };
    onCharacter(model.name);
    const before = (await command('status')).status;
    if (before.running) throw Error('This chat is already being exported. Wait for it to finish.');
    if (expectedConversationId && before.conversation_id !== expectedConversationId) {
      throw Error('The reloaded chat differs from the source page. Check the current chat and try again.');
    }
    let state = before;
    let stopped = signal.aborted;
    if (!stopped) {
      progress('Character data received. Reading the current chat history…');
      state = (await command('start')).status;
      ownsCapture = state.running;
    }

    let conversationId = state.conversation_id || null;
    const deadline = Date.now() + 610000;
    while (state.running && !stopped) {
      progress(globalThis.RoleLeafI18n?.t('Collected {count} messages. Loading earlier messages…', { count: state.records || 0 }) ?? `${state.records || 0} messages collected. Loading earlier messages…`);
      await collectionDelay(800);
      state = (await command('status')).status;
      if (conversationId && state.conversation_id && conversationId !== state.conversation_id) {
        throw Error('The current chat changed. Export again.');
      }
      conversationId ||= state.conversation_id || null;
      stopped = signal.aborted || Date.now() > deadline;
      if (stopped && !signal.aborted) warnings.push('Chat export reached the time limit.');
    }
    if (stopped && ownsCapture) await command('cancel');
    ownsCapture = false;

    const snapshot = await command('export');
    const conversations = readConversations(route, snapshot);
    if (conversationId && conversations.some(conversation => conversation.id !== conversationId)) {
      throw Error('The current chat changed. Export again.');
    }
    const scope = snapshot.scope || {
      requested: 'all_bot_conversations', actual: 'current_conversation',
      conversation_list_complete: false, archived_checked: false,
    };
    addChatImages(model, conversations);
    const media = await collectImages(model, signal, progress, warnings, downloadImage);
    const final = readConversations(route, await command('export'));
    const fingerprint = items => JSON.stringify(items.map(item => [item.id, item.completeness.error, item.messages]));
    if (fingerprint(final) !== fingerprint(conversations)) {
      throw Error('The chat or its messages changed during export. Keep the chat unchanged and try again.');
    }

    progress('Creating the character ZIP…');
    const output = await BotPackage.build({
      model, conversations, scope, ...media, started, stopped: stopped || signal.aborted, warnings,
    });
    const filename = `${route.platform}_${BotModel.safe(model.name)}_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    return {
      bytes: output.bytes,
      filename,
      messages: conversations.reduce((count, conversation) => count + conversation.messages.length, 0),
      conversations: conversations.length,
      images: media.assets.filter(asset => asset.status === 'saved').length,
      imageCount: media.assets.length,
      partialReason: output.report.chats.conversations?.find(conversation => conversation.error)?.error,
      partial: output.report.chats.status !== 'captured_mainlines_complete' ||
        output.report.images.status === 'partial' || output.report.stopped ||
        model.assets.length > media.assets.length,
    };
  } finally {
    if (ownsCapture) await command('cancel').catch(() => {});
  }
}

async function saveBot(output, { folder, saveAs }) {
  const url = URL.createObjectURL(new Blob([output.bytes], { type: 'application/zip' }));
  let id, timer;
  const early = new Map();
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  function changed(delta) {
    const state = delta.state?.current;
    if (state !== 'complete' && state !== 'interrupted') return;
    if (id === undefined) early.set(delta.id, state);
    else if (delta.id === id) finish(state);
  }

  chrome.downloads.onChanged.addListener(changed);
  try {
    id = await chrome.downloads.download({
      url, filename: folder ? `${folder}/${output.filename}` : output.filename,
      conflictAction: 'uniquify', saveAs,
    });
    if (!Number.isInteger(id)) throw Error('Chrome did not start the download.');
    if (early.has(id)) finish(early.get(id));
    timer = setTimeout(() => finish('timeout'), 120000);
    const state = await completed;
    if (state === 'timeout') {
      await chrome.downloads.cancel(id).catch(() => {});
      const [download] = await chrome.downloads.search({ id }).catch(() => []);
      if (download?.state === 'complete') return id;
      throw Error('The save timed out. Check Chrome downloads and try again.');
    }
    if (state !== 'complete') throw Error('The download was canceled or interrupted.');
    return id;
  } finally {
    clearTimeout(timer);
    chrome.downloads.onChanged.removeListener(changed);
    URL.revokeObjectURL(url);
  }
}

async function collectCreator({ tabId, route, tabs = chrome.tabs, signal, progress,
  downloadImage = BotPackage.downloadImage }) {
  const started = new Date().toISOString();
  const warnings = [];
  const deadline = Date.now() + 20000;
  let model;
  progress('Reading saved character settings…');
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const result = await tabs.sendMessage(tabId, { type: 'BOT_CREATOR', action: 'read', characterId: route.id }).catch(() => null);
    signal.throwIfAborted();
    if (result?.ok) {
      model = BotCreator.model(route, result.data);
      break;
    }
    if (result?.reason === 'forbidden') throw Error('This character is not editable by the signed-in account.');
    await collectionDelay(450);
  }
  if (!model) throw Error('Could not read the saved editor. Open the character from your own profile and try again.');
  const media = await collectImages(model, signal, progress, warnings, downloadImage);
  signal.throwIfAborted();
  progress('Creating the creator ZIP…');
  const scope = { requested: 'creator_character', actual: 'creator_character' };
  const output = await BotPackage.build({ model, conversations: [], scope, ...media, started, warnings });
  signal.throwIfAborted();
  return {
    bytes: output.bytes,
    filename: `${route.platform}_creator_${BotModel.safe(model.name)}_${route.id}_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`,
    messages: 0, conversations: 0, images: media.assets.filter(asset => asset.status === 'saved').length,
    imageCount: media.assets.length, partial: output.report.character.status === 'partial' ||
      output.report.images.status === 'partial' || model.assets.length > media.assets.length,
  };
}

async function openCreatorEditor(tabs, tabId, route, signal) {
  if (route.platform !== 'tipsy') return;
  signal.throwIfAborted();
  const result = await tabs.sendMessage(tabId, { type: 'BOT_CREATOR', action: 'open_editor', characterId: route.id });
  signal.throwIfAborted();
  if (!result?.ok) throw Error('Could not open this character’s Edit menu on your Tipsy profile. Refresh the list and try again.');
}
