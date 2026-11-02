import {numericInkBounds} from './numeric-region.mjs';
import {detectStoreRegions,enhanceFramePixels,storeRegionsReady} from './auto-select.mjs?v=autoselect-4';
import {deliverDiscord} from './discord-delivery.mjs';
import {sourcePoint,validRegion} from './capture-geometry.mjs';
import {observeChat} from './chat.mjs?v=reader-4';
import {discordBody,saleEmbed} from './notifications.mjs?v=ms-4';
import {createSession,observeStore} from './store-session.mjs?v=ms-4';
import {chooseSoldReading,chatVisitors,parsePriceList,agreedNumber,STORE_FEE_RATE} from './sold-items.mjs?v=ms-4';
import {parseTotal,chooseItemReading} from './detection.mjs?v=reader-4';
import {tsvWords,locateRegions,frameScale,coinScorer} from './locate.mjs?v=autoselect-4';
import {reportObservations,configured as boardConfigured,matchNames,iconUrl} from './api.mjs?v=ms-2';
const $=id=>document.getElementById(id);
const video=$('video'),preview=$('preview'),ctx=preview.getContext('2d');
let stream=null,regions={},mode=null,drag=null,timer=null,watching=false,busy=false,worker=null,workerPromise=null,state=createSession(crypto.randomUUID()),sales=[],frame=null,checking=false;
let chatState={ready:false,keys:[],candidate:null},chatCount=0;
const fmt=n=>n.toLocaleString('en-US');
const debugBox=document.createElement('details');debugBox.className='privacy';debugBox.innerHTML='<summary>Local capture diagnostics</summary><p>Coordinates and OCR from your selected store regions stay on this page. Do not share diagnostics containing private chat.</p><pre id="capture-debug"></pre>';preview.parentElement.after(debugBox);
let lastAutoDetection={};
function debugCapture(data){$('capture-debug').textContent=JSON.stringify({source:{width:video.videoWidth,height:video.videoHeight},regions,...lastAutoDetection,...data},null,2);}
// Debug overlay: region coordinates and the latest OCR result per region, drawn over the preview.
let lastChat=null,lastReads={},debugOverlay=false;
{const t=document.createElement('label');t.className='check';t.innerHTML='<input type="checkbox" id="debug-overlay"> Show coordinates, OCR results and confidence on the preview';debugBox.querySelector('p').after(t);$('debug-overlay').onchange=e=>{debugOverlay=e.target.checked;};}
// Store name and listed prices stay in this browser. Listed prices let a sale be verified to the exact meso.
for(const id of ['store-name','listed-prices']){const key='mw-'+id;try{$(id).value=localStorage.getItem(key)||'';}catch{}$(id).addEventListener('change',()=>{try{localStorage.setItem(key,$(id).value.slice(0,20000));}catch{}});}
// Shop chat is read with every check when its area is known: buyers entering the shop corroborate a sale.
async function readChat(w){
 if(!regions.chat)return[];
 await w.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
 const read=await w.recognize(prepare(crop('chat',4)));
 lastChat={text:read.data.text,confidence:read.data.confidence,picture:crop('chat')};
 const visitors=read.data.confidence>=50?chatVisitors(read.data.text):[];
 lastReads.chat=visitors.length+' visitor(s) · '+Math.round(read.data.confidence)+'%';
 return visitors;
}
// Verified sales only: one entry per Sold Items record, never repeated for the same record in this session.
async function recordVerified(result,r){
 const occurrences=new Map();
 for(const sale of result.sales){
  const base=[state.id,sale.name,sale.buyer,sale.qty].join('|').toLowerCase(),n=(occurrences.get(base)||0)+1;occurrences.set(base,n);
  const saleKey=base+'|'+(sales.filter(e=>e.saleKey?.startsWith(base+'|')).length+n);
  if(notified.has(saleKey))continue;notified.add(saleKey);
  let item=null;try{const [m]=await matchNames([sale.name.replace(/\.{2,}$/,'')]);if(m?.item_id)item={id:m.item_id,game_id:m.game_id,category:m.category,icon_path:m.icon_path,name:m.name};}catch{}
  const entry={time:new Date().toISOString(),sessionId:state.id,initialBalance:state.initialBalance,kind:'verified',saleKey,names:item?.name||sale.name,qty:sale.qty,buyer:sale.buyer,unitPrice:sale.unitPrice,amount:sale.gross,net:sale.net,fee:sale.fee,method:result.method,icon:item?iconUrl(item):null,corroborated:true,evidence:result.reason,delivery:$('webhook').value.trim()?'Sending':'Recorded (Discord not connected)'};
  sales.unshift(entry);renderSales();
  if($('share-sales')?.checked&&boardConfigured()&&sale.qty>0&&!sale.unitPriceRange)reportObservations([{kind:'sale',item:entry.names,price:sale.unitPrice,qty:sale.qty}],{world:$('world')?.value||''}).then(n=>{if(n?.length){entry.shared='Shared to price board';renderSales();}}).catch(()=>{});
  if($('webhook').value.trim()){
   try{await sendEmbed(saleEmbed({...sale,name:entry.names,icon:entry.icon,store:$('store-name').value.trim(),time:entry.time}),r.picture);entry.delivery='Sent to Discord';}
   catch(e){entry.delivery='Discord delivery failed — not retried';status('Sale recorded, but Discord delivery failed: '+e.message,true);}
   renderSales();
  }
 }
 status('Verified sale recorded: '+result.sales.map(x=>x.name+' ×'+x.qty).join(', ')+'. Still watching your store.');
}
async function sendEmbed(embed,picture){const url=validWebhook();const blob=picture?await new Promise(res=>picture.toBlob(b=>res(b),'image/png')):null;await deliverDiscord(url,discordBody('',blob,'sold-items.png',[embed]));}
video.addEventListener('resize',()=>{if(!stream)return;stop('Capture resolution changed. Re-detecting regions; review them before restarting.');regions={};layoutSig=null;debugCapture({failure:'Source resolution changed'});if(!busy&&!checking)autoDetect();});
const baselineNote=document.createElement('p');baselineNote.className='hint';baselineNote.id='session-baseline';baselineNote.textContent='Session starting mesos: not set';$('balance-note').after(baselineNote);
const meso=(size=14)=>{const s=document.createElement('span');s.className='meso';s.style.setProperty('--m',size+'px');s.title='mesos';const i=document.createElement('img');i.src='meso.png?v=ms-2';i.alt='';i.width=i.height=size;i.decoding='async';s.append(i);return s;};
const mesoAmt=(text,size=14)=>{const s=document.createElement('span');s.className='meso-amt';s.append(meso(size),document.createTextNode(String(text)));return s;};
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function controls(){
 const connected=!!stream;
 $('save-item-crop').disabled=!connected||!regions.items||busy;
 for(const id of ['select-total','select-items','select-balance','select-chat','select-sale','auto-detect'])$(id).disabled=!connected||watching||checking||busy;
 $('read').disabled=!connected||!storeRegionsReady(regions)||busy||watching;
 $('start').disabled=!connected||!storeRegionsReady(regions)||watching||busy||checking;
 $('connect').disabled=watching||checking||busy;$('interval').disabled=watching;$('stop').disabled=!watching;
 $('chat-alerts').disabled=watching||busy;
}
function validWebhook(){const raw=$('webhook').value.trim();let url;try{url=new URL(raw);}catch{throw Error('Paste your Discord webhook URL first.');}if(url.protocol!=='https:'||url.hostname!=='discord.com'||!/^\/api\/webhooks\/\d+\/[\w-]+\/?$/.test(url.pathname))throw Error('Use a Discord channel webhook URL from discord.com.');url.search='';url.hash='';url.searchParams.set('wait','true');return url.href;}
async function send(content,picture,filename='sold-items.png'){
 const url=validWebhook();
 const blob=picture?await new Promise((resolve,reject)=>picture.toBlob(b=>b?resolve(b):reject(Error('Screenshot failed.')),'image/png')):null;
 const payload=discordBody(content,blob,filename);
 await deliverDiscord(url,payload);
}
$('test').onclick=async()=>{try{$('test').disabled=true;await send('Mesos-Watch test: your shop alerts will arrive here.');status('Test delivered to Discord. You’re connected.');$('discord-step').open=false;}catch(e){status(e.message,true);}finally{$('test').disabled=false;}};
function stop(message='Watching stopped. Restart to establish a fresh baseline.') {watching=false;clearTimeout(timer);timer=null;$('badge').classList.remove('live');$('badge').replaceChildren(Object.assign(document.createElement('span'),{className:'dot'}),document.createTextNode(' Not watching'));controls();status(message);}
$('stop').onclick=()=>stop();
$('connect').onclick=async()=>{try{if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Screen sharing isn’t available here. Open this page in desktop Chrome or Edge.');if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:2},audio:false});video.srcObject=stream;await video.play();regions={};mode=null;stream.getVideoTracks()[0].addEventListener('ended',()=>{stop('Game sharing ended. Reconnect your window to continue.');stream=null;video.srcObject=null;regions={};$('preview').hidden=true;$('capture-empty').hidden=false;controls();window.dispatchEvent(new Event('mesoswatch:capture-ended'));});$('preview').hidden=false;$('capture-empty').hidden=true;$('source-note').textContent='Window connected';window.dispatchEvent(new Event('mesoswatch:capture-started'));cancelAnimationFrame(frame);controls();draw();await autoDetect();}catch(e){status(e.name==='NotAllowedError'?'Window sharing was cancelled. You can try again.':e.message,true);controls();}};
function draw(){if(!stream)return;const w=video.videoWidth,h=video.videoHeight;if(w&&h&&document.body.dataset.view==='store'&&!document.hidden&&$('capture-details').open){preview.width=w;preview.height=h;ctx.drawImage(video,0,0);for(const [name,r]of Object.entries(regions)){if(typeof r!=='object'||!Number.isFinite(r?.x))continue;ctx.strokeStyle=name==='chat'?'#c58be5':name==='sale'?'#e58a81':name==='balance'?'#7ba952':name==='total'?'#e8a53b':'#6aa8d1';ctx.lineWidth=Math.max(2,w/400);ctx.strokeRect(r.x,r.y,r.w,r.h);ctx.fillStyle=ctx.strokeStyle;ctx.font=`${Math.max(12,w/100)}px sans-serif`;if(typeof r!=='object'||!Number.isFinite(r?.x))continue;ctx.fillText((name==='chat'?'SHOP CHAT':name==='sale'?'SALE SNAPSHOT':name==='balance'?'MY MESOS':name==='total'?'TOTAL':'SOLD ITEMS')+(debugOverlay?` ${r.x},${r.y} ${r.w}×${r.h}`+(lastReads[name]?' · '+lastReads[name]:''):''),r.x+4,Math.max(15,r.y-5));}if(drag){ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.strokeRect(drag.x,drag.y,drag.endX-drag.x,drag.endY-drag.y);}}frame=requestAnimationFrame(draw);}
function point(e){const b=preview.getBoundingClientRect();return sourcePoint({x:e.clientX,y:e.clientY},{x:b.left,y:b.top,width:b.width,height:b.height},{width:preview.width,height:preview.height});}
function selectRegion(name){
 mode=name;$('capture-details').open=true;$('capture-details').parentElement.closest('details').open=true;
 $('capture-details').scrollIntoView({block:'center',behavior:'smooth'});
 const instructions={balance:'only the digits of your personal mesos balance.',total:'only the LEFT Total Sales number at the bottom of Sold Items.',items:'only the sold item names.',sale:'the Sold Items panel or item entry, including its icon and name. This area is sent with sale alerts.',chat:'the shop-chat message area, excluding the input box and game-world chat. Keep it scrolled to the bottom.'};
 status('Drag a rectangle over '+instructions[name]);
}
for(const name of ['total','items','balance','chat','sale'])$('select-'+name).onclick=()=>selectRegion(name);

preview.onpointerdown=e=>{if(!mode||watching||checking)return;preview.setPointerCapture(e.pointerId);const p=point(e);drag={...p,endX:p.x,endY:p.y};};
preview.onpointermove=e=>{if(drag){const p=point(e);drag.endX=p.x;drag.endY=p.y;}};
preview.onpointerup=e=>{
 if(!drag)return;
 const p=point(e),r={x:Math.round(Math.min(drag.x,p.x)),y:Math.round(Math.min(drag.y,p.y)),w:Math.round(Math.abs(p.x-drag.x)),h:Math.round(Math.abs(p.y-drag.y))};
 if(r.w>=10&&r.h>=8){
  regions[mode]=r;$('capture-details').open=false;
  if(mode==='chat')$('chat-status').textContent='Chat area selected. New messages will be watched when you start; keep chat scrolled to the bottom.';
  status('Capture area saved. The preview is hidden.');
 }else status('That area is too small. Try dragging a larger rectangle.',true);
 drag=null;mode=null;controls();
};
preview.onpointercancel=()=>{drag=null;};
function crop(name,scale=1){const r=regions[name];if(!validRegion(r,video.videoWidth,video.videoHeight))throw Error('Capture area moved outside the source. Run Auto Select again.');if(!r||!stream||!video.videoWidth)throw Error('Reconnect and select both reading areas.');const c=document.createElement('canvas');c.width=r.w*scale;c.height=r.h*scale;const g=c.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(video,r.x,r.y,r.w,r.h,0,0,c.width,c.height);return c;}
function prepare(image,threshold=false){const c=document.createElement('canvas');c.width=image.width+40;c.height=image.height+40;const g=c.getContext('2d',{willReadFrequently:true});g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(image,20,20);const data=g.getImageData(20,20,image.width,image.height);for(let p=0;p<data.data.length;p+=4){let v=.299*data.data[p]+.587*data.data[p+1]+.114*data.data[p+2];v=threshold?(v<165?0:255):Math.max(0,Math.min(255,(v-128)*1.4+128));data.data[p]=data.data[p+1]=data.data[p+2]=v;}g.putImageData(data,20,20);return c;}
function showCrop(id,image){const canvas=$(id);canvas.hidden=false;canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);}
async function getWorker(){if(worker)return worker;if(!workerPromise){workerPromise=(async()=>{status('Loading the OCR engine for the first reading…');if(!window.Tesseract){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';s.onload=resolve;s.onerror=()=>{s.remove();reject(Error('Could not load OCR. Check your connection and retry.'));};document.head.append(s);});}worker=await window.Tesseract.createWorker('eng',1,{logger:()=>{}});await worker.setParameters({tessedit_pageseg_mode:'6'});return worker;})();}try{return await workerPromise;}catch(e){workerPromise=null;throw e;}}
async function reading(){
 const itemsImage=crop('items',4),picture=crop('items');
 showCrop('items-crop',crop('items',2));
 const w=await getWorker();let t={data:{text:'',confidence:0}},t2=t,a=null,b=null,total=null;
 if(regions.total){const totalImage=crop('total',4);showCrop('total-crop',crop('total',2));await w.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789, .'});t=await w.recognize(prepare(totalImage));t2=await w.recognize(prepare(totalImage,true));a=parseTotal(t.data.text);b=parseTotal(t2.data.text);total=a!==null&&a===b?a:null;}
 await w.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
 const i=await w.recognize(prepare(itemsImage)),i2=await w.recognize(prepare(itemsImage,true));
 const balance=await readBalance(w),visitors=await readChat(w);
 if(regions.mode==='sold-items'){
  const sold=chooseSoldReading(i.data,i2.data);lastReads.items=sold.records.length+' records · '+Math.round(sold.confidence)+'%';
  $('total-reading').textContent='Not shown in this layout';
  $('items-reading').textContent=sold.display||'No Sold Items records found';
  $('items-reading').classList.toggle('uncertain',!sold.complete);
  $('item-quality').textContent=sold.complete?'Both readings agree on every record.':'Records the two readings disagree on are shown, but they cannot verify a sale.';
  $('item-quality').classList.toggle('uncertain',!sold.complete);
  $('raw-ocr').textContent='Sold Items pass 1:\n'+i.data.text.trim()+'\n\nSold Items pass 2:\n'+i2.data.text.trim()+(lastChat?'\n\nShop chat:\n'+lastChat.text.trim():'');
  $('ocr-quality').textContent='Sold Items confidence: '+Math.round(sold.confidence)+'% · '+(regions.chat?visitors.length+' visitor name(s) in chat':'shop chat not selected');
  debugCapture({balance,records:sold.records,visitors,confidence:sold.confidence});
  return{mode:'sold-items',balance,records:sold.records,confidence:sold.confidence,visitors,prices:parsePriceList($('listed-prices').value),feeRate:STORE_FEE_RATE,picture,raw:i.data.text+'\n'+i2.data.text};
 }
 const chosen=chooseItemReading(i.data,i2.data);
 $('total-reading').textContent=regions.mode==='sold-items'?'Not shown in this layout':total===null?'Reselect total':fmt(total)+' mesos';
 $('items-reading').textContent=chosen.display||'No item names found — select the names only';
 $('items-reading').classList.toggle('uncertain',!chosen.itemReliable);
 $('item-quality').textContent=chosen.itemReliable?'Both readings agree. Compare the spelling with the item crop.':'Uncertain item text — this spelling will not be sent as a sale item. Compare the crop or save it for troubleshooting.';
 $('item-quality').classList.toggle('uncertain',!chosen.itemReliable);
 $('raw-ocr').textContent='Total pass 1: '+t.data.text.trim()+'\nTotal pass 2: '+t2.data.text.trim()+'\n\nItem pass 1:\n'+i.data.text.trim()+'\n\nItem pass 2:\n'+i2.data.text.trim();
 const confidence=regions.mode==='sold-items'?chosen.confidence:Math.min(t.data.confidence,t2.data.confidence);
 $('ocr-quality').textContent=(regions.mode==='sold-items'?'No cumulative sales total · item confidence: '+Math.round(confidence)+'% · ':'Total confidence: '+Math.round(Math.min(t.data.confidence,t2.data.confidence))+'% · ')+ 'Item text: '+Math.round(chosen.confidence)+'%'+(a!==b?' · Total readings disagree':'');
 debugCapture({total,balance,confidence:Math.min(t.data.confidence,t2.data.confidence),selectedItemOCR:[i.data.text,i2.data.text]});
 return{mode:regions.mode||'total',total,balance,rawFirst:i.data.text,rawSecond:i2.data.text,raw:i.data.text+'\n'+i2.data.text,items:chosen.items,itemReliable:chosen.itemReliable,confidence,picture};
}
$('read').onclick=async()=>{if(busy)return;busy=true;checking=true;controls();try{const r=await reading();const bad=r.balance===null||r.confidence<65||(r.mode!=='sold-items'&&r.total===null);status(bad?'A selected region is unreadable. Check the crops and retry.':r.mode==='sold-items'?'Sold Items and balance read. This layout has no sales total; changes will remain unverified.':'Reading complete. Compare the total and item text with your game before starting.',bad);}catch(e){status(e.message,true);}finally{busy=false;checking=false;controls();}};
async function tick(){
 if(!watching)return;if(busy){timer=setTimeout(tick,1500);return;}if(redetect){redetect=false;await autoDetect(true);if(!watching)return;}busy=true;controls();
 try{
  const r=await reading();if(!watching)return;
  const result=observeStore(state,r);unreadable=result.kind==='unreadable'?unreadable+1:0;{const sig=regionSig();if(unreadable>=2||sigDiff(layoutSig,sig)>40){redetect=true;unreadable=0;}layoutSig=sig;}
  if(result.kind==='reset'){stop('The sales total decreased. Check the shop, then restart with a new baseline.');return;}
  state=result.state;
  baselineNote.textContent=state.initialBalance===null?'Session starting mesos: not set':'Session starting mesos: '+fmt(state.initialBalance)+' · current change: '+(r.balance===null?'unreadable':fmt(r.balance-state.initialBalance))+' mesos';
  if(result.kind==='unreadable')status('Sales total unclear. No sale alert sent; checking again next time.',true);
  else if(result.kind==='uncertain'||result.kind==='balance-change'){
   const names=result.kind==='balance-change'?'Mesos changed with no new Sold Items record':(result.records||[]).map(x=>x.name+' ×'+x.qty).join(', ')||'Sold Items changed';
   sales.unshift({time:new Date().toISOString(),sessionId:state.id,initialBalance:state.initialBalance,kind:result.kind,names,amount:null,balanceChange:result.balanceChange,corroborated:false,evidence:result.reason,delivery:result.kind==='balance-change'?'Not a sale · kept for your balance timeline':'Uncertain · no Discord alert or market contribution'});
   renderSales();status(result.reason);
  }
  else if(result.kind==='sale'&&result.sales)await recordVerified(result,r);
  else if(result.kind==='unverified'){
   sales.unshift({time:new Date().toISOString(),sessionId:state.id,initialBalance:state.initialBalance,kind:'unverified',names:result.names.length?result.names.join(', '):'Sold Items changed',amount:null,balanceChange:result.balanceChange,corroborated:false,evidence:result.reason,delivery:'Unverified change · no sale notification or market contribution'});renderSales();status(result.reason);
  }
  else if(result.kind==='sale'){
   const names=result.names.length?result.names.join(', '):'Item text unclear — see the Sold Items snapshot';
   const saleKey=state.id+':'+String(state.total);
   if(notified.has(saleKey)){status('That sale was already recorded. Still watching your store.');return;}
   notified.add(saleKey);
   const entry={time:new Date().toISOString(),sessionId:state.id,initialBalance:state.initialBalance,names,amount:result.amount,evidence:result.reason,corroborated:result.corroborated,delivery:$('webhook').value.trim()?'Sending':'Recorded (Discord not connected)'};sales.unshift(entry);renderSales();
   if(result.corroborated)shareSale(result,r).then(t=>{if(t){entry.shared=t;renderSales();}});
   if(!result.corroborated){entry.delivery='Unverified · no Discord sale alert or market contribution';status(result.reason,true);renderSales();if(watching&&$('chat-alerts').checked&&$('webhook').value.trim())await checkChat();return;}
   if($('webhook').value.trim())try{
    await send('MapleStory Classic · sale evidence corroborated\nItems: '+names.slice(0,1000)+'\nSales total increased by '+fmt(result.amount)+' mesos.\n'+new Date().toLocaleString()+'\nSeveral purchases may be grouped. See the attached Sold Items snapshot.',r.picture,'sold-items.png');
    entry.delivery='Sent to Discord';status('Sale snapshot sent. Still watching your store.');
   }catch(e){entry.delivery='Delivery failed — not retried';stop('Sale snapshot delivery failed. Check your webhook, then restart. '+e.message);$('status').classList.add('error');}
   else status('Sale recorded. Connect Discord under Discord Integration to get notified.');
   renderSales();
  }else status(result.kind==='pending'?(r.mode==='sold-items'?'Sold Items changed. Confirming a second reading…':'Sales total changed. Waiting for a second reading…'):result.kind==='baseline'?'Baseline set. Watching for new sales and messages.':'Last checked '+new Date().toLocaleTimeString()+'. No new sale detected.');
  if(watching&&$('chat-alerts').checked&&$('webhook').value.trim())await checkChat();
 }catch(e){stop('Monitoring paused: '+e.message);$('status').classList.add('error');}
 finally{busy=false;controls();if(watching)timer=setTimeout(tick,Number($('interval').value)*1000);}
}
async function checkChat(){
 if(!regions.chat)return;
 let picture,text;
 if(lastChat){picture=lastChat.picture;text={data:lastChat};lastChat=null;}
 else{picture=crop('chat');const w=await getWorker();await w.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});text=await w.recognize(prepare(crop('chat',4)));}
 if(!watching)return;
 const result=observeChat(chatState,{text:text.data.text,confidence:text.data.confidence});chatState=result.state;
 if(result.kind==='messages'){
  const lines=result.messages.map(m=>m.user+': '+m.text).join('\n');
  $('chat-last').textContent=lines.slice(0,500);
  try{
   await send('New MapleStory shop message'+(result.messages.length>1?'s':'')+'\n'+lines.slice(0,1600)+'\n'+new Date().toLocaleString()+'\nText read by OCR; see the attached shop-chat snapshot.',picture,'shop-chat.png');
   chatCount+=result.messages.length;$('chat-status').textContent=chatCount+' new message(s) sent with a chat snapshot.';
  }catch(e){$('chat-status').textContent='Chat snapshot delivery failed. No automatic retry.';stop('Discord chat delivery failed: '+e.message);$('status').classList.add('error');}
 }else $('chat-status').textContent=result.kind==='unreadable'?'Chat text is unclear. Keep the selected area visible.':result.kind==='pending'?'New chat text detected; confirming the reading…':result.kind==='reset'?'Chat history changed or scrolled. Baseline reset; keep chat at the bottom.':result.kind==='baseline'?'Chat baseline set. Existing messages will not trigger alerts.':'Watching shop chat · '+chatCount+' new message(s) sent.';
}

$('start').onclick=async()=>{try{if($('webhook').value.trim())validWebhook();if(!storeRegionsReady(regions))throw Error('Keep Sold Items and personal mesos visible, then run Auto Select. Select Total Sales too only if this layout shows it.');if($('chat-alerts').checked&&$('webhook').value.trim()&&!regions.chat){selectRegion('chat');throw Error('Select the shop-chat area once before starting message alerts.');}chatState={ready:false,keys:[],candidate:null};$('capture-details').open=false;$('crop-details').open=false;state=createSession(crypto.randomUUID());baselineNote.textContent='Session starting mesos: waiting for a reliable reading';watching=true;mode=null;drag=null;$('badge').classList.add('live');$('badge').replaceChildren(Object.assign(document.createElement('span'),{className:'dot'}),document.createTextNode(' Watching'));controls();await tick();}catch(e){stop(e.message);$('status').classList.add('error');}};
const isChange=e=>['unverified','uncertain','balance-change'].includes(e.kind);
function row(entry,example=false){const r=document.createElement('div');r.className='sale-row'+(entry.kind==='verified'?' verified':isChange(entry)?' uncertain':'');const time=document.createElement('time');time.textContent=new Date(entry.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});const text=document.createElement('div'),name=document.createElement('strong'),note=document.createElement('small');if(entry.icon){const img=Object.assign(document.createElement('img'),{src:entry.icon,alt:'',width:28,height:28,loading:'lazy',className:'item-icon',onerror(){this.remove();}});name.append(img);}name.append(document.createTextNode(entry.names+(entry.qty>1?' ×'+entry.qty:'')));note.textContent=example?'Example only · no Discord message sent':entry.kind==='verified'?'Verified · '+(entry.buyer?'buyer '+entry.buyer+' · ':'')+(entry.unitPrice?fmt(entry.unitPrice)+' each · ':'')+'received '+fmt(entry.net)+' after fee · '+entry.delivery:entry.delivery+(entry.evidence&&isChange(entry)?' · '+entry.evidence:'')+' · OCR reading';text.append(name,note);const amount=document.createElement('div');amount.className='amount';amount.replaceChildren(mesoAmt(isChange(entry)?(entry.balanceChange>=0?'+':'')+fmt(entry.balanceChange)+' mesos balance change':'+'+fmt(entry.amount)+' mesos',13));r.append(time,text,amount);return r;}
function renderSales(){try{localStorage.setItem('mw-sales',JSON.stringify(sales.slice(0,500)));}catch{}$('activity-empty').hidden=sales.length>0;$('sales').replaceChildren(...sales.map(s=>row(s)));$('sale-count').textContent=String(sales.filter(s=>s.corroborated===true).length);$('meso-count').replaceChildren(mesoAmt(fmt(sales.filter(s=>s.corroborated===true).reduce((a,s)=>a+s.amount,0)),13),document.createTextNode(' '),Object.assign(document.createElement('small'),{textContent:'mesos'}));$('export').disabled=!sales.length;}
$('demo').onclick=()=>{if(sales.length)return;$('sales').replaceChildren(row({time:new Date().toISOString(),names:'Example: Steelies',amount:2500000},true));$('demo').textContent='Example shown below';};
$('export').onclick=()=>{const safe=s=>{let v=String(s);if(/^[=+@\-\t\r]/.test(v))v="'"+v;return'"'+v.replaceAll('"','""')+'"';};const csv='Time,Items,Total increase (mesos),Delivery\r\n'+sales.map(s=>[s.time,s.names,s.kind==='unverified'?'':s.amount,s.delivery].map(safe).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='mesoswatch-sales.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function safeLink(value){try{const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch{return null;}}
const config=window.MESOSWATCH_CONFIG||{};const donation=safeLink(config.donationUrl);if(donation){$('donate').href=donation;$('donate').target='_blank';$('donate').rel='noopener noreferrer';$('donate').removeAttribute('aria-disabled');$('donate').classList.remove('disabled');$('donate').textContent=config.donationLabel||'Support Mesos-Watch ↗';$('donation-note').textContent='Thank you for supporting the project.';}
const sponsor=config.sponsor||{},link=safeLink(sponsor.url);if(link&&sponsor.title){const a=document.createElement('a');a.href=link;a.target='_blank';a.rel='sponsored noopener noreferrer';const image=safeLink(sponsor.imageUrl);if(image){const img=document.createElement('img');img.src=image;img.alt=sponsor.title;img.loading='lazy';a.append(img);}else a.textContent=sponsor.title;$('ad-content').replaceChildren(a);}
window.addEventListener('beforeunload',e=>{if(watching){e.preventDefault();e.returnValue='';}});
window.addEventListener('pagehide',()=>{clearTimeout(timer);cancelAnimationFrame(frame);stream?.getTracks().forEach(t=>t.stop());worker?.terminate();});
async function readBalance(w){
 if(!regions.balance)return null;
 showCrop('balance-crop',crop('balance',2));
 await w.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789, .'});
 let source=crop('balance',4);const ink=numericInkBounds(source.getContext('2d',{willReadFrequently:true}).getImageData(0,0,source.width,source.height),4);if(ink){const tight=document.createElement('canvas');tight.width=ink.w;tight.height=ink.h;tight.getContext('2d').drawImage(source,ink.x,ink.y,ink.w,ink.h,0,0,ink.w,ink.h);source=tight;}const a=await w.recognize(prepare(source)),b=await w.recognize(prepare(source,true));
 const first=agreedNumber(a.data,b.data,parseTotal),reliable=first!==null;
 lastReads.balance=(reliable?fmt(first):'unclear')+' · '+Math.round(Math.min(a.data.confidence,b.data.confidence))+'%';
 $('balance-reading').replaceChildren(reliable?mesoAmt(fmt(first),15):document.createTextNode('Unclear'));
 $('balance-note').textContent=reliable?'Personal mesos · checked '+new Date().toLocaleTimeString():'Balance unreadable. Keep inventory visible or reselect the digits.';
 return reliable?first:null;
}
async function autoDetect(background=false){
 if(!stream||busy||(watching&&!background))return;
 busy=true;checking=true;mode=null;drag=null;controls();
 try{
  status('Looking for Sold Items, sales totals, and your mesos balance…');
  const captureStream=stream,sourceWidth=video.videoWidth,sourceHeight=video.videoHeight;
  if(!sourceWidth||!sourceHeight||video.readyState<2)throw Error('The shared video has not produced a frame yet. Wait for the preview, then retry Auto Select.');
  const scale=frameScale(sourceWidth),c=document.createElement('canvas');
  c.width=Math.round(video.videoWidth*scale);c.height=Math.round(video.videoHeight*scale);
  const g=c.getContext('2d',{willReadFrequently:true});g.imageSmoothingEnabled=false;g.drawImage(video,0,0,c.width,c.height);
  const w=await getWorker(),pixels=g.getImageData(0,0,c.width,c.height),coinScore=coinScorer(pixels,scale);
  const detection=await detectStoreRegions({width:c.width,height:c.height,scale,sourceWidth,sourceHeight,coinScore,
   isCurrent:()=>stream===captureStream&&video.videoWidth===sourceWidth&&video.videoHeight===sourceHeight,
   onProgress:({attempt,pass})=>status('Finding store regions · OCR pass '+attempt+'/3 ('+pass+')…'),
   recognize:async pass=>{let image=c;if(pass.name!=='original'){image=document.createElement('canvas');image.width=c.width;image.height=c.height;const imageContext=image.getContext('2d'),enhanced=imageContext.createImageData(c.width,c.height);enhanced.data.set(enhanceFramePixels(pixels.data,pass.name==='threshold'));imageContext.putImageData(enhanced,0,0);}await w.setParameters({tessedit_pageseg_mode:pass.mode,tessedit_char_whitelist:''});return w.recognize(image,{},{text:true,tsv:true});}
  });
  lastAutoDetection={attempts:detection.attempts,missing:detection.missing};
  const found=detection.regions;debugCapture({detected:found,confidence:detection.confidence});
  if(detection.cancelled){status('Capture changed while detecting. Run Auto Select again on the current frame.',true);return;}
  if(!stream)return;
  if(background&&!storeRegionsReady(found)){stop('Could not relocate all store evidence areas. Review Auto Select before restarting.');return;}
  if(background&&!found.chat&&regions.chat&&regions.sale&&found.sale&&['x','y','w','h'].some(k=>Math.abs(regions.sale[k]-found.sale[k])>5)){stop('Store layout moved. Reselect shop chat before restarting to avoid sending the wrong area.');return;}
  regions={...found,...(!found.chat&&regions.chat?{chat:regions.chat}:{})};layoutSig=regionSig();
  if(background){status(storeRegionsReady(found)?'Your windows moved. Areas re-detected automatically; still watching.':'Your windows moved and the Sales total could not be found again. Keep Sold Items visible or select it manually.',!found.total);return;}
  if(storeRegionsReady(regions))await reading();else if(regions.balance)await readBalance(w);
  const missing=[];if(!found.items||(found.mode!=='sold-items'&&!found.total))missing.push('Sold Items / Total Sales');if(!found.balance)missing.push('personal mesos');
  status(missing.length?'Auto-detection could not confidently locate '+missing.join(' and ')+' after alternate OCR passes. Keep both panels unobstructed and try Auto Select again; missing regions remain unselected.':found.mode==='sold-items'?'Found Sold Items and your personal mesos'+(found.chat?' and shop chat':'')+'. No Total Sales is shown in this layout; balance and item changes remain unverified.':'Found Sold Items, Total Sales, and your personal mesos. Check the highlighted areas before starting.'+(found.totalEstimated?' The Total Sales number was hard to read, so its area is an estimate: make sure the highlight covers the number.':''),missing.length>0);
 }catch(e){debugCapture({failure:e.message});status('Auto-detection unavailable: '+e.message+' You can select the areas manually.',true);}
 finally{busy=false;checking=false;controls();}
}
$('auto-detect').onclick=()=>autoDetect();
$('chat-alerts').onchange=()=>{chatState={ready:false,keys:[],candidate:null};$('chat-status').textContent=$('chat-alerts').checked?(regions.chat?'Chat alerts ready. Start watching to establish a baseline.':'Select the shop-chat area once to enable message alerts.'):'Chat alerts are off.';controls();};
controls();

$('save-item-crop').onclick=()=>{try{crop('items').toBlob(blob=>{if(!blob){status('Could not save the item crop.',true);return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mesos-watch-item-crop.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');}catch(e){status(e.message,true);}};

// Layout signature: a 12x12 grayscale thumbnail of the store area. A big change means the window moved or closed.
let layoutSig=null,redetect=false,unreadable=0;
function regionSig(){const r=regions.sale||regions.total;if(!r||!video.videoWidth)return null;const c=document.createElement('canvas');c.width=c.height=12;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(video,r.x,r.y,r.w,r.h,0,0,12,12);const d=g.getImageData(0,0,12,12).data,out=new Uint8Array(144);for(let i=0;i<144;i++)out[i]=(d[i*4]*.299+d[i*4+1]*.587+d[i*4+2]*.114)|0;return out;}
function sigDiff(a,b){if(!a||!b)return 0;let t=0;for(let i=0;i<a.length;i++)t+=Math.abs(a[i]-b[i]);return t/a.length;}

// Shared capture for the Live FM Scanner: one window share and one OCR engine, taken in turns.
window.mesosCapture={video,get stream(){return stream;},connect:()=>$('connect').onclick(),
 async withOCR(fn){const t0=Date.now();while(busy||checking){if(Date.now()-t0>30000)throw Error('The OCR engine is busy with your store. Try again shortly.');await new Promise(r=>setTimeout(r,250));}busy=true;controls();try{return await fn(await getWorker());}finally{busy=false;controls();}}};
window.dispatchEvent(new Event('mesoswatch:capture-ready'));

// Personal sales history survives reloads (this browser only).
const notified=new Set();
try{const saved=JSON.parse(localStorage.getItem('mw-sales')||'[]');if(Array.isArray(saved)){sales=saved.filter(e=>e&&typeof e.time==='string'&&(Number.isFinite(e.amount)||(isChange(e)&&Number.isFinite(e.balanceChange)))).slice(0,500);renderSales();}}catch{}
window.addEventListener('mesoswatch:clear-sales',()=>{sales=[];renderSales();});

// A confirmed sale goes to the price board only when the evidence is unambiguous: one item name read reliably and the
// "Number purchased" visible, so the per-item price is the sales-total increase divided by that count.
async function shareSale(result,r){
 if(!result.corroborated||!$('share-sales')?.checked||!boardConfigured())return'';
 // "Number" is often misread ("Murnber", "Humber"); "purchased: N" is the reliable part.
 const counts=[...String(r.raw||'').matchAll(/purchased\s*[:;]?\s*(\d{1,4})\b/gi)].map(m=>+m[1]);
 if(result.names.length!==1||!r.itemReliable||!counts.length||new Set(counts).size!==1)return'';
 const qty=result.quantity,price=result.amount/qty;
 if(!Number.isSafeInteger(price)||price<=0)return'';
 try{const n=await reportObservations([{kind:'sale',item:result.names[0],price,qty}],{world:$('world')?.value||''});return n&&n.length?'Shared to price board':'';}catch(e){return'Not shared: '+e.message;}
}
