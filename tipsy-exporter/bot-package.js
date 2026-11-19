(function(root){
'use strict';
const M=root.BotModel,enc=new TextEncoder(),json=x=>JSON.stringify(x,null,2);
const MAX_ZIP_BYTES = 128 * 1024 * 1024;
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function bytes(x){return typeof x==='string'?enc.encode(x):x;}
function pathOK(name){return typeof name==='string'&&name.length<240&&!name.startsWith('/')&&!name.includes('\\')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..')&&!/[\x00-\x1f]/.test(name);}
function zip(files){
 if(files.length>10000)throw Error('Too many files in the export');const parts=[],central=[];let offset=0,size=0;const used=new Set();
 for(const file of files){if(!pathOK(file.path)||used.has(file.path))throw Error('Duplicate or invalid path in the export');used.add(file.path);const name=enc.encode(file.path),data=bytes(file.data);size+=data.length;if(size>MAX_ZIP_BYTES)throw Error('Export exceeds 128 MB');const crc=root.TipsyExporterPNG.crc32(data);const h=new Uint8Array(30+name.length),v=new DataView(h.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);h.set(name,30);parts.push(h,data);
 const c=new Uint8Array(46+name.length),w=new DataView(c.buffer);w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint16(14,33,true);w.setUint32(16,crc,true);w.setUint32(20,data.length,true);w.setUint32(24,data.length,true);w.setUint16(28,name.length,true);w.setUint32(42,offset,true);c.set(name,46);central.push(c);offset+=h.length+data.length;
 }
 const centralSize=central.reduce((n,c)=>n+c.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);const out=new Uint8Array(offset+centralSize+22);let at=0;for(const p of [...parts,...central,end]){out.set(p,at);at+=p.length;}return out;
}
async function sha(data){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(data))),v=>v.toString(16).padStart(2,'0')).join('');}
function characterMatchId(platform, id) {
  const valid = platform === 'tipsy' ? /^\d{6,30}$/ : platform === 'character_ai' ? /^[\w-]{6,100}$/ : null;
  if (typeof id !== 'string' || !valid?.test(id)) throw Error('Invalid character identity');
  return sha(JSON.stringify(['roleleaf-character-id-v1', platform, id]));
}
function imageType(data) {
 if (data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71) {
  root.TipsyExporterPNG.chunks(data);
  return 'png';
 }
 if (data.length > 5 && data[0] === 255 && data[1] === 216 && data[2] === 255 &&
     data.at(-2) === 255 && data.at(-1) === 217) return 'jpg';
 if (data.length > 13 && /^GIF8[79]a$/.test(String.fromCharCode(...data.slice(0, 6))) && data.at(-1) === 59) return 'gif';
 if (data.length > 20 && String.fromCharCode(...data.slice(0, 4)) === 'RIFF' &&
     String.fromCharCode(...data.slice(8, 12)) === 'WEBP' &&
     new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, true) + 8 === data.length) return 'webp';
 throw Error('Image must be a complete PNG, JPEG, GIF, or WebP');
}
function mediaURL(url){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&M.imageHost(u.hostname);}catch{return false;}}
async function fetchImage(url,signal){
 const request = () => fetch(url, { credentials: 'omit', redirect: 'error', signal });
 try {
  return await request();
 } catch (error) {
  if (signal?.aborted || error.name !== 'TypeError') throw error;
  return request();
 }
}
async function downloadImage(url,signal){
 if(!mediaURL(url))throw Error('Media host is not allowed or URL is invalid');
 let r;
 try{r=await fetchImage(url,signal);}catch(error){
  if(error.name!=='TypeError')throw error;
  throw Error('Image request failed');
 }
 if (!r.ok) throw Error('Image HTTP ' + r.status);
 if (!r.body) throw Error('Image response is empty');
 const reader=r.body.getReader();let size=0;const chunks=[];
 try{
  while(true){
   const x=await reader.read();
   if(x.done)break;
   size+=x.value.length;
   if(size>16*1024*1024)throw Error('Image exceeds 16 MB');
   chunks.push(x.value);
  }
  const data=new Uint8Array(size);let at=0;
  for(const c of chunks){data.set(c,at);at+=c.length;}
  return {data,ext:imageType(data)};
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
// Conversation payloads can repeat structured profile data in their source
// metadata. Keep the chat and its media, while omitting those profile fields.
const characterMetadata = /^(?:bot(?:_?id|_?name|_?profile|_?url)?|character(?:_?id|_?name|_?url|_?profile|_?card|_?info)?|external_?id|prefetchedCharacterDetailed)$/i;
const imageMetadata = /^(?:images?|image_?(?:url|uri|path|rel_?path)|tti_?image_?rel_?path|photos?)$/i;
const mixedAttachments = /^(?:attachments?|media)$/i;
function diagnosticURL(value) {
 try {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password ? url.origin + url.pathname : undefined;
 } catch {
  return undefined;
 }
}
function chatMetadata(value, model) {
 if (Array.isArray(value)) return value.map(item => chatMetadata(item, model));
 if (typeof value === 'string') return M.textWithoutImageURLs(value);
 if (!value || typeof value !== 'object') return value;
 return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
  if (characterMetadata.test(key) || imageMetadata.test(key)) return [];
  if (mixedAttachments.test(key)) {
   if (Array.isArray(item)) {
    const remaining = item.filter(entry => !M.containsImage(entry, model.platform));
    return remaining.length ? [[key, chatMetadata(remaining, model)]] : [];
   }
   if (M.containsImage(item, model.platform)) return [];
  }
  if (item === model.id && /(?:id|identifier)$/i.test(key)) return [];
  if (typeof item === 'string' && /url$/i.test(key) && M.route(item)?.id === model.id) return [];
  return [[key, chatMetadata(item, model)]];
 }));
}

function creatorMetadata(value, assets) {
 const imageIds = new Map(assets.filter(asset => asset.role === 'reference' && asset.status === 'saved')
  .map(asset => [asset.url, asset.image_id]));
 function sanitize(item) {
  if (typeof item === 'string') return M.textWithoutImageURLs(item, true);
  if (Array.isArray(item)) return item.map(sanitize);
  if (!item || typeof item !== 'object') return item;
  return Object.fromEntries(Object.entries(item).flatMap(([key, entry]) => {
   if (key === 'image_url') return imageIds.has(entry) ? [['image_id', imageIds.get(entry)]] : [];
   return [[key, sanitize(entry)]];
  }));
 }
 return sanitize(value);
}

async function build(input){
 let {model,conversations,scope,assets,files:assetFiles,cardPNG,started,stopped=false,warnings=[]}=input;
 const creator=scope.actual==='creator_character';
 if(creator && conversations.length)throw Error('Creator packages cannot contain conversations');
 const matchId = await characterMatchId(model.platform, model.id);
 if (!creator) {
  assets = assets.filter(asset => asset.role === 'message_image');
  const chatPaths = new Set(assets.filter(asset => asset.status === 'saved').map(asset => asset.path));
  assetFiles = assetFiles.filter(file => chatPaths.has(file.path));
  const attachmentCounts = new Map();
  for (const asset of model.assets ?? assets) {
   if (asset.role !== 'message_image') continue;
   const key = JSON.stringify([asset.conversation_id, asset.message_id]);
   attachmentCounts.set(key, (attachmentCounts.get(key) || 0) + 1);
  }
  conversations = conversations.map(conversation => {
   const clean = chatMetadata(conversation, model);
   for (const message of clean.messages) {
    const count = attachmentCounts.get(JSON.stringify([conversation.id, message.id]));
    if (count) message.image_attachment_count = count;
   }
   return clean;
  });
  scope = chatMetadata(scope, model);
 }
 const files=[...assetFiles],put=(path,data)=>files.push({path,data:typeof data==='string'?data:json(data)});
 const missing=Object.entries(creator ? model.fields : {}).filter(([,f])=>!['available','empty'].includes(f.status)).map(([field,f])=>({field,status:f.status,source:f.source}));
 const sourceGaps = c => model.platform === 'tipsy' && c.completeness.gaps_from_source === true;
 const savedAssets=assets.filter(asset=>asset.status==='saved'), rejectedAssets=assets.filter(asset=>asset.status!=='saved');
 const skippedImages=Math.max(0,(model.assets?.length??assets.length)-assets.length);
 const importAssets=savedAssets.map(asset=>{
  const entry={image_id:asset.image_id,role:asset.role,file:asset.file||asset.path,
   sha256:asset.sha256,mime:asset.mime,ref:asset.ref};
  if(asset.conversation_id!=null)entry.conversation_id=asset.conversation_id;
  if(asset.message_id!=null)entry.message_id=asset.message_id;
  return entry;
 });
 let chatStatus = creator ? 'not_requested' : 'partial';
 if (!creator && conversations.length && conversations.every(c => c.completeness.complete_current_mainline || sourceGaps(c))) {
  chatStatus = conversations.some(sourceGaps) ? 'captured_mainlines_with_source_gaps' : 'captured_mainlines_complete';
 }
 const sanitizeAttempt = attempt => ({ ...attempt, url: diagnosticURL(attempt.url) });
 const imageDiagnostics = assets.map(({ role, status, url, path, error, conversation_id, message_id, fallback, attempts }) => ({
  role, status, path,
  ...(conversation_id != null ? { conversation_id } : {}),
  ...(message_id != null ? { message_id } : {}),
  ...(status === 'saved' ? {} : { url: diagnosticURL(url), error }),
  ...(fallback ? { fallback: sanitizeAttempt(fallback) } : {}),
  ...(attempts?.length ? { attempts: attempts.map(sanitizeAttempt) } : {}),
 }));
 const report={schema:'bot_package_report_v1',character:{status:creator?(missing.length?'partial':'captured_fields'):'name_only',missing},images:{status:rejectedAssets.length||skippedImages?'partial':assets.length?'complete':'not_found',assets:imageDiagnostics,...(skippedImages?{skipped_count:skippedImages}:{})},chats:{status:chatStatus,scope,conversations:conversations.map(c=>({id:c.id,...c.completeness})),all_regeneration_variants_verified:false},stopped,warnings:creator?[...model.warnings,...warnings]:[...warnings]};
 if(creator&&rejectedAssets.length)report.warnings.push('Some images could not be downloaded and were left out of the import metadata. The character can still be imported without them.');
 if (creator) {
  const { card, source, assets: sourceAssets, ...character } = model;
  put('character/character.json', creatorMetadata(character, savedAssets));
  put('character/card.json', creatorMetadata(card, savedAssets));
  put('provenance/source.json', creatorMetadata(source, savedAssets));
  if (cardPNG) files.push({ path: 'character/card.png', data: cardPNG });
  else report.warnings.push('The PNG character card is unavailable. The JSON card is included.');
 } else {
  put('character/character.json', { name: model.name });
 }
 put('assets/assets.json', { schema: 'roleleaf_assets_v1', assets: importAssets });
 for(const[cIndex,c]of conversations.entries()){const folder=`conversations/${cIndex+1}-${M.safe(c.id)}`;put(folder+'/messages.json',c);put(folder+'/transcript.txt',M.transcript(c));}
 put('provenance/report.json',report);
 const imgHTML=assets.filter(a=>a.status==='saved').map(a=>`<figure><img src="${escape(a.path)}" alt="${escape(a.role)}"><figcaption>${escape(a.role)}</figcaption></figure>`).join('');
 const chatHTML=conversations.map(c=>`<details><summary>Chat ${escape(c.id)} · ${c.messages.length} messages · ${c.completeness.complete_current_mainline?'Current thread complete':sourceGaps(c)?'Captured available history with missing source sequences':'Partial history'}</summary>${c.messages.map(m=>`<article><small>${escape(m.role)} · ${escape(m.timestamp)}</small><pre>${escape(m.content??'Selected reply is unknown. See the JSON.')}</pre>${m.candidates.length?`<details><summary>${m.candidates.length} reply candidates</summary>${m.candidates.map(x=>`<pre>${escape(x.raw_content)}</pre>`).join('')}</details>`:''}</article>`).join('')}</details>`).join('');
 const characterHTML = creator ? '<h2>Character details</h2>' + Object.entries(creatorMetadata(model.fields, savedAssets))
  .map(([key, field]) => `<details><summary>${escape(key)} · ${escape(field.status)}</summary><pre>${escape(typeof field.value==='string'?field.value:json(field.value))}</pre></details>`).join('') : '';
 put('README.html',`<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(model.name)} · RoleLeaf export</title><style>body{max-width:960px;margin:40px auto;padding:0 24px;background:#141621;color:#e6e8f2;font:16px/1.7 system-ui}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;background:#202331;padding:16px;border-radius:12px}img{max-width:240px;max-height:300px}figure{display:inline-block;margin:8px}summary{cursor:pointer;padding:14px;background:#292b42;margin:12px 0}small{color:#aeb3cf}article{border-bottom:1px solid #363b50;padding:16px 0}</style><h1>${escape(model.name)}</h1><p>${escape(model.platform)}</p><p>${creator?'Creator backup from the source editor. Chats are outside this export.':'Covers the current chat. Other chats and archives are unverified.'}${stopped?' Export stopped. Available data was saved.':''}</p><p>Character: ${escape(report.character.status)} · Images: ${escape(report.images.status)} · Chat: ${escape(report.chats.status)}</p><h2>Coverage and missing content</h2><ul>${[...missing.map(x=>x.field+': '+x.status),...report.warnings].map(x=>'<li>'+escape(x)+'</li>').join('')}</ul>${characterHTML}<h2>Images</h2>${imgHTML}${creator?'':'<h2>Chat</h2>'+chatHTML}</html>`);
 const index=[];for(const file of files)index.push({path:file.path,bytes:bytes(file.data).length,sha256:await sha(file.data)});
 const manifest={schema:'bot_package_v1',exporter_version:M.VERSION,platform:model.platform,match_id:matchId,is_creator:creator,name:model.name,started_at:started,finished_at:new Date().toISOString(),scope,complete:creator ? report.character.status==='captured_fields'&&report.images.status==='complete' : !stopped&&report.images.status!=='partial'&&report.chats.status==='captured_mainlines_complete'&&scope.conversation_list_complete===true,files:index,index_excludes:['manifest.json'],report:'provenance/report.json'};
 if (creator) manifest.bot_id = model.id;
 put('manifest.json',manifest);
 let excess = index.reduce((total, file) => total + file.bytes, bytes(json(manifest)).length) - MAX_ZIP_BYTES;
 if (excess > 0 && (assetFiles.length || cardPNG)) {
  if (cardPNG) excess -= cardPNG.length;
  const removed = new Set();
  for (const file of [...assetFiles].reverse()) {
   if (excess <= 0) break;
   removed.add(file.path);
   excess -= bytes(file.data).length;
  }
  return build({ ...input, cardPNG: null,
   files: assetFiles.filter(file => !removed.has(file.path)),
   assets: assets.map(asset => removed.has(asset.path) ? {
    ...asset, status: 'failed', path: null, error: 'Image omitted to keep the ZIP within 128 MB',
   } : asset),
  });
 }
 return {files,manifest,report,bytes:zip(files)};
}
root.BotPackage=Object.freeze({zip,sha,build,creatorMetadata,downloadImage,mediaURL,imageType,pathOK});
})(globalThis);
