const test = require('node:test');
const assert = require('node:assert/strict');
require('../tipsy-exporter/chat.js');
const {History, request, endpoint, transcript} = globalThis.TipsyExporterChat;
const id = '9000000000000000002';
const q = cursor => ({character_id:id,sequence:cursor,size:10,language_code:'en',chat_mode:'group_chat'});
const row = (sequence, content='原文 {{user}}\n下一行') => ({sequence:String(sequence),sender_type:'character',content_type:'text',content,timestamp:123});
test('synthetic paginated histories export exact text, deduplicate pages and keep events separate',()=>{
 const pages=require('./fixtures/chat-pages.cjs');
 for(const character of [...new Set(pages.map(p=>p.request.character_id))]){
  const h=new History(character);
  for(const p of pages.filter(p=>p.request.character_id===character && p.response))h.accept(p.request,p.response);
  const out=h.export('样本');assert.equal(out.completeness.complete_current_mainline,true);
  assert.equal(out.records.length,character==='100000001'?20:14);
  assert.equal(out.completeness.events,1);assert.equal(out.completeness.all_regeneration_variants_verified,false);
  const original=pages.filter(p=>p.request.character_id===character&&p.response).flatMap(p=>p.response.data);
  for(const m of out.records){assert.deepEqual(m,original.find(x=>x.sequence===m.sequence));if(m.content_type==='text')assert.ok(transcript(out).includes(m.content));}
 }
});
test('HTTP success without a valid body is never treated as terminal',()=>{
 const h=new History(id);h.accept(q('0'),{code:0,data:[row(11),row(12)]});
 for(const p of [null,{code:0},{code:1,data:[]}])assert.throws(()=>h.accept(q('10'),p));
 assert.equal(h.summary().server_start_reached,false);
 h.accept(q('10'),{code:0,data:[]});assert.equal(h.summary().end_reason,'empty_older_page');
});
test('conflicting edits, wrong identity and non-progress cursors are rejected atomically',()=>{
 const h=new History(id);h.bind('conversation-one');h.accept(q('0'),{code:0,data:[row(10)]});
 assert.throws(()=>h.accept(q('9'),{code:0,data:[row(10)]}));
 assert.throws(()=>h.accept(q('0'),{code:0,data:[row(10,'changed')]}));
 assert.throws(()=>h.accept({...q('9'),conversation_id:'conversation-two'},{code:0,data:[row(1)]}));
 assert.equal(h.summary().records,1);assert.equal(h.bind('conversation-two'),true);
});
test('identity arriving after first page does not invalidate otherwise matching pagination',()=>{
 const h=new History(id);h.accept(q('0'),{code:0,data:[row(2)]});h.bind('conversation-one');h.accept(q('1'),{code:0,data:[row(1)]});assert.equal(h.summary().complete_current_mainline,true);
});
test('large sequences retain precision; gaps and errors prohibit complete claims',()=>{
 const h=new History(id);h.accept(q('0'),{code:0,data:[row('9007199254740993'),row('9007199254740994')]});
 assert.equal(h.sorted()[0].sequence,'9007199254740993');
 const g=new History(id);g.accept(q('0'),{code:0,data:[row(1),row(3)]});assert.equal(g.summary().complete_current_mainline,false);
 assert.equal(g.summary().gaps_from_source,true);
 const unverified=new History(id);
 unverified.accept(q('0'),{code:0,data:[row(5),row(6)]});
 unverified.accept(q('2'),{code:0,data:[row(1),row(2)]});
 assert.equal(unverified.summary().server_start_reached,true);
 assert.equal(unverified.summary().gaps_from_source,false);
 const paged=new History(id);
 paged.accept(q('0'),{code:0,data:[row(5),row(6)]});
 paged.accept(q('4'),{code:0,data:[row(1),row(2)]});
 assert.equal(paged.summary().gaps_from_source,true);
 paged.error='network';
 assert.equal(paged.summary().gaps_from_source,false);
 const e=new History(id);e.accept(q('0'),{code:0,data:[row(1)]});e.error='network';assert.equal(e.summary().complete_current_mainline,false);
});
test('scope filtering and credential fields are excluded without rewriting message text',()=>{
 assert.equal(endpoint('https://evil.test/api/v1/chat/history'),'');
 assert.deepEqual(request({...q('0'),Authorization:'secret',cookie:'secret'}),q('0'));
 const h=new History(id);h.accept(q('0'),{code:0,data:[{...row(1),token:'secret',content_presentation:{html:'<p>原文</p>',headers:{authorization:'secret'}}}]});
 assert.equal(h.sorted()[0].token,undefined);assert.deepEqual(h.sorted()[0].content_presentation,{html:'<p>原文</p>'});
 assert.equal(h.sorted()[0].content,row(1).content);
});
