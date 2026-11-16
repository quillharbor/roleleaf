const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const id='9000000000000000002',url='https://api.tipsy.chat/api/v1/chat/history';
const sleep=()=>new Promise(r=>setTimeout(r,40));
function setup(scroller=null, mobile=false, desktop=scroller, timers={}){
 const messages=[],listeners=[],queue=[];let runtimeListener=[];
 const location={origin:'https://tipsy.chat',href:`https://tipsy.chat/chat/${id}`};
 const win={addEventListener:(n,fn)=>listeners.push(fn),postMessage:m=>{messages.push(m);queueMicrotask(()=>listeners.forEach(fn=>fn({source:win,origin:location.origin,data:m})));},fetch:()=>queue.shift()};
 class XHR{open(){}send(){}}
 const shared={URL,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout,window:win,location,XMLHttpRequest:XHR,
 ...timers,document:{querySelectorAll:()=>mobile?[{parentElement:typeof scroller==='function'?scroller():scroller,getAttribute:()=>null}]:[],querySelector:()=>desktop},
 getComputedStyle:el=>({overflowY:el.overflowY||'visible'}),crypto:require('node:crypto').webcrypto,
 chrome:{runtime:{id:'test',onMessage:{addListener:fn=>runtimeListener.push(fn)}}}};
 const main=vm.createContext({...shared}),isolated=vm.createContext({...shared});
 vm.runInContext(fs.readFileSync('tipsy-exporter/page.bundle.js','utf8'),main);
 vm.runInContext(fs.readFileSync('tipsy-exporter/bridge.bundle.js','utf8'),isolated);
 const command=action=>new Promise(resolve=>runtimeListener.forEach(fn=>fn({type:'TIPSY_CHAT',action,characterId:id},{id:'test'},resolve)));
 function response(data){const r=new Response(JSON.stringify(data));Object.defineProperty(r,'url',{value:url});return r;}
 return {win,queue,command,response,location,messages};
}
test('real bridge handshake, delayed fetch and export work across execution worlds',async()=>{
 const e=setup();let s=await e.command('status');assert.equal(s.ok,true);assert.equal(s.status.character_id,id);assert.equal(s.status.records,0);
 const p=Promise.resolve(e.response({code:0,data:[{sequence:'1',content:'hello',content_type:'text',sender_type:'character'}]}));
 e.queue.push(p);const original=e.win.fetch(url,{body:JSON.stringify({character_id:id,sequence:'0'})});assert.equal(original,p);
 assert.equal((await original.then(r=>r.json())).data[0].content,'hello');await sleep();
 s=await e.command('export');assert.equal(s.data.records[0].content,'hello');assert.equal(s.status.complete_current_mainline,true);
 assert.ok(!JSON.stringify(e.messages).includes('Authorization'));
});
const message=n=>({sequence:String(n),content:'message '+n,sender_type:'character',content_type:'text'});
async function page(e,cursor,rows){
 e.queue.push(Promise.resolve(e.response({code:0,data:rows})));
 await e.win.fetch(url,{body:JSON.stringify({character_id:id,sequence:cursor})});await sleep();
}
test('reloading an identical latest page retains all previously captured pages',async()=>{
 const e=setup();
 await page(e,'0',[message(5),message(6)]);
 await page(e,'4',[message(3),message(4)]);
 await page(e,'2',[message(1),message(2)]);
 await page(e,'0',[message(5),message(6)]);
 const out=await e.command('export');
 assert.deepEqual(Array.from(out.data.records,m=>m.sequence),['1','2','3','4','5','6']);
 assert.equal(out.status.complete_current_mainline,true);
});
test('a changed latest page still invalidates old history, including deleted messages',async()=>{
 const e=setup();await page(e,'0',[message(3),message(4)]);await page(e,'2',[message(1),message(2)]);
 await page(e,'0',[message(2),{...message(3),content:'edited'}]);
 const out=await e.command('export');
 assert.deepEqual(Array.from(out.data.records,m=>m.sequence),['2','3']);
 assert.equal(out.data.records[1].content,'edited');assert.equal(out.status.complete_current_mainline,false);
});
test('identical latest refetch does not orphan an in-flight older page',async()=>{
 const e=setup();await page(e,'0',[message(3),message(4)]);
 let finish;e.queue.push(new Promise(r=>finish=r));
 const pending=e.win.fetch(url,{body:JSON.stringify({character_id:id,sequence:'2'})});
 await page(e,'0',[message(3),message(4)]);
 finish(e.response({code:0,data:[message(1),message(2)]}));await pending;await sleep();
 const out=await e.command('export');assert.equal(out.data.records.length,4);assert.equal(out.status.complete_current_mainline,true);
});
test('virtual list at the top rearms its load threshold and ignores an unrelated desktop scroller',async()=>{
 let position=0,armed=false,loads=0,e;
 const unrelated={isConnected:true,clientHeight:200,scrollHeight:1000,scrollTop:0};
 const scroller={isConnected:true,clientHeight:200,scrollHeight:1000,overflowY:'auto',parentElement:null,
  get scrollTop(){return position},set scrollTop(v){position=v;if(v>100)armed=true;
   if(v===0&&armed&&loads<2){armed=false;const cursor=loads++===0?'4':'2';void page(e,cursor,cursor==='4'?[message(3),message(4)]:[message(1),message(2)]);}
  }};
 e=setup(scroller,true,unrelated);await page(e,'0',[message(5),message(6)]);
 await e.command('start');
 try{
  for(let i=0;i<90;i++){if(!(await e.command('status')).status.running)break;await sleep();}
  const out=await e.command('export');assert.equal(out.status.complete_current_mainline,true);
  assert.equal(out.data.records.length,6);assert.equal(loads,2);assert.equal(position,0);
 }finally{await e.command('cancel');}
});
test('mobile message ancestor scrolls older history without desktop classes',async()=>{
 let onTop=()=>{},position=800;
 const scroller={isConnected:true,clientHeight:200,scrollHeight:1000,overflowY:'auto',parentElement:null,
  get scrollTop(){return position},set scrollTop(v){position=v;if(v===0)onTop();}};
 const e=setup(scroller,true),message=n=>({sequence:String(n),content:'synthetic '+n,sender_type:'character',content_type:'text'});
 e.queue.push(Promise.resolve(e.response({code:0,data:[message(3),message(4)]})));
 await e.win.fetch(url,{body:JSON.stringify({character_id:id,sequence:'0'})});await sleep();
 let triggered=false;onTop=()=>{if(triggered)return;triggered=true;e.queue.push(Promise.resolve(e.response({code:0,data:[message(1),message(2)]})));e.win.fetch(url,{body:JSON.stringify({character_id:id,sequence:'2'})});};
 assert.equal((await e.command('start')).status.running,true);
 await new Promise(r=>setTimeout(r,1500));const out=await e.command('export');
 assert.equal(out.data.records.length,4);assert.equal(out.status.complete_current_mainline,true);assert.equal(position,800);
});
test('response arriving after route change cannot enter another character cache',async()=>{
 const e=setup();let finish;e.queue.push(new Promise(r=>finish=r));e.win.fetch(url,{body:JSON.stringify({character_id:id,sequence:'0'})});
 e.location.href='https://tipsy.chat/chat/999999999';finish(e.response({code:0,data:[{sequence:'1',content:'private old',sender_type:'character',content_type:'text'}]}));await sleep();
 e.location.href=`https://tipsy.chat/chat/${id}`;const s=await e.command('export');assert.equal(s.data.records.length,0);
});
test('automatic scrolling collects older pages; popup commands can cancel a running job',async()=>{
 let onTop=()=>{};const scroller={isConnected:true,scrollHeight:1000,clientHeight:200,get scrollTop(){return 800},set scrollTop(v){if(v===0)onTop();}};
 const e=setup(scroller),message=n=>({sequence:String(n),content:'message '+n,sender_type:'character',content_type:'text'});
 e.queue.push(Promise.resolve(e.response({code:0,data:[message(3),message(4)]})));
 await e.win.fetch(url,{body:JSON.stringify({character_id:id,sequence:'0'})});await sleep();
 let triggered=false;onTop=()=>{if(triggered)return;triggered=true;e.queue.push(Promise.resolve(e.response({code:0,data:[message(1),message(2)]})));e.win.fetch(url,{body:JSON.stringify({character_id:id,sequence:'2'})});};
 assert.equal((await e.command('start')).status.running,true);
 await new Promise(r=>setTimeout(r,1500));let out=await e.command('export');assert.equal(out.data.records.length,4);assert.equal(out.status.complete_current_mainline,true);assert.equal(out.status.running,false);
 const fresh=setup(scroller);onTop=()=>{};fresh.queue.push(Promise.resolve(fresh.response({code:0,data:[message(4)]})));
 await fresh.win.fetch(url,{body:JSON.stringify({character_id:id,sequence:'0'})});await sleep();
 await fresh.command('start');assert.equal((await fresh.command('cancel')).status.running,false);assert.equal((await fresh.command('export')).status.complete_current_mainline,false);
});

function fastClock() {
 let now = Date.now();
 return {
  Date: class extends Date { static now() { return now; } },
  setTimeout: (fn, ms) => setTimeout(() => { now += ms; fn(); }, 1),
 };
}

async function collected(e) {
 for (let i = 0; i < 40; i++) {
  const out = await e.command('export');
  if (!out.status.running) return out;
  await sleep();
 }
 assert.fail('History collection did not settle');
}

test('pagination finds the replacement scroller after no older request arrives', async () => {
 let e, current, opened = 0;
 function list(onTop) {
  let position = 0;
  return {isConnected:true, clientHeight:200, scrollHeight:1000, overflowY:'auto', parentElement:null,
   get scrollTop() { return position; },
   set scrollTop(value) { position = value; if (!value) onTop(); },
  };
 }
 const second = list(() => {
  if (++opened !== 1) return;
  void page(e, '16', Array.from({length:16}, (_,i) => message(i+1)));
 });
 current = list(() => { current.isConnected = false; current = second; });
 e = setup(() => current, true, null, fastClock());
 await page(e, '0', Array.from({length:10}, (_,i) => message(i+17)));
 await e.command('start');
 const out = await collected(e);
 assert.equal(out.status.complete_current_mainline, true);
 assert.equal(out.status.records, 26);
 assert.equal(opened, 1);
});

for (const requested of [false, true]) {
 test(requested ? 'a pending older request is not retriggered and has its own timeout' : 'a missing older request has its own diagnostic', async () => {
  let position = 800, triggers = 0, e;
  const scroller = {isConnected:true, clientHeight:200, scrollHeight:1000,
   get scrollTop() { return position; },
   set scrollTop(value) {
    position = value;
    if (value) return;
    triggers++;
    if (requested && triggers === 1) {
     e.queue.push(new Promise(() => {}));
     e.win.fetch(url,{body:JSON.stringify({character_id:id,sequence:'16'})});
    }
   },
  };
  e = setup(scroller, false, scroller, fastClock());
  await page(e, '0', [message(17), message(18)]);
  await e.command('start');
  const out = await collected(e);
  assert.equal(out.status.records, 2);
  assert.equal(out.status.complete_current_mainline, false);
  assert.equal(triggers, requested ? 1 : 3);
  assert.match(out.status.error, requested ? /Timed out waiting.*response/ : /did not request earlier messages/);
 });
}
