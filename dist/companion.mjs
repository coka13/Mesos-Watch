// Companion: live training tracker. The shared game window is read in this browser, a strip at a time, and nothing here is uploaded.
// Screen reading only: no clicks, no keyboard input, no game memory. companion-core.mjs holds the rules for what counts.
import {findStatusBar,readBar,identityAreas,levelPixels,readScale,parseLevel,closestJob,cleanCharacterName} from './hud.mjs?v=1';
import * as core from './companion-core.mjs?v=1';
import {closestMap,createQuestLog,observeMap,routeView,ROUTES,WIKI} from './companion-quests.mjs?v=1';
import * as fm from './fm-location.mjs?v=depth-1';
import {ocrImage} from './ocr-prep.mjs?v=prep-2';
import {expChartSvg} from './chart.mjs?v=exp-1';
import {configured,rankings,publishCharacter,unpublishCharacter} from './api.mjs?v=depth-1';
import {ago} from './checker.mjs?v=depth-1';
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=Object.assign(document.createElement(tag),props);e.append(...kids.filter(k=>k!=null&&k!==false));return e;};
const fmt=n=>n==null?'—':Number(n).toLocaleString('en-US');
const cap=()=>window.mesosCapture;
const dur=core.formatDuration,clock=t=>new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const SESSIONS='mw-companion-sessions',LIVE='mw-companion-live',QUESTS='mw-companion-quests',KEEP_SESSIONS=30,KEEP_READINGS=5;
const READ_EVERY=1000,PLACE_EVERY=3000,SAVE_EVERY=15000,STRIP_FROM=.7,RELOCATE_AFTER=6,MISS_WARNING=12,WHO_RETRY=20000,WHO_TRIES=4;
const load=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const store=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}};
const validSession=s=>!!s&&Number.isFinite(s.startedAt)&&Array.isArray(s.minutes)&&Array.isArray(s.segments)&&Array.isArray(s.readings);
const savedSessions=()=>{const list=load(SESSIONS,[]);return Array.isArray(list)?list.filter(validSession):[];};
function savedQuests(){const q=load(QUESTS,null);return q&&typeof q.records==='object'&&q.records&&Array.isArray(q.recent)?q:null;}
const st={enabled:false,session:null,history:savedSessions(),log:createQuestLog(savedQuests()),data:null,bar:null,last:null,outcome:null,misses:0,blind:0,stop:null,busy:false,chart:null,savedAt:0,pip:null,
 place:{status:'unknown',map:null,thumb:null,at:0,busy:false},who:{need:true,busy:false,at:0,tries:0,names:[]},saveFailed:false};

// A session left running when the page closed goes into the history.
{const live=load(LIVE,null);if(validSession(live)){core.end(live,live.lastSeen??live.startedAt);if(live.gained>0||live.readingsCount>1)st.history=[live,...st.history].slice(0,KEEP_SESSIONS);store(SESSIONS,st.history);}try{localStorage.removeItem(LIVE);}catch{}}

// ---- Frames ----
const scratch=document.createElement('canvas'),sg=scratch.getContext('2d',{willReadFrequently:true});
function grab(video,x,y,w,h){if(scratch.width!==w)scratch.width=w;if(scratch.height!==h)scratch.height=h;sg.drawImage(video,x,y,w,h,0,0,w,h);return sg.getImageData(0,0,w,h);}
const slice=(px,r)=>{const data=new Uint8ClampedArray(r.w*r.h*4);for(let y=0;y<r.h;y++)data.set(px.data.subarray(((r.y+y)*px.width+r.x)*4,((r.y+y)*px.width+r.x+r.w)*4),y*r.w*4);return{data,width:r.w,height:r.h};};
const toCanvas=({data,width,height})=>{const c=document.createElement('canvas');c.width=width;c.height=height;c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data),width,height),0,0);return c;};
async function ocr(w,pixels,options,psm,chars=''){await w.setParameters({tessedit_pageseg_mode:psm,tessedit_char_whitelist:chars});return(await w.recognize(toCanvas(ocrImage(pixels,options)))).data;}
// Timers in a hidden page are slowed to a crawl; a worker's are not, so tracking carries on behind the game.
function ticker(ms,fn){
 try{const url=URL.createObjectURL(new Blob([`setInterval(()=>postMessage(0),${ms})`],{type:'text/javascript'})),w=new Worker(url);URL.revokeObjectURL(url);w.onmessage=fn;return()=>w.terminate();}
 catch{const t=setInterval(fn,ms);return()=>clearInterval(t);}
}

// ---- Reading ----
async function tick(){
 const video=cap()?.video;
 if(st.busy||!cap()?.stream||!video?.videoWidth||!st.session)return;
 st.busy=true;
 try{
  const W=video.videoWidth,H=video.videoHeight,top=Math.floor(H*STRIP_FROM),strip=grab(video,0,top,W,H-top),now=Date.now();
  if(!st.bar){st.bar=findStatusBar(strip,0);st.blind=st.bar?0:st.blind+1;}
  if(st.bar){
   const r=readBar(strip,st.bar);st.last=r;
   // Unreadable for a while: the bar may have moved with a resized window, so it is looked for again.
   if(r.exp===null){if(++st.misses%RELOCATE_AFTER===0){const again=findStatusBar(strip,0);if(again)st.bar=again;}}else st.misses=0;
   const res=core.observe(st.session,r,now);st.outcome=res.outcome;
   if(res.outcome==='level-up'){st.who.need=true;st.who.tries=0;st.who.at=0;}
  }
  readWho(strip,now);readPlace(video,now);
  if(now-st.savedAt>SAVE_EVERY){st.savedAt=now;saveLive(now);}
  render(now);
 }catch(e){status('Reading problem: '+e.message+' Tracking continues.','error');}
 finally{st.busy=false;}
}
// Level, job and name change rarely and need OCR: at the start and after a level-up, a few tries with pauses between, so that a name
// the OCR cannot make out never keeps the shared OCR engine busy. Each is read with several preparations of its small text.
function readWho(strip,now){
 const who=st.who;if(!who.need||who.busy||!st.bar||now<who.at)return;
 who.busy=true;who.tries++;who.at=now+WHO_RETRY;const areas=identityAreas(st.bar,strip.width,strip.height),s=st.session;
 const passes=r=>[{scale:readScale(r,48),binarize:true},{scale:readScale(r,48)},{scale:readScale(r,64),binarize:true}];
 cap().withOCR(async w=>{
  const level=parseLevel((await ocr(w,levelPixels(strip,areas.level),{scale:readScale(areas.level,60),binarize:true},'7','0123456789')).text);
  if(level)core.identify(s,{level});
  if(!s.job)for(const o of passes(areas.job)){const job=closestJob((await ocr(w,slice(strip,areas.job),o,'7')).text,st.data?.jobs||[]);if(job){core.identify(s,{job});break;}}
  if(!s.name)for(const o of passes(areas.name)){
   const d=await ocr(w,slice(strip,areas.name),o,'7'),name=d.confidence>=60?cleanCharacterName(d.text):null;
   // A name counts when two reads agree: the small font misreads letters one time in several.
   if(name)who.names.push(name);
   const agreed=who.names.find((n,i)=>who.names.indexOf(n)!==i);if(agreed){core.identify(s,{name:agreed});break;}
  }
  who.need=(!s.level||!s.job||!s.name)&&who.tries<WHO_TRIES;
 }).catch(()=>{}).finally(()=>{who.busy=false;});
}
// The map name, re-read only when the minimap's title changes on screen.
// One changed digit ("Step 1" to "Step 2") must count as a change, so each cell of the title is averaged and the largest cell
// difference decides: an average over the whole line would not notice it.
const TITLE_CELLS=[64,8],TITLE_CHANGE=6;
function titleThumb(px,r){
 const [cols,rows]=TITLE_CELLS,out=new Float32Array(cols*rows),n=new Uint32Array(cols*rows);
 for(let y=0;y<r.h;y++)for(let x=0;x<r.w;x++){const p=((r.y+y)*px.width+r.x+x)*4,c=Math.min(rows-1,Math.floor(y*rows/r.h))*cols+Math.min(cols-1,Math.floor(x*cols/r.w));out[c]+=(px.data[p]+px.data[p+1]+px.data[p+2])/3;n[c]++;}
 for(let i=0;i<out.length;i++)out[i]/=n[i]||1;
 return out;
}
const similar=(a,b)=>{if(!a||a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>TITLE_CHANGE)return false;return true;};
function readPlace(video,now){
 const p=st.place;if(p.busy||now-p.at<PLACE_EVERY||!st.data)return;p.at=now;
 const corner=fm.roomCorner(video.videoWidth,video.videoHeight),px=grab(video,0,0,corner.w,corner.h),found=fm.roomLine(px,{x:0,y:0,w:corner.w,h:corner.h});
 if(!found){p.status='hidden';p.thumb=null;return;}
 const thumb=titleThumb(px,found.crop);if(similar(p.thumb,thumb)&&p.status==='known')return;
 p.busy=true;
 cap().withOCR(async w=>{
  const crop=slice(px,found.crop),rooms=[];for(const o of fm.roomLineReads(found.h))rooms.push((await ocr(w,crop,o,'7',fm.ROOM_CHARS)).text);
  const room=fm.agreedRoom(rooms);if(room)return`Free Market <${room}>`;
  const votes=new Map();
  for(const o of fm.MAP_NAME_READS){const m=closestMap((await ocr(w,crop,{...o,scale:Math.max(1,Math.round(o.scale*9.5/found.h))},'7')).text,st.data.maps);if(m)votes.set(m.name,(votes.get(m.name)||0)+1);}
  return[...votes].find(([,n])=>n>=2)?.[0]??null;
 }).then(name=>{
  p.thumb=thumb;if(!name){p.status='unclear';return;}
  p.status='known';if(name===p.map?.name)return;
  p.map=st.data.maps.find(m=>m.name===name)||null;enterMap(name,video);
 }).catch(()=>{p.status='unclear';}).finally(()=>{p.busy=false;});
}
function enterMap(name,video){
 const now=Date.now();if(st.session)core.setMap(st.session,name,now);
 observeMap(st.log,name,now);store(QUESTS,{records:st.log.records,recent:st.log.recent});
 drawMinimap(video);renderPlace();renderQuest(now);if(document.body.dataset.view==='companion')renderTables(now);
}
function drawMinimap(video){
 const W=video.videoWidth,H=video.videoHeight,place=fm.storeMinimap(grab(video,0,0,W,H)),canvas=$('cp-minimap');
 if(!place){canvas.hidden=true;return;}
 const {map,marker}=place;canvas.width=map.w;canvas.height=map.h;canvas.hidden=false;
 const g=canvas.getContext('2d');g.drawImage(video,map.x,map.y,map.w,map.h,0,0,map.w,map.h);
 if(marker){g.strokeStyle='#ffe34c';g.lineWidth=2;g.beginPath();g.arc(marker.x,marker.y,8,0,Math.PI*2);g.stroke();}
}

// ---- Controls ----
function status(text,kind=''){const s=$('cp-status');if(s.textContent!==text)s.textContent=text;s.className='status'+(kind?' '+kind:'');}
function saveLive(now){if(st.session){st.saveFailed=!store(LIVE,{...core.archive(st.session),lastSeen:now});}}
function archive(now){
 const s=st.session;if(!s)return;core.end(s,now);st.session=null;
 if(s.gained>0||s.readingsCount>1){st.history=[core.archive(s),...st.history].slice(0,KEEP_SESSIONS).map((h,i)=>i<KEEP_READINGS?h:{...h,readings:[]});st.saveFailed=!store(SESSIONS,st.history);}
 try{localStorage.removeItem(LIVE);}catch{}
}
function begin(now){st.session=core.createSession(crypto.randomUUID(),now);st.who={need:true,busy:false,at:0,tries:0,names:[]};st.misses=0;if(st.place.map)core.setMap(st.session,st.place.map.name,now);}
function startTicker(){if(!st.stop)st.stop=ticker(READ_EVERY,tick);}
function stopTicker(){st.stop?.();st.stop=null;}
function controls(){
 const stream=!!cap()?.stream,s=st.session,paused=s?.status==='paused';
 $('cp-connect').hidden=stream&&st.enabled;$('cp-connect').textContent=!stream?(st.enabled?'▣   Share again':'▣   Share MapleStory window'):'▶   Start tracking';
 $('cp-pause').disabled=!s||!stream;$('cp-pause').textContent=paused?'▶ Resume':'❚❚ Pause';
 $('cp-new').disabled=!s;$('cp-stop').disabled=!s;
 const badge=$('cp-badge');badge.classList.toggle('live',!!s&&!paused&&stream);badge.lastChild.textContent=!stream?' Not sharing':!s?' Window shared':paused?' Paused':' Tracking';
 if(st.pip)renderPip();
}
const showError=e=>status(e,'error');
$('cp-connect').onclick=async()=>{
 const button=$('cp-connect');button.disabled=true;
 try{
  if(!cap())return showError('The page is still loading. Try again in a moment.');
  if(!cap().stream){const error=await cap().connect(true);if(error)return showError(error);}
  if(!cap().stream)return;
  await ready();st.enabled=true;st.bar=null;st.blind=0;
  const now=Date.now();
  if(st.session?.status==='paused')core.resume(st.session,now);else if(!st.session)begin(now);
  startTicker();status('Tracking. Play as usual: this page reads your status bar once a second.','ok');
 }catch(e){showError(e.message);
 }finally{button.disabled=false;controls();render(Date.now());}
};
$('cp-pause').onclick=()=>{
 const s=st.session,now=Date.now();if(!s)return;
 if(s.status==='paused'){core.resume(s,now);status('Tracking again. What changed during the pause is not counted.','ok');}
 else{core.pause(s,now);status('Paused. Time, EXP and recoveries are not counted until you resume.','warn');}
 controls();render(now);
};
$('cp-new').onclick=()=>{const now=Date.now();archive(now);if(cap()?.stream&&st.enabled)begin(now);status('New session started. The last one is in Sessions below.','ok');controls();render(now);};
// Stop ends the session and, unless the scanner or Store Watcher is using the window, ends the sharing too.
$('cp-stop').onclick=()=>{
 const now=Date.now();archive(now);stopTicker();st.enabled=false;st.bar=null;st.last=null;
 const released=cap()?.release?.();
 status(released?'Stopped. Sharing has ended and your session is saved below.':'Stopped. Your session is saved below. The window stays shared for the tool still using it.');
 controls();render(now);
};
window.addEventListener('mesoswatch:capture-ended',()=>{
 const now=Date.now();if(st.session?.status==='running')core.pause(st.session,now);
 st.bar=null;st.last=null;stopTicker();if(st.session)saveLive(now);
 if(st.enabled){status('Sharing stopped. Your history is saved: share your game window again to carry on.','warn');}
 controls();render(now);
});
window.addEventListener('mesoswatch:capture-started',controls);
window.addEventListener('mesoswatch:capture-ready',controls);
cap()?.video?.addEventListener('resize',()=>{st.bar=null;st.place.thumb=null;});
window.addEventListener('pagehide',()=>{stopTicker();if(st.session)saveLive(Date.now());});

// ---- Display ----
const set=(id,text)=>{const e=$(id);if(e.textContent!==text)e.textContent=text;};
function render(now){
 const s=st.session,f=s?core.stats(s,now):null;
 set('cp-level',s?.level?String(s.level):'—');set('cp-job',[s?.job,s?.name].filter(Boolean).join(' · '));
 set('cp-exp',s?.exp!=null?fmt(s.exp):'—');set('cp-pct',s?.pct!=null?s.pct.toFixed(2)+'%':'');
 const left=f?.left!=null?fmt(Math.round(f.left))+' EXP to go':'';
 set('cp-tolevel',f?.toLevel!=null?dur(f.toLevel):'—');set('cp-left',left);
 set('cp-last',f?.lastMinute!=null?fmt(Math.round(f.lastMinute)):'—');set('cp-avg',f?.average!=null?fmt(Math.round(f.average)):'—');set('cp-best',f?.best!=null?fmt(f.best):'—');
 set('cp-gained',s?fmt(s.gained)+' EXP gained · '+dur(f.active)+(s.levelUps?` · ${s.levelUps} level${s.levelUps===1?'':'s'} up`:'')+(s.lost?` · ${fmt(s.lost)} lost`:''):'');
 const pct=s?.pct??st.last?.fill*100,fill=$('cp-bar');fill.style.width=Math.max(0,Math.min(100,pct||0))+'%';fill.parentElement.setAttribute('aria-valuenow',String(Math.round(pct||0)));
 renderHelp(now);
 if(st.pip)renderPip(now);
 if(document.body.dataset.view!=='companion')return;
 renderChart(now);renderTables(now);renderQuest(now);renderPlace();renderDebug();rkControls();
}
function renderChart(now){
 const list=st.session||st.history[0],box=$('cp-chart');
 if(!list){box.innerHTML=expChartSvg([],{width:Math.max(320,box.clientWidth||720)});return;}
 const live=!!st.session,range=st.chart??(live?'map':'all');
 const at=live?now:list.endedAt,width=Math.max(320,box.clientWidth||720),key=[list.startedAt,range,list.segments.length,Math.floor(core.activeMs(list,at)/2e4),list.gained,width].join('|');
 if(box.dataset.key===key)return;box.dataset.key=key;
 for(const button of document.querySelectorAll('#cp-ranges button'))button.classList.toggle('active',button.dataset.range===String(range));
 box.innerHTML=expChartSvg(core.series(list,at,range==='map'&&!list.segments.length?'all':range),{width,height:200});
}
const cells=(...values)=>values.map(v=>el('td',typeof v==='object'&&v?{className:v.className||'',textContent:v.text,title:v.title||''}:{textContent:v}));
const num=(text,title)=>({className:'num',text,title});
function renderTables(now){
 const live=st.session,shown=live||st.history[0],at=live?now:shown?.endedAt;
 const segs=shown?[...shown.segments].reverse().map(g=>core.segmentRow(shown,g,at)):[];
 $('cp-history').replaceChildren(...segs.map(r=>el('tr',{},...cells(r.map,clock(r.arrivedAt),num(dur(r.ms)),num(fmt(r.gained)),num(fmt(r.average===null?null:Math.round(r.average))),num(fmt(r.peak)),num(String(r.recoveries),'Inferred from HP or MP jumping up: potions and healing skills look the same')))));
 $('cp-history-empty').hidden=segs.length>0;
 const rows=[...(live?[core.sessionRow(live,now)]:[]),...st.history.map(h=>core.sessionRow(h,h.endedAt))];
 $('cp-sessions').replaceChildren(...rows.map(r=>el('tr',{},...cells(new Date(r.startedAt).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}),num(dur(r.ms)),num(fmt(r.gained)),num(fmt(r.perMin===null?null:Math.round(r.perMin))),num(r.pctPerMin===null?'—':r.pctPerMin.toFixed(2)+'%'),num(fmt(r.readings))))));
 $('cp-sessions-empty').hidden=rows.length>0;
 const reads=[...(shown?.readings||[])].reverse().slice(0,40);
 $('cp-readings').replaceChildren(...reads.map(r=>el('tr',{},...cells(new Date(r.t).toLocaleTimeString(),r.level??'—',num(fmt(r.exp)),num(r.kind==='level'?'+'+fmt(r.change)+' ▲ level':r.kind==='loss'?fmt(r.change):r.kind==='gain'?'+'+fmt(r.change):'—'),num(r.pct!=null?r.pct.toFixed(2)+'%':'—'),r.map||'—'))));
 $('cp-readings-empty').hidden=reads.length>0;
}
function renderPlace(){
 const p=st.place,m=p.map,note={unknown:'Map not read yet',hidden:'Minimap title not visible',unclear:'Map name unclear'}[p.status];
 set('cp-map',m?.name??(note||'—'));set('cp-street',m?[m.street,m.region==='Other'?'':m.region].filter(Boolean).join(' · '):'');
 const mob=new Map((st.data?.monsters||[]).map(x=>[x.id,x])),rows=(m?.mobs||[]).map(([id,n])=>({...mob.get(id),n})).filter(x=>x.name).sort((a,b)=>a.level-b.level);
 const sig=m?.id+':'+rows.length;if($('cp-monsters').dataset.sig===sig)return;$('cp-monsters').dataset.sig=sig;
 $('cp-monsters').replaceChildren(...rows.map(x=>{const icon=x.icon?el('img',{src:x.icon,alt:'',width:24,height:24,loading:'lazy',decoding:'async'}):null;if(icon)icon.onerror=()=>icon.remove();return el('tr',{},el('td',{className:'cp-mob'},icon,el('span',{textContent:x.name+(x.boss?' ★':'')})),...cells(num(String(x.level)),num(fmt(x.hp)),num(fmt(x.exp)),num('×'+x.n)));}));
 $('cp-monsters-empty').hidden=rows.length>0;$('cp-monsters-empty').textContent=m?'No monsters listed for this map.':'Shown when your map is read.';
}
function renderQuest(now){
 const box=$('cp-quest');if(!st.data)return;
 const v=routeView(st.log,st.data,now);
 if(!v){
  const pq=ROUTES.filter(r=>r.type==='PQ'),jq=ROUTES.filter(r=>r.type==='JQ'),done=r=>{const rec=st.log.records[r.id];return rec?` · ${rec.finished}/${rec.attempts} finished${rec.bestMs?' · best '+dur(rec.bestMs):''}`:'';};
  const sig='idle'+JSON.stringify(st.log.records);if(box.dataset.sig===sig)return;box.dataset.sig=sig;
  box.replaceChildren(el('p',{className:'hint',textContent:'Walk into a party quest or a jump quest and its stages appear here, followed from your map name.'}),
   ...[['Party quest',pq],['Jump quests',jq]].map(([title,list])=>el('details',{className:'cp-routes'},el('summary',{textContent:`${title} (${list.length})`}),el('ul',{},...list.map(r=>el('li',{textContent:r.name+done(r)}))))));
  return;
 }
 const {route,quest,stages}=v;box.dataset.sig='';
 box.replaceChildren(
  el('div',{className:'cp-quest-head'},el('b',{textContent:route.name}),el('span',{className:'fm-badge',textContent:route.type})),
  el('p',{className:'hint',textContent:[route.goal,route.party,quest?.level?'Level '+quest.level+'+':'',route.start].filter(Boolean).join(' ')}),
  el('div',{className:'cp-quest-time'},el('strong',{textContent:`${v.index+1} / ${v.total}`}),el('span',{textContent:dur(v.elapsed)+(v.falls?` · ${v.falls} fall${v.falls===1?'':'s'}`:'')+(v.record?.bestMs?' · best '+dur(v.record.bestMs):'')})),
  el('ol',{className:'cp-stages'},...stages.map(g=>el('li',{className:g.state,ariaCurrent:g.state==='current'?'step':null},el('b',{textContent:g.label}),(g.monsters.length||g.people.length)&&el('small',{textContent:[...g.people,...g.monsters].join(' · ')})))),
  quest&&el('p',{className:'hint',textContent:`Quest: ${quest.name.replace(/^\[.*?\]\s*/,'')} · reward ${fmt(quest.exp)} EXP, ${fmt(quest.mesos)} mesos`}),
  route.guide&&el('a',{className:'head-link',href:WIKI+route.guide,target:'_blank',rel:'noopener',textContent:'Stage guide on the Classic wiki ↗'}));
}
function renderDebug(){
 const r=st.last;
 set('cp-d-exp',r?.exp!=null?`${fmt(r.exp)} · ${r.pct}%`:'unreadable');set('cp-d-raw',r?.raw.exp||'—');set('cp-d-fill',r?(r.fill*100).toFixed(1)+'%':'—');
 set('cp-d-hp',r?.hp!=null?`${r.hp}/${r.hpMax}`:'—');set('cp-d-mp',r?.mp!=null?`${r.mp}/${r.mpMax}`:'—');set('cp-d-match',r?Math.round(r.match*100)+'%':'—');
 set('cp-d-outcome',st.outcome||'—');set('cp-d-misreads',String(st.session?.misreads??0));set('cp-d-source',cap()?.video?.videoWidth?cap().video.videoWidth+'×'+cap().video.videoHeight:'—');
}
// What is wrong right now, in the player's terms, with the fix. Only conditions actually measured here appear.
function troubles(){
 const out=[],stream=!!cap()?.stream,video=cap()?.video;
 if(!stream||!st.session)return out;
 if(st.session.status==='paused')return out;
 if(video?.videoWidth&&video.videoWidth<800)out.push(['Game window too small','Share the game window at its normal size. Below about 800 pixels wide the numbers cannot be read.']);
 if(!st.bar&&st.blind>=4)out.push(['Status bar not found','Share the game itself, not another window, and keep the bottom bar uncovered. If the colours look washed out, turn off HDR in Windows display settings: reading resumes by itself.']);
 else if(st.bar&&st.bar.gaugeH<9)out.push(['Numbers are very small','Make the game window bigger, or set the UI size to Ideal Ratio in the game’s graphics options.']);
 if(st.bar&&st.misses>=MISS_WARNING)out.push(['EXP numbers unclear','Blurry numbers usually mean the UI size is between two sizes: set it to Ideal Ratio in the game’s graphics options. Your session keeps counting once they read clearly.']);
 if(st.place.status==='hidden')out.push(['Map name hidden','Open the minimap fully (its + button) and keep it in the top-left corner. Clear anything covering its title, such as an FPS counter or a server notice.']);
 else if(st.place.status==='unclear')out.push(['Map name unclear','Keep the minimap title uncovered and still for a moment.']);
 if(st.saveFailed)out.push(['Sessions are not being saved','This browser refused to store them, so they will be lost when the page closes.']);
 return out;
}
function renderHelp(){
 const list=troubles(),sig=list.map(t=>t[0]).join('|'),box=$('cp-help');
 if(box.dataset.sig===sig&&box.childElementCount)return;box.dataset.sig=sig;
 box.replaceChildren(...(list.length?list.map(([title,fix])=>el('li',{className:'warn'},el('b',{textContent:title}),el('span',{textContent:fix}))):[el('li',{className:'ok',textContent:st.session&&cap()?.stream?'Everything is reading normally.':'Nothing to fix yet. Problems show up here with what to do.'})]));
}
for(const b of document.querySelectorAll('#cp-ranges button'))b.onclick=()=>{st.chart=b.dataset.range==='map'||b.dataset.range==='all'?b.dataset.range:+b.dataset.range;for(const o of document.querySelectorAll('#cp-ranges button'))o.classList.toggle('active',o===b);$('cp-chart').dataset.key='';render(Date.now());};
// A full frame, saved only to this computer: for bug reports, and to teach the reader new captures.
$('cp-save-frame').onclick=()=>{
 const video=cap()?.video;if(!video?.videoWidth)return set('cp-save-note','Share your game window first.');
 const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;c.getContext('2d').drawImage(video,0,0);
 c.toBlob(blob=>{const a=el('a',{href:URL.createObjectURL(blob),download:'mesos-watch-frame-'+new Date().toISOString().replace(/[:.]/g,'-')+'.png'});a.click();URL.revokeObjectURL(a.href);set('cp-save-note','Frame saved to your downloads. It is not uploaded anywhere.');},'image/png');
};

// ---- Pop out: a small always-on-top window, where the browser offers one ----
const canPop=()=>'documentPictureInPicture' in window;
function renderPip(now=Date.now()){
 const d=st.pip?.document;if(!d)return;
 const s=st.session,f=s?core.stats(s,now):null,put=(id,t)=>{const e=d.getElementById(id);if(e&&e.textContent!==t)e.textContent=t;};
 put('p-level',s?.level?'Lv. '+s.level:'Lv. —');put('p-pct',s?.pct!=null?s.pct.toFixed(2)+'%':'—');put('p-rate',f?.average!=null?fmt(Math.round(f.average))+' EXP/min':'— EXP/min');put('p-to',f?.toLevel!=null?dur(f.toLevel)+' to level':'— to level');
 put('p-gain',s?fmt(s.gained)+' EXP · '+dur(f.active):'No session');
 const bar=d.getElementById('p-bar');if(bar)bar.style.width=Math.max(0,Math.min(100,s?.pct||0))+'%';
 const pause=d.getElementById('p-pause');if(pause){pause.textContent=s?.status==='paused'?'▶ Resume':'❚❚ Pause';pause.disabled=!s;}
 const stop=d.getElementById('p-stop');if(stop)stop.disabled=!s;
}
$('cp-popout').hidden=!canPop();
$('cp-popout').onclick=async()=>{
 if(st.pip){st.pip.close();return;}
 try{
  const pip=await window.documentPictureInPicture.requestWindow({width:320,height:176});
  for(const sheet of document.querySelectorAll('link[rel="stylesheet"]'))pip.document.head.append(sheet.cloneNode());
  pip.document.documentElement.dataset.theme=document.documentElement.dataset.theme;
  pip.document.body.className='cp-pip';
  pip.document.body.innerHTML='<div class="cp-pip-top"><b id="p-level"></b><span id="p-pct"></span></div><div class="cp-meter"><i id="p-bar"></i></div><div id="p-rate" class="cp-pip-rate"></div><div id="p-to"></div><small id="p-gain"></small><div class="cp-pip-actions"><button id="p-pause"></button><button id="p-stop">■ Stop</button></div>';
  pip.document.getElementById('p-pause').onclick=()=>$('cp-pause').click();
  pip.document.getElementById('p-stop').onclick=()=>$('cp-stop').click();
  st.pip=pip;$('cp-popout').textContent='Close pop-out';
  pip.addEventListener('pagehide',()=>{st.pip=null;$('cp-popout').textContent='⧉ Pop out';});
  renderPip();
 }catch(e){status(e.name==='NotAllowedError'?'The browser needs a click to open the pop-out. Try again.':'The pop-out could not open: '+e.message,'error');}
};

// ---- Rankings: what players chose to publish about their own character ----
let rkPage=0,rkRequest=0;
const rkWorld=()=>$('world').value||'';
async function loadRankings(){
 const request=++rkRequest,body=$('rk-rows');
 if(!configured()){body.replaceChildren();$('rk-empty').hidden=false;$('rk-empty').textContent='Rankings appear once the community database is connected.';$('rk-next').disabled=$('rk-prev').disabled=true;return;}
 try{
  const out=await rankings(rkWorld(),{job:$('rk-job').value,page:rkPage});if(request!==rkRequest)return;
  if(out===null){$('rk-empty').hidden=false;$('rk-empty').textContent='Rankings appear once the site’s database is updated.';return;}
  body.replaceChildren(...out.rows.map((r,i)=>el('tr',{},el('td',{className:'num',textContent:String(rkPage*50+i+1)}),el('td',{textContent:r.name}),el('td',{textContent:r.job}),el('td',{className:'num',textContent:String(r.level)}),el('td',{className:'when',textContent:ago(r.last_seen),title:new Date(r.last_seen).toLocaleString()}))));
  $('rk-empty').hidden=out.rows.length>0;$('rk-empty').textContent='Nobody has published a character here yet.';
  $('rk-prev').disabled=rkPage===0;$('rk-next').disabled=!out.more;
 }catch(e){if(request===rkRequest){body.replaceChildren();$('rk-empty').hidden=false;$('rk-empty').textContent=e.message;}}
}
function fillJobs(){const box=$('rk-job');if(box.options.length>1||!st.data)return;box.append(...st.data.jobs.map(j=>new Option(j,j)));}
const rkName=()=>$('rk-name').value.trim();
function rkControls(){
 const s=st.session,name=/^[A-Za-z0-9]{2,12}$/.test(rkName());
 $('rk-publish').disabled=!(name&&s?.level&&s?.job&&configured());$('rk-remove').disabled=!(name&&configured());
 if(s?.name&&!$('rk-name').value)$('rk-name').value=s.name;
 const need=!s?'Start tracking first, so your level and job can be read.':!s.level||!s.job?'Waiting to read your level and job from the status bar.':'';
 if(need&&!$('rk-note').dataset.done)set('rk-note',need);else if(!need&&!$('rk-note').dataset.done)set('rk-note','');
}
$('rk-name').addEventListener('input',rkControls);
$('rk-job').onchange=()=>{rkPage=0;loadRankings();};
$('rk-prev').onclick=()=>{rkPage=Math.max(0,rkPage-1);loadRankings();};
$('rk-next').onclick=()=>{rkPage++;loadRankings();};
$('rk-publish').onclick=async()=>{
 const s=st.session;if(!s?.level||!s.job)return;
 try{await publishCharacter({world:rkWorld(),name:rkName(),job:s.job,level:s.level});$('rk-note').dataset.done='1';set('rk-note',`${rkName()} is on the rankings at level ${s.level}.`);rkPage=0;await loadRankings();}
 catch(e){$('rk-note').dataset.done='1';set('rk-note',e.message);}
};
$('rk-remove').onclick=async()=>{
 try{const gone=await unpublishCharacter({world:rkWorld(),name:rkName()});$('rk-note').dataset.done='1';set('rk-note',gone?`${rkName()} was removed from the rankings.`:'That character is not one you published.');await loadRankings();}
 catch(e){$('rk-note').dataset.done='1';set('rk-note',e.message);}
};
window.addEventListener('mesoswatch:world',()=>{rkPage=0;if(document.body.dataset.view==='companion')loadRankings();});

// ---- Page ----
async function ready(){
 if(st.data)return st.data;
 const r=await fetch('classic-data.json?v=2026-10-29');if(!r.ok)throw Error('Could not load the map list.');
 st.data=await r.json();const s=st.data.source;
 $('cp-credit').replaceChildren('Maps, monsters and quests: ',el('a',{href:s.url,target:'_blank',rel:'noopener',textContent:s.name}),' (',el('a',{href:s.licenseUrl,target:'_blank',rel:'noopener',textContent:s.license}),`), ${s.changes} Data of ${new Date(s.updatedAt).toLocaleDateString()}. Game content © Nexon.`);
 return st.data;
}
function browserNote(){
 const box=$('cp-browser'),capture=!!navigator.mediaDevices?.getDisplayMedia,firefox=/firefox/i.test(navigator.userAgent);
 box.hidden=capture&&!firefox;
 box.textContent=!capture?'Screen sharing is not available in this browser. Open this page on a computer, in Chrome or Edge.':'Firefox can share a window, but the pop-out and background tracking work only in Chrome and Edge.';
}
const opened=()=>{browserNote();ready().then(()=>{fillJobs();render(Date.now());}).catch(err=>status(err.message,'error'));controls();loadRankings();};
window.addEventListener('mesoswatch:view',e=>{if(e.detail.view==='companion')opened();});
$('set-clear-training').onclick=()=>{
 if(st.session)return set('set-clear-note','Stop your Companion session first.');
 st.history=[];st.log=createQuestLog();try{for(const k of [SESSIONS,LIVE,QUESTS])localStorage.removeItem(k);}catch{}
 set('set-clear-note','Training history cleared.');
};
if(document.body.dataset.view==='companion')opened();
controls();renderHelp();
