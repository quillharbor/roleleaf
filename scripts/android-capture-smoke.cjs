// Debug-only CDP integration test. All source-page requests below are intercepted
// and fulfilled with synthetic data; this never signs in to a website.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
async function connect(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl), pending = new Map(); let serial = 0;
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const cdp = { onEvent() {}, close: () => socket.close(), send(method, params = {}) {
    return new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  }, async eval(expression) {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
  } };
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data), p = pending.get(message.id);
    if (p) { pending.delete(message.id); message.error ? p.reject(Error(JSON.stringify(message.error))) : p.resolve(message.result); }
    else cdp.onEvent(message);
  }; return cdp;
}
async function prepareWorker(panel, sourcePage, handleRequest, port = 9223) {
  await panel.eval("window.workerReady = call('openRecent').catch(() => null); true");
  let workerPage;
  for (let i = 0; i < 100 && !workerPage; i++) {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    workerPage = pages.find(p => p.id !== sourcePage.id && p.url.startsWith(new URL(sourcePage.url).origin));
    if (!workerPage) await delay(100);
  }
  assert.ok(workerPage, 'Open Batch export on the test device before running this check');
  const worker = await connect(workerPage);
  worker.onEvent = event => handleRequest(worker, event);
  await worker.send('Network.enable');
  await worker.send('Network.setBypassServiceWorker', { bypass: true });
  await worker.send('Network.setCacheDisabled', { cacheDisabled: true });
  await worker.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await panel.eval('window.workerReady');
  return worker;
}
async function main() {
  const pages = await (await fetch('http://127.0.0.1:9223/json')).json();
  const panel = await connect(pages.find(p => p.url.startsWith('https://appassets.androidplatform.net/')));
  const sourcePage = pages.find(p => p.url.startsWith('https://tipsy.chat'));
  const source = await connect(sourcePage);
  let worker;
  let total = 4;
  const html = `<!doctype html><meta name="viewport" content="width=device-width"><title>安卓合成测试角色</title>
    <div class="chatted-list-scrollbar"><a href="/chat/100000001">安卓合成测试角色</a></div>
    <div class="no-transition-scrollbar" style="height:400px;overflow:auto">Synthetic history only</div>
    <script>(async()=>{
      const post=(path,body)=>fetch('https://api.tipsy.chat/api/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
      await post('character/get/public',{character_id:'100000001'});
      await post('conversation/list',{character_id:'100000001'});
      await post('chat/history',{character_id:'100000001',conversation_id:'android-synthetic',sequence:'0',size:10,language_code:'en',chat_mode:'group_chat'});
      window.syntheticReady=true;
    })();</script>`;
  function handleRequest(target, event) {
    if (event.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = event.params;
    const path = new URL(request.url).pathname;
    let body = '', type = 'application/json';
    if (path === '/chat/100000001') { body = html; type = 'text/html'; }
    else if (path.endsWith('/character/get/public')) body = JSON.stringify({ code: 0, data: { character: { character_id: '100000001', nickname: '安卓合成测试角色', introduction: '本地集成测试', background: 'Synthetic only', greeting: '你好 🌙' } } });
    else if (path.endsWith('/conversation/list')) body = JSON.stringify({ code: 0, data: { active_conversation: { conversation_id: 'android-synthetic' } } });
    else if (path.endsWith('/chat/history')) body = JSON.stringify({ code: 0, data: Array.from({ length: total }, (_, i) => ({ sequence: String(i + 1), sender_type: i % 2 ? 'user' : 'character', content_type: 'text', content: `Android synthetic ${i + 1} 🌙\n{{user}} 原文`, timestamp: 1700000000 + i })) });
    const headers = { 'Content-Type': type, 'Access-Control-Allow-Origin': 'https://tipsy.chat', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };
    void target.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })), body: Buffer.from(request.method === 'OPTIONS' ? '' : body).toString('base64') }).catch(() => {});
  }
  source.onEvent = event => handleRequest(source, event);
  try {
    await source.send('Page.stopLoading');
    await source.send('Network.enable');
    await source.send('Network.setBypassServiceWorker', { bypass: true });
    await source.send('Network.setCacheDisabled', { cacheDisabled: true });
    await source.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await source.send('Page.navigate', { url: 'https://tipsy.chat/chat/100000001' });
    let ready = false;
    for (let i = 0; i < 50; i++) { ready = await source.eval('window.syntheticReady === true').catch(() => false); if (ready) break; await delay(200); }
    assert.ok(ready, 'Synthetic source loaded: ' + JSON.stringify(await source.eval('({url:location.href,title:document.title,hook:typeof window.__botAndroidRequest,ready:window.syntheticReady})')));
    assert.equal(await source.eval("typeof NativeApp"), 'undefined', 'Source cannot access local filesystem/download bridge');
    assert.equal(await source.eval("typeof window.__botAndroidRequest"), 'function', 'Document-start hook installed');
    for (let i = 0; i < 250 && await panel.eval('opening'); i++) await delay(200);
    await panel.eval('loadBots()');
    worker = await prepareWorker(panel, sourcePage, handleRequest);
    assert.equal(await panel.eval('route?.id'), '100000001');
    // Append a new server message after page load. Export must reload and capture it.
    total = 5;
    await panel.eval('collect()');
    const result = await panel.eval('output && ({messages:output.messages, filename:output.filename, bytes:encode(output.bytes)})');
    assert.equal(result?.messages, 5, await panel.eval("document.getElementById('status').textContent"));
    assert.ok(!result.filename.includes('_demo_'));
    if (process.argv[2]) fs.writeFileSync(process.argv[2], Buffer.from(result.bytes, 'base64'));
    console.log(JSON.stringify({ passed: true, capturedMessages: result.messages, nativeBridgeIsolation: true, documentStartCapture: true, freshReloadIncludesNewMessage: true }));
  } finally {
    await source.send('Fetch.disable').catch(() => {});
    worker?.close(); source.close(); panel.close();
  }
}
module.exports = { connect, prepareWorker };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
