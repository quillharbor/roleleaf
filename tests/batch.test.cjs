const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { setTimeout: delay } = require('node:timers/promises');

function load(env, ...files) {
  for (const file of files) {
    vm.runInContext(fs.readFileSync(`tipsy-exporter/${file}.js`, 'utf8'), env);
  }
}

test('sidebar reads only the site chat list and deduplicates by Bot while preserving the link', () => {
  for (const [origin, selector, id, other] of [
    ['https://tipsy.chat', 'chatted-list-scrollbar', '100000001', '100000002'],
    ['https://character.ai', 'guide-recent-chats-scroll', 'Luna_demo_1', 'Other_bot_2'],
  ]) {
    const link = (href, name) => ({
      href, textContent: 'Subtitle', querySelector: () => ({ alt: name }),
    });
    const first = `${origin}/chat/${id}?conversation=one`;
    const env = vm.createContext({
      URL, location: new URL(first),
      document: { querySelector(value) {
        assert.ok(value.includes(selector));
        return { querySelectorAll: () => [
          link(first, 'Luna'),
          link(`${origin}/chat/${id}?conversation=two`, 'Duplicate'),
          link(`${origin}/chat/${other}`, 'Other'),
          link('https://elsewhere.test/chat/100000003', 'External'),
          link(`${origin}/discover`, 'Discover'),
        ] };
      } },
    });
    load(env, 'core', 'bot-model', 'sidebar');
    const result = env.BotSidebar.read();
    assert.equal(result.current.id, id);
    assert.deepEqual(Array.from(result.bots, bot => bot.id), [id, other]);
    assert.equal(result.bots[0].name, 'Luna');
    assert.equal(result.bots[0].url, first);
  }
});

async function until(done) {
  for (let i = 0; i < 100; i++) {
    if (done()) return;
    await delay(10);
  }
  assert.fail('Timed out waiting for the batch task');
}

test('Tipsy mobile recent cards use stable ids and exclude previews and delete actions',()=>{
 const row=(marker,name)=>({getAttribute:()=>marker,querySelector:s=>s.includes('img')?{src:'https://img.tipsy.chat/synthetic.png'}:name?{textContent:name}:null,
  textContent:'Private message preview Delete Pin'});
 const rows=[row('chatlist.item.100000001.view','Synthetic role'),row('chatlist.item.100000001.view','Duplicate'),
  row('chatlist.item.deleteButton','Delete'),row('chatlist.item.100000002.view',null)];
 const env=vm.createContext({URL,location:new URL('https://tipsy.chat/chat/recent'),document:{querySelector:()=>null,querySelectorAll:()=>rows}});
 load(env,'core','bot-model','sidebar');const result=env.BotSidebar.read();
 assert.equal(result.found,true);assert.equal(result.bots.length,2);
 assert.equal(result.bots[0].url,'https://tipsy.chat/chat/100000001');assert.equal(result.bots[0].name,'Synthetic role');
 assert.equal(result.bots[1].name,'100000002');assert.ok(!JSON.stringify(result).includes('Private message'));
 env.location=new URL('https://tipsy.chat/');assert.equal(env.BotSidebar.read().found,false);
});

function queueFixture({ stopAfterFirst = false } = {}) {
  const key = 'batch:12345678-abcd-4000-8000-123456789012';
  const bots = ['100000001', '100000002', '100000003'].map(id => ({
    id, url: `https://tipsy.chat/chat/${id}?session=keep`, name: id,
  }));
  const nodes = new Map(), operations = [];
  const element = () => ({
    textContent: '', hidden: true, classList: { toggle() {} },
    children: [], append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
  });
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  let nextWorker = 1, workerOpen = false, failed = false;
  const env = vm.createContext({
    URL, AbortController, window: { addEventListener() {} },
    location: { href: `https://extension.test/collector.html?tab=1&batch=${key.slice(6)}` },
    document: { documentElement: {}, querySelectorAll: () => [], getElementById: node, createElement: element },
    chrome: {
      runtime: { getManifest: () => ({ version: '0.5.0' }) },
      tabs: {
        get: async () => ({ url: bots[0].url }),
        create: async ({ url, active }) => {
          assert.equal(active, false);
          assert.equal(workerOpen, false);
          workerOpen = true;
          operations.push(['open', url]);
          return { id: ++nextWorker };
        },
        remove: async id => {
          assert.ok(id > 1);
          assert.ok(workerOpen);
          workerOpen = false;
          operations.push(['close', id]);
        },
      },
      storage: { session: {
        get: async value => {
          assert.equal(value, key);
          return { [key]: { platform: 'tipsy', sourceTab: 1, currentId: bots[0].id, bots } };
        },
        remove: async value => assert.equal(value, key),
      } },
    },
    readChat: async () => ({ status: { running: false, conversation_id: 'current' } }),
    collectBot: async ({ tabId, route, worker, signal, onCharacter }) => {
      operations.push(['collect', route.id, worker, tabId]);
      assert.equal(signal.aborted, false);
      onCharacter(route.id);
      return { filename: `${route.id}.zip`, images: 1, imageCount: 1, messages: 3, partial: false };
    },
    saveBot: async (output, { folder, saveAs }) => {
      assert.equal(saveAs, false);
      assert.match(folder, /^RoleLeaf\/tipsy_.+_12345678$/);
      operations.push(['save', output.filename, folder]);
      if (stopAfterFirst && output.filename === '100000001.zip') node('stop').onclick();
      if (!stopAfterFirst && !failed && output.filename === '100000002.zip') {
        failed = true;
        throw Error('synthetic download interrupted');
      }
    },
  });
  load(env, 'i18n', 'messages', 'core', 'bot-model', 'collector');
  return { bots, node, operations };
}

test('Tipsy batch opens fresh pages including the current Bot and retries only failures', async () => {
  const { bots, node, operations } = queueFixture();
  await until(() => node('summary').textContent === 'Saved: 2 · Failed: 1 · Skipped: 0');
  assert.equal(node('retry').hidden, false);
  assert.deepEqual(operations.map(([action]) => action), [
    'open', 'collect', 'save', 'close', 'open', 'collect', 'save', 'close', 'open', 'collect', 'save', 'close',
  ]);
  assert.deepEqual(operations[1], ['collect', bots[0].id, true, 2]);
  assert.deepEqual(operations.filter(([action]) => action === 'open').map(([, url]) => url),
    bots.map(bot => bot.url));
  assert.match(node('queue').children[1].children[2].textContent, /download interrupted/);
  await node('retry').onclick();
  assert.equal(node('summary').textContent, 'Saved: 3 · Failed: 0 · Skipped: 0');
  assert.equal(node('retry').hidden, true);
  const saves = operations.filter(([action]) => action === 'save');
  assert.deepEqual(saves.map(([, name]) => name), [
    '100000001.zip', '100000002.zip', '100000003.zip', '100000002.zip',
  ]);
  assert.equal(new Set(saves.map(([, , folder]) => folder)).size, 1);
});

test('stopping a batch keeps the completed download and skips unopened Bots', async () => {
  const { node, operations } = queueFixture({ stopAfterFirst: true });
  await until(() => node('summary').textContent === 'Saved: 1 · Failed: 0 · Skipped: 2');
  assert.equal(node('progress').textContent, 'Queue stopped.');
  assert.equal(node('retry').hidden, false);
  assert.deepEqual(operations.map(([action]) => action), ['open', 'collect', 'save', 'close']);
});
