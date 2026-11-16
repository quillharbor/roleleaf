// UI harness with synthetic data and real ZIP downloads; never shipped.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../tipsy-exporter');
const mock=String.raw`
(() => {
const demoPlatform=new URL(location.href).searchParams.get('platform')||'tipsy';
const origin=demoPlatform==='tipsy'?'https://tipsy.chat':'https://character.ai';
const ids=demoPlatform==='tipsy'?['100000001','100000002','100000003']:['Synthetic_Luna-123','Synthetic_Sol-456','Synthetic_Nova-789'];
const bots=ids.map((id,index)=>({id,url:origin+'/chat/'+id,name:['Luna 月亮','Sol 太阳','Nova 新星'][index]}));
const tabs=new Map([[1,bots[0]]]),listeners=new Set();
let nextTab=2,nextDownload=1;
const demoText='Synthetic 原文 {{user}} 🌙\nNo AI completion.';
window.fetch=async()=>new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0)),{status:200});

window.chrome={
 runtime:{getManifest:()=>({version:'0.5.0'}),getURL:file=>'/'+file},
 storage:{session:{
  set:async values=>{for(const [key,value] of Object.entries(values))sessionStorage.setItem(key,JSON.stringify(value));},
  get:async key=>({[key]:JSON.parse(sessionStorage.getItem(key))}),
  remove:async key=>sessionStorage.removeItem(key),
 }},
 tabs:{
  query:async()=>[{id:1,url:bots[0].url}],
  getCurrent:async()=>null,
  get:async id=>({id,url:tabs.get(id).url}),
  reload:async()=>{},
  create:async({url})=>{
   if(url.startsWith('/collector.html?')){location.href=url+'&platform='+demoPlatform;return;}
   const id=nextTab++;
   tabs.set(id,bots.find(bot=>bot.url===url));
   return {id};
  },
  remove:async id=>tabs.delete(id),
  sendMessage:async(tabId,message)=>{
   const {id,name,url}=tabs.get(tabId);
   const current={platform:demoPlatform,id,url};
   if(message.type==='BOT_SIDEBAR')return {ok:true,platform:demoPlatform,current,bots};
   const capturedAt=new Date().toISOString(),chatId='synthetic-'+id;
   const status={character_id:id,conversation_id:chatId,latest_page_captured:true,records:2,running:false};
   const completeness={records:2,complete_current_mainline:true,all_regeneration_variants_verified:false};
   const records=[
    {sequence:'1',sender_type:'character',content_type:'text',content:name+': '+demoText,timestamp:123},
    {sequence:'2',sender_type:'user',content_type:'text',content:'Synthetic reply',timestamp:124},
   ];
   if(message.type==='TIPSY_GET_CURRENT'){
    return {ok:true,entry:{capturedAt,source:{character:{
     character_id:id,nickname:name,introduction:'合成测试角色',greeting:demoText,
     background:'Literal definition',tags:['Romantic'],face_url:'https://img.tipsy.chat/synthetic.png',
    }}}};
   }
   if(message.type==='TIPSY_CHAT'){
    return {ok:true,status,data:{source:{character_id:id,conversation_id:chatId},completeness,records,pages:[{cursor:'0',count:2}]}};
   }
   const messages=records.map(({sequence,sender_type,content,content_type,timestamp})=>({
    id:sequence,role:sender_type,content,content_type,timestamp,candidates:[],source:{},
   }));
   return {ok:true,status,entry:{capturedAt,character:{
    external_id:id,name,title:'Tagline',description:'Description',definition:'Literal definition',
    greeting:demoText,avatar_url:'https://characterai.io/synthetic.png',
   }},conversations:[{id:chatId,completeness,messages}],scope:{
    actual:'current_conversation',conversation_list_complete:false,archived_checked:false,
   }};
  },
 },
 downloads:{
  download:async options=>{
   const id=nextDownload++;
   const link=document.createElement('a');
   link.href=options.url;
   link.download=options.filename.split('/').at(-1);
   link.click();
   setTimeout(()=>{for(const listener of listeners)listener({id,state:{current:'complete'}});},450);
   return id;
  },
  onChanged:{addListener:listener=>listeners.add(listener),removeListener:listener=>listeners.delete(listener)},
 },
};
})();
`;
const port=Number(process.env.BOT_PREVIEW_PORT || 8769);
http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/mock.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(mock);return;}const file=pathname==='/'?'popup.html':pathname.slice(1);const allowed=['popup.html','popup.css','popup.js','i18n.js','messages.js','bot-creator.js','collector.html','collector.js','collect-bot.js','core.js','chat.js','png.js','bot-model.js','bot-package.js'];if(!allowed.includes(file)){res.writeHead(404);res.end();return;}let content=fs.readFileSync(path.join(root,file));if(file.endsWith('.html'))content=content.toString().replace('<script src="core.js">','<script src="mock.js"></script><script src="core.js">');res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript');res.end(content);}).listen(port,'127.0.0.1',()=>console.log(`Synthetic preview: http://127.0.0.1:${port}/?platform=character_ai`));
