// Synthetic integration test. Refuses physical devices; never run fixtures on a signed-in phone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { connect, prepareWorker } = require('./android-capture-smoke.cjs');
const serial = process.argv[2] || 'emulator-5554';
const adb = (...args) => execFileSync(process.env.ADB || 'adb', ['-s', serial, ...args], { encoding: 'utf8' }).trim();
async function main() {
  assert.match(serial, /^emulator-\d+$/);
  assert.equal(adb('shell', 'getprop', 'ro.kernel.qemu'), '1', 'Only an emulator can receive synthetic fixtures');
  let pages;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const pid = adb('shell', 'pidof', 'io.github.quillharbor.roleleaf.test'); assert.match(pid, /^\d+$/);
      adb('forward', 'tcp:9224', `localabstract:webview_devtools_remote_${pid}`);
      pages = await (await fetch('http://127.0.0.1:9224/json')).json();
      if (pages.some(p => p.url.startsWith('https://appassets.androidplatform.net/')) && pages.some(p => p.url.startsWith('https://tipsy.chat'))) break;
    } catch {}
    await delay(250);
  }
  assert.ok(pages?.length, 'App WebViews are ready');
  const panel = await connect(pages.find(p => p.url.startsWith('https://appassets.androidplatform.net/')));
  const sourcePage = pages.find(p => p.url.startsWith('https://tipsy.chat'));
  const source = await connect(sourcePage);
  let worker;
  const listHTML = '<!doctype html><meta name="viewport" content="width=device-width">' + Array.from({ length: 30 }, (_, i) => `<div data-recent-chat-row="true" data-testid="chatlist.item.${100000001 + i}.view"><div class="swipeable-content"><span class="truncate text-white">Synthetic ${i + 1}</span></div></div>`).join('');
  function chatHTML(id) { return `<!doctype html><meta name="viewport" content="width=device-width"><title>Synthetic ${id}</title>
    <div id="scroll" style="height:400px;overflow:auto"><div style="height:2000px"><span data-rum-chat-message="${id}:4">Synthetic fixture</span></div></div>
    <script>(async()=>{const id='${id}',post=(p,body)=>fetch('https://api.tipsy.chat/api/v1/'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
    await post('character/get/public',{character_id:id});await post('conversation/list',{character_id:id});
    await post('chat/history',{character_id:id,sequence:'0'});
    const scroller=document.getElementById('scroll');scroller.scrollTop=scroller.scrollHeight;let older=false;
    scroller.addEventListener('scroll',()=>{if(scroller.scrollTop===0&&!older){older=true;void post('chat/history',{character_id:id,sequence:'2'})}});})();</script>`; }
  function handleRequest(target, event) {
    if (event.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = event.params; const path = new URL(request.url).pathname;
    let data = {}, body = '', type = 'application/json';
    try { data = JSON.parse(request.postData || '{}'); } catch {}
    if (path === '/chat/recent') { body = listHTML; type = 'text/html'; }
    else if (/^\/chat\/\d+$/.test(path)) { body = chatHTML(path.split('/').at(-1)); type = 'text/html'; }
    else if (path.endsWith('/character/get/public')) body = JSON.stringify({ code: 0, data: { character: { character_id: data.character_id, nickname: 'Synthetic fixture', introduction: 'Local synthetic test', background: 'Synthetic', greeting: 'Hello' } } });
    else if (path.endsWith('/conversation/list')) body = JSON.stringify({ code: 0, data: { active_conversation: { conversation_id: `synthetic-${data.character_id}` } } });
    else if (path.endsWith('/chat/history')) body = JSON.stringify({ code: 0, data: (data.sequence === '0' ? [3, 4] : [1, 2]).map(n => ({ sequence: String(n), content: `Synthetic ${data.character_id} message ${n}`, content_type: 'text', sender_type: n % 2 ? 'user' : 'character' })) });
    const headers = { 'Content-Type': type, 'Access-Control-Allow-Origin': 'https://tipsy.chat', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS' };
    void target.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })), body: Buffer.from(request.method === 'OPTIONS' ? '' : body).toString('base64') }).catch(() => {});
  }
  source.onEvent = event => handleRequest(source, event);
  try {
    await source.send('Page.stopLoading'); await source.send('Network.enable');
    await source.send('Network.setBypassServiceWorker', { bypass: true }); await source.send('Network.setCacheDisabled', { cacheDisabled: true });
    await source.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await source.send('Page.navigate', { url: 'https://tipsy.chat/chat/recent' });
    for (let i = 0; i < 250 && await panel.eval('opening'); i++) await delay(200);
    await panel.eval('loadBots()');
    for (let i = 0; i < 60; i++) { if (await panel.eval('!opening && listedBots.length===30').catch(() => false)) break; await delay(250); }
    assert.equal(await panel.eval('listedBots.length'), 30);
    assert.equal(await panel.eval("document.querySelectorAll('#bot-list .bot-row').length"), 30);
    await panel.eval("$('bot-search').value='100000003';$('bot-search').dispatchEvent(new Event('input'));$('select-visible').click();$('bot-search').value='';$('bot-search').dispatchEvent(new Event('input'));document.querySelector('#bot-list input[type=checkbox]').click()");
    assert.equal(await panel.eval('selectedBots.size'), 2);
    for (const width of [320, 360, 412]) {
      await panel.send('Emulation.setDeviceMetricsOverride', { width, height: 820, deviceScaleFactor: 1, mobile: true });
      assert.equal(await panel.eval('document.documentElement.scrollWidth <= innerWidth'), true, `No horizontal overflow at ${width}`);
    }
    if (process.argv[3]) { const shot = await panel.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(process.argv[3] + '.png', Buffer.from(shot.data, 'base64')); }
    worker = await prepareWorker(panel, sourcePage, handleRequest, 9224);
    await panel.eval("$('export-selected').click()");
    assert.equal(await panel.eval("$('export-dialog').open"), true);
    for (let i = 0; i < 180; i++) { if (await panel.eval('!job')) break; await delay(500); }
    const result = await panel.eval("({messages:output?.messages,phase,status:$('status').textContent,count:output?.files.length,label:$('result-label').textContent})");
    assert.equal(result.phase, 'done', JSON.stringify(result)); assert.equal(result.messages, 8); assert.equal(result.count, 2); assert.match(result.label, /2 of 2/);
    if (process.argv[3]) {
      const files = await panel.eval('output.files.map(file => ({ filename:file.filename, bytes:encode(file.bytes) }))');
      files.forEach((file, index) => fs.writeFileSync(process.argv[3] + '-' + (index + 1) + '.zip', Buffer.from(file.bytes, 'base64')));
    }
    for (const url of ['https://tipsy.chat/chat/../private', 'https://tipsy.chat/chat/recent?x=1', 'https://evil.test/chat/100000001']) {
      assert.equal(await panel.eval(`call('openChatPage',{url:${JSON.stringify(url)}}).then(()=>false,()=>true)`), true);
    }
    console.log(JSON.stringify({ passed: true, listed: 30, selected: 2, messages: result.messages, widths: [320, 360, 412], nativeNavigationChecks: 3 }));
  } finally {
    await panel.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    await source.send('Fetch.disable').catch(() => {}); worker?.close(); source.close(); panel.close(); adb('forward', '--remove', 'tcp:9224');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
