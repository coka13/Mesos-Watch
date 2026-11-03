// Public navigation, world picker, FM Megaphones and browser-data controls.
import {searchItems,NOT_SET_UP,configured,worlds,megaphonePlans,liveMegaphones,myMegaphones} from './api.mjs?v=ms-2';
import {checkMegaphone,MAX_MESSAGE} from './megaphone-rules.mjs?v=pc-1';
import {show,worldChanged,iconEl} from './checker.mjs?v=ms-3';
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=Object.assign(document.createElement(tag),props);e.append(...kids.filter(k=>k!=null&&k!==false));return e;};
const money=c=>'$'+(c/100).toFixed(2);
const VIEWS=['checker','trends','scanner','history','megaphones','store','settings','stores','opportunities'];
const LEGACY={watcher:'store','sale-activity':'store',support:'store',discord:'store',guide:'settings',prices:'checker',item:'checker'};

// ---- Router ----
function route(){
 const raw=location.hash.replace(/^#/,''),[path,query='']=raw.split('?'),[head,arg]=path.split('/');
 const view=VIEWS.includes(head)?head:LEGACY[head]||'checker',param=head==='item'?arg:view==='history'?arg:null;
 for(const v of document.querySelectorAll('.view'))v.hidden=v.dataset.view!==view;
 // Sub-links (e.g. Discord Integration inside My Store) are current only when their anchor is the one routed to.
 const links=[...document.querySelectorAll('#nav a')],subMatch=links.some(a=>a.dataset.view===view&&a.dataset.sub&&a.dataset.sub===arg);
 for(const a of links)a.toggleAttribute('aria-current',a.dataset.view===view&&(subMatch?a.dataset.sub===arg:!a.dataset.sub));
 document.body.dataset.view=view;$('community-status').textContent='';window.dispatchEvent(new CustomEvent('mesoswatch:view',{detail:{view,param:arg}}));
 if(view!=='checker')document.title=({history:'Price History',settings:'Privacy & browser data'}[view]||document.querySelector(`#nav a[data-view="${view}"]`)?.textContent.trim()||'Mesos-Watch')+' · Mesos-Watch';
 const anchor=arg&&!param&&document.getElementById(arg);
 show(view,param).catch(()=>{});
 if(view==='megaphones')loadMegaphoneView(new URLSearchParams(query));

 if(anchor){anchor.closest('details')?.setAttribute('open','');if(anchor.tagName==='DETAILS')anchor.open=true;setTimeout(()=>anchor.scrollIntoView({block:'start',behavior:'smooth'}),view==='settings'?400:0);}
 else if(!param)window.scrollTo({top:0});
}
window.addEventListener('hashchange',route);
// Narrow screens: the section menu folds away so the search stays near the top.
$('nav-toggle').onclick=()=>{const open=$('nav').classList.toggle('open');$('nav-toggle').setAttribute('aria-expanded',String(open));};
window.addEventListener('hashchange',()=>{$('nav').classList.remove('open');$('nav-toggle').setAttribute('aria-expanded','false');});

// ---- World ----
const ws=worlds(),sel=$('world');
sel.replaceChildren(...(ws.length?ws.map(w=>new Option(w,w)):[new Option('Unspecified world','')]));
try{const saved=localStorage.getItem('mw-world');if(ws.includes(saved))sel.value=saved;}catch{}
sel.hidden=!ws.length;
sel.onchange=()=>{try{localStorage.setItem('mw-world',sel.value);}catch{}worldChanged();route();loadStrip();};

// ---- Megaphone strip under the search bar: every live message takes an equal turn, 8 seconds each ----
let strip=[],stripIdx=0,stripTimer=null;
async function loadStrip(){
 if(!configured()){$('mega-strip').hidden=true;return;}
 try{strip=await liveMegaphones(sel.value);}catch{strip=[];}
 $('mega-strip').hidden=!strip.length;clearInterval(stripTimer);stripIdx=0;showStrip();
 if(strip.length>1)stripTimer=setInterval(showStrip,8000);
}
function showStrip(){
 strip=strip.filter(m=>new Date(m.ends_at)>new Date());$('mega-strip').hidden=!strip.length;if(!strip.length)return;const m=strip[stripIdx++%strip.length];
 $('mega-text').replaceChildren(...[megaItem(m),m.sender&&el('b',{textContent:m.sender+' : '}),document.createTextNode(m.message)].filter(Boolean));
 $('mega-pos').textContent=strip.length>1?`${(stripIdx-1)%strip.length+1}/${strip.length}`:'';
}
setInterval(loadStrip,60000);

// ---- FM Megaphones view ----
let plans=[],chosen=null;
async function loadMegaphoneView(q){
 if(q.get('paid'))note('Checkout returned. Payment status is confirmed by the server; check your campaign status below.','ok');
 else if(q.get('cancelled'))note('Checkout cancelled. You were not charged.','');
 if(!configured()){$('mg-buy').disabled=true;note('Megaphones are not available yet: the site owner has not connected the database and payments.','warn');$('mg-live').replaceChildren(el('li',{className:'empty',textContent:'Unavailable until the site is connected.'}));$('mg-mine').replaceChildren(el('li',{className:'empty',textContent:'Unavailable until the site is connected.'}));renderPlans(FALLBACK_PLANS);return;}
 try{plans=await megaphonePlans();renderPlans(plans);}catch(e){note(e.message,'error');$('mg-buy').disabled=true;}
 refreshMine();
 try{const live=await liveMegaphones(sel.value);$('mg-live').replaceChildren(...(live.length?live.map(m=>el('li',{},el('span',{textContent:(m.sender?m.sender+' : ':'')+m.message}),el('small',{textContent:'Campaign '+m.id+' · until '+new Date(m.ends_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}))):[el('li',{className:'empty',textContent:'No megaphones live right now.'})]));}catch(e){$('mg-live').replaceChildren(el('li',{className:'empty',textContent:e.message}));}
}
// Shown when the database is unreachable; the real prices come from megaphone_plans (supabase/migrations).
const FALLBACK_PLANS=[{id:'basic30',label:'Basic · 30 minutes',price_cents:199,minutes:30},{id:'premium120',label:'Premium · 2 hours',price_cents:399,minutes:120},{id:'featured360',label:'Featured · 6 hours',price_cents:599,minutes:360}];
// Saving against the 1-hour rate (the cheapest plan per minute is the reference only if it is the shortest).
function planNote(p,list){const base=list.reduce((a,b)=>a.minutes<b.minutes?a:b);const perHour=p.price_cents*60/p.minutes,save=Math.round(100*(1-perHour/(base.price_cents*60/base.minutes)));return money(Math.round(perHour))+' per hour'+(save>0?` · save ${save}%`:'');}
function renderPlans(list){
 $('mg-plans').replaceChildren(...list.map((p,i)=>{const id='plan-'+p.id;const input=el('input',{type:'radio',name:'mg-plan',id,value:p.id,checked:chosen?chosen===p.id:i===0});input.onchange=()=>{chosen=p.id;preview();};
  return el('label',{className:'plan',htmlFor:id},input,el('strong',{textContent:p.label}),el('b',{textContent:money(p.price_cents)}),el('small',{textContent:planNote(p,list)}));}));
 chosen=chosen||list[0]?.id;preview();
}
// Featured item: a link with the item's icon, ahead of the message.
function megaItem(m){if(!m?.item_id||!m.item_name)return null;return el('a',{className:'mega-item',href:'#item/'+m.item_id},iconEl({id:m.item_id,name:m.item_name,game_id:m.item_game_id,icon_path:m.item_icon_path,category:m.item_category},20),el('span',{textContent:m.item_name}));}
let mgItem=null,mgTimer=null;
function pickItem(item){mgItem=item;$('mg-item').value=item?item.name:'';$('mg-item-clear').hidden=!item;$('mg-item-list').hidden=true;preview();}
$('mg-item').oninput=()=>{clearTimeout(mgTimer);const q=$('mg-item').value.trim();if(mgItem&&q!==mgItem.name)mgItem=null;$('mg-item-clear').hidden=!mgItem;if(q.length<2||!configured()){$('mg-item-list').hidden=true;preview();return;}
 mgTimer=setTimeout(async()=>{try{const rows=(await searchItems(q,sel.value,8,0))||[];$('mg-item-list').replaceChildren(...rows.map(r=>{const item={id:r.id??r.item_id,name:r.name,game_id:r.game_id,icon_path:r.icon_path,category:r.category};return el('li',{role:'option',tabIndex:0,onclick:()=>pickItem(item),onkeydown:e=>{if(e.key==='Enter'){e.preventDefault();pickItem(item);}}},iconEl(item,24),el('span',{textContent:item.name}));}));$('mg-item-list').hidden=!rows.length;}catch{$('mg-item-list').hidden=true;}},250);};
$('mg-item-clear').onclick=()=>pickItem(null);
function preview(){
 const r=checkMegaphone({message:$('mg-message').value,sender:$('mg-sender').value});
 $('mg-count').textContent=`${$('mg-message').value.length}/${MAX_MESSAGE}`;
 $('mg-preview').replaceChildren(el('span',{className:'mega-label',textContent:'📢 Megaphone'}),el('span',{className:'mega-text'},...[mgItem&&megaItem({item_id:mgItem.id,item_name:mgItem.name,item_game_id:mgItem.game_id,item_icon_path:mgItem.icon_path,item_category:mgItem.category}),r.sender&&el('b',{textContent:r.sender+' : '}),document.createTextNode(r.message||'Your message appears here')].filter(Boolean)));
 $('mg-errors').replaceChildren(...r.errors.filter(e=>$('mg-message').value||!/at least/.test(e)).map(e=>el('li',{textContent:e})));
 $('mg-buy').disabled=!configured()||!!r.errors.length||!chosen;
 const p=plans.find(x=>x.id===chosen);$('mg-buy').textContent=p?`Pay ${money(p.price_cents)} · secure checkout`:'Choose a duration';
}
function note(text,kind){const n=$('mg-note');n.textContent=text;n.className='status'+(kind?' '+kind:'');n.hidden=!text;}
async function refreshMine(){
 try{const mine=await myMegaphones();
  const label={awaiting_payment:'Awaiting payment',paid_pending_review:'Paid · waiting for review',queued:'Approved · queued',live:'Live now',expired:'Finished',rejected:'Rejected',refunded:'Refunded',cancelled:'Cancelled',removed:'Removed'};
  $('mg-mine').replaceChildren(...(mine.length?mine.map(m=>el('li',{},el('span',{textContent:m.message}),el('small',{textContent:['Campaign '+m.id,label[m.display_status]||m.display_status,`${m.minutes} min · ${money(m.price_cents)}`,m.starts_at&&m.display_status!=='expired'?'starts '+new Date(m.starts_at).toLocaleString():'',m.reject_reason,m.livemode?'':'test payment'].filter(Boolean).join(' · ')}))):[el('li',{className:'empty',textContent:'You have not bought a megaphone in this browser.'})]));
 }catch(e){$('mg-mine').replaceChildren(el('li',{className:'empty',textContent:e.message}));}
}
$('mg-message').oninput=preview;$('mg-sender').oninput=preview;
$('mg-form').onsubmit=async e=>{e.preventDefault();const r=checkMegaphone({message:$('mg-message').value,sender:$('mg-sender').value});if(r.errors.length)return preview();
 $('mg-buy').disabled=true;note('Opening secure checkout…','');
 const fields={message:r.message,sender:r.sender,world:sel.value,plan_id:chosen,...(mgItem?{item_id:mgItem.id}:{})},provider=e.submitter?.dataset.provider;
 try{if(provider){await (await import('./pay.mjs?v=pay-2')).startPayment('megaphone',provider,fields);return;}throw Error('Choose PayPal or crypto to continue.');}
 catch(e){note(e.message,'error');preview();}};

// Two-step confirm built into the page (no browser dialogs).
$('set-clear-sales').onclick=()=>{const b=$('set-clear-sales');if(b.dataset.armed){window.dispatchEvent(new Event('mesoswatch:clear-sales'));b.textContent='Sales history cleared';delete b.dataset.armed;setTimeout(()=>b.textContent='Clear my sales history',2500);}else{b.dataset.armed='1';b.textContent='Click again to clear';setTimeout(()=>{delete b.dataset.armed;b.textContent='Clear my sales history';},4000);}};
$('set-reset-consent').onclick=()=>{try{localStorage.removeItem('mw-scan-consent');}catch{}const c=$('scan-consent');if(c.checked){c.checked=false;c.dispatchEvent(new Event('change'));}$('set-reset-consent').textContent='Scanner agreement reset';};

document.addEventListener('keydown',e=>{if(e.key==='/'&&!/input|textarea|select/i.test(document.activeElement.tagName)){e.preventDefault();if(document.body.dataset.view!=='checker')location.hash='#checker';$('q').focus();}});
$('config-missing').hidden=configured();
if(configured())megaphonePlans().catch(e=>{if(e.message===NOT_SET_UP){$('config-missing').textContent=NOT_SET_UP;$('config-missing').hidden=false;}});
route();loadStrip();
