(function(){
'use strict';
const M=globalThis.BotModel,C=globalThis.BotCai;if(globalThis.__botCaiInstalled)return;globalThis.__botCaiInstalled=true;
let identity=M.route(location.href),entry=null,history=null,running=false,job=0,notice='Waiting for the page to respond. Refresh the character chat.',revision=0,chatId=null;
function sync(){const now=M.route(location.href);if(now?.id!==identity?.id){identity=now;entry=null;history=null;chatId=null;running=false;job++;revision++;}return now;}
function status(){sync();return {character_id:identity?.id,conversation_id:history?.id||chatId,running,notice,...(history?.export().completeness||{records:0}),revision};}
function failure(e){if(history)history.error=e.message;notice=e.message;running=false;job++;}
function bind(cid){if(chatId&&chatId!==cid){history=null;job++;running=false;notice='The chat changed. Export again.';revision++;}chatId=cid;}
function receive(u,p,scope){sync();if(scope!==identity||!identity)return;
 if(u.pathname==='/character/v1/get_character_info'){
  const c=M.caiCharacter(p.character);if(c.external_id!==identity.id)return;
  const avatar=Array.from(document.querySelectorAll('img')).find(x=>c.avatar_file_name&&x.src.includes(c.avatar_file_name));if(avatar)c.avatar_url=avatar.src;
  entry={character:c,capturedAt:new Date().toISOString()};revision++;return;
 }
 const match=u.pathname.match(/^\/turns\/([\w-]+)\/$/);if(match){
  const cid=match[1],cursor=u.searchParams.get('next_token')||'';
  if(!cursor){
   const snapshot=new C.History(identity.id,cid);snapshot.accept('',p);
   snapshot.latestSignature=JSON.stringify([snapshot.next,snapshot.export().messages]);
   // An unchanged latest refetch must not discard older pages or rewind next.
   if(history?.id===cid&&history.latestSignature===snapshot.latestSignature)return;
   bind(cid);history=snapshot;running=false;job++;
  }else{
   if(!history||history.id!==cid)return;
   history.accept(cursor,p);
  }
  revision++;notice=history.ended?'Reached the start of the current chat. Coverage of earlier regenerated replies is unverified.':'Partial history available.';return;
 }
 const chat=u.pathname.match(/^\/chat\/([\w-]+)\/$/);if(chat&&p.chat?.character_id===identity.id)bind(chat[1]);
}
function relevant(u){return u.origin==='https://neo.character.ai'&&(u.pathname==='/character/v1/get_character_info'||/^\/(?:turns|chat)\/[\w-]+\/$/.test(u.pathname));}
async function body(response){if(!response.ok)throw Error('Chat history HTTP '+response.status);const reader=response.body.getReader();let n=0;const chunks=[];try{while(true){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>16*1024*1024)throw Error('Response exceeds 16 MB');chunks.push(r.value);}const bytes=new Uint8Array(n);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
const fetchOriginal=window.fetch;window.fetch=function(...args){sync();const url=typeof args[0]==='string'?args[0]:args[0]?.url;let u;try{u=new URL(url,location.href);}catch{}const scope=identity;const promise=Reflect.apply(fetchOriginal,this,args);if(u&&relevant(u))promise.then(r=>body(r.clone())).then(p=>receive(u,p,scope)).catch(e=>{if(scope===identity)failure(e);});return promise;};
const urls=new WeakMap(),open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open=function(method,url,...rest){try{urls.set(this,new URL(url,location.href));}catch{}return Reflect.apply(open,this,[method,url,...rest]);};
XMLHttpRequest.prototype.send=function(){sync();const u=urls.get(this),scope=identity;if(u&&relevant(u))this.addEventListener('load',()=>{try{if(this.status<200||this.status>=300)throw Error('API HTTP '+this.status);const text=this.responseType==='json'?JSON.stringify(this.response):this.responseText;if(text.length>16*1024*1024)throw Error('Response exceeds the size limit');receive(u,JSON.parse(text),scope);}catch(e){if(scope===identity)failure(e);}},{once:true});return Reflect.apply(send,this,arguments);};
// Observe mutation commands without retaining credentials or changing socket traffic.
if(typeof window.WebSocket==='function'){
 const Native=window.WebSocket;
 window.WebSocket=new Proxy(Native,{construct(Target,args){const ws=Reflect.construct(Target,args),send=ws.send;
  ws.send=function(data){try{const p=typeof data==='string'&&data.length<1024*1024?JSON.parse(data):null;if(history&&/^(?:create_and_generate_turn|generate_turn|edit_turn_candidate|update_primary_candidate|remove_turns|delete_turn|rewind)/.test(p?.command||''))failure(Error('A message is being sent, edited, or regenerated. Wait for it to finish and export again.'));}catch{}return Reflect.apply(send,this,arguments);};
  ws.addEventListener('message',event=>{try{if(typeof event.data!=='string'||event.data.length>16*1024*1024)return;const p=JSON.parse(event.data),t=p.turn;if(history&&t?.turn_key?.chat_id===history.id)failure(Error('Messages changed during export. Export again.'));}catch{}});return ws;}});
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function collect(){
 sync();if(running)return;if(!history?.latest){notice='Recent history is unavailable. Refresh the Character.AI chat.';return;}
 if(history.ended&&!history.error)return;
 const scroller=document.querySelector('.flex-col-reverse.overflow-y-scroll');if(!scroller){failure(Error('The chat cannot scroll. You can save the available messages.'));return;}
 running=true;history.error='';const target=history,scope=identity,run=++job;let count=history.rows.size,last=Date.now();const start=last,oldTop=scroller.scrollTop;
 try{while(running&&run===job&&scope===identity&&target===history){
  sync();if(target!==history||scope!==identity)break;if(history.ended)break;
  if(Date.now()-start>600000)throw Error('Export reached the 10 minute limit');
  const reverse=getComputedStyle(scroller).flexDirection==='column-reverse';
  const range=Math.max(0,scroller.scrollHeight-scroller.clientHeight);
  const nudge=Math.min(range,Math.max(256,scroller.clientHeight));
  // Leave the virtual list's load threshold, including reverse-flex lists.
  scroller.scrollTop=reverse?-range+nudge:nudge;
  await delay(120);if(run!==job)break;
  scroller.scrollTop=reverse?-scroller.scrollHeight:0;
  await delay(1200);
  if(history.rows.size!==count){count=history.rows.size;last=Date.now();}
  if(Date.now()-last>20000)throw Error('No earlier messages arrived within 20 seconds. Check for ads or sign-in prompts. You can save the available messages.');
 }}
 catch(e){if(target===history)failure(e);}finally{if(run===job)running=false;if(scroller.isConnected&&scope===identity)scroller.scrollTop=oldTop;}
}
window.addEventListener('message',e=>{if(e.source!==window||e.origin!==location.origin)return;const m=e.data;if(m?.channel!==M.CHANNEL||m.type!=='CAI_COMMAND'||typeof m.requestId!=='string')return;sync();if(m.characterId!==identity?.id)return;
 if(m.action==='start')collect();else if(m.action==='cancel'){running=false;job++;notice='Export stopped. Saving the available data.';}else if(!['status','export'].includes(m.action))return;
 if(entry&&!entry.character.avatar_url){const c=entry.character,a=Array.from(document.querySelectorAll('img')).find(x=>c.avatar_file_name&&x.src.includes(c.avatar_file_name));if(a)c.avatar_url=a.src;}
 const result={ok:true,status:status()};if(m.action==='export')Object.assign(result,{entry,conversations:history?[history.export()]:[],scope:{requested:'all_bot_conversations',actual:'current_conversation',conversation_list_complete:false,archived_checked:false},revision});
 window.postMessage({channel:M.CHANNEL,type:'CAI_RESULT',requestId:m.requestId,result},location.origin);
});
})();
