import {iconEl,mesoAmt} from './checker.mjs?v=ms-8';
// Live FM Scanner: reads any shop window in the shared game window and contributes its listings to the price database.
// Screen reading only: no clicks, no keyboard input, no game memory. Players roam the FM however they like.
// Publishing is automatic, with no review step, and only of what was read with certainty: every listing carries where to find
// it (location.mjs: world, channel, and an FM room or a named map), a catalog item, and a price two reads agree on. Listings
// seen while the location is incomplete wait, unpublished, and are published by a later scan once it is known; nothing is
// filled in. Greyed-out rows are sold sightings (their listed price, never a sale price), and end the matching asking price.
import {tsvWords,frameScale} from './locate.mjs?v=autoselect-7';
import {readShop,confirmed,listingKey,averageHash,shopKeyOf,parsePriceLine,cleanName} from './shop.mjs?v=pc-4';
import * as fm from './fm-location.mjs?v=fm-4';
import {makeLocation,locationProblems,whereToFind,locationColumns} from './location.mjs?v=loc-2';
import {ocrImage,TEXT_PASSES} from './ocr-prep.mjs?v=prep-2';
import {configured,reportObservations,reportSoldSightings,shareIcon,worlds} from './api.mjs?v=ms-4';
import {createShopMemory} from './shop-identity.mjs?v=1';
const $=id=>document.getElementById(id);
const fmt=n=>Number(n).toLocaleString('en-US');
const cap=()=>window.mesosCapture;
const st={on:false,timer:null,last:[],sent:new Set(),icons:new Set(),prevThumb:null,settled:false,rejected:0,scans:0,shops:new Set(),shared:0,soldShared:0,errors:0,feed:[],busy:false,
 // Location: what the screen showed (auto) and what the player typed (manual, which wins until the screen shows a change).
 place:{status:'unknown',locationType:null,roomNumber:null,mapName:null,confidence:null,crop:null,thumb:null,missAt:0,texts:[]},
 chan:{channel:null,world:'',at:0},manual:{channel:false,place:false},
 verifiedChannel:null,pending:null,shop:{title:'',active:0,sold:0,uncertain:0},waiting:0};

// A rectangle of the game window prepared for OCR (as the store watcher's crops).
function cropImage(video,box,options){
 const c=document.createElement('canvas');c.width=box.w;c.height=box.h;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(video,box.x,box.y,box.w,box.h,0,0,box.w,box.h);
 const img=ocrImage(g.getImageData(0,0,box.w,box.h),options),o=document.createElement('canvas');o.width=img.width;o.height=img.height;
 o.getContext('2d').putImageData(new ImageData(img.data,img.width,img.height),0,0);return o;
}
// One line, smoothly enlarged: gray, or binarized at its own Otsu level. Sold (grey) rows get their faint levels stretched first.
const lineImage=(video,box,threshold,scale=4,levels=null)=>cropImage(video,box,{scale,binarize:threshold,levels});
async function readCrop(w,video,box,options,psm,whitelist=''){
 await w.setParameters({tessedit_pageseg_mode:psm,tessedit_char_whitelist:whitelist});
 return(await w.recognize(cropImage(video,box,options),{},{text:true,tsv:true})).data;
}
// The window at its native resolution: room, channel and sold tests run on these pixels, not on the scaled OCR frame.
function captureFrame(video){
 const frame=document.createElement('canvas');
 frame.width=video.videoWidth;frame.height=video.videoHeight;
 frame.getContext('2d',{willReadFrequently:true}).drawImage(video,0,0);
 return frame;
}
function cropThumb(video,box){const c=document.createElement('canvas');c.width=48;c.height=8;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(video,box.x,box.y,box.w,box.h,0,0,48,8);const d=g.getImageData(0,0,48,8).data,o=new Uint8Array(384);for(let i=0;i<384;i++)o[i]=(d[i*4]*.299+d[i*4+1]*.587+d[i*4+2]*.114)|0;return o;}

// FM room or map name from the expanded minimap in the top-left corner, as the store watcher reads it: the title panel is
// found from its pixels at any capture size, then its map line is read with digit-only and plain passes scaled to the text
// height. The line is re-read only when it changes on screen (a room change); an unclear line leaves the place unknown.
async function detectPlace(w,video,px){
 const W=video.width,H=video.height,corner=fm.roomCorner(W,H),found=fm.roomLine(px,corner);
 let crop=found?.crop,reads=found?fm.roomLineReads(found.h):fm.ROOM_READS,h=found?.h||null;
 if(!crop){
  if(Date.now()-st.place.missAt<30000&&st.place.status==='not-found')return;
  const line=fm.findRoomLine(fm.toSource(tsvWords((await readCrop(w,video,corner,fm.ROOM_FIND,'11')).tsv),corner,fm.ROOM_FIND.scale));
  if(!line){setPlace({status:'not-found',missAt:Date.now()});return;}
  crop=fm.roomLineCrop(line,W,H);
 }
 const thumbNow=cropThumb(video,crop);
 if(st.place.thumb&&st.place.status==='detected'&&diff(thumbNow,st.place.thumb)<3)return;
 const roomTexts=[];for(const o of reads)roomTexts.push((await readCrop(w,video,crop,o,'7',fm.ROOM_CHARS)).text);
 let res=fm.readMapLine(roomTexts);
 if(!res){const nameTexts=[];for(const o of fm.MAP_NAME_READS)nameTexts.push((await readCrop(w,video,crop,h?{...o,scale:Math.max(1,Math.round(o.scale*9.5/h))}:o,'7')).text);res=fm.readMapLine(roomTexts,nameTexts);}
 if(!res){setPlace({status:'unclear',texts:roomTexts});return;}
 const moved=st.place.status==='detected'&&(res.roomNumber!==st.place.roomNumber||res.mapName!==st.place.mapName);
 setPlace({status:'detected',...res,crop,thumb:thumbNow,texts:roomTexts});
 if(moved||!st.manual.place){st.manual.place=false;fillPlace();}
}
// Unknown, unclear or newly detected: the old room never carries over.
function setPlace(p){const known=p.status==='detected';st.place={...st.place,locationType:null,roomNumber:null,mapName:null,confidence:null,crop:null,thumb:null,texts:[],...p};if(!known&&!st.manual.place)fillPlace();}
function fillPlace(){$('scan-room').value=st.place.roomNumber||'';$('scan-map').value=st.place.mapName||'';}
// Channel (and world) from the Change Channel menu whenever it is open: the one blue cell of the grid, read from pixels.
async function detectChannel(w,video,grid){
 if(!grid)return;
 const again=grid.channel===st.chan.channel&&st.chan.world;
 st.chan={channel:grid.channel,world:st.chan.world,at:Date.now()};st.manual.channel=false;$('scan-channel').value=grid.channel;
 if(again)return;
 const world=fm.parseWorld((await readCrop(w,video,fm.worldBand(grid,video.width,video.height),fm.WORLD_READS[0],'6')).text);
 st.chan.world=world||'';
 const pick=world&&[...$('world').options].find(o=>o.value.toLowerCase()===world.toLowerCase()||o.textContent.trim().toLowerCase()===world.toLowerCase());
 if(pick&&$('world').value!==pick.value){$('world').value=pick.value;$('world').dispatchEvent(new Event('change'));}
}
// The location listings are published with: detected values unless the player corrected them.
function currentLocation(shopName=''){
 const channel=st.manual.channel?+$('scan-channel').value||null:st.chan.channel;
 const room=st.manual.place?+$('scan-room').value||null:st.place.roomNumber,map=st.manual.place?$('scan-map').value:st.place.mapName;
 const conf=[st.manual.channel?100:st.chan.channel?95:null,st.manual.place?100:st.place.confidence].filter(v=>v!==null);
 return makeLocation({world:$('world').value||'',channel,roomNumber:room,mapName:room?'':map,shopName,
  locationSource:st.manual.channel||st.manual.place?'MANUAL':'AUTO',locationConfidence:conf.length===2?Math.min(...conf):null});
}
const needWorld=()=>worlds().length>1;
// The channel read from the Change Channel grid's pixels: how sure that reading is (as in currentLocation).
const GRID_CHANNEL_CONFIDENCE=95;
// Shops seen this session, so a misread shop title does not publish the same listings again as another shop.
const shopMemory=createShopMemory();
const locKey=l=>[l.world,l.channel,l.locationType,l.roomNumber,l.mapName].join('|').toLowerCase();

const inside=(b,video)=>b&&b.x>=0&&b.y>=0&&b.w>4&&b.x+b.w<=video.width&&b.y+b.h<=video.height;
// The shop's owner/title, re-read from its own crop with the store watcher's passes; two matching reads win, else the
// most confident clean one, else the full-frame reading.
async function readTitle(w,video,box,fallback){
 if(!inside(box,video))return fallback;
 await w.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:''});
 const reads=[];for(const o of TEXT_PASSES){const d=(await w.recognize(lineImage(video,box,!!o.binarize,o.scale))).data,text=cleanName(d.text||'').slice(0,40);if(/[A-Za-z]{2}/.test(text))reads.push({text,conf:d.confidence??0});}
 const agreed=reads.find((r,i)=>reads.some((q,j)=>j!==i&&q.text.toLowerCase()===r.text.toLowerCase()));
 if(agreed)return agreed.text;
 const best=reads.sort((p,q)=>q.conf-p.conf)[0];return best&&best.conf>=70?best.text:fallback;
}
// A listing counts only when two differently prepared re-reads agree on quantity and price (and on the name, if that read poorly).
// Greyed-out rows are re-read with their faint grey stretched to full contrast, so their names and prices read as well.
async function verify(w,video,listings){
 const out=[];let reads=0;
 for(const l of listings){
  if(l.certain){out.push(l);continue;}
  if(reads++>=12)break;
  if(!inside(l.priceBox,video)||!inside(l.nameBox,video))continue;
  await w.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789,. formesFORMES'});
  const lv=l.state==='active'?null:[170,245],a=parsePriceLine((await w.recognize(lineImage(video,l.priceBox,false,4,lv))).data.text),b=parsePriceLine((await w.recognize(lineImage(video,l.priceBox,true,4,lv))).data.text);
  if(!a||!b||a.qty!==b.qty||a.bundle!==b.bundle){st.rejected++;continue;}
  let item=l.item;
  if(l.nameConf<70||l.state!=='active'){
   await w.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:''});
   const x=cleanName((await w.recognize(lineImage(video,l.nameBox,false,4,lv))).data.text),y=cleanName((await w.recognize(lineImage(video,l.nameBox,true,4,lv))).data.text);
   if(x.length<2||x.toLowerCase()!==y.toLowerCase()){st.rejected++;continue;}
   item=x;
  }
  out.push({...l,item,qty:a.qty,price:a.price,certain:true});
 }
 return out;
}

let scanRun=0,channelPromptShown=false;
const channelDialog=$('scan-channel-dialog');
window.addEventListener('mesoswatch:view',event=>{
 if(event.detail.view!=='scanner')channelDialog.close();
});
const channelPrompt='Prices read. Open Change Channel to verify the channel for these listings. Stay on the same channel until they are shared.';
const scanReady='Scanning. Walk around the Free Market and open shops; each one is read automatically.';
function scanStatus(text=scanReady,kind='ok'){
 const channel=st.verifiedChannel;
 if(channel){
  channelPromptShown=false;
  channelDialog.close();
 }
 if(st.pending&&!channel&&kind!=='error'){
  status(channelPrompt,'warn');
  if(st.on&&!channelPromptShown&&document.body.dataset.view==='scanner'){
   channelPromptShown=true;
   channelDialog.showModal();
  }
 }else status(text,kind);
}
function status(text,kind=''){const s=$('scan-status');if(s.textContent!==text)s.textContent=text;s.className='status'+(kind?' '+kind:'');}
function stats(){$('scan-count').textContent=fmt(st.scans);$('scan-shops').textContent=fmt(st.shops.size);$('scan-shared').textContent=fmt(st.shared);$('scan-errors').textContent=fmt(st.errors);}
function controls(){
 const stream=!!cap()?.stream;
 $('scan-connect').hidden=stream;$('scan-toggle').disabled=!stream||!$('scan-consent').checked;
 $('scan-toggle').textContent=st.on?'■ Stop scanning':'▶ Start scanning';$('scan-toggle').classList.toggle('primary',!st.on);
 $('scan-badge').classList.toggle('live',st.on);$('scan-badge').lastChild.textContent=st.on?' Scanning':stream?' Window shared':' Not connected';
}
// The location dashboard: each value with where it came from, and why publishing is blocked, if it is.
const tag=(id,text,kind)=>{const t=$(id);t.textContent=text;t.className='loc-src'+(kind?' '+kind:'');};
function dashboard(){
 const loc={...currentLocation(st.shop.title),channel:st.verifiedChannel},problems=locationProblems(loc,{needWorld:needWorld()});
 if(!loc.channel){const index=problems.findIndex(problem=>problem.startsWith('Channel unknown:'));problems[index]=channelPrompt;}
 $('scan-d-world').textContent=$('world').selectedOptions[0]?.textContent.trim()||'—';
 tag('scan-channel-src',st.manual.channel?'MANUAL':st.chan.channel?'AUTO · menu':'not detected',st.manual.channel?'manual':st.chan.channel?'auto':'none');
 const p=st.place,placeText={unknown:'not read yet','not-found':'minimap not found',unclear:'unclear: '+p.texts.map(t=>t.trim()).filter(Boolean).slice(0,2).join(' / ')}[p.status];
 tag('scan-place-src',st.manual.place?'MANUAL':p.status==='detected'?'AUTO · '+p.confidence+'%':placeText||'—',st.manual.place?'manual':p.status==='detected'?'auto':'none');
 $('scan-d-conf').textContent=loc.locationConfidence!=null?loc.locationConfidence+'%':'—';
 $('scan-d-shop').textContent=st.shop.title||'—';
 $('scan-d-active').textContent=fmt(st.shop.active);$('scan-d-sold').textContent=fmt(st.shop.sold);$('scan-d-uncertain').textContent=fmt(st.shop.uncertain);
 $('scan-d-drafts').textContent=fmt(st.waiting);
 const where=whereToFind(loc);
 $('scan-blocked').textContent=problems.length?'Publishing paused: '+problems.join(' '):'Publishing to: '+[loc.world,where].filter(Boolean).join(' • ')+(loc.locationSource==='MANUAL'?' (corrected by you)':'');
 $('scan-blocked').classList.toggle('blocked',problems.length>0);
}

// Cheap change check: a 32x18 grayscale thumbnail. An unchanged screen is not read again.
function thumb(video){const c=document.createElement('canvas');c.width=32;c.height=18;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(video,0,0,32,18);const d=g.getImageData(0,0,32,18).data,o=new Uint8Array(576);for(let i=0;i<576;i++)o[i]=(d[i*4]*.299+d[i*4+1]*.587+d[i*4+2]*.114)|0;return o;}
const diff=(a,b)=>{if(!a||!b)return 255;let t=0;for(let i=0;i<a.length;i++)t+=Math.abs(a[i]-b[i]);return t/a.length;};

// Active rows are asking prices; sold rows are sold sightings (the displayed price, not a confirmed sale price).
async function publish(items,loc,shop){
 const cols=locationColumns(loc),world=loc.world,shopKey=shopKeyOf(world,shop.title,cols.map);
 const asks=items.filter(l=>l.state==='active'),sold=items.filter(l=>l.state==='sold');
 const saved=asks.length?await reportObservations(asks.map(l=>({kind:'ask',source:'scanner',item:l.item,price:l.price,qty:l.qty,confidence:Math.min(100,l.nameConf??65),stats:l.stats,shopKey,shopTitle:shop.title,map:cols.map,channel:loc.channel,location:cols})),{world}):[];
 const seen=sold.length?await reportSoldSightings(sold.map(l=>({item:l.item,price:l.price,qty:l.qty,stats:l.stats,shopKey,shopTitle:shop.title,confidence:Math.min(100,l.nameConf??65),location:cols})),{world}):[];
 const match=(name,list)=>list.find(x=>x.item.toLowerCase()===name.toLowerCase())||list.find(x=>name.toLowerCase().startsWith(x.item.replace(/(\.\.\.|…)$/,'').toLowerCase()));
 for(const row of saved){const l=match(row.item_name,asks);
  st.feed.unshift({id:'Observation #'+row.id,observationId:row.id,time:new Date(),item:row.item_name,itemId:row.item_id,catalogItem:row.item,price:l?.price,qty:l?.qty,stats:l?.stats,shop:shop.title,where:whereToFind(loc)});
  if(l&&!row.catalog&&!st.icons.has(row.item_id)){st.icons.add(row.item_id);sendIcon(shop.video,l.icon,row.item_id);}}
 for(const row of seen){const l=match(row.item_name,sold);
  st.feed.unshift({id:'Sold sighting #'+row.id,sold:true,time:new Date(),item:row.item_name,itemId:row.item_id,catalogItem:row.item,price:row.listed_price,qty:l?.qty,stats:l?.stats,shop:shop.title,where:whereToFind(loc)});}
 st.feed=st.feed.slice(0,40);renderFeed();
 st.shared+=saved.length;st.soldShared+=seen.length;
 return{saved,seen,asks,sold};
}

async function scanOnce(){
 const run=scanRun;
 const report=(text,kind)=>{if(run===scanRun)scanStatus(text,kind||'');};
 const video=cap()?.video;
 if(!st.on||st.busy||!cap()?.stream||!video?.videoWidth)return;
 try{
  const t=thumb(video);
  if(diff(t,st.prevThumb)<2&&st.settled)return;
  if(document.hidden)report('This tab is in the background, so the browser slows scanning. Keep it visible in another window for steady scans.','warn');
  st.prevThumb=t;st.busy=true;
  const t0=performance.now();
  const frame=captureFrame(video),scale=frameScale(frame.width),c=document.createElement('canvas');
  c.width=Math.round(frame.width*scale);c.height=Math.round(frame.height*scale);
  const g=c.getContext('2d');g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';g.drawImage(frame,0,0,c.width,c.height);
  const px=frame.getContext('2d').getImageData(0,0,frame.width,frame.height);
  const grid=fm.channelGrid(px);
  st.verifiedChannel=grid?.channel??null;
  // One OCR turn: location, the full frame, then enlarged re-reads of any listing whose "1 for … mesos" line (or name) read poorly.
  let shop=await cap().withOCR(async w=>{
   await detectChannel(w,frame,grid);
   if(st.pending)return null;
   await detectPlace(w,frame,px);
   await w.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:''});
   const r=await w.recognize(c,{},{text:true,tsv:true});
   // OCR boxes come from the scaled frame; everything after this works in native window pixels.
   const found=readShop(tsvWords(r.data.tsv)),s=v=>Math.round(v/scale),sb=b=>({x:s(b.x),y:s(b.y),w:s(b.w),h:s(b.h)});
   found.listings=await verify(w,frame,found.listings.map(l=>{const nameBox=sb(l.nameBox),priceBox=sb(l.priceBox),state=fm.rowState(px,nameBox,priceBox);
    return{...l,box:sb(l.box),icon:sb(l.icon),nameBox,priceBox,state,sold:state==='sold'};}));
   if(found.titleBox)found.shopTitle=await readTitle(w,frame,sb(found.titleBox),found.shopTitle);
   return found;
  });
  if(run!==scanRun)return;
  st.scans++;
  const pending=st.pending;
  if(pending&&!grid){report(channelPrompt,'warn');return;}
  if(pending)shop=pending.shop;
  else if(shop&&!shop.ownStore&&shop.listings.length)shop.shopTitle=shopMemory.resolve(locKey(currentLocation()),shop.shopTitle,shop.listings.filter(l=>l.state!=='uncertain').map(listingKey));
  if(shop.ownStore){st.waiting=0;st.last=[];st.shop={title:'',active:0,sold:0,uncertain:0};if(run===scanRun)drawOverlay(frame,[],new Set());report('This is your own store (its Sold Items / Close Store buttons are visible), so it is not shared as an FM listing. Track it in My Store, or publish it under Player Stores.','warn');return;}
  const listings=shop.listings,count=k=>listings.filter(l=>l.state===k).length;
  st.shop={title:shop.shopTitle||'',active:count('active'),sold:count('sold'),uncertain:count('uncertain')};
  // Listings wait for the Change Channel check without a channel, so their combined confidence is only known once it is read.
  const base=pending?.location??currentLocation(shop.shopTitle);
  const loc={...base,channel:pending?grid.channel:null,locationConfidence:pending?(Number.isFinite(base.placeConfidence)?Math.min(base.placeConfidence,GRID_CHANNEL_CONFIDENCE):null):base.locationConfidence};
  const problems=locationProblems(loc,{needWorld:needWorld(),needChannel:!!pending}),here=locKey(loc);
  const key=l=>here+'|'+listingKey(l);
  // Uncertain rows are shown but never published: neither a price on offer nor a sale.
  const publishable=listings.filter(l=>l.state!=='uncertain');
  const fresh=(pending?.items??confirmed(st.last,publishable)).filter(l=>!st.sent.has(key(l)));
  st.last=listings;
  const ms=Math.round(performance.now()-t0);
  if(!pending)drawOverlay(frame,listings,new Set());
  if(!listings.length){
   st.waiting=0;
   report(`No shop on screen (read in ${ms} ms). Open any shop in the Free Market; scanning continues automatically.`);
   st.settled=true;return;
  }
  st.shops.add(shopKeyOf(loc.world,shop.shopTitle,locationColumns(loc).map)||'untitled:'+listings.map(l=>l.item).join('|'));
  const shopName=shop.shopTitle?`“${shop.shopTitle}”`:'a shop',uncertain=st.shop.uncertain?` ${st.shop.uncertain} row${st.shop.uncertain===1?' looks':'s look'} neither clearly sold nor for sale (Uncertain, not shared).`:'';
  if(fresh.length&&problems.length){
   if(pending)st.pending=null;
   // Not published and not filled in later: the next scan with the location known publishes what is on screen then.
   st.waiting=fresh.length;
   report(`Read ${fresh.length} listing${fresh.length===1?'':'s'} in ${shopName}, waiting for the location before publishing. ${problems.join(' ')}`+uncertain,'warn');return;
  }
  if(!pending&&fresh.length){
   st.pending={shop,items:fresh,frame,location:{...loc,placeConfidence:st.manual.place?100:st.place.confidence}};
   st.waiting=fresh.length;
   st.verifiedChannel=null;
   st.settled=false;
   report(channelPrompt,'warn');
   return;
  }
  if(pending){
   st.pending=null;
   st.last=[];
  }
  st.settled=publishable.every(l=>st.sent.has(key(l)))&&fresh.length===0;
  if(!fresh.length){st.waiting=0;report(`Reading ${shopName}: ${st.shop.active} for sale, ${st.shop.sold} sold. ${st.sent.size?'Already shared; scroll the list or move on to the next shop.':'Confirming with a second read…'}`+uncertain);return;}
  st.waiting=0;
  if(!configured()){report(`Read ${listings.length} listings in ${shopName}, but the community database is not connected yet, so nothing was shared.`,'warn');return;}
  const {saved,seen,asks,sold}=await publish(fresh,loc,{title:shop.shopTitle||'',video:pending.frame});
  for(const l of fresh)st.sent.add(key(l));
  if(run===scanRun)drawOverlay(pending.frame,listings,new Set(publishable.filter(l=>st.sent.has(key(l))).map(listingKey)));
  st.settled=false;
  const dupes=fresh.length-saved.length-seen.length;
  report(`Shared ${saved.length} price${saved.length===1?'':'s'}${seen.length?` and ${seen.length} sold item${seen.length===1?'':'s'}`:''} from ${shopName} · ${whereToFind(loc)}.`+
   (dupes>0?` ${dupes} ${dupes===1?'was':'were'} already shared or not identified in the catalog (skipped).`:'')+uncertain,'ok');
  if(asks.length)window.dispatchEvent(new CustomEvent('mesoswatch:observed',{detail:{world:loc.world}}));
 }catch(e){st.errors++;report('Scan problem: '+e.message+' Scanning continues.','error');}
 finally{st.busy=false;stats();dashboard();}
}

// Crop the listing's sprite at native size, hash it, and offer it as the item's icon (it becomes official when two players agree).
async function sendIcon(video,box,itemId){
 try{
  if(!video||box.x<0||box.y<0||box.w<8||box.x+box.w>video.width||box.y+box.h>video.height)return;
  const c=document.createElement('canvas');c.width=box.w;c.height=box.h;c.getContext('2d').drawImage(video,box.x,box.y,box.w,box.h,0,0,box.w,box.h);
  const s=document.createElement('canvas');s.width=s.height=8;const sg=s.getContext('2d',{willReadFrequently:true});sg.drawImage(c,0,0,8,8);
  const d=sg.getImageData(0,0,8,8).data,gray=[];for(let i=0;i<64;i++)gray.push(d[i*4]*.299+d[i*4+1]*.587+d[i*4+2]*.114);
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));if(!blob||blob.size>16000)return;
  await shareIcon(itemId,averageHash(gray),blob);
 }catch{/* icons are optional; prices still count */}
}

// Drawn at the window's own resolution (as the store preview) so it stays sharp when the page scales it.
// Green: shared. Orange: waiting for a second matching read. Grey: sold. Purple: uncertain, not shared.
function drawOverlay(video,listings,shared){
 const cv=$('scan-canvas'),w=video.width,h=video.height,u=Math.max(1,w/720);
 cv.width=w;cv.height=h;cv.hidden=false;$('scan-empty').hidden=true;
 const g=cv.getContext('2d');g.drawImage(video,0,0);g.lineWidth=2*u;g.font=`bold ${Math.round(11*u)}px Nunito, Arial, sans-serif`;
 for(const l of listings){const colour=l.state==='uncertain'?'#7a4fb5':l.state==='sold'?'#6b7280':shared.has(listingKey(l))?'#2e8049':'#e8a12d';
  g.strokeStyle=colour;g.strokeRect(l.box.x-2*u,l.box.y-2*u,l.box.w+4*u,l.box.h+4*u);
  const label=(l.state==='sold'?'SOLD · ':l.state==='uncertain'?'Uncertain · ':'')+fmt(l.price)+(Object.keys(l.stats).length?' · '+Object.entries(l.stats).map(([a,b])=>a+' '+b).join(' '):'');
  const tw=g.measureText(label).width+8*u;g.fillStyle=colour;g.fillRect(l.box.x+l.box.w+6*u,l.box.y,tw,15*u);g.fillStyle='#fff';g.fillText(label,l.box.x+l.box.w+10*u,l.box.y+11*u);}
}

// "Work Gloves — 450,000,000 mesos — SOLD", with the item picture, the mesos icon and where to find it.
function renderFeed(){
 const list=$('scan-feed');list.replaceChildren();
 $('scan-feed-empty').hidden=st.feed.length>0;
 for(const f of st.feed){const li=document.createElement('li');li.title=f.id;li.classList.toggle('sold',!!f.sold);
  if(f.observationId){const report=document.createElement('a');report.href='#reports';report.textContent='Report #'+f.observationId;li.append(report);}
  const a=Object.assign(document.createElement('a'),{href:'#item/'+f.itemId,className:'item-link'});a.append(iconEl(f.catalogItem||{name:f.item},24),document.createTextNode(f.item));
  li.append(a,mesoAmt(f.price!=null?fmt(f.price):'—'));
  if(f.sold)li.append(Object.assign(document.createElement('span'),{className:'fm-badge sold',textContent:'SOLD'}));
  li.append(Object.assign(document.createElement('small'),{textContent:[f.qty>1?'×'+f.qty:'',Object.entries(f.stats||{}).map(([k,v])=>k+' '+v).join(' '),f.shop,f.where,f.time.toLocaleTimeString()].filter(Boolean).join(' · ')}));
  list.append(li);}
}

function schedule(){clearTimeout(st.timer);if(st.on)st.timer=setTimeout(async()=>{await scanOnce();schedule();},Number($('scan-interval').value)*1000);}
function setOn(on){cap()?.claim?.('scanner',on);scanRun++;st.pending=null;st.waiting=0;st.verifiedChannel=null;st.on=on;st.last=[];st.prevThumb=null;controls();if(on){channelPromptShown=false;scanStatus();scanOnce().then(schedule);}else{clearTimeout(st.timer);channelDialog.close();status('Scanning stopped.');}}

$('scan-connect').onclick=async()=>{if(!cap())return status('The page is still loading. Try again in a moment.','error');const button=$('scan-connect');button.disabled=true;
 try{const error=await cap().connect();if(error)status(error,'error');}
 finally{button.disabled=false;controls();}};
$('scan-toggle').onclick=()=>setOn(!st.on);
$('scan-consent').onchange=()=>{try{localStorage.setItem('mw-scan-consent',$('scan-consent').checked?'1':'');}catch{}if(!$('scan-consent').checked&&st.on)setOn(false);controls();};
// Manual corrections. Typing a room clears the map name and the other way round; emptying both returns to detection.
$('scan-channel').addEventListener('input',()=>{st.manual.channel=$('scan-channel').value!=='';if(!st.manual.channel)$('scan-channel').value=st.chan.channel||'';st.settled=false;if(st.on&&(!currentLocation().channel||$('scan-status').textContent===channelPrompt))scanStatus();dashboard();});
$('scan-room').addEventListener('input',()=>{if($('scan-room').value)$('scan-map').value='';st.manual.place=!!($('scan-room').value||$('scan-map').value);if(!st.manual.place)fillPlace();st.settled=false;dashboard();});
$('scan-map').addEventListener('input',()=>{if($('scan-map').value)$('scan-room').value='';st.manual.place=!!($('scan-room').value||$('scan-map').value);if(!st.manual.place)fillPlace();st.settled=false;dashboard();});
$('scan-use-detected').onclick=()=>{st.manual={channel:false,place:false};$('scan-channel').value=st.chan.channel||'';fillPlace();st.settled=false;dashboard();};
$('world').addEventListener('change',()=>{st.settled=false;dashboard();});
$('scan-interval').onchange=()=>{try{localStorage.setItem('mw-scan-interval',$('scan-interval').value);}catch{}schedule();};
try{$('scan-consent').checked=localStorage.getItem('mw-scan-consent')==='1';const iv=localStorage.getItem('mw-scan-interval');if(iv&&[...$('scan-interval').options].some(o=>o.value===iv))$('scan-interval').value=iv;}catch{}
window.addEventListener('mesoswatch:capture-started',()=>{controls();status($('scan-consent').checked?'Window shared. Press Start scanning when you are in the Free Market.':'Window shared. Tick the sharing agreement, then press Start scanning.');});
window.addEventListener('mesoswatch:capture-ended',()=>{if(st.on)setOn(false);status('Window sharing ended. Share your game window again to keep scanning.','error');$('scan-canvas').hidden=true;$('scan-empty').hidden=false;controls();});
window.addEventListener('mesoswatch:capture-ready',controls);
if(!configured())status('The community database is not connected yet, so scans will be read but not shared. The site owner sets it up in config.js.','warn');
controls();stats();renderFeed();dashboard();
