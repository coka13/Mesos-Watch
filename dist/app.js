import {parseTotal,observe,chooseItemReading} from './detection.mjs?v=reader-3';
import {tsvWords,locateRegions} from './locate.mjs?v=reader-3';
const $=id=>document.getElementById(id);
const video=$('video'),preview=$('preview'),ctx=preview.getContext('2d');
let stream=null,regions={},mode=null,drag=null,timer=null,watching=false,busy=false,worker=null,workerPromise=null,state={total:null,items:'',candidate:null},sales=[],frame=null,checking=false;
const fmt=n=>n.toLocaleString('en-US');
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function controls(){const connected=!!stream;$('save-item-crop').disabled=!connected||!regions.items||busy;for(const id of ['select-total','select-items','select-balance','auto-detect'])$(id).disabled=!connected||watching||checking||busy;$('read').disabled=!connected||!regions.total||!regions.items||busy||watching;$('start').disabled=!connected||!regions.total||!regions.items||watching||busy||checking;$('connect').disabled=watching||checking||busy;$('interval').disabled=watching;$('stop').disabled=!watching;}
function validWebhook(){const raw=$('webhook').value.trim();let url;try{url=new URL(raw);}catch{throw Error('Paste your Discord webhook URL first.');}if(url.protocol!=='https:'||url.hostname!=='discord.com'||!/^\/api\/webhooks\/\d+\/[\w-]+\/?$/.test(url.pathname))throw Error('Use a Discord channel webhook URL from discord.com.');url.search='';url.hash='';url.searchParams.set('wait','true');return url.href;}
async function send(content,picture){const url=validWebhook();let body,headers;const payload={username:'MESOS - WATCH',content,allowed_mentions:{parse:[]}};if(picture){body=new FormData();body.append('payload_json',JSON.stringify(payload));body.append('files[0]',await new Promise((resolve,reject)=>picture.toBlob(b=>b?resolve(b):reject(Error('Screenshot failed.')),'image/png')),'sold-items.png');}else{body=JSON.stringify(payload);headers={'Content-Type':'application/json'};}const r=await fetch(url,{method:'POST',headers,body,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(r.status===429?'Discord rate limit reached. Wait before restarting.':`Discord returned ${r.status}. Check your webhook and channel permissions.`);}
$('test').onclick=async()=>{try{$('test').disabled=true;await send('MESOS - WATCH test: your shop alerts will arrive here.');status('Test delivered to Discord. You’re connected.');$('discord-step').open=false;}catch(e){status(e.message,true);}finally{$('test').disabled=false;}};
function stop(message='Watching stopped. Restart to establish a fresh baseline.') {watching=false;clearTimeout(timer);timer=null;$('badge').classList.remove('live');$('badge').replaceChildren(Object.assign(document.createElement('span'),{className:'dot'}),document.createTextNode(' Not watching'));controls();status(message);}
$('stop').onclick=()=>stop();
$('connect').onclick=async()=>{try{if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Screen sharing isn’t available here. Open this page in desktop Chrome or Edge.');if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:2},audio:false});video.srcObject=stream;await video.play();regions={};mode=null;stream.getVideoTracks()[0].addEventListener('ended',()=>{stop('Game sharing ended. Reconnect your window to continue.');stream=null;video.srcObject=null;regions={};$('preview').hidden=true;$('capture-empty').hidden=false;controls();});$('preview').hidden=false;$('capture-empty').hidden=true;$('source-note').textContent='Window connected';cancelAnimationFrame(frame);controls();draw();await autoDetect();}catch(e){status(e.name==='NotAllowedError'?'Window sharing was cancelled. You can try again.':e.message,true);controls();}};
function draw(){if(!stream)return;const w=video.videoWidth,h=video.videoHeight;if(w&&h){preview.width=w;preview.height=h;ctx.drawImage(video,0,0);for(const [name,r]of Object.entries(regions)){ctx.strokeStyle=name==='balance'?'#7ba952':name==='total'?'#e8a53b':'#6aa8d1';ctx.lineWidth=Math.max(2,w/400);ctx.strokeRect(r.x,r.y,r.w,r.h);ctx.fillStyle=ctx.strokeStyle;ctx.font=`${Math.max(12,w/100)}px sans-serif`;ctx.fillText(name==='balance'?'MY MESOS':name==='total'?'TOTAL':'SOLD ITEMS',r.x+4,Math.max(15,r.y-5));}if(drag){ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.strokeRect(drag.x,drag.y,drag.endX-drag.x,drag.endY-drag.y);}}frame=requestAnimationFrame(draw);}
function point(e){const b=preview.getBoundingClientRect();return{x:Math.max(0,Math.min(preview.width,(e.clientX-b.left)*preview.width/b.width)),y:Math.max(0,Math.min(preview.height,(e.clientY-b.top)*preview.height/b.height))};}
for(const name of ['total','items','balance'])$('select-'+name).onclick=()=>{mode=name;status('Drag a rectangle over '+(name==='balance'?'only the digits of your personal mesos balance in your inventory.':name==='total'?'only the LEFT Total Sales number at the bottom of Sold Items. Exclude the mesos balance in your inventory and the Total Received column.':'only the sold item names. Exclude Buyer, Number purchased, and the bottom totals.'));};
preview.onpointerdown=e=>{if(!mode||watching||checking)return;preview.setPointerCapture(e.pointerId);const p=point(e);drag={...p,endX:p.x,endY:p.y};};
preview.onpointermove=e=>{if(drag){const p=point(e);drag.endX=p.x;drag.endY=p.y;}};
preview.onpointerup=e=>{if(!drag)return;const p=point(e),r={x:Math.round(Math.min(drag.x,p.x)),y:Math.round(Math.min(drag.y,p.y)),w:Math.round(Math.abs(p.x-drag.x)),h:Math.round(Math.abs(p.y-drag.y))};if(r.w>=10&&r.h>=8){regions[mode]=r;status((mode==='balance'?'Personal mesos balance':mode==='total'?'Sales total':'Sold Items')+' area selected. '+(regions.total&&regions.items?'Check the reading before starting.':'Select the other area next.'));}else status('That area is too small. Try dragging a larger rectangle.',true);drag=null;mode=null;controls();};
preview.onpointercancel=()=>{drag=null;};
function crop(name,scale=1){const r=regions[name];if(!r||!stream||!video.videoWidth)throw Error('Reconnect and select both reading areas.');const c=document.createElement('canvas');c.width=r.w*scale;c.height=r.h*scale;const g=c.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(video,r.x,r.y,r.w,r.h,0,0,c.width,c.height);return c;}
function prepare(image,threshold=false){const c=document.createElement('canvas');c.width=image.width+40;c.height=image.height+40;const g=c.getContext('2d',{willReadFrequently:true});g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(image,20,20);const data=g.getImageData(20,20,image.width,image.height);for(let p=0;p<data.data.length;p+=4){let v=.299*data.data[p]+.587*data.data[p+1]+.114*data.data[p+2];v=threshold?(v<165?0:255):Math.max(0,Math.min(255,(v-128)*1.4+128));data.data[p]=data.data[p+1]=data.data[p+2]=v;}g.putImageData(data,20,20);return c;}
function showCrop(id,image){const canvas=$(id);canvas.hidden=false;canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);}
async function getWorker(){if(worker)return worker;if(!workerPromise){workerPromise=(async()=>{status('Loading the OCR engine for the first reading…');if(!window.Tesseract){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';s.onload=resolve;s.onerror=()=>{s.remove();reject(Error('Could not load OCR. Check your connection and retry.'));};document.head.append(s);});}worker=await window.Tesseract.createWorker('eng',1,{logger:()=>{}});await worker.setParameters({tessedit_pageseg_mode:'6'});return worker;})();}try{return await workerPromise;}catch(e){workerPromise=null;throw e;}}
async function reading(){
 const totalImage=crop('total',4),itemsImage=crop('items',4),picture=crop('items');
 showCrop('total-crop',crop('total',2));showCrop('items-crop',crop('items',2));
 const w=await getWorker();
 await w.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789, .'});
 const t=await w.recognize(prepare(totalImage)),t2=await w.recognize(prepare(totalImage,true));
 const a=parseTotal(t.data.text),b=parseTotal(t2.data.text),total=a!==null&&a===b?a:null;
 await w.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:''});
 const i=await w.recognize(prepare(itemsImage)),i2=await w.recognize(prepare(itemsImage,true));
 const chosen=chooseItemReading(i.data,i2.data);
 await readBalance(w);
 $('total-reading').textContent=total===null?'Reselect total':fmt(total)+' mesos';
 $('items-reading').textContent=chosen.display||'No item names found — select the names only';
 $('items-reading').classList.toggle('uncertain',!chosen.itemReliable);
 $('item-quality').textContent=chosen.itemReliable?'Both readings agree. Compare the spelling with the item crop.':'Uncertain item text — this spelling will not be sent as a sale item. Compare the crop or save it for troubleshooting.';
 $('item-quality').classList.toggle('uncertain',!chosen.itemReliable);
 $('raw-ocr').textContent='Total pass 1: '+t.data.text.trim()+'\nTotal pass 2: '+t2.data.text.trim()+'\n\nItem pass 1:\n'+i.data.text.trim()+'\n\nItem pass 2:\n'+i2.data.text.trim();
 $('ocr-quality').textContent='Total confidence: '+Math.round(Math.min(t.data.confidence,t2.data.confidence))+'% · Item text: '+Math.round(chosen.confidence)+'%'+(a!==b?' · Total readings disagree':'');
 return{total,items:chosen.items,itemReliable:chosen.itemReliable,confidence:Math.min(t.data.confidence,t2.data.confidence),picture};
}
$('read').onclick=async()=>{if(busy)return;busy=true;checking=true;controls();try{const r=await reading();status(r.total===null||r.confidence<65?'The total is unclear. Select a tighter area around the number, then check again.':'Reading complete. Compare the total and item text with your game before starting.',r.total===null||r.confidence<65);}catch(e){status(e.message,true);}finally{busy=false;checking=false;controls();}};
async function tick(){if(!watching||busy)return;busy=true;controls();try{const r=await reading();if(!watching)return;const result=observe(state,r);if(result.kind==='reset'){stop('The sales total decreased. Your shop may have reopened. Check the reading, then start a new baseline.');return;}if(result.kind==='unreadable'){state=result.state;status('Reading unclear. No alert sent; trying again next check.',true);}else if(result.kind==='sale'){const names=result.names.length?result.names.join(', '):'Item text unclear — verify the Sold Items list';const entry={time:new Date().toISOString(),names,amount:result.amount,delivery:'Sending'};sales.unshift(entry);renderSales();try{await send(`MapleStory Classic · sale detected by OCR\nItems: ${names.slice(0,1000)}\nSales total increased by ${fmt(result.amount)} mesos.\n${new Date().toLocaleString()}\nSeveral purchases can be grouped. Check the screenshot to verify.`,$('attach').checked?r.picture:null);entry.delivery='Sent to Discord';state=result.state;status('Sale alert sent. Still watching your store.');}catch(e){entry.delivery='Delivery failed — not retried';state=result.state;stop('Discord delivery failed. The sale remains in activity; check your webhook and restart. '+e.message);$('status').classList.add('error');}renderSales();}else{state=result.state;status(result.kind==='pending'?'Sales total changed. Waiting for a second matching reading…':result.kind==='baseline'?'Baseline set. Watching for your next sale.':'Last checked '+new Date().toLocaleTimeString()+'. No new sale detected.');}}catch(e){stop('Monitoring paused: '+e.message);$('status').classList.add('error');}finally{busy=false;controls();if(watching)timer=setTimeout(tick,Number($('interval').value)*1000);}}
$('start').onclick=async()=>{try{validWebhook();if(!regions.total||!regions.items)throw Error('Select both reading areas first.');state={total:null,items:'',candidate:null};watching=true;mode=null;drag=null;$('badge').classList.add('live');$('badge').replaceChildren(Object.assign(document.createElement('span'),{className:'dot'}),document.createTextNode(' Watching'));controls();await tick();}catch(e){stop(e.message);$('status').classList.add('error');}};
function row(entry,example=false){const r=document.createElement('div');r.className='sale-row';const time=document.createElement('time');time.textContent=new Date(entry.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});const text=document.createElement('div'),name=document.createElement('strong'),note=document.createElement('small');name.textContent=entry.names;note.textContent=example?'Example only · no Discord message sent':entry.delivery+' · OCR reading';text.append(name,note);const amount=document.createElement('div');amount.className='amount';amount.textContent='+'+fmt(entry.amount)+' mesos';r.append(time,text,amount);return r;}
function renderSales(){$('activity-empty').hidden=sales.length>0;$('sales').replaceChildren(...sales.map(s=>row(s)));$('sale-count').textContent=String(sales.length);$('meso-count').replaceChildren(document.createTextNode(fmt(sales.reduce((a,s)=>a+s.amount,0))+' '),Object.assign(document.createElement('small'),{textContent:'mesos'}));$('export').disabled=!sales.length;}
$('demo').onclick=()=>{if(sales.length)return;$('sales').replaceChildren(row({time:new Date().toISOString(),names:'Example: Steelies',amount:2500000},true));$('demo').textContent='Example shown below';};
$('export').onclick=()=>{const safe=s=>{let v=String(s);if(/^[=+@\-\t\r]/.test(v))v="'"+v;return'"'+v.replaceAll('"','""')+'"';};const csv='Time,Items,Total increase (mesos),Delivery\r\n'+sales.map(s=>[s.time,s.names,s.amount,s.delivery].map(safe).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='mesoswatch-sales.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function safeLink(value){try{const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch{return null;}}
const config=window.MESOSWATCH_CONFIG||{};const donation=safeLink(config.donationUrl);if(donation){$('donate').href=donation;$('donate').target='_blank';$('donate').rel='noopener noreferrer';$('donate').removeAttribute('aria-disabled');$('donate').classList.remove('disabled');$('donate').textContent=config.donationLabel||'Support MESOS - WATCH ↗';$('donation-note').textContent='Thank you for supporting the project.';}
const sponsor=config.sponsor||{},link=safeLink(sponsor.url);if(link&&sponsor.title){const a=document.createElement('a');a.href=link;a.target='_blank';a.rel='sponsored noopener noreferrer';const image=safeLink(sponsor.imageUrl);if(image){const img=document.createElement('img');img.src=image;img.alt=sponsor.title;img.loading='lazy';a.append(img);}else a.textContent=sponsor.title;$('ad-content').replaceChildren(a);}
window.addEventListener('beforeunload',e=>{if(watching){e.preventDefault();e.returnValue='';}});
window.addEventListener('pagehide',()=>{clearTimeout(timer);cancelAnimationFrame(frame);stream?.getTracks().forEach(t=>t.stop());worker?.terminate();});
async function readBalance(w){
 if(!regions.balance)return;
 showCrop('balance-crop',crop('balance',2));
 await w.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789, .'});
 const source=crop('balance',4),a=await w.recognize(prepare(source)),b=await w.recognize(prepare(source,true));
 const first=parseTotal(a.data.text),second=parseTotal(b.data.text);
 const reliable=first!==null&&first===second&&Math.min(a.data.confidence,b.data.confidence)>=65;
 $('balance-reading').textContent=reliable?fmt(first):'Unclear';
 $('balance-note').textContent=reliable?'Personal mesos · checked '+new Date().toLocaleTimeString():'Balance unreadable. Keep inventory visible or reselect the digits.';
}
async function autoDetect(){
 if(!stream||busy||watching)return;
 busy=true;checking=true;mode=null;drag=null;controls();
 try{
  status('Looking for Sold Items, sales totals, and your mesos balance…');
  const scale=video.videoWidth<1400?2:1.5,c=document.createElement('canvas');
  c.width=Math.round(video.videoWidth*scale);c.height=Math.round(video.videoHeight*scale);
  const g=c.getContext('2d',{willReadFrequently:true});g.imageSmoothingEnabled=false;g.drawImage(video,0,0,c.width,c.height);
  const w=await getWorker();await w.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:''});
  const result=await w.recognize(c,{}, {text:true,tsv:true});
  const pixels=g.getImageData(0,0,c.width,c.height);
  const coinScore=word=>{const left=Math.max(0,Math.floor(word.x-35*scale)),right=Math.max(0,Math.floor(word.x-2*scale)),top=Math.max(0,Math.floor(word.y-4*scale)),bottom=Math.min(c.height,Math.ceil(word.y+word.h+4*scale));let gold=0,total=0;for(let y=top;y<bottom;y+=2)for(let x=left;x<right;x+=2){const p=(y*c.width+x)*4,r=pixels.data[p],gr=pixels.data[p+1],b=pixels.data[p+2];if(r>165&&gr>100&&gr<r*.96&&b<135&&r-b>60)gold++;total++;}return total?gold/total:0;};
  const found=locateRegions(tsvWords(result.data.tsv),c.width,c.height,scale,coinScore);
  if(!stream)return;
  regions=found;
  if(regions.total&&regions.items)await reading();else if(regions.balance)await readBalance(w);
  const missing=[];if(!found.total||!found.items)missing.push('Sold Items / Total Sales');if(!found.balance)missing.push('personal mesos');
  status(missing.length?'Auto-detection could not confidently locate '+missing.join(' and ')+'. Use the manual selection buttons for those areas.':'Found Sold Items, Total Sales, and your personal mesos. Check the highlighted areas before starting.',missing.length>0);
 }catch(e){status('Auto-detection unavailable: '+e.message+' You can select the areas manually.',true);}
 finally{busy=false;checking=false;controls();}
}
$('auto-detect').onclick=autoDetect;
controls();

$('save-item-crop').onclick=()=>{try{crop('items').toBlob(blob=>{if(!blob){status('Could not save the item crop.',true);return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='mesos-watch-item-crop.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');}catch(e){status(e.message,true);}};
