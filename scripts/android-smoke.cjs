// Debug APK only. Forward its webview_devtools_remote_<pid> socket to localhost:9223 first.
// Can inspect the bundled panel or exercise native request validation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
async function main() {
  const pages = await (await fetch('http://127.0.0.1:9223/json')).json();
  const page = pages.find(p => p.url.startsWith('https://appassets.androidplatform.net/'));
  assert.ok(page, 'Bundled mobile UI is loaded');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let serial = 0; const requests = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data), p = requests.get(message.id);
    if (p) { requests.delete(message.id); message.error ? p.reject(Error(JSON.stringify(message.error))) : p.resolve(message.result); }
  };
  function command(method, params) { return new Promise((resolve, reject) => { const id = ++serial; requests.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      ready = await evaluate("typeof window.openBatchPicker === 'function' && typeof collect === 'function'").catch(() => false);
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, 'Mobile scripts are ready');
    const mode = process.argv[2] || 'check';
    if (mode === 'inspect') { console.log(await evaluate('document.body.innerText')); return; }
    if (mode === 'save') { await evaluate("document.getElementById('save').click()"); return; }
    if (mode === 'collect') { await evaluate('collect()'); console.log(await evaluate("document.getElementById('status').textContent")); return; }
    if (mode === 'read-output') {
      const data = await evaluate('output && ({filename:output.filename, messages:output.messages, images:output.images, bytes:encode(output.bytes)})');
      assert.ok(data, 'Output exists'); fs.writeFileSync(process.argv[3], Buffer.from(data.bytes, 'base64'));
      console.log(JSON.stringify({ filename: data.filename, messages: data.messages, images: data.images })); return;
    }
    assert.equal(await evaluate("document.querySelector('#demo')"), null);
    assert.equal(await evaluate("document.querySelector('#export-dialog').open"), false);
    // Check native boundaries, not just the JS caller's validation.
    for (const expression of [
      "call('imageDownload',{id:crypto.randomUUID(),url:'https://example.com/private.png'})",
      "call('zipBegin',{filename:'../../bad.zip',size:20})",
      "call('zipBegin',{filename:'tipsy_test.zip',size:999999999})",
      "call('capture',{message:{type:'READ_COOKIES'}})",
    ]) {
      assert.equal(await evaluate(`(${expression}).then(()=>false,()=>true)`), true, 'Invalid native operation must be rejected');
    }
    console.log(JSON.stringify({ passed: true, nativeBoundaryChecks: 4 }, null, 2));
  } finally { ws.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
