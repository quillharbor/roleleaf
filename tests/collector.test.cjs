const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup({mutate=false,failImage=false,instantDownload=false}={}){
 const nodes=new Map(),downloads=[],source={character_id:'100000001',nickname:'Synthetic',background:'Literal',greeting:'Hello',face_url:'https://img.tipsy.chat/image.png'};
 const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:false,hidden:false,classList:{toggle(){}}});return nodes.get(id);};
 const chat={source:{character_id:'100000001',conversation_id:'one'},completeness:{records:1,complete_current_mainline:true},records:[{sequence:'1',sender_type:'character',content:'exact',content_type:'text',image_url:'https://img.tipsy.chat/chat-image.png'}],pages:[]};let exports=0,downloadListener;
 const env=vm.createContext({URL,Blob,TextEncoder,TextDecoder,Uint8Array,Uint32Array,DataView,AbortController,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,window:{addEventListener(){}},location:{href:'https://extension.test/collector.html?tab=1'},document:{documentElement:{},querySelectorAll:()=>[],getElementById:node},fetch:async()=>{if(failImage)throw Error('synthetic network failure');throw Error('no live network in tests');},chrome:{runtime:{getManifest:()=>({version:'0.5.0'})},tabs:{getCurrent:async()=>null,create:async()=>({id:2}),remove:async()=>{},get:async()=>({url:'https://tipsy.chat/chat/100000001'}),sendMessage:async(_id,m)=>{if(m.type==='TIPSY_GET_CURRENT')return {ok:true,entry:{source:{character:source}}};if(m.action==='export')exports++;const data=JSON.parse(JSON.stringify(chat));if(mutate&&exports>1)data.records[0].content='changed';return {ok:true,status:{character_id:'100000001',conversation_id:'one',running:false,latest_page_captured:true},data};}},downloads:{download:async o=>{downloads.push(o);if(instantDownload)downloadListener?.({id:1,state:{current:'complete'}});return 1;},onChanged:{addListener(fn){downloadListener=fn;},removeListener(){downloadListener=null;}}}}});
 for(const f of ['i18n.js','messages.js','core.js','chat.js','png.js','bot-model.js','bot-package.js','collect-bot.js'])vm.runInContext(fs.readFileSync('tipsy-exporter/'+f,'utf8'),env);
 const task=vm.runInContext(fs.readFileSync('tipsy-exporter/collector.js','utf8'),env);
 return {task,downloads,node,complete:()=>downloadListener?.({id:1,state:{current:'complete'}})};
}
test('collector produces one downloadable ZIP while preserving image failures as partial evidence',async()=>{
 const x=setup({failImage:true});
 try {
  const deadline=Date.now()+3000;
  while(!x.downloads.length&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(x.downloads.length,1);
  const r=await fetch(x.downloads[0].url),b=new Uint8Array(await r.arrayBuffer());
  assert.deepEqual(Array.from(b.slice(0,4)),[80,75,3,4]);
  assert.ok(x.node('summary').textContent.includes('Images: 0 of 1'));
  assert.ok(x.node('summary').textContent.includes('Messages: 1'));
  assert.ok(x.node('summary').textContent.includes('could not be downloaded'));
 }finally{x.complete();}
 await x.task;
 assert.equal(x.node('progress').textContent,'Character ZIP saved.');
});
test('collector rejects message changes during media collection before writing a misleading snapshot',async()=>{const x=setup({mutate:true,failImage:true});await x.task;assert.equal(x.downloads.length,0);assert.ok(x.node('progress').textContent.includes('changed during export'));});

test('download completion before the download promise resolves still updates the saved state',async()=>{const x=setup({failImage:true,instantDownload:true});await x.task;assert.equal(x.downloads.length,1);assert.equal(x.node('progress').textContent,'Character ZIP saved.');assert.ok(x.node('summary').textContent.includes('File saved'));});

test('Tipsy creator queue saves the matching editor after Chrome closes the profile message channel', async () => {
 const ids = ['100000001', '100000002', '100000003', '100000004'];
 const profile = 'https://tipsy.chat/profile/100000010';
 const batch = '9e6686fd-4d7e-4f49-be3c-686f739e7921';
 const nodes = new Map(), opened = [], closed = [], saved = [];
 const node = id => {
  if (!nodes.has(id)) nodes.set(id, { append() {}, replaceChildren() {}, classList: { toggle() {} } });
  return nodes.get(id);
 };
 let reads = 0, now = 0;
 const env = vm.createContext({
  URL, TextEncoder, TextDecoder, Uint8Array, DataView, AbortController, crypto: require('node:crypto').webcrypto,
  Date: class extends Date { static now() { return now; } },
  setTimeout: (callback, delay) => setTimeout(() => { now += delay; callback(); }, 0),
  window: { addEventListener() {} },
  location: { href: `https://extension.test/collector.html?tab=1&batch=${batch}` },
  document: { documentElement: {}, querySelectorAll: () => [], getElementById: node, createElement: () => node(Symbol()) },
  chrome: {
   runtime: { getManifest: () => ({ version: '0.5.15' }) },
   storage: { session: {
    get: async key => ({ [key]: { sourceTab: 1, platform: 'tipsy', creator: true,
     bots: ids.map((id, index) => ({ id, url: profile, name: `Synthetic ${index}` })) } }),
    remove: async () => {},
   } },
   tabs: {
    create: async () => ({ id: opened.length + 2 }),
    get: async () => ({ status: 'complete' }),
    remove: async id => { closed.push(id); },
    sendMessage: async (id, message) => {
     if (message.action === 'open_editor') {
      assert.equal(message.characterId, ids[id - 2]);
      opened.push(message.characterId);
      reads = 0;
      if (id === 5) return { ok: false, reason: 'edit_unavailable' };
      throw Error('The page keeping the extension port is moved into back/forward cache, so the message channel is closed.');
     }
     assert.equal(message.action, 'read');
     if (++reads === 1) return { ok: false, reason: 'waiting' };
     const characterId = id === 4 ? '100000099' : message.characterId;
     return { ok: true, data: { id: characterId, name: `Synthetic ${id}`,
      url: `https://tipsy.chat/update?character_id=${characterId}`, values: {}, assets: [] } };
    },
   },
  },
  savePackage: output => saved.push(output),
 });
 for (const file of ['i18n', 'messages', 'core', 'png', 'bot-model', 'bot-creator', 'bot-package', 'collect-bot']) {
  vm.runInContext(fs.readFileSync(`tipsy-exporter/${file}.js`, 'utf8'), env);
 }
 vm.runInContext('saveBot = async output => savePackage(output)', env);
 vm.runInContext(fs.readFileSync('tipsy-exporter/collector.js', 'utf8'), env);
 for (let attempt = 0; attempt < 100 && !node('stop').disabled; attempt++) {
  await new Promise(resolve => setTimeout(resolve, 5));
 }
 assert.equal(node('summary').textContent, 'Saved: 2 · Failed: 2 · Skipped: 0');
 assert.deepEqual(opened, ids);
 assert.deepEqual(closed, [2, 3, 4, 5]);
 assert.equal(saved.length, 2);
 assert.ok(saved.every(output => output.filename.startsWith('tipsy_creator_') && output.messages === 0));
});

test('Character.AI chat-only exports can use the selected name with verified history', async () => {
 const id = 'character-Synthetic', conversationId = 'synthetic-chat';
 const route = { platform: 'character_ai', id, url: `https://character.ai/chat/${id}` };
 const message = { id: 'synthetic-message', role: 'user', content: 'Hello', content_type: 'text', candidates: [] };
 const conversation = { id: conversationId, messages: [message],
  completeness: { latest_page_captured: true, complete_current_mainline: true } };
 let historyReady = true, tabURL = route.url, now = 0;
 const env = vm.createContext({
  URL, TextEncoder, TextDecoder, Uint8Array, DataView, AbortController, crypto: require('node:crypto').webcrypto,
  Date: class extends Date { static now() { return now; } },
  setTimeout: (callback, delay) => { now += delay; queueMicrotask(callback); },
  chrome: { tabs: {
   get: async () => ({ url: tabURL }),
   sendMessage: async () => ({ ok: true, entry: null,
    status: { character_id: id, conversation_id: conversationId, latest_page_captured: historyReady },
    conversations: historyReady ? [conversation] : [] }),
  } },
 });
 for (const file of ['core', 'png', 'bot-model', 'bot-package', 'collect-bot']) {
  vm.runInContext(fs.readFileSync(`tipsy-exporter/${file}.js`, 'utf8'), env);
 }
 const collect = vm.runInContext('collectBot', env);
 const options = { tabId: 2, route, worker: true, selectedName: 'Synthetic',
  signal: new AbortController().signal, progress() {}, onCharacter() {} };
 const output = await collect(options);
 assert.equal(output.messages, 1);
 assert.match(output.filename, /^character_ai_Synthetic_/);
 await assert.rejects(collect({ ...options, expectedConversationId: 'another-chat' }), /chat differs/);
 historyReady = false;
 await assert.rejects(collect(options), /after 30 seconds/);
 historyReady = true;
 tabURL = 'https://character.ai/chat/another-Synthetic';
 await assert.rejects(collect(options), /after 30 seconds/);
});
