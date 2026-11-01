const fs=require('fs');
let html=fs.readFileSync('dist/index.html','utf8');
html=html.replace('<div class="crop-previews">','<details id="crop-details" class="capture-settings"><summary>Show reading crops & diagnostics</summary><div class="crop-previews">');
fs.writeFileSync('dist/index.html',html);
let js=fs.readFileSync('dist/app.js','utf8').replaceAll('reader-3','reader-4');
js="import {observeChat} from './chat.mjs?v=reader-4';\nimport {discordBody} from './notifications.mjs?v=reader-4';\n"+js;
js=js.replace('const fmt=n=>',"let chatState={ready:false,keys:[],candidate:null},chatCount=0;\nconst fmt=n=>");
function replaceBetween(start,end,text){const a=js.indexOf(start),b=js.indexOf(end,a);if(a<0||b<0)throw Error('Cannot locate '+start);js=js.slice(0,a)+text+'\n'+js.slice(b);}
replaceBetween('function controls(){','function validWebhook()',`function controls(){
 const connected=!!stream;
 $('save-item-crop').disabled=!connected||!regions.items||busy;
 for(const id of ['select-total','select-items','select-balance','select-chat','select-sale','auto-detect'])$(id).disabled=!connected||watching||checking||busy;
 $('read').disabled=!connected||!regions.total||!regions.items||busy||watching;
 $('start').disabled=!connected||!regions.total||!regions.items||watching||busy||checking;
 $('connect').disabled=watching||checking||busy;$('interval').disabled=watching;$('stop').disabled=!watching;
 $('chat-alerts').disabled=watching||busy;
}`);
replaceBetween('async function send(','$(\'test\').onclick',`async function send(content,picture,filename='sold-items.png'){
 const url=validWebhook();
 const blob=picture?await new Promise((resolve,reject)=>picture.toBlob(b=>b?resolve(b):reject(Error('Screenshot failed.')),'image/png')):null;
 const payload=discordBody(content,blob,filename);
 const r=await fetch(url,{method:'POST',...payload,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error(r.status===429?'Discord rate limit reached. Wait before restarting.':\`Discord returned \${r.status}. Check your webhook and channel permissions.\`);
}`.replaceAll('\\`','`').replaceAll('\\${','${'));
js=js.replace('if(w&&h){preview.width=w;',"if(w&&h&&$('capture-details').open){preview.width=w;");
js=js.replace("ctx.strokeStyle=name==='balance'?'#7ba952':name==='total'?'#e8a53b':'#6aa8d1'","ctx.strokeStyle=name==='chat'?'#c58be5':name==='sale'?'#e58a81':name==='balance'?'#7ba952':name==='total'?'#e8a53b':'#6aa8d1'");
js=js.replace("name==='balance'?'MY MESOS':name==='total'?'TOTAL':'SOLD ITEMS'","name==='chat'?'SHOP CHAT':name==='sale'?'SALE SNAPSHOT':name==='balance'?'MY MESOS':name==='total'?'TOTAL':'SOLD ITEMS'");
replaceBetween("for(const name of ['total','items','balance'])","preview.onpointerdown",`function selectRegion(name){
 mode=name;$('capture-details').open=true;$('capture-details').parentElement.closest('details').open=true;
 $('capture-details').scrollIntoView({block:'center',behavior:'smooth'});
 const instructions={balance:'only the digits of your personal mesos balance.',total:'only the LEFT Total Sales number at the bottom of Sold Items.',items:'only the sold item names.',sale:'the Sold Items panel or item entry, including its icon and name. This area is sent with sale alerts.',chat:'the shop-chat message area, excluding the input box and game-world chat. Keep it scrolled to the bottom.'};
 status('Drag a rectangle over '+instructions[name]);
}
for(const name of ['total','items','balance','chat','sale'])$('select-'+name).onclick=()=>selectRegion(name);
`);
replaceBetween('preview.onpointerup=','preview.onpointercancel=',`preview.onpointerup=e=>{
 if(!drag)return;
 const p=point(e),r={x:Math.round(Math.min(drag.x,p.x)),y:Math.round(Math.min(drag.y,p.y)),w:Math.round(Math.abs(p.x-drag.x)),h:Math.round(Math.abs(p.y-drag.y))};
 if(r.w>=10&&r.h>=8){
  regions[mode]=r;$('capture-details').open=false;
  if(mode==='chat')$('chat-status').textContent='Chat area selected. New messages will be watched when you start; keep chat scrolled to the bottom.';
  status('Capture area saved. The preview is hidden.');
 }else status('That area is too small. Try dragging a larger rectangle.',true);
 drag=null;mode=null;controls();
};`);
js=js.replace("picture=crop('items');","picture=crop(regions.sale?'sale':'items');");
replaceBetween('async function tick(){',"$('start').onclick",`async function tick(){
 if(!watching||busy)return;busy=true;controls();
 try{
  const r=await reading();if(!watching)return;
  const result=observe(state,r);
  if(result.kind==='reset'){stop('The sales total decreased. Check the shop, then restart with a new baseline.');return;}
  state=result.state;
  if(result.kind==='unreadable')status('Sales total unclear. No sale alert sent; checking again next time.',true);
  else if(result.kind==='sale'){
   const names=result.names.length?result.names.join(', '):'Item text unclear — see the Sold Items snapshot';
   const entry={time:new Date().toISOString(),names,amount:result.amount,delivery:'Sending'};sales.unshift(entry);renderSales();
   try{
    await send('MapleStory Classic · sale detected\\nItems: '+names.slice(0,1000)+'\\nSales total increased by '+fmt(result.amount)+' mesos.\\n'+new Date().toLocaleString()+'\\nSeveral purchases may be grouped. See the attached Sold Items snapshot.',r.picture,'sold-items.png');
    entry.delivery='Sent to Discord';status('Sale snapshot sent. Still watching your store.');
   }catch(e){entry.delivery='Delivery failed — not retried';stop('Sale snapshot delivery failed. Check your webhook, then restart. '+e.message);$('status').classList.add('error');}
   renderSales();
  }else status(result.kind==='pending'?'Sales total changed. Waiting for a second reading…':result.kind==='baseline'?'Baseline set. Watching for new sales and messages.':'Last checked '+new Date().toLocaleTimeString()+'. No new sale detected.');
  if(watching&&$('chat-alerts').checked)await checkChat();
 }catch(e){stop('Monitoring paused: '+e.message);$('status').classList.add('error');}
 finally{busy=false;controls();if(watching)timer=setTimeout(tick,Number($('interval').value)*1000);}
}
async function checkChat(){
 if(!regions.chat)return;
 const picture=crop('chat'),image=crop('chat',4),w=await getWorker();
 await w.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
 const text=await w.recognize(prepare(image));if(!watching)return;
 const result=observeChat(chatState,{text:text.data.text,confidence:text.data.confidence});chatState=result.state;
 if(result.kind==='messages'){
  const lines=result.messages.map(m=>m.user+': '+m.text).join('\\n');
  $('chat-last').textContent=lines.slice(0,500);
  try{
   await send('New MapleStory shop message'+(result.messages.length>1?'s':'')+'\\n'+lines.slice(0,1600)+'\\n'+new Date().toLocaleString()+'\\nText read by OCR; see the attached shop-chat snapshot.',picture,'shop-chat.png');
   chatCount+=result.messages.length;$('chat-status').textContent=chatCount+' new message(s) sent with a chat snapshot.';
  }catch(e){$('chat-status').textContent='Chat snapshot delivery failed. No automatic retry.';stop('Discord chat delivery failed: '+e.message);$('status').classList.add('error');}
 }else $('chat-status').textContent=result.kind==='unreadable'?'Chat text is unclear. Keep the selected area visible.':result.kind==='pending'?'New chat text detected; confirming the reading…':result.kind==='reset'?'Chat history changed or scrolled. Baseline reset; keep chat at the bottom.':result.kind==='baseline'?'Chat baseline set. Existing messages will not trigger alerts.':'Watching shop chat · '+chatCount+' new message(s) sent.';
}
`);
js=js.replace("if(!regions.total||!regions.items)throw Error('Select both reading areas first.');state=", "if(!regions.total||!regions.items)throw Error('Select both reading areas first.');if($('chat-alerts').checked&&!regions.chat){selectRegion('chat');throw Error('Select the shop-chat area once before starting message alerts.');}chatState={ready:false,keys:[],candidate:null};$('capture-details').open=false;$('crop-details').open=false;state=");
js=js.replace('regions=found;',"regions={...found,...(regions.chat?{chat:regions.chat}:{})};");
js=js.replace("$('auto-detect').onclick=autoDetect;","$('auto-detect').onclick=autoDetect;\n$('chat-alerts').onchange=()=>{chatState={ready:false,keys:[],candidate:null};$('chat-status').textContent=$('chat-alerts').checked?(regions.chat?'Chat alerts ready. Start watching to establish a baseline.':'Select the shop-chat area once to enable message alerts.'):'Chat alerts are off.';controls();};");
fs.writeFileSync('dist/app.js',js);
