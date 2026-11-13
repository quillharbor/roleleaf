// Requires Character.AI selected in the debug APK; uses only synthetic intercepted responses.
const { connect, prepareWorker } = require('./android-capture-smoke.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
async function main() {
  const pages = await (await fetch('http://127.0.0.1:9223/json')).json();
  const panel = await connect(pages.find(p => p.url.startsWith('https://appassets.androidplatform.net/')));
  const sourcePage = pages.find(p => p.url.startsWith('https://character.ai'));
  const source = await connect(sourcePage);
  let worker;
  const id = 'Synthetic_Bot-123', cid = 'android-synthetic-cai'; let total = 4;
  const html = `<!doctype html><title>安卓 CAI 合成角色</title><div id="guide-recent-chats-scroll"><div role="listbox"><a href="/chat/${id}">安卓 CAI 合成角色</a></div></div><script>(async()=>{
    await fetch('https://neo.character.ai/character/v1/get_character_info').then(r=>r.json());
    await fetch('https://neo.character.ai/turns/${cid}/').then(r=>r.json());window.syntheticReady=true;
  })();</script>`;
  function handleRequest(target, event) {
    if (event.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = event.params, path = new URL(request.url).pathname;
    let type = 'application/json', body = '';
    if (path === `/chat/${id}`) { type = 'text/html'; body = html; }
    else if (path.endsWith('get_character_info')) body = JSON.stringify({ character: { external_id: id, name: '安卓 CAI 合成角色', description: 'Synthetic only', definition: 'literal {{user}} definition' } });
    else if (path === `/turns/${cid}/`) body = JSON.stringify({ turns: Array.from({ length: total }, (_, i) => ({ turn_key: { chat_id: cid, turn_id: String(i + 1) }, create_time: `2026-11-05T01:00:0${i}Z`, author: { author_id: id }, candidates: [{ candidate_id: 'choice', raw_content: `CAI synthetic ${i + 1} 🌙` }], primary_candidate_id: 'choice' })), meta: { next_token: '' } });
    void target.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Access-Control-Allow-Origin', value: 'https://character.ai' }], body: Buffer.from(body).toString('base64') }).catch(() => {});
  }
  source.onEvent = event => handleRequest(source, event);
  try {
    await source.send('Page.stopLoading');
    await source.send('Network.enable'); await source.send('Network.setBypassServiceWorker', { bypass: true });
    await source.send('Network.setCacheDisabled', { cacheDisabled: true });
    await source.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await source.send('Page.navigate', { url: `https://character.ai/chat/${id}` });
    let ready = false;
    for (let i = 0; i < 50; i++) { ready = await source.eval('window.syntheticReady === true').catch(() => false); if (ready) break; await delay(200); }
    assert.ok(ready); assert.equal(await source.eval('typeof NativeApp'), 'undefined');
    for (let i = 0; i < 250 && await panel.eval('opening'); i++) await delay(200);
    await panel.eval('loadBots()'); worker = await prepareWorker(panel, sourcePage, handleRequest); assert.equal(await panel.eval('route?.id'), id);
    total = 5; await panel.eval('collect()');
    const result = await panel.eval('output && ({messages:output.messages, filename:output.filename, bytes:encode(output.bytes)})');
    assert.equal(result?.messages,5,await panel.eval("document.getElementById('status').textContent"));
    if (process.argv[2]) fs.writeFileSync(process.argv[2],Buffer.from(result.bytes,'base64'));
    console.log(JSON.stringify({ passed:true, platform:'character_ai', freshMessages:result.messages, nativeBridgeIsolation:true }));
  } finally { await source.send('Fetch.disable').catch(()=>{}); worker?.close(); source.close(); panel.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
