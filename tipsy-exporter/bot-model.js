(function(root){
'use strict';
const { VERSION } = root.TipsyExporterCore;
const CHANNEL='bot-exporter-v1';
const str=v=>typeof v==='string'?v:'';
const safe=v=>str(v).normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,'_').replace(/^[.\s]+|[.\s]+$/g,'').slice(0,90)||'bot';
function route(url){try{const u=new URL(url);if(u.origin==='https://tipsy.chat'){const id=root.TipsyExporterCore.roleId(url);return id?{platform:'tipsy',id,url:u.origin+u.pathname}:null;}if(u.origin==='https://character.ai'){const id=u.pathname.match(/^\/chat\/([\w-]{6,100})(?:\/|$)/)?.[1];return id?{platform:'character_ai',id,url:u.origin+u.pathname}:null;}}catch{}return null;}
function clean(v,depth=0){if(depth>25)throw Error('Data is nested too deeply');if(v===null||['string','boolean','number'].includes(typeof v))return v;if(Array.isArray(v))return v.map(x=>clean(x,depth+1));if(!v||typeof v!=='object')return null;const o={};for(const[k,x]of Object.entries(v))if(!/^(?:__proto__|constructor|prototype|authorization|cookie|cookies|set-cookie|token|access_token|refresh_token|password|email|headers|request)$/i.test(k))o[k]=clean(x,depth+1);return o;}
function field(obj,key,source){const value=obj[key];return {value:value??null,status:value==null?'missing':typeof value==='string'?(value.trim()?'available':'empty'):'unmapped',source:source||key};}
function caiCharacter(raw){const keys=['external_id','name','title','description','definition','greeting','additional_greetings','dynamic_greeting_enabled','allow_dynamic_greeting','avatar_file_name','avatar_url','background_image_url','visibility','copyable','has_definition','lorebook_id','tags','categories','user__username','participant__user__username','voice_id','default_voice_id'];const out={};for(const k of keys)if(Object.hasOwn(raw,k))out[k]=clean(raw[k]);if(!/^[\w-]{6,100}$/.test(out.external_id)||typeof out.name!=='string')throw Error('Invalid Character.AI character structure');return out;}
function normalize(r,entry){
 if(r.platform==='tipsy'){
  const core=root.TipsyExporterCore,source=core.project(entry.source),c=source.character,a=core.report(entry);
  if(c.character_id!==r.id)throw Error('The character changed');
  return {schema:'bot_character_v1',platform:r.platform,id:r.id,name:c.nickname,source_url:r.url,captured_at:entry.capturedAt,fields:{name:field(c,'nickname'),description:field(c,'introduction'),definition:{value:core.background(source).value||null,status:core.background(source).state==='present'?'available':core.background(source).state,source:'character.background/public_background'},greeting:field(c,'greeting'),scenario:field(c,'scenario'),world_book:{value:source.world_books??c.world_books??null,status:a.world_books.state,source:'world_books'}},assets:[['avatar',c.face_url],['cover',c.image_url],['background',c.pc_image_url]].filter(x=>x[1]).map(([role,url])=>({role,url})),source,card:core.card(entry),warnings:a.warnings};
 }
 const c=caiCharacter(entry.character);if(c.external_id!==r.id)throw Error('The character changed');
 const fields={};for(const[k,v]of Object.entries({name:'name',tagline:'title',description:'description',definition:'definition',greeting:'greeting',alternate_greetings:'additional_greetings',tags:'tags',visibility:'visibility',voice:'voice_id'}))fields[k]=field(c,v,`character.${v}`);
 if(Array.isArray(c.additional_greetings))fields.alternate_greetings.status=c.additional_greetings.length?'available':'empty';
 fields.world_book={value:null,status:c.lorebook_id?'metadata_only':'missing',source:'character.lorebook_id',id:c.lorebook_id??null};
 const warnings=[];if(fields.definition.status!=='available')warnings.push(c.has_definition?'The source indicates a definition exists, but its text was unavailable.':'No definition text was available. The full character definition is unverified.');warnings.push('Lorebook text is unverified. The chat greeting and author-configured greeting are preserved separately.');
 const card={spec:'chara_card_v2',spec_version:'2.0',data:{name:c.name,description:str(c.description),personality:str(c.definition),scenario:'',first_mes:str(c.greeting),mes_example:'',creator_notes:warnings.join('\n'),system_prompt:'',post_history_instructions:'',alternate_greetings:Array.isArray(c.additional_greetings)?c.additional_greetings.filter(x=>typeof x==='string'):[],tags:root.TipsyExporterCore.tagNames(c.tags),creator:str(c.user__username||c.participant__user__username),character_version:'',extensions:{character_ai:{source:c,source_url:r.url,definition_mapping:'Full definition preserved once in personality; no inferred split.'}}}};
 const assets=[['avatar',c.avatar_url],['background',c.background_image_url]].filter(x=>x[1]).map(([role,url])=>({role,url}));
 return {schema:'bot_character_v1',platform:r.platform,id:r.id,name:c.name,source_url:r.url,captured_at:entry.capturedAt,fields,assets,source:{character:c},card,warnings};
}
function tipsyMessages(data){return {schema:'bot_messages_v1',id:data.source.conversation_id||'current',scope:'current_conversation',completeness:data.completeness,messages:data.records.map(m=>({id:m.sequence,role:m.sender_type,content:m.content,content_type:m.content_type,timestamp:m.timestamp??null,candidates:[],selected_candidate_id:null,source:clean(m)})),source_pages:data.pages};}
function transcript(c){return ['Current chat thread. See report.json for missing content and reply candidate coverage.',...c.messages.map(m=>`[${m.id}] ${m.role} | ${m.timestamp??'Unknown'}\n${m.content_type==='text'?(m.content??'[Selected reply unknown. See the JSON.]'):'[Non-text event. See the JSON.]'}`)].join('\n\n');}
function imageHost(host){return host==='characterai.io'||host==='img.tipsy.chat'||host==='chat-attachments-prod.a4a46ba0803ca197cf9724979695aaf8.r2.cloudflarestorage.com';}
function imageURL(value, includeUnsupported = false, platform = 'character_ai', rewrite = true){
 if(typeof value!=='string')return '';
 let text=value.trim().replace(/^<|>$/g,'');
 if(!text||/^data:/i.test(text))return '';
 if(text.startsWith('//'))text='https:'+text;
 else if(!/^[a-z][a-z0-9+.-]*:/i.test(text)){
  if(platform!=='character_ai')return '';
  const path=text.replace(/^\/+/, '');
  text='https://characterai.io/'+(/^static\//i.test(path)?'i/400/':'')+path;
 }
 try{
  const u=new URL(text);
  if(u.username||u.password||!['http:','https:'].includes(u.protocol))return '';
  if(!includeUnsupported&&(u.protocol!=='https:'||u.port||!imageHost(u.hostname)))return '';
  if(rewrite&&u.hostname==='characterai.io'&&u.pathname.startsWith('/uploaded/')){
   u.pathname='/i/400/static/user/uploaded/'+u.pathname.slice('/uploaded/'.length);
  }else if(rewrite&&u.hostname==='characterai.io'&&u.pathname.startsWith('/avatars/uploaded/')){
   u.pathname='/i/400/static'+u.pathname;
  }
  return u.href;
 }catch{return '';}
}
const webLink=/(?:https?:)?\/\/[^\s<>"'`)]+/gi;
const imageField=/^(?:images?|image_?(?:url|uri|path|rel_?path)|tti_?image_?rel_?path|photos?)$/i;
const attachmentField=/^(?:attachments?|media)$/i;
const imageLocation=/^(?:url|src|file|path)$/i;
const signedParameter=/^(?:x-amz-|x-goog-|signature$|token$|expires$|policy$|key-pair-id$)/i;
const imageExtension=/\.(?:jpe?g|png|gif|webp|avif|svg|bmp|heic)(?:[?#]|$)/i;
function mediaIdentity(link){
 const normalized=imageURL(link,true);
 if(!normalized)return link;
 const url=new URL(normalized);
 for(const key of [...url.searchParams.keys()]){
  if(signedParameter.test(key))url.searchParams.delete(key);
 }
 return url.href;
}
function mediaFingerprint(value){
 function normalize(item, context = ''){
  if(typeof item==='string')return context==='image'||context==='attachment'&&imageExtension.test(item)?mediaIdentity(item):
   chatImageMarkup(item,(url,_,markup,original)=>markup.replace(original,mediaIdentity(url)));
  if(Array.isArray(item))return item.map(entry=>normalize(entry,context));
  if(!item||typeof item!=='object')return item;
  const isImage=!nonImageAttachment(item)&&(context==='image'||isImageAttachment(item));
  return Object.fromEntries(Object.entries(item).map(([key,entry])=>[
   key,normalize(entry,imageField.test(key)||isImage&&imageLocation.test(key)?'image':
    attachmentField.test(key)||context==='attachment'&&imageLocation.test(key)&&!nonImageAttachment(item)?'attachment':''),
  ]));
 }
 return JSON.stringify(normalize(value));
}
function chatImageMarkup(text, handle){
 return text.replace(/(`+)[\s\S]*?\1(?!`)|!\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)|<img\b[^>]*\ssrc\s*=\s*["']([^"']+)["'][^>]*>/gi,
  (markup,code,label,markdownURL,htmlURL)=>code?markup:handle(markdownURL??htmlURL.replace(/&amp;/gi,'&'),
   label??markup.match(/\salt\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(value=>value!==undefined),
   markup,markdownURL??htmlURL));
}
function signedImageURL(value){
 try{
  const url=new URL(value.replace(/^<|>$/g,''),'https://characterai.io');
  return [...url.searchParams.keys()].some(key=>signedParameter.test(key));
 }catch{return false;}
}
function textWithoutImageURLs(text, signedOnly=false){
 return chatImageMarkup(text, (url,label,markup)=>signedOnly&&!signedImageURL(url)?markup:label || '[Image attachment]').replace(webLink, link=>{
  try{
   const url=new URL(link.startsWith('//')?'https:'+link:link);
   return imageExtension.test(url.pathname)&&signedImageURL(link)?'[Image attachment]':link;
  }catch{return link;}
 });
}
function isImageAttachment(value){
 const type=value?.type, mime=value?.mime??value?.content_type;
 return typeof mime==='string'&&/^image\//i.test(mime)||
  typeof type==='string'&&/image|photo/i.test(type);
}
function nonImageAttachment(value){
 const type=value?.type, mime=value?.mime??value?.content_type;
 if(typeof mime==='string'&&/^[\w.+-]+\/[\w.+-]+$/.test(mime))return !/^image\//i.test(mime);
 return typeof type==='string'&&!!type&&!/image|photo/i.test(type);
}
function imageValues(value,out,platform,depth=0,explicit=true){
 if(depth>8||value==null)return;
 if(typeof value==='string'){
  const url=(explicit||imageExtension.test(value))&&imageURL(value,true,platform,false);
  if(url)out.push(url);
  return;
 }
 if(Array.isArray(value)){for(const item of value)imageValues(item,out,platform,depth+1,explicit);return;}
 if(typeof value!=='object')return;
 if(nonImageAttachment(value))return;
 for(const[key,item]of Object.entries(value)){
  if(/^(?:avatar|avatar_url|pfp|profile|profile_image|icon|emoji)$/i.test(key))continue;
  if(imageLocation.test(key)||imageField.test(key)||attachmentField.test(key)){
   imageValues(item,out,platform,depth+1,imageField.test(key)||isImageAttachment(value)||explicit);
  }
 }
}
function containsImage(value,platform='character_ai'){
 if(isImageAttachment(value)&&!nonImageAttachment(value))return true;
 const urls=[];
 imageValues(value,urls,platform,0,false);
 return urls.length>0;
}
function chatImageURLs(message,platform='character_ai'){
 const urls=new Map();
 const add=url=>{if(url)urls.set(mediaIdentity(url),url);};
 for(const text of [message?.content,...(message?.candidates??[]).map(candidate=>candidate?.raw_content)]){
  if(typeof text!=='string')continue;
  chatImageMarkup(text,(value,_,markup)=>{add(imageURL(value,true,platform,false));return markup;});
 }
 const values=[];
 for(const source of [message?.source,...(message?.candidates??[])]){
  if(!source||typeof source!=='object')continue;
  for(const key of ['image_url','image_uri','image_rel_path','tti_image_rel_path','attachment','attachments','image','images','photo','photos','media']){
   if(Object.hasOwn(source,key))imageValues(source[key],values,platform,0,!attachmentField.test(key));
  }
 }
 for(const url of values)add(url);
 return [...urls.values()];
}
function addChatImages(model,conversations){
 for(const conversation of conversations){
  for(const message of conversation.messages){
   for(const url of chatImageURLs(message,model.platform)){
    const fallback=imageURL(url,false,model.platform);
    model.assets.push({
     role:'message_image',url,conversation_id:conversation.id,message_id:message.id,
     ...(fallback&&fallback!==url?{fallback_url:fallback}:{}),
    });
   }
  }
 }
}
root.BotModel=Object.freeze({VERSION,CHANNEL,str,safe,route,clean,field,caiCharacter,normalize,tipsyMessages,transcript,imageHost,imageURL,mediaFingerprint,textWithoutImageURLs,containsImage,chatImageURLs,addChatImages});
})(globalThis);
