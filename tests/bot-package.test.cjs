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
test('CAI turns keep image attachments and chat images are collected from both structured and markdown fields',()=>{
 const imageTurn = turn('image', 'That is me', '2026-11-05T01:00:02Z');
 imageTurn.attachments = [{ type: 'TYPE_IMAGE', url: 'https://characterai.io/i/400/static/user/uploaded/turn.webp' }];
 imageTurn.candidates[1].tti_image_rel_path = 'i/400/static/user/uploaded/candidate.webp';
 const h = new C.History(bot, chat);
 h.accept('', payload([imageTurn], ''));
 const message = h.export().messages[0];
 assert.deepEqual(JSON.parse(JSON.stringify(message.source.attachments)), imageTurn.attachments);
 assert.deepEqual(JSON.parse(JSON.stringify(M.chatImageURLs(message).sort())), [
  'https://characterai.io/i/400/static/user/uploaded/candidate.webp',
  'https://characterai.io/i/400/static/user/uploaded/turn.webp',
 ]);
 assert.deepEqual(JSON.parse(JSON.stringify(M.chatImageURLs({ content: '![image](https://characterai.io/i/400/static/user/uploaded/markdown.webp)' }))), [
  'https://characterai.io/i/400/static/user/uploaded/markdown.webp',
 ]);
 assert.equal(M.chatImageURLs({ source: { attachments: [{ type: 'TYPE_FILE', url: 'https://characterai.io/i/400/file.pdf' }] } }).length, 0);
 assert.equal(M.imageURL('https://characterai.io/uploaded/2026/11/19/a.jpg'),
  'https://characterai.io/i/400/static/user/uploaded/2026/11/19/a.jpg');
 const attachmentURL = 'https://chat-attachments-prod.a4a46ba0803ca197cf9724979695aaf8.r2.cloudflarestorage.com/62/b8/f1/f7/a.webp?X-Amz-Signature=x';
 assert.equal(M.imageURL(attachmentURL), attachmentURL);
 assert.equal(P.mediaURL(attachmentURL), true);
 assert.equal(M.imageURL('https://evil.example.com/a.webp'), '');
 const model = { assets: [] };
 M.addChatImages(model, [{ id: chat, messages: [message] }]);
 assert.equal(model.assets.length, 2);
 assert.ok(model.assets.every(asset => asset.role === 'message_image' && asset.conversation_id === chat && asset.message_id === 'image'));
 const imageOnly = turn('image-only', '', '2026-11-05T01:00:03Z');
 imageOnly.candidates = [{ candidate_id: 'selected', raw_content: null, tti_image_rel_path: 'i/400/static/user/uploaded/only.webp' }];
 const onlyHistory = new C.History(bot, chat);
 onlyHistory.accept('', payload([imageOnly], ''));
 const onlyMessage = onlyHistory.export().messages[0];
 assert.equal(onlyMessage.content, null);
 assert.equal(M.chatImageURLs(onlyMessage)[0], 'https://characterai.io/i/400/static/user/uploaded/only.webp');
});
test('CAI missing page metadata, wrong chat, unknown selection, cursor loops and edits cannot claim completeness',()=>{const h=new C.History(bot,chat);assert.throws(()=>h.accept('',{turns:[]}));assert.throws(()=>h.accept('',payload([{...turn('a','x','2026-11-05'),turn_key:{chat_id:'other',turn_id:'a'}}],'')));const t=turn('a','x','2026-11-05');t.primary_candidate_id='absent';h.accept('',payload([t],'next'));assert.equal(h.export().messages[0].content,null);assert.throws(()=>h.accept('next',payload([],'next')));assert.throws(()=>h.accept('next',payload([turn('a','edited','2026-11-05')],'')));h.accept('next',payload([],null));assert.equal(h.export().completeness.complete_current_mainline,false);});
test('CAI definition stays literal; omitted definition and dynamic greeting are not fabricated',()=>{const r=M.route('https://character.ai/chat/'+bot),raw={external_id:bot,name:'Example',title:'Tagline',description:'Description',greeting:'Authored greeting',definition:'Mixed setting\n{{user}}: Q\n{{char}}: A',additional_greetings:['Second'],has_definition:true,tags:['Romantic','Unknown'],avatar_url:'https://characterai.io/avatar.png'};const m=M.normalize(r,{character:raw});assert.equal(m.card.data.personality,raw.definition);assert.equal(m.card.data.mes_example,'');delete raw.definition;const missing=M.normalize(r,{character:raw});assert.equal(missing.fields.definition.status,'missing');assert.equal(missing.card.data.personality,'');assert.equal(missing.card.data.first_mes,'Authored greeting');});
test('one-bot ZIP has independent valid paths, hashes, lossless text and inert offline HTML',async()=>{const r=M.route('https://character.ai/chat/'+bot),model=M.normalize(r,{character:{external_id:bot,name:'<img src=x onerror=alert(1)>',definition:'Literal',greeting:'{{user}}'}});const h=new C.History(bot,chat);h.accept('',payload([turn('a','</pre><script>alert(1)</script>','2026-11-05')],''));const out=await P.build({model,conversations:[h.export()],scope:{actual:'current_conversation',conversation_list_complete:false},assets:[],files:[],started:'2026-11-05'}),files=unzip(out.bytes);const manifest=JSON.parse(files['manifest.json']);assert.equal(manifest.schema,'bot_package_v1');assert.equal(manifest.complete,false);assert.equal(manifest.is_creator,false);
 assert.equal(manifest.match_id, require('node:crypto').createHash('sha256')
   .update(JSON.stringify(['roleleaf-character-id-v1', 'character_ai', bot])).digest('hex'));
 assert.equal(manifest.character_id,undefined);
 assert.equal(manifest.bot_id,undefined);
 assert.equal(manifest.source_url,undefined);
 assert.deepEqual(JSON.parse(files['character/character.json']),{name:model.name});
 assert.deepEqual(JSON.parse(files['assets/assets.json']),{schema:'roleleaf_assets_v1',assets:[]});
 assert.equal(JSON.parse(files['provenance/report.json']).character.status,'name_only');
 assert.doesNotMatch(JSON.stringify(manifest),new RegExp(bot));for(const f of manifest.files){assert.equal(files[f.path].length,f.bytes);assert.equal(await P.sha(files[f.path]),f.sha256);}const text=files['README.html'].toString();assert.ok(!text.includes('<script>'));assert.ok(text.includes('&lt;script&gt;'));assert.ok(!text.includes('src="https:'));const msgs=JSON.parse(files['conversations/1-chat-one/messages.json']);assert.equal(msgs.messages[0].content,'</pre><script>alert(1)</script>');assert.deepEqual(Object.keys(files).sort(), ['README.html','assets/assets.json','character/character.json','conversations/1-chat-one/messages.json','conversations/1-chat-one/transcript.txt','manifest.json','provenance/report.json']);});
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

test('async ZIP assembly preserves the exact synchronous archive bytes', async () => {
 const files = [{ path: 'one.txt', data: 'one' }, { path: 'two.bin', data: Uint8Array.of(1, 2, 3) }];
 assert.deepEqual(Array.from(await P.zipAsync(files)), Array.from(P.zip(files)));
});

test('failed chat attachments retain a placeholder count without leaking the image URL', async () => {
 const url = 'https://characterai.io/test.png?X-Amz-Signature=synthetic-secret';
 const extraURL = 'https://characterai.io/extra.png?token=synthetic-secret-two';
 const asset = { url, role: 'message_image', conversation_id: chat, message_id: 'image', status: 'failed', path: null, error: 'Image HTTP 403' };
 const message = { id: 'image', role: 'user', content: `Sample ![diagram](${url})`, content_type: 'text',
  candidates: [{ raw_content: `Sample ${extraURL}`, attachments: [{ type: 'TYPE_IMAGE', url }], srcset: `${extraURL} 1x` }] };
 const output = await P.build({ model: { platform: 'character_ai', id: bot, name: 'Synthetic' },
  conversations: [{ id: chat, messages: [message], completeness: {} }], scope: { actual: 'current_conversation' },
  assets: [asset], files: [] });
 const files = unzip(output.bytes);
 assert.deepEqual(JSON.parse(files['assets/assets.json']).assets, []);
 const [exported] = JSON.parse(files['conversations/1-chat-one/messages.json']).messages;
 assert.equal(exported.content, 'Sample diagram');
 assert.equal(exported.image_attachment_count, 1);
 assert.equal(exported.candidates[0].attachments, undefined);
 assert.equal(JSON.parse(files['provenance/report.json']).images.assets[0].url, 'https://characterai.io/test.png');
 assert.doesNotMatch(Buffer.from(output.bytes).toString(), /synthetic-secret/);
});

test('unsupported images remain discoverable for a placeholder, without allowing their download', () => {
 const url = 'https://unsupported.example/image.webp?token=synthetic';
 const message = { id: 'image', content: `![diagram](${url})` };
 const model = { assets: [] };
 M.addChatImages(model, [{ id: chat, messages: [message] }]);
 assert.equal(model.assets[0].url, url);
 assert.equal(P.mediaURL(url), false);
});

test('overlapping Character.AI turns accept refreshed attachment signatures and keep the latest URL', () => {
 const url = 'https://characterai.io/test.webp';
 const signedTurn = (file, token) => ({
  ...turn('image', 'Attachment', '2026-11-05'),
  attachments: [{ type: 'TYPE_IMAGE', url: `${file}?token=${token}` }],
 });
 const history = new C.History(bot, chat);
 history.accept('', payload([signedTurn(url, 'first')], 'older'));
 assert.throws(() => history.accept('older', payload([signedTurn(url + 'x', 'second')], null)), /changed/);
 history.accept('older', payload([signedTurn(url, 'second')], null));
 assert.equal(M.chatImageURLs(history.export().messages[0])[0], url + '?token=second');
});

test('ordinary links and non-image attachments keep their query and fragment', async () => {
 const pdf = 'https://characterai.io/manual.pdf?token=first#page=2';
 const attachment = { type: 'TYPE_FILE', url: pdf };
 const image = '//unsupported.example/image?X-Amz-Signature=synthetic-private';
 const code = '`![Example](https://characterai.io/example.webp)`';
 const first = turn('mixed', `${pdf} ${code} <img src="${image}" alt="Diagram">`, '2026-11-05');
 first.candidates[1].attachments = [attachment, { url: pdf }, { type: 'TYPE_IMAGE', url: image }];
 const history = new C.History(bot, chat);
 history.accept('', payload([first], 'older'));
 const changed = structuredClone(first);
 changed.candidates[1].raw_content = changed.candidates[1].raw_content.replace('token=first', 'token=second');
 assert.throws(() => history.accept('older', payload([changed], null)), /changed/);
 const conversation = history.export();
 const model = { platform: 'character_ai', id: bot, name: 'Synthetic', assets: [] };
 M.addChatImages(model, [conversation]);
 assert.equal(model.assets.length, 1);
 const output = await P.build({ model, conversations: [conversation], scope: { actual: 'current_conversation' },
  assets: model.assets.map(asset => ({ ...asset, status: 'failed', error: 'Image request failed' })), files: [] });
 const [message] = JSON.parse(output.files.find(file => file.path.endsWith('messages.json')).data).messages;
 assert.equal(message.content, `${pdf} ${code} Diagram`);
 assert.deepEqual(message.candidates[1].attachments, [attachment, { url: pdf }]);
 assert.doesNotMatch(Buffer.from(output.bytes).toString(), /synthetic-private/);
});

test('chat image references retain the original URL and only apply Character.AI relative paths on Character.AI', () => {
 const original = 'https://characterai.io/uploaded/test.webp';
 const conversation = { id: chat, messages: [{ id: 'image', source: { image_uri: original } }] };
 const model = { platform: 'character_ai', assets: [] };
 M.addChatImages(model, [conversation]);
 assert.equal(model.assets[0].url, original);
 assert.equal(model.assets[0].fallback_url, 'https://characterai.io/i/400/static/user/uploaded/test.webp');
 const message = { source: { image_uri: '/uploaded/test.webp' } };
 assert.equal(M.chatImageURLs(message, 'tipsy').length, 0);
 assert.equal(M.chatImageURLs(message, 'character_ai')[0], original);
});

test('the ZIP size limit omits optional images while preserving the chat', async () => {
 const imagePath = 'assets/synthetic.png';
 const output = await P.build({
  model: { platform: 'character_ai', id: bot, name: 'Synthetic' },
  conversations: [{ id: chat, messages: [], completeness: {} }],
  scope: { actual: 'current_conversation' },
  assets: [{ role: 'message_image', path: imagePath, status: 'saved', url: 'https://characterai.io/image.png',
   conversation_id: chat, message_id: 'image' }],
  files: [{ path: imagePath, data: new Uint8Array(128 * 1024 * 1024) }],
 });
 assert.ok(output.files.some(file => file.path.endsWith('/messages.json')));
 assert.ok(!output.files.some(file => file.path === imagePath));
 assert.deepEqual(JSON.parse(output.files.find(file => file.path === 'assets/assets.json').data).assets, []);
 assert.equal(output.report.images.status, 'partial');
 assert.match(output.report.images.assets[0].error, /128 MB/);
});

test('the ZIP size check reserves room for the manifest', async () => {
 const imagePath = 'assets/near-limit.bin';
 const output = await P.build({
  model: { platform: 'character_ai', id: bot, name: 'Synthetic' },
  conversations: [{ id: chat, messages: [], completeness: {} }],
  scope: { actual: 'current_conversation' },
  assets: [{ role: 'message_image', path: imagePath, status: 'saved', url: 'https://characterai.io/image.png',
   conversation_id: chat, message_id: 'image' }],
  files: [{ path: imagePath, data: new Uint8Array(128 * 1024 * 1024 - 1024) }],
 });
 assert.ok(!output.files.some(file => file.path === imagePath));
 assert.equal(output.report.images.status, 'partial');
 assert.match(output.report.images.assets[0].error, /128 MB/);
});

test('truncated image signatures do not qualify as downloadable media', () => {
 for (const sample of [
  Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
  Uint8Array.of(255, 216, 255),
  new TextEncoder().encode('GIF89a'),
  new TextEncoder().encode('RIFF\x00\x00\x00\x00WEBP'),
 ]) assert.throws(() => P.imageType(sample));
 assert.equal(P.mediaURL('https://other.r2.cloudflarestorage.com/example.webp'), false);
 assert.equal(P.mediaURL('https://characterai.io:8443/example.webp'), false);
});
