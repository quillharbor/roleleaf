(function(root){
'use strict';
const M=root.BotModel;
class History{
 constructor(botId,id){this.botId=botId;this.id=id;this.rows=new Map();this.pages=[];this.latest=false;this.ended=false;this.next=null;this.error='';this.revision=0;this.seen=new Set();}
 accept(cursor,p){
  if(!p||!Array.isArray(p.turns)||!p.meta||!Object.hasOwn(p.meta,'next_token'))throw Error('History response is missing messages or pagination metadata');
  if(p.meta.next_token!==null&&typeof p.meta.next_token!=='string')throw Error('Unrecognized pagination cursor');
  const next=p.meta.next_token||null;
  if(cursor&&cursor!==this.next&&!this.seen.has(cursor))throw Error('History pages are out of order');
  if(next&&(next===cursor||this.seen.has(next)))throw Error('History cursor repeated');
  const rows=new Map(this.rows);
  for(const t of p.turns){
   if(t?.turn_key?.chat_id!==this.id||typeof t.turn_key.turn_id!=='string'||!Array.isArray(t.candidates)||!t.author||!Number.isFinite(Date.parse(t.create_time)))throw Error('Invalid message identity or structure');
   const candidates=t.candidates.map(c=>{if(typeof c.candidate_id!=='string'||!(typeof c.raw_content==='string'||c.raw_content==null))throw Error('Unrecognized reply candidate structure');return M.clean(c);});
   const selected=candidates.find(c=>c.candidate_id===t.primary_candidate_id);
   const source={state:t.state??null,last_update_time:t.last_update_time??null};
   for(const key of ['attachment','attachments','image','image_url','image_uri','image_rel_path','tti_image_rel_path','media']){
    if(Object.hasOwn(t,key))source[key]=M.clean(t[key]);
   }
   const msg={id:t.turn_key.turn_id,role:t.author.is_human===true?'user':t.author.author_id===this.botId?'character':'unknown',content:typeof selected?.raw_content==='string'?selected.raw_content:null,content_type:'text',timestamp:t.create_time,candidates,selected_candidate_id:t.primary_candidate_id??null,source};
   const old=rows.get(msg.id);if(old&&M.mediaFingerprint(old)!==M.mediaFingerprint(msg))throw Error('Messages or selected replies changed during export');rows.set(msg.id,msg);
  }
  if(rows.size>10000||new TextEncoder().encode(JSON.stringify([...rows.values()])).length>32*1024*1024)throw Error('Export reached the 10,000 message or 32 MB limit');
  this.rows=rows;this.seen.add(cursor||'');this.latest=this.latest||!cursor;this.next=next;this.ended=!next;this.revision++;this.error='';this.pages.push({cursor:cursor||null,next_token:next,count:p.turns.length});
 }
 export(){const messages=[...this.rows.values()].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)||a.id.localeCompare(b.id));return {schema:'bot_messages_v1',id:this.id,scope:'current_conversation',completeness:{latest_page_captured:this.latest,server_start_reached:this.ended,complete_current_mainline:this.latest&&this.ended&&!this.error&&messages.every(m=>m.content!==null),all_regeneration_variants_verified:false,records:messages.length,candidates:messages.reduce((n,m)=>n+m.candidates.length,0),error:this.error},messages,source_pages:this.pages};}
}
root.BotCai=Object.freeze({History});
})(globalThis);
