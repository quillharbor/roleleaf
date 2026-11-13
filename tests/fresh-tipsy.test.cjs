const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { setTimeout: delay } = require('node:timers/promises');

function setup({ differentConversation = false, missingLatest = false } = {}) {
  const id = '100000001', sourceURL = `https://tipsy.chat/chat/${id}?conversation=keep`;
  const nodes = new Map(), opened = [], closed = [], packages = [], saved = [];
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, { textContent: '', classList: { toggle() {} } });
    return nodes.get(key);
  };
  const env = vm.createContext({
    URL, TextEncoder, TextDecoder, Uint8Array, AbortController,
    // Fast-forward loading deadlines without waiting 30 seconds in tests.
    Date: class extends Date { static now() { return missingLatest ? (this.tick = (this.tick || 0) + 10000) : Date.now(); } },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 1)), clearTimeout,
    window: { addEventListener() {} },
    location: { href: 'https://extension.test/collector.html?tab=1' },
    document: { getElementById: node },
    chrome: {
      runtime: { getManifest: () => ({ version: 'test' }) },
      tabs: {
        get: async () => ({ url: sourceURL }),
        create: async options => { opened.push(options); return { id: 2 }; },
        remove: async id => { closed.push(id); },
        sendMessage: async (tabId, message) => {
          if (message.type === 'TIPSY_GET_CURRENT') return { ok: true, entry: {
            capturedAt: '2026-11-09T01:00:00Z', source: { character: { character_id: id, nickname: 'Synthetic' } },
          } };
          const cid = tabId === 2 && differentConversation ? 'another-conversation' : 'current-conversation';
          // The original page retains its entry-time cache, while a newly loaded
          // page receives the user's later messages from normal site history.
          const contents = tabId === 1 ? ['initial'] : ['initial', 'new user message', 'new character reply'];
          return { ok: true,
            status: { character_id: id, conversation_id: cid, running: false, latest_page_captured: !missingLatest },
            data: { source: { conversation_id: cid }, completeness: { complete_current_mainline: true }, pages: [],
              records: contents.map((content, i) => ({ sequence: String(i + 1), content, sender_type: i === 1 ? 'user' : 'character', content_type: 'text' })) },
          };
        },
      },
    },
    BotPackage: { build: async data => {
      packages.push(data);
      return { bytes: new Uint8Array(), report: { character: {}, images: {}, chats: { status: 'captured_mainlines_complete' } } };
    } },
    recordSaved: output => saved.push(output),
  });
  for (const file of ['core', 'bot-model', 'collect-bot']) {
    vm.runInContext(fs.readFileSync(`tipsy-exporter/${file}.js`, 'utf8'), env);
  }
  vm.runInContext('saveBot = async output => recordSaved(output)', env);
  vm.runInContext(fs.readFileSync('tipsy-exporter/collector.js', 'utf8'), env);
  return { node, opened, closed, packages, saved, sourceURL };
}

async function finished(x) {
  for (let i = 0; i < 100 && !x.node('stop').disabled; i++) await delay(5);
  assert.equal(x.node('stop').disabled, true);
}

test('Tipsy export after chatting uses fresh history instead of the entry-time cache', async () => {
  const x = setup(); await finished(x);
  assert.equal(x.saved.length, 1);
  assert.deepEqual(Array.from(x.packages[0].conversations[0].messages, m => m.content),
    ['initial', 'new user message', 'new character reply']);
  assert.equal(x.opened[0].url, x.sourceURL);
  assert.equal(x.opened[0].active, false);
  assert.deepEqual(x.closed, [2]);
});

test('fresh Tipsy export refuses a different active conversation and closes its tab', async () => {
  const x = setup({ differentConversation: true }); await finished(x);
  assert.equal(x.saved.length, 0);
  assert.match(x.node('progress').textContent, /chat/i);
  assert.deepEqual(x.closed, [2]);
});

test('fresh Tipsy export cannot fall back to character-only data before latest history loads', async () => {
  const x = setup({ missingLatest: true }); await finished(x);
  assert.equal(x.saved.length, 0);
  assert.match(x.node('progress').textContent, /recent history|history.*reload/i);
  assert.deepEqual(x.closed, [2]);
});
