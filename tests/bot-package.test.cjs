const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const env=vm.createContext({URL,TextEncoder,TextDecoder,Uint8Array,DataView,Uint32Array,crypto:require('node:crypto').webcrypto});
for(const f of ['core.js','png.js','bot-model.js','cai.js','bot-package.js'])vm.runInContext(fs.readFileSync('tipsy-exporter/'+f,'utf8'),env);
const {BotModel:M,BotCai:C,BotPackage:P}=env,copy=x=>JSON.parse(JSON.stringify(x));
const bot='synthetic_bot_123',chat='chat-one';
test('Tipsy source gaps have their own ZIP coverage status; uncovered gaps remain partial', async () => {
 const build = (gapsFromSource) => P.build({
  model: { platform: 'tipsy', id: '100000001', name: 'Synthetic' },
  conversations: [{ id: chat, messages: [], completeness: {
   complete_current_mainline: false, sequence_gaps: [['2', '5']], gaps_from_source: gapsFromSource,
  } }],
  scope: { actual: 'current_conversation', conversation_list_complete: false }, assets: [], files: [],
 });
 const saved = await build(true);
 assert.equal(saved.report.chats.status, 'captured_mainlines_with_source_gaps');
 assert.equal(saved.manifest.complete, false);
 assert.equal((await build(false)).report.chats.status, 'partial');
});
const turn=(id,content,time)=>({turn_key:{chat_id:chat,turn_id:id},create_time:time,author:{author_id:bot},state:'STATE_OK',primary_candidate_id:'selected',candidates:[{candidate_id:'old',raw_content:'old candidate',is_final:true},{candidate_id:'selected',raw_content:content,is_final:true}]});
const payload=(turns,next_token)=>({turns,meta:{next_token}});
function unzip(data){const b=Buffer.from(data),out={};let at=0;while(b.readUInt32LE(at)===0x04034b50){const size=b.readUInt32LE(at+18),n=b.readUInt16LE(at+26),extra=b.readUInt16LE(at+28),name=b.toString('utf8',at+30,at+30+n),start=at+30+n+extra;out[name]=b.subarray(start,start+size);assert.equal(P.pathOK(name),true);assert.equal(P.zip([{path:name,data:out[name]}]).length>0,true);at=start+size;}assert.equal(b.readUInt32LE(at),0x02014b50);return out;}
test('platform identity is exact; CAI IDs retain underscores and hyphens',()=>{assert.equal(M.route('https://character.ai/chat/a_B-c123').id,'a_B-c123');assert.equal(M.route('https://character.ai.evil.test/chat/abcdef'),null);assert.equal(M.route('https://tipsy.chat/chat/12345678').platform,'tipsy');});
test('CAI pagination preserves candidates and selected text, with explicit server endpoint',()=>{const h=new C.History(bot,chat);h.accept('',payload([turn('b','Selected 🌙','2026-11-05T01:00:01Z')],'older'));assert.equal(h.export().completeness.complete_current_mainline,false);h.accept('older',payload([turn('a','First {{user}}','2026-11-05T01:00:00Z')],''));const out=h.export();assert.equal(out.messages.length,2);assert.equal(out.messages[1].content,'Selected 🌙');assert.equal(out.messages[1].candidates.length,2);assert.equal(out.completeness.complete_current_mainline,true);assert.equal(out.completeness.all_regeneration_variants_verified,false);});
test('CAI missing page metadata, wrong chat, unknown selection, cursor loops and edits cannot claim completeness',()=>{const h=new C.History(bot,chat);assert.throws(()=>h.accept('',{turns:[]}));assert.throws(()=>h.accept('',payload([{...turn('a','x','2026-11-05'),turn_key:{chat_id:'other',turn_id:'a'}}],'')));const t=turn('a','x','2026-11-05');t.primary_candidate_id='absent';h.accept('',payload([t],'next'));assert.equal(h.export().messages[0].content,null);assert.throws(()=>h.accept('next',payload([],'next')));assert.throws(()=>h.accept('next',payload([turn('a','edited','2026-11-05')],'')));h.accept('next',payload([],null));assert.equal(h.export().completeness.complete_current_mainline,false);});
test('CAI definition stays literal; omitted definition and dynamic greeting are not fabricated',()=>{const r=M.route('https://character.ai/chat/'+bot),raw={external_id:bot,name:'Example',title:'Tagline',description:'Description',greeting:'Authored greeting',definition:'Mixed setting\n{{user}}: Q\n{{char}}: A',additional_greetings:['Second'],has_definition:true,tags:['Romantic','Unknown'],avatar_url:'https://characterai.io/avatar.png'};const m=M.normalize(r,{character:raw});assert.equal(m.card.data.personality,raw.definition);assert.equal(m.card.data.mes_example,'');delete raw.definition;const missing=M.normalize(r,{character:raw});assert.equal(missing.fields.definition.status,'missing');assert.equal(missing.card.data.personality,'');assert.equal(missing.card.data.first_mes,'Authored greeting');});
test('one-bot ZIP has independent valid paths, hashes, lossless text and inert offline HTML',async()=>{const r=M.route('https://character.ai/chat/'+bot),model=M.normalize(r,{character:{external_id:bot,name:'<img src=x onerror=alert(1)>',definition:'Literal',greeting:'{{user}}'}});const h=new C.History(bot,chat);h.accept('',payload([turn('a','</pre><script>alert(1)</script>','2026-11-05')],''));const out=await P.build({model,conversations:[h.export()],scope:{actual:'current_conversation',conversation_list_complete:false},assets:[],files:[],started:'2026-11-05'}),files=unzip(out.bytes);const manifest=JSON.parse(files['manifest.json']);assert.equal(manifest.schema,'bot_package_v1');assert.equal(manifest.complete,false);assert.equal(manifest.is_creator,false);
 assert.equal(manifest.match_id, require('node:crypto').createHash('sha256')
   .update(JSON.stringify(['roleleaf-character-id-v1', 'character_ai', bot])).digest('hex'));
 assert.equal(manifest.character_id,undefined);
 assert.equal(manifest.bot_id,undefined);
 assert.equal(manifest.source_url,undefined);
 assert.deepEqual(JSON.parse(files['character/character.json']),{name:model.name});
 assert.equal(JSON.parse(files['provenance/report.json']).character.status,'name_only');
 assert.doesNotMatch(JSON.stringify(manifest),new RegExp(bot));for(const f of manifest.files){assert.equal(files[f.path].length,f.bytes);assert.equal(await P.sha(files[f.path]),f.sha256);}const text=files['README.html'].toString();assert.ok(!text.includes('<script>'));assert.ok(text.includes('&lt;script&gt;'));assert.ok(!text.includes('src="https:'));const msgs=JSON.parse(files['conversations/1-chat-one/messages.json']);assert.equal(msgs.messages[0].content,'</pre><script>alert(1)</script>');assert.deepEqual(Object.keys(files).sort(), ['README.html','character/character.json','conversations/1-chat-one/messages.json','conversations/1-chat-one/transcript.txt','manifest.json','provenance/report.json']);});
test('match_id is stable across repeat exports and changes with source platform or exact bot ID', async () => {
 const exportId = async (platform, id, name = 'Original', started = '2026-11-15') => {
  const out = await P.build({ model: { platform, id, name }, conversations: [], scope: { actual: 'current_conversation' }, assets: [], files: [], started });
  return JSON.parse(unzip(out.bytes)['manifest.json']).match_id;
 };
 const id = '001234567';
 const first = await exportId('tipsy', id);
 assert.equal(await exportId('tipsy', id, 'Renamed', '2026-11-16'), first);
 assert.notEqual(await exportId('character_ai', id), first);
 assert.notEqual(await exportId('tipsy', '1234567'), first);
 assert.notEqual(await exportId('character_ai', bot.toUpperCase()), await exportId('character_ai', bot));
});
test('ZIP rejects traversal, duplicate paths and untrusted media domains',()=>{for(const path of ['../secret','/abs','a/../b','a\\b'])assert.throws(()=>P.zip([{path,data:'x'}]));assert.throws(()=>P.zip([{path:'same',data:'x'},{path:'same',data:'y'}]));for(const u of ['https://evil.test/x','http://characterai.io/x','https://characterai.io.evil.test/x','https://user:pass@characterai.io/x'])assert.equal(P.mediaURL(u),false);assert.equal(P.mediaURL('https://characterai.io/i/avatar.webp'),true);assert.throws(()=>P.imageType(new TextEncoder().encode('<svg onload="evil">')));});
