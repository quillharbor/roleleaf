const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const id='Synthetic_Bot-123',cid='chat-one',pause=()=>new Promise(r=>setTimeout(r,25));
function setup(scroller=null,images=[]){
 const listeners={main:[],bridge:[]},location={origin:'https://character.ai',href:'https://character.ai/chat/'+id},responses=[];
 const makeWindow=side=>({addEventListener:(n,cb)=>{if(n==='message')listeners[side].push(cb);},postMessage(data){for(const s of ['main','bridge'])for(const cb of listeners[s])cb({source:worlds[s].window,origin:location.origin,data});},fetch:()=>responses.shift()});
 let handler;class XHR{open(){}send(){}}
 const document={querySelectorAll:selector=>selector==='img'?images:[],querySelector:()=>scroller};const globals={URL,TextEncoder,TextDecoder,setTimeout,clearTimeout,location,document,getComputedStyle:()=>({flexDirection:'column-reverse'}),crypto:require('node:crypto').webcrypto,XMLHttpRequest:XHR};
 const worlds={main:vm.createContext({...globals,window:makeWindow('main')}),bridge:vm.createContext({...globals,window:makeWindow('bridge'),chrome:{runtime:{id:'extension',onMessage:{addListener:cb=>handler=cb}}}})};
 for(const [side,file]of [['main','cai-page.bundle.js'],['bridge','cai-bridge.bundle.js']])vm.runInContext(fs.readFileSync('tipsy-exporter/'+file,'utf8'),worlds[side]);
 return {location,worlds,responses,command:action=>new Promise(resolve=>handler({type:'BOT_CAI',action,characterId:id},{id:'extension'},resolve)),async fetch(url,p){responses.push(Promise.resolve(new Response(JSON.stringify(p))));const r=await worlds.main.window.fetch(url);await r.json();await pause();}};
}
const turn={turn_key:{chat_id:cid,turn_id:'one'},create_time:'2026-11-05T01:00:00Z',author:{author_id:id},candidates:[{candidate_id:'choice',raw_content:'exact {{user}} 🌙'}],primary_candidate_id:'choice'};
test('CAI MAIN/ISOLATED bridge survives immediate host body consumption and exports normalized turns',async()=>{const e=setup();await e.fetch('https://neo.character.ai/character/v1/get_character_info',{character:{external_id:id,name:'Synthetic',definition:'literal'}});await e.fetch('https://neo.character.ai/turns/'+cid+'/',{turns:[turn],meta:{next_token:''}});const x=await e.command('export');assert.equal(x.ok,true);assert.equal(x.entry.character.definition,'literal');assert.equal(x.conversations[0].messages[0].content,turn.candidates[0].raw_content);assert.equal(x.status.complete_current_mainline,true);assert.equal(x.scope.conversation_list_complete,false);});
test('CAI chat capture uses the visible character avatar when avatar_file_name is empty',async()=>{
 const avatar='https://characterai.io/pfp-fallbacks/6.webp';
 const e=setup(null,[
  {src:'https://characterai.io/pfp-fallbacks/2.webp',currentSrc:'https://characterai.io/pfp-fallbacks/2.webp',alt:'Other',naturalWidth:1200,naturalHeight:1200,parentElement:{className:'rounded-full'}},
  {src:avatar,currentSrc:avatar,alt:'Synthetic',naturalWidth:1200,naturalHeight:1200,parentElement:{className:'rounded-full'}},
 ]);
 await e.fetch('https://neo.character.ai/character/v1/get_character_info',{character:{external_id:id,name:'Synthetic',avatar_file_name:''}});
 const x=await e.command('export');
 assert.equal(x.ok,true);assert.equal(x.entry.character.avatar_url,avatar);
});
test('CAI late previous-route responses never enter the next bot package',async()=>{const e=setup();let finish;e.responses.push(new Promise(r=>finish=r));const p=e.worlds.main.window.fetch('https://neo.character.ai/turns/'+cid+'/');e.location.href='https://character.ai/chat/Another_bot';finish(new Response(JSON.stringify({turns:[turn],meta:{next_token:''}})));await p;await pause();e.location.href='https://character.ai/chat/'+id;const x=await e.command('export');assert.equal(x.conversations.length,0);});
test('CAI identical latest refetch preserves older turns and the pagination cursor',async()=>{
 const e=setup(),url='https://neo.character.ai/turns/'+cid+'/';
 const older=n=>({...turn,turn_key:{chat_id:cid,turn_id:n}});
 const latest={turns:[turn],meta:{next_token:'page-two'}};
 await e.fetch(url,latest);
 await e.fetch(url+'?next_token=page-two',{turns:[older('two')],meta:{next_token:'page-three'}});
 await e.fetch(url,latest);
 assert.equal((await e.command('export')).conversations[0].messages.length,2);
 await e.fetch(url+'?next_token=page-three',{turns:[older('three')],meta:{next_token:''}});
 await e.fetch(url,latest);
 const out=await e.command('export');
 assert.equal(out.conversations[0].messages.length,3);assert.equal(out.status.complete_current_mainline,true);
});
test('CAI changed latest page invalidates the old snapshot',async()=>{
 const e=setup(),url='https://neo.character.ai/turns/'+cid+'/';
 await e.fetch(url,{turns:[turn],meta:{next_token:''}});
 await e.fetch(url,{turns:[{...turn,candidates:[{candidate_id:'choice',raw_content:'edited'}]}],meta:{next_token:'older'}});
 const out=await e.command('export');assert.equal(out.conversations[0].messages[0].content,'edited');
 assert.equal(out.status.complete_current_mainline,false);
});
test('CAI reverse virtual list already at the oldest edge rearms and completes multiple pages',async()=>{
 let position=-800,armed=false,loads=0,e;
 const url='https://neo.character.ai/turns/'+cid+'/';
 const scroller={isConnected:true,clientHeight:200,scrollHeight:1000,
  get scrollTop(){return position},set scrollTop(v){position=Math.max(-800,Math.min(0,v));if(position>-700)armed=true;
   if(position===-800&&armed&&loads<2){armed=false;loads++;void e.fetch(url+'?next_token=page-'+loads,{turns:[{...turn,turn_key:{chat_id:cid,turn_id:'older-'+loads}}],meta:{next_token:loads===1?'page-2':''}});}
  }};
 e=setup(scroller);await e.fetch(url,{turns:[turn],meta:{next_token:'page-1'}});
 await e.command('start');
 try{
  for(let i=0;i<140;i++){if(!(await e.command('status')).status.running)break;await pause();}
  const out=await e.command('export');assert.equal(out.status.complete_current_mainline,true);
  assert.equal(out.status.running,false);assert.equal(out.conversations[0].messages.length,3);assert.equal(position,-800);
 }finally{await e.command('cancel');}
});
