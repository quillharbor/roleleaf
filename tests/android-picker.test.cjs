const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = name => fs.readFileSync(`android/app/src/main/assets/${name}.js`, 'utf8');
const bots = [1, 2, 3].map(n => ({ id: `10000000${n}`, name: `Synthetic ${n}`, url: `https://tipsy.chat/chat/10000000${n}`, avatar: n === 1 ? 'https://img.tipsy.chat/avatar.png' : null }));
function fixture({ hydrate = false, changeConversation = false, cai = false, coldProfile = false, foreignProfile = false } = {}) {
  const nodes = new Map(), opened = [], written = [], calls = [];
  let staged, creatorReads = 0, creatorGeneration = 0;
  const element = () => ({ value: '', textContent: '', children: [], dataset: {}, hidden: false,
    get firstElementChild() { return this.children[0]; },
    showModal() { this.open = true; }, close() { this.open = false; },
    setAttribute(key, value) { this[key] = value; },
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; } });
  const node = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const current = cai ? 'https://character.ai/' : 'https://tipsy.chat/chat/100000002?conversation_id=current&language_code=en';
  let worker, listReads = 0, dismissed = 0, statusReads = 0, generation = 0, ownTab = false;
  const accountBots = hydrate ? Array.from({ length: 30 }, (_, i) => ({ id: String(100000001 + i), name: `Synthetic ${i + 1}`, url: `https://tipsy.chat/chat/${100000001 + i}` })) : bots;
  const env = vm.createContext({ URL, TextEncoder, btoa, Uint8Array, AbortController, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)), clearTimeout,
    document: { getElementById: node, createElement: element, body: element() },
    window: { addEventListener() {} },
    NativeApp: { postMessage(raw) {
      const { id, method, params } = JSON.parse(raw); let data = true;
      calls.push(method);
      if (method === 'zipBegin') staged = params.filename;
      if (method === 'zipSaveToFolder') written.push(staged);
      if (method === 'current') data = { platform: cai ? 'character_ai' : 'tipsy', url: params.worker ? worker : current, title: 'Tipsy' };
      if (method === 'capture') {
        if (params.message.type === 'TIPSY_CHAT') {
          data = { ok: true, status: { character_id: '100000002', conversation_id: changeConversation && ++statusReads > 1 ? 'changed' : 'current' } };
        } else {
        const onRecent = params.worker && worker?.endsWith('/recent');
        data = { found: onRecent, bots: onRecent ? accountBots.slice(0, hydrate && ++listReads <= 3 ? 17 : accountBots.length) : [] };
        }
      }
      if (!cai && method === 'capture' && params.message.type === 'BOT_CREATOR') {
        const profile = 'https://tipsy.chat/zh-tw/profile/100000099';
        if (params.message.action === 'profile') data = { ok: true, url: coldProfile && !params.worker ? null : profile };
        if (params.message.action === 'list') {
          const found = params.worker && worker === profile;
          data = { ok: !!found, platform: 'tipsy', more: found && ++creatorReads < 3, bots: found ? bots.slice(0, creatorReads < 3 ? 1 : 3).map(bot => ({...bot,
            name: 'Own ' + creatorGeneration + ' ' + bot.name, url: foreignProfile ? 'https://tipsy.chat/profile/100000088' : profile })) : [] };
        }
      }
      if (method === 'openCreatorWorker') { worker = params.url; creatorReads = 0; creatorGeneration++; }
      if (cai && method === 'capture') {
        const own = worker?.endsWith('/profile');
        if (params.message.type === 'BOT_ANDROID_LIST') ownTab = own;
        const found = params.worker && worker && (!own || ownTab);
        // Mobile home has no sidebar. The background page hydrates incrementally.
        const count = ++listReads < 3 ? 1 : 2;
        data = { ok: !!found, found: !!found, platform: 'character_ai', bots: found ? [1, 2].slice(0, count).map(n => ({
          id: `Cai_Bot${n}`, name: `${own ? 'Own' : 'Recent'} ${generation}-${n}`,
          url: `https://character.ai/${own ? 'character' : 'chat'}/Cai_Bot${n}${own ? '/edit' : ''}`,
        })) : [], reason: 'profile' };
      }
      if (cai && method === 'capture' && params.message.scope === 'profile') data = { ok: true, url: 'https://character.ai/profile/synthetic' };
      if (method === 'openCaiList') { generation++; listReads = 0; ownTab = false; worker = 'https://character.ai/' + (params.scope === 'creator' ? 'profile' : ''); }
      if (method === 'openRecent') worker = 'https://tipsy.chat/chat/recent';
      if (method === 'openChatPage') { opened.push(params.url); worker = params.url; }
      if (method === 'closeWorker') worker = null;
      if (method === 'dismissPicker') dismissed++;
      queueMicrotask(() => env.window.nativeReply({ id, ok: true, data }));
    } },
    BotPackage: { mediaURL: url => url?.startsWith('https://img.tipsy.chat/') },
    collectBot: async ({ route, onCharacter }) => { onCharacter('Synthetic fixture'); return { bytes: new Uint8Array(10), messages: 2, images: 1, partial: false, filename: `${route.id}.zip` }; },
  });
  vm.runInContext(fs.readFileSync('tipsy-exporter/collect-bot.js', 'utf8').split('async function readCharacter')[0], env);
  for (const file of ['core', 'bot-model', 'bot-creator']) vm.runInContext(fs.readFileSync(`tipsy-exporter/${file}.js`, 'utf8'), env);
  vm.runInContext(source('mobile-batch'), env); vm.runInContext(source('mobile'), env);
  return { env, node, opened, written, calls, dismissed: () => dismissed };
}
async function ready(f) {
  vm.runInContext('window.openBatchPicker()', f.env);
  for (let i = 0; i < 100 && vm.runInContext('opening', f.env); i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(vm.runInContext('opening', f.env), false);
}
test('Android renders recent bots, searches and selects only visible results', async () => {
  const f = fixture(); await ready(f);
  assert.equal(f.node('bot-list').children.length, 3);
  const avatars = f.node('bot-list').children.map(row => row.children[1]);
  assert.equal(avatars[0].children[0].src, '/avatar?url=https%3A%2F%2Fimg.tipsy.chat%2Favatar.png');
  assert.equal(avatars[1].children.length, 0);
  f.node('bot-search').value = '100000002'; f.node('bot-search').oninput();
  assert.equal(f.node('bot-list').children.length, 1);
  f.node('select-visible').checked = true; f.node('select-visible').onchange();
  assert.equal(f.node('export-selected').textContent, 'Export (1)');
  assert.equal(f.node('export-selected').hidden, false);
  f.node('bot-search').value = ''; f.node('bot-search').oninput();
  assert.equal(f.node('select-visible').indeterminate, true);
  assert.equal(f.node('bot-list').children.length, 3);
  assert.deepEqual(f.opened, [], 'selecting a character does not navigate');
  assert.equal(await vm.runInContext('liveTabs.get().then(tab => tab.url)', f.env), 'https://tipsy.chat/chat/100000002?conversation_id=current&language_code=en');
});
test('Android cold start waits for incremental hydration from 17 to 30 recent bots', async () => {
  const f = fixture({ hydrate: true }); await ready(f);
  assert.equal(f.node('bot-list').children.length, 30);
  assert.equal(f.node('list-count').textContent, '30 characters loaded');
});
test('Android batch opens one folder picker and writes one ZIP per selected bot', async () => {
  const f = fixture(); await ready(f);
  await vm.runInContext("selectedBots.add('100000001');selectedBots.add('100000003');collectSelected()", f.env);
  assert.deepEqual(f.opened, ['https://tipsy.chat/chat/100000001', 'https://tipsy.chat/chat/100000003']);
  await vm.runInContext('save()', f.env);
  assert.deepEqual(f.written, ['100000001.zip', '100000003.zip']);
  assert.equal(f.calls.filter(method => method === 'chooseZipFolder').length, 1);
  assert.equal(f.node('result-label').textContent, '2 of 2 character packages ready');
  assert.equal(f.node('message-count').textContent, '4');
  assert.equal(f.node('save').hidden, true);
  assert.equal(f.node('export-dialog').open, true);
  await f.node('close-export').onclick();
  assert.equal(f.node('export-dialog').open, false);
  assert.equal(f.dismissed(), 1);
  assert.equal(await vm.runInContext('liveTabs.get().then(tab => tab.url)', f.env), 'https://tipsy.chat/chat/100000002?conversation_id=current&language_code=en');
});
test('Android batch preserves the active Tipsy URL and rejects a changed conversation', async () => {
  const f = fixture({ changeConversation: true }); await ready(f);
  await vm.runInContext("selectedBots.add('100000002');collectSelected()", f.env);
  assert.deepEqual(f.opened, ['https://tipsy.chat/chat/100000002?conversation_id=current&language_code=en']);
  assert.equal(f.node('save').hidden, true);
  assert.match(f.node('status').textContent, /current chat changed/i);
});
test('Android batch retains finished ZIPs on failure, cancellation and size cap', async () => {
  const env = vm.createContext({}); vm.runInContext(source('mobile-batch'), env);
  for (const mode of ['failure', 'cancel', 'limit']) {
    const controller = new AbortController(); let calls = 0;
    const result = await env.MobileBatch.run({ bots, signal: controller.signal, limit: mode === 'limit' ? 15 : 100,
      progress() {}, collect: async () => { calls++; if (calls === 2 && mode === 'failure') throw Error('Synthetic failure');
        if (calls === 2 && mode === 'cancel') { controller.abort(); throw Error('Stopped'); }
        return { bytes: new Uint8Array(10), messages: 2, images: 1, partial: false }; } });
    assert.equal(result.files.length, mode === 'failure' ? 2 : 1);
    assert.equal(result.partial, true);
    assert.equal(result.results.length, 3);
    if (mode !== 'failure') assert.equal(result.results[2].status, 'skipped');
  }
});

test('C.AI mobile home automatically loads fresh Recent and My Characters without source navigation', async () => {
  const f = fixture({ cai: true }); await ready(f);
  assert.equal(f.node('bot-list').children.length, 2);
  assert.match(vm.runInContext('listedBots[0].name', f.env), /^Recent 1-/);
  assert.equal(f.node('open-profile').hidden, true);
  assert.ok(f.calls.includes('openCaiList'));
  assert.ok(!f.calls.includes('openRecent'));
  f.node('creator-mode').onclick();
  for (let i = 0; i < 100 && vm.runInContext('opening', f.env); i++) await new Promise(r => setTimeout(r, 5));
  assert.match(vm.runInContext('listedBots[0].name', f.env), /^Own 2-/);
  assert.equal(f.node('bot-list').children.length, 2);
  assert.equal(f.node('open-profile').hidden, true);
  f.node('chat-mode').onclick();
  for (let i = 0; i < 100 && vm.runInContext('opening', f.env); i++) await new Promise(r => setTimeout(r, 5));
  assert.match(vm.runInContext('listedBots[0].name', f.env), /^Recent 3-/);
  await vm.runInContext('closeBatchPicker()', f.env); await ready(f);
  assert.match(vm.runInContext('listedBots[0].name', f.env), /^Recent 4-/);
  assert.equal(await vm.runInContext('liveTabs.get().then(tab=>tab.url)', f.env), 'https://character.ai/');
  assert.equal(f.calls.filter(x=>x==='openCreatorProfile').length, 0);
});

test('Android C.AI resolves the signed-in profile and only selects Characters on the own profile', () => {
  let handler, clicked = 0, username = 'synthetic_owner';
  let keys = ['characters', 'liked', 'personas'];
  const env = {
    chrome: { runtime: { id: 'android', onMessage: { addListener: fn => { handler = fn; } } } },
    BotCreator: { profile: () => true }, location: { href: 'https://character.ai/profile/synthetic_owner' },
    document: {
      getElementById: () => ({ textContent: JSON.stringify({ props: { pageProps: { user: { user: { username } } } } }) }),
      querySelectorAll: () => keys.map(key => ({
        getAttribute: name => name === 'aria-controls' ? 'content-' + key : 'false',
        click: () => { clicked++; },
      })),
    },
  };
  vm.runInNewContext(source('cai-list'), env);
  let result;
  const request = scope => handler({ type: 'BOT_ANDROID_LIST', scope }, { id: 'android' }, value => { result = value; });
  request('profile'); assert.equal(result.url, 'https://character.ai/profile/synthetic_owner');
  request('creator'); assert.equal(clicked, 1);
  keys = ['characters']; request('creator'); assert.equal(clicked, 1, 'Do not operate another user’s profile');
  for (username of [undefined, '../another', '']) { request('profile'); assert.equal(result.url, null); }
});

for (const coldProfile of [false, true]) test(`Tipsy My Characters loads in background from a chat (cold profile: ${coldProfile})`, async () => {
  const f = fixture({ coldProfile });
  vm.runInContext('creator = true', f.env); await ready(f);
  assert.equal(f.node('bot-list').children.length, 3);
  assert.equal(f.node('open-profile').hidden, true);
  assert.equal(f.node('list-notice').textContent, '');
  assert.ok(f.calls.includes('openCreatorWorker'));
  assert.equal(f.calls.includes('openRecent'), coldProfile);
  assert.ok(!f.calls.includes('openCreatorProfile'));
  assert.match(vm.runInContext('listedBots[0].name', f.env), /^Own 1 /);
  await vm.runInContext('loadBots()', f.env);
  assert.match(vm.runInContext('listedBots[0].name', f.env), /^Own 2 /);
  assert.equal(await vm.runInContext('liveTabs.get().then(t=>t.url)', f.env), 'https://tipsy.chat/chat/100000002?conversation_id=current&language_code=en');
});
test('Tipsy creator list rejects characters attributed to a different profile', async () => {
  const f = fixture({ foreignProfile: true });
  vm.runInContext('creator = true', f.env); await ready(f);
  assert.equal(f.node('bot-list').children.length, 0);
  assert.equal(f.node('list-notice').textContent, 'No saved characters found.');
});
