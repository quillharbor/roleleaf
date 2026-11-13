const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname,'../tipsy-exporter');
function run(name, context) { vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),context,{filename:name}); }
function context(extra={}) { const c=vm.createContext({URL,TextEncoder,TextDecoder,Uint8Array,Uint32Array,DataView,btoa,setTimeout,...extra}); run('core.js',c);run('png.js',c);return c; }
const env=context(), core=env.TipsyExporterCore, png=env.TipsyExporterPNG;
const id='9000000000000000001';
const fixture = () => ({character:{character_id:id,nickname:'测试角色 🌙',introduction:'介绍\n{{user}} 与 {{char}}',greeting:'你好，{{user}}！',show_background:false,is_translated:true,scenario:'',dialog_style:[{role:'all',message:'{{user}}: hi\n{{char}}: hello\nNPC: welcome'}],tags:['fiction',{name:'fantasy'}]},world_books:[16,20,13].map((n,i)=>({name:`Book ${i}`,entry_count:n,enabled:true,world_book_key:''})),creator:{nickname:'Author',email:'private@example.invalid',user_id:'secret'},custom_prompt:null});
test('V2 fields retain Unicode, placeholders, role=all, and exact source strings',()=>{
 const source=fixture(), card=core.card(core.record(source));
 assert.equal(card.spec,'chara_card_v2');assert.equal(card.spec_version,'2.0');
 for(const key of ['name','description','personality','scenario','first_mes','mes_example','creator_notes','system_prompt','post_history_instructions','creator','character_version'])assert.equal(typeof card.data[key],'string');
 assert.equal(card.data.first_mes,source.character.greeting);
 assert.equal(card.data.description,source.character.introduction);
 assert.equal(card.data.mes_example,'<START>\n'+source.character.dialog_style[0].message);
 assert.equal(card.data.personality,'');assert.equal(card.data.extensions.tipsy.source.character.character_id,id);
 assert.deepEqual(Array.from(card.data.tags),['fiction','fantasy']);
 assert.ok(card.data.creator_notes.includes('The full character definition is unverified'));
});
test('worldbook metadata is not represented as 49 downloaded bodies or a usable character_book',()=>{
 const entry=core.record(fixture()), report=core.report(entry);
 assert.equal(report.world_books.reportedEntries,49);assert.equal(report.world_books.receivedEntries,0);
 assert.equal(report.world_books.state,'metadata_only');assert.equal(report.world_books.books.length,3);
 assert.equal(Object.hasOwn(core.card(entry).data,'character_book'),false);
 assert.equal(report.completeness,'not_verified');
});
test('nonempty backgrounds export; empty and absent remain distinguishable',()=>{
 const source=fixture(); source.character.background='Hidden body';source.character.public_background='';
 assert.equal(core.card(core.record(source)).data.personality,'Hidden body');
 source.character.public_background='Public body';assert.equal(core.card(core.record(source)).data.personality,'Public body');
 delete source.character.background; delete source.character.public_background;
 let report=core.report(core.record(source));assert.equal(report.fields.personality.state,'missing');assert.equal(report.fields.scenario.state,'empty');
 source.character.background='';assert.equal(core.report(core.record(source)).fields.personality.state,'empty');
});
test('worldbook bodies remain in source with explicit unmapped state',()=>{
 const source=fixture();source.world_books[0].entries=[{content:'World body',keys:['trigger']}];
 const card=core.card(core.record(source));assert.equal(card.data.extensions.tipsy.report.world_books.state,'body_unmapped');
 assert.equal(card.data.extensions.tipsy.source.world_books[0].entries[0].content,'World body');assert.equal(Object.hasOwn(card.data,'character_book'),false);
});
test('untrusted response metadata and prototype keys never enter exports',()=>{
 const source=fixture();source.character.token='secret';source.headers={Authorization:'secret'};
 source.rich_content=JSON.parse('{"greeting_rich_text":"hello","token":"secret","__proto__":{"polluted":true},"request":{"cookie":"secret"}}');
 const projected=core.project(source), serialized=JSON.stringify(projected);
 assert.equal(serialized.includes('secret'),false);assert.equal(serialized.includes('private@example'),false);
 assert.equal(projected.creator.nickname,'Author');assert.equal(projected.rich_content.greeting_rich_text,'hello');assert.equal({}.polluted,undefined);
 assert.throws(()=>core.project({character:{character_id:Number(id),nickname:'bad'}}));
});
test('only exact public endpoint and Tipsy character routes match',()=>{
 assert.ok(core.publicEndpoint('https://api.tipsy.chat/api/v1/character/get/public?x=1'));
 for(const u of ['https://api.tipsy.chat/api/v1/chat/history','https://evil.test/api/v1/character/get/public','https://api.tipsy.chat.evil.test/api/v1/character/get/public'])assert.equal(core.publicEndpoint(u),false);
 assert.equal(core.roleId(`https://tipsy.chat/chat/${id}`),id);assert.equal(core.roleId(`https://tipsy.chat/en/chat/${id}/public`),id);
 assert.equal(core.roleId(`https://evil.test/chat/${id}`),null);assert.equal(core.roleId('https://tipsy.chat/'),null);
});
test('structured examples keep turns; unknown formats are preserved or reported',()=>{
 const result=core.examples([{role:'user',message:'A'},{role:'assistant',message:'B'},{role:'npc',message:'C'},{}]);
 assert.equal(result.value,'<START>\n{{user}}: A\n{{char}}: B\n\n<START>\nC');assert.equal(result.warnings.length,2);
});
function readPNG(bytes) {
 const b=Buffer.from(bytes), result=[]; let offset=8;
 while(offset<b.length){const n=b.readUInt32BE(offset),type=b.toString('ascii',offset+4,offset+8);result.push({type,data:b.subarray(offset+8,offset+8+n)});offset+=12+n;}
 return result;
}
// Generated independently with Python struct/zlib, including CRCs.
const pixel=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64'));
test('PNG chara chunk round-trips the V2 card with Unicode, preserving image bytes',()=>{
 const card=core.card(core.record(fixture())), out=png.embed(pixel,card), chunks=readPNG(out);
 const metadata=chunks.filter(c=>c.type==='tEXt');assert.equal(metadata.length,1);
 assert.equal(metadata[0].data.subarray(0,6).toString('ascii'),'chara\0');
 const decoded=JSON.parse(Buffer.from(metadata[0].data.subarray(6).toString('ascii'),'base64').toString('utf8'));
 assert.equal(JSON.stringify(decoded),JSON.stringify(card));
 assert.deepEqual(chunks.find(c=>c.type==='IDAT').data,readPNG(pixel).find(c=>c.type==='IDAT').data);
 assert.equal(png.chunks(out).length,chunks.length);
 const replaced=png.embed(out,{spec:'replacement'});
 assert.equal(readPNG(replaced).filter(c=>c.type==='tEXt').length,1);
});
test('PNG rejects damaged bytes and invalid signatures',()=>{
 const bad=pixel.slice();bad[45]^=1;assert.throws(()=>png.embed(bad,{}));assert.throws(()=>png.embed(new Uint8Array(100),{}));
});
function captureEnv() {
 const messages=[],listeners={},responses=[];
 class XHR {
  open(method,url){this.responseURL=url;}send(){this.sent=true;}
  addEventListener(name,callback){this.callback=callback;}
 }
 const win={addEventListener:(name,cb)=>listeners[name]=cb,postMessage:m=>messages.push(m),fetch:()=>responses.shift()};
 const ctx=context({window:win,location:{origin:'https://tipsy.chat'},XMLHttpRequest:XHR});run('capture.js',ctx);
 return {ctx,win,messages,listeners,responses,XHR};
}
const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
test('manifest injects self-contained resources into each execution world',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 const resources=manifest.content_scripts.flatMap(script=>script.js);
 assert.equal(new Set(resources).size,resources.length,'Never share a resource path between worlds');
 for(const script of manifest.content_scripts.filter(s=>s.matches.includes('https://tipsy.chat/*'))){
  let handler;
  class XHR {open(){}send(){}}
  const fresh=vm.createContext({URL,TextEncoder,TextDecoder,setTimeout,
   window:{addEventListener(){},postMessage(){},fetch:()=>Promise.resolve()},
   location:{origin:'https://tipsy.chat',href:'https://tipsy.chat/'},XMLHttpRequest:XHR,
   chrome:{runtime:{id:'test',onMessage:{addListener:cb=>handler=cb}}}});
  for(const file of script.js)run(file,fresh);
  assert.equal(fresh.TipsyExporterCore.VERSION,manifest.version);
  if(script.world==='ISOLATED'){
   let reply;handler({type:'TIPSY_GET_CURRENT'},{id:'test'},value=>reply=value);
   assert.equal(reply.reason,'not_character');
  }else assert.equal(fresh.__tipsyExporterCaptureInstalled,true);
 }
});
test('fetch capture leaves original response readable and never reads history',async()=>{
 const e=captureEnv(),response=new Response(JSON.stringify({code:0,data:fixture()})),promise=Promise.resolve(response);e.responses.push(promise);
 assert.equal(e.win.fetch('https://api.tipsy.chat/api/v1/character/get/public'),promise);
 assert.equal((await (await promise).json()).data.character.character_id,id);await pause();
 assert.equal(e.messages.length,1);assert.equal(e.messages[0].entry.source.character.character_id,id);
 let read=false;e.responses.push(Promise.resolve({clone(){read=true;throw Error('must not read');}}));
 await e.win.fetch('https://api.tipsy.chat/api/v1/chat/history');await pause();assert.equal(read,false);assert.equal(e.messages.length,1);
 e.listeners.message({source:e.win,origin:'https://tipsy.chat',data:{channel:core.CHANNEL,type:'REQUEST',characterId:id}});assert.equal(e.messages.length,2);
});
test('XHR capture accepts only successful public data and strips creator private fields',()=>{
 const e=captureEnv(),xhr=new e.XHR();xhr.open('POST','https://api.tipsy.chat/api/v1/character/get/public');xhr.send();
 xhr.status=200;xhr.responseType='json';xhr.response={code:0,data:fixture()};xhr.callback();
 assert.equal(e.messages.length,1);assert.equal(e.messages[0].entry.source.creator.email,undefined);
 const other=new e.XHR();other.open('POST','https://api.tipsy.chat/api/v1/chat/history');other.send();assert.equal(other.callback,undefined);
 xhr.response={code:1,data:fixture()};xhr.callback();assert.equal(e.messages.length,1);
});
test('isolated bridge validates current route and rejects stale role after SPA navigation',async()=>{
 let listener, onMessage;
 const loc={origin:'https://tipsy.chat',href:`https://tipsy.chat/chat/${id}`};
 const win={addEventListener:(name,cb)=>listener=cb,postMessage:()=>{}};
 const chrome={runtime:{id:'test-extension',onMessage:{addListener:cb=>onMessage=cb}}};
 const ctx=context({window:win,location:loc,chrome});run('content.js',ctx);
 listener({source:win,origin:loc.origin,data:{channel:core.CHANNEL,type:'CAPTURE',entry:core.record(fixture())}});
 let response=await new Promise(resolve=>onMessage({type:'TIPSY_GET_CURRENT'},{id:'test-extension'},resolve));assert.equal(response.ok,true);
 response=await new Promise(resolve=>{onMessage({type:'TIPSY_GET_CURRENT'},{id:'test-extension'},resolve);loc.href='https://tipsy.chat/chat/123456789';});assert.equal(response.reason,'navigated');
 response=await new Promise(resolve=>onMessage({type:'TIPSY_GET_CURRENT'},{id:'test-extension'},resolve));assert.equal(response.reason,'waiting');
});
