import {iconEl,mesoAmt} from './checker.mjs?v=ms-2';
// Live FM Scanner: reads any shop window in the shared game window and contributes its listings to the price database.
// Screen reading only: no clicks, no keyboard input, no game memory. Players roam the FM however they like.
import {tsvWords,frameScale} from './locate.mjs?v=autoselect-3';
import {readShop,confirmed,listingKey,averageHash,shopKeyOf,parsePriceLine,cleanName} from './shop.mjs?v=pc-1';
import {configured,reportObservations,shareIcon} from './api.mjs?v=ms-2';
const $=id=>document.getElementById(id);
const fmt=n=>Number(n).toLocaleString('en-US');
const cap=()=>window.mesosCapture;
const st={on:false,timer:null,last:[],sent:new Set(),icons:new Set(),prevThumb:null,lastFound:0,settled:false,rejected:0,scans:0,shops:new Set(),shared:0,errors:0,feed:[],overlay:null,busy:false};

// One line of the game window at 4x, with a white margin: contrast-stretched gray, or black/white threshold (as app.js prepare).
function lineImage(video,box,threshold){
 const s=4,pad=20,c=document.createElement('canvas');c.width=box.w*s+pad*2;c.height=box.h*s+pad*2;
 const g=c.getContext('2d',{willReadFrequently:true});g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.imageSmoothingEnabled=false;
 g.drawImage(video,box.x,box.y,box.w,box.h,pad,pad,box.w*s,box.h*s);
 const d=g.getImageData(pad,pad,box.w*s,box.h*s);
 for(let p=0;p<d.data.length;p+=4){let v=.299*d.data[p]+.587*d.data[p+1]+.114*d.data[p+2];v=threshold?(v<165?0:255):Math.max(0,Math.min(255,(v-128)*1.4+128));d.data[p]=d.data[p+1]=d.data[p+2]=v;}
 g.putImageData(d,pad,pad);return c;
}
// A listing counts only when two differently prepared re-reads agree on quantity and price (and on the name, if that read poorly).
async function verify(w,video,listings){
 const out=[];let reads=0;
 for(const l of listings){
  if(l.certain){out.push(l);continue;}
  if(reads++>=12)break;
  const inside=b=>b.x>=0&&b.y>=0&&b.w>4&&b.x+b.w<=video.videoWidth&&b.y+b.h<=video.videoHeight;
  if(!inside(l.priceBox)||!inside(l.nameBox))continue;
  await w.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789,. formesFORMES'});
  const a=parsePriceLine((await w.recognize(lineImage(video,l.priceBox,false))).data.text),b=parsePriceLine((await w.recognize(lineImage(video,l.priceBox,true))).data.text);
  if(!a||!b||a.qty!==b.qty||a.bundle!==b.bundle){st.rejected++;continue;}
  let item=l.item;
  if(l.nameConf<70){
   await w.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:''});
   const x=cleanName((await w.recognize(lineImage(video,l.nameBox,false))).data.text),y=cleanName((await w.recognize(lineImage(video,l.nameBox,true))).data.text);
   if(x.length<2||x.toLowerCase()!==y.toLowerCase()){st.rejected++;continue;}
   item=x;
  }
  out.push({...l,item,qty:a.qty,price:a.price,certain:true});
 }
 return out;
}

function status(text,kind=''){const s=$('scan-status');s.textContent=text;s.className='status'+(kind?' '+kind:'');}
function stats(){$('scan-count').textContent=fmt(st.scans);$('scan-shops').textContent=fmt(st.shops.size);$('scan-shared').textContent=fmt(st.shared);$('scan-errors').textContent=fmt(st.errors);}
function controls(){
 const stream=!!cap()?.stream;
 $('scan-connect').hidden=stream;$('scan-toggle').disabled=!stream||!$('scan-consent').checked;
 $('scan-toggle').textContent=st.on?'■ Stop scanning':'▶ Start scanning';$('scan-toggle').classList.toggle('primary',!st.on);
 $('scan-badge').classList.toggle('live',st.on);$('scan-badge').lastChild.textContent=st.on?' Scanning':stream?' Window shared':' Not connected';
}

// Cheap change check: a 32x18 grayscale thumbnail. An unchanged screen is not read again.
function thumb(video){const c=document.createElement('canvas');c.width=32;c.height=18;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(video,0,0,32,18);const d=g.getImageData(0,0,32,18).data,o=new Uint8Array(576);for(let i=0;i<576;i++)o[i]=(d[i*4]*.299+d[i*4+1]*.587+d[i*4+2]*.114)|0;return o;}
const diff=(a,b)=>{if(!a||!b)return 255;let t=0;for(let i=0;i<a.length;i++)t+=Math.abs(a[i]-b[i]);return t/a.length;};

async function scanOnce(){
 const video=cap()?.video;
 if(!st.on||st.busy||!cap()?.stream||!video?.videoWidth)return;
 if(document.hidden){status('This tab is in the background, so the browser slows scanning. Keep it visible in another window for steady scans.','warn');}
 const t=thumb(video);
 if(diff(t,st.prevThumb)<2&&st.settled){status((st.lastFound?'This shop is fully shared. Open the next one; ':'Nothing changed on screen. Open a shop to scan it; ')+'last check '+new Date().toLocaleTimeString()+'.');return;}
 st.prevThumb=t;st.busy=true;
 const t0=performance.now();
 try{
  const scale=frameScale(video.videoWidth),c=document.createElement('canvas');
  c.width=Math.round(video.videoWidth*scale);c.height=Math.round(video.videoHeight*scale);
  const g=c.getContext('2d');g.imageSmoothingEnabled=false;g.drawImage(video,0,0,c.width,c.height);
  // One OCR turn: the full frame, then enlarged re-reads of any listing whose "1 for … mesos" line (or name) read poorly.
  const shop=await cap().withOCR(async w=>{
   await w.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:''});
   const r=await w.recognize(c,{},{text:true,tsv:true});
   const found=readShop(tsvWords(r.data.tsv)),s=v=>Math.round(v/scale),sb=b=>({x:s(b.x),y:s(b.y),w:s(b.w),h:s(b.h)});
   found.listings=await verify(w,video,found.listings.map(l=>({...l,box:sb(l.box),icon:sb(l.icon),nameBox:sb(l.nameBox),priceBox:sb(l.priceBox)})));
   return found;
  });
  st.scans++;
  const listings=shop.listings;
  st.lastFound=listings.length;
  const world=$('world').value||'',fresh=confirmed(st.last,listings).filter(l=>!st.sent.has(world+'|'+listingKey(l)));
  st.last=listings;
  const world2=world;st.settled=listings.every(l=>st.sent.has(world2+'|'+listingKey(l)))&&fresh.length===0;
  const ms=Math.round(performance.now()-t0);
  drawOverlay(video,listings,fresh);
  if(!listings.length){status(`No shop on screen (read in ${ms} ms). Open any shop in the Free Market; scanning continues automatically.`);return;}
  const shopKey=shopKeyOf(world,shop.shopTitle,shop.map);st.shops.add(shopKey||'untitled:'+listings.map(l=>l.item).join('|'));
  const where=shop.shopTitle?`“${shop.shopTitle}”`:'a shop';
  if(!fresh.length){status(`Reading ${where}: ${listings.length} listing${listings.length===1?'':'s'}. ${st.sent.size?'Already shared; scroll the list or move on to the next shop.':'Confirming with a second read…'}`);return;}
  if(!configured()){status(`Read ${listings.length} listings in ${where}, but the community database is not connected yet, so nothing was shared.`,'warn');return;}
  const saved=await reportObservations(fresh.map(l=>({kind:'ask',item:l.item,price:l.price,qty:l.qty,confidence:Math.min(100,l.nameConf??65),stats:l.stats,shopKey,shopTitle:shop.shopTitle,map:shop.map,channel:shop.channel})),{world});
  for(const l of fresh)st.sent.add(world+'|'+listingKey(l));
  st.settled=listings.every(l=>st.sent.has(world+'|'+listingKey(l)));
  st.shared+=saved.length;
  for(const row of saved){const l=fresh.find(x=>x.item.toLowerCase()===row.item_name.toLowerCase())||fresh.find(x=>row.item_name.toLowerCase().startsWith(x.item.replace(/(\.\.\.|…)$/,'').toLowerCase()));
   st.feed.unshift({observationId:row.id,time:new Date(),item:row.item_name,itemId:row.item_id,catalogItem:row.item,price:l?.price,qty:l?.qty,stats:l?.stats,shop:shop.shopTitle,map:shop.map});
   if(l&&!row.catalog&&!st.icons.has(row.item_id)){st.icons.add(row.item_id);sendIcon(video,l.icon,row.item_id);}}
  st.feed=st.feed.slice(0,40);renderFeed();
  status(`Shared ${saved.length} new price${saved.length===1?'':'s'} from ${where}${shop.map?' · '+shop.map:''}. ${fresh.length-saved.length?`${fresh.length-saved.length} were already in the database.`:''}`,'ok');
  window.dispatchEvent(new CustomEvent('mesoswatch:observed',{detail:{world}}));
 }catch(e){st.errors++;status('Scan problem: '+e.message+' Scanning continues.','error');}
 finally{st.busy=false;stats();}
}

// Crop the listing's sprite at native size, hash it, and offer it as the item's icon (it becomes official when two players agree).
async function sendIcon(video,box,itemId){
 try{
  if(box.x<0||box.y<0||box.w<8||box.x+box.w>video.videoWidth||box.y+box.h>video.videoHeight)return;
  const c=document.createElement('canvas');c.width=box.w;c.height=box.h;c.getContext('2d').drawImage(video,box.x,box.y,box.w,box.h,0,0,box.w,box.h);
  const s=document.createElement('canvas');s.width=s.height=8;const sg=s.getContext('2d',{willReadFrequently:true});sg.drawImage(c,0,0,8,8);
  const d=sg.getImageData(0,0,8,8).data,gray=[];for(let i=0;i<64;i++)gray.push(d[i*4]*.299+d[i*4+1]*.587+d[i*4+2]*.114);
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));if(!blob||blob.size>16000)return;
  await shareIcon(itemId,averageHash(gray),blob);
 }catch{/* icons are optional; prices still count */}
}

function drawOverlay(video,listings,fresh){
 const cv=$('scan-canvas'),w=Math.min(720,video.videoWidth),h=Math.round(video.videoHeight*w/video.videoWidth),k=w/video.videoWidth;
 cv.width=w;cv.height=h;cv.hidden=false;$('scan-empty').hidden=true;
 const g=cv.getContext('2d');g.drawImage(video,0,0,w,h);g.lineWidth=2;g.font='bold 11px Nunito, Arial, sans-serif';
 const freshKeys=new Set(fresh.map(listingKey));
 for(const l of listings){const ok=freshKeys.has(listingKey(l))||st.sent.has(($('world').value||'')+'|'+listingKey(l));
  g.strokeStyle=ok?'#2e8049':'#e8a12d';g.strokeRect(l.box.x*k-2,l.box.y*k-2,l.box.w*k+4,l.box.h*k+4);
  const label=fmt(l.price)+(Object.keys(l.stats).length?' · '+Object.entries(l.stats).map(([a,b])=>a+' '+b).join(' '):'');
  const tw=g.measureText(label).width+8;g.fillStyle=ok?'#2e8049':'#e8a12d';g.fillRect(l.box.x*k+l.box.w*k+6,l.box.y*k,tw,15);g.fillStyle='#fff';g.fillText(label,l.box.x*k+l.box.w*k+10,l.box.y*k+11);}
}

function renderFeed(){
 const list=$('scan-feed');list.replaceChildren();
 $('scan-feed-empty').hidden=st.feed.length>0;
 for(const f of st.feed){const li=document.createElement('li');li.title='Observation #'+f.observationId;const report=document.createElement('a');report.href='#reports';report.textContent='Report #'+f.observationId;li.append(report);
  const a=Object.assign(document.createElement('a'),{href:'#item/'+f.itemId,className:'item-link'});a.append(iconEl(f.catalogItem||{name:f.item},24),document.createTextNode(f.item));
  li.append(a,mesoAmt(f.price!=null?fmt(f.price):'—'),Object.assign(document.createElement('small'),{textContent:[f.qty>1?'×'+f.qty:'',Object.entries(f.stats||{}).map(([k,v])=>k+' '+v).join(' '),f.shop,f.map,f.time.toLocaleTimeString()].filter(Boolean).join(' · ')}));
  list.append(li);}
}

function schedule(){clearTimeout(st.timer);if(st.on)st.timer=setTimeout(async()=>{await scanOnce();schedule();},Number($('scan-interval').value)*1000);}
function setOn(on){st.on=on;st.last=[];st.prevThumb=null;controls();if(on){status('Scanning. Walk around the Free Market and open shops; each one is read automatically.','ok');scanOnce().then(schedule);}else{clearTimeout(st.timer);status('Scanning stopped.');}}

$('scan-connect').onclick=async()=>{if(!cap())return status('The page is still loading. Try again in a moment.','error');await cap().connect();controls();};
$('scan-toggle').onclick=()=>setOn(!st.on);
$('scan-consent').onchange=()=>{try{localStorage.setItem('mw-scan-consent',$('scan-consent').checked?'1':'');}catch{}if(!$('scan-consent').checked&&st.on)setOn(false);controls();};
$('scan-interval').onchange=()=>{try{localStorage.setItem('mw-scan-interval',$('scan-interval').value);}catch{}schedule();};
try{$('scan-consent').checked=localStorage.getItem('mw-scan-consent')==='1';const iv=localStorage.getItem('mw-scan-interval');if(iv&&[...$('scan-interval').options].some(o=>o.value===iv))$('scan-interval').value=iv;}catch{}
window.addEventListener('mesoswatch:capture-started',()=>{controls();status($('scan-consent').checked?'Window shared. Press Start scanning when you are in the Free Market.':'Window shared. Tick the sharing agreement, then press Start scanning.');});
window.addEventListener('mesoswatch:capture-ended',()=>{if(st.on)setOn(false);status('Window sharing ended. Share your game window again to keep scanning.','error');$('scan-canvas').hidden=true;$('scan-empty').hidden=false;controls();});
window.addEventListener('mesoswatch:capture-ready',controls);
if(!configured())status('The community database is not connected yet, so scans will be read but not shared. The site owner sets it up in config.js.','warn');
controls();stats();renderFeed();
