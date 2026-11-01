// Navigation, world picker, FM Megaphones and Settings (including admin moderation).
import {NOT_SET_UP,configured,worlds,megaphonePlans,liveMegaphones,myMegaphones,startCheckout,moderateMegaphone,adminSignIn,adminState,signOut,moderationQueue,unverifiedItems,updateItem,catalogSyncLog,catalogSyncNow} from './api.mjs?v=ms-2';
import {checkMegaphone,MAX_MESSAGE} from './megaphone-rules.mjs?v=pc-1';
import {show,worldChanged,ago,iconEl} from './checker.mjs?v=ms-2';
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=Object.assign(document.createElement(tag),props);e.append(...kids.filter(k=>k!=null&&k!==false));return e;};
const money=c=>'$'+(c/100).toFixed(2);
const VIEWS=['checker','trends','scanner','history','megaphones','store','settings'];
const LEGACY={watcher:'store','sale-activity':'store',support:'store',discord:'store',guide:'settings',prices:'checker',item:'checker'};

// ---- Router ----
function route(){
 const raw=location.hash.replace(/^#/,''),[path,query='']=raw.split('?'),[head,arg]=path.split('/');
 const view=VIEWS.includes(head)?head:LEGACY[head]||'checker',param=head==='item'?arg:view==='history'?arg:null;
 for(const v of document.querySelectorAll('.view'))v.hidden=v.dataset.view!==view;
 for(const a of document.querySelectorAll('#nav a'))a.toggleAttribute('aria-current',a.dataset.view===view);
 document.body.dataset.view=view;
 if(view!=='checker')document.title=document.querySelector(`#nav a[data-view="${view}"]`)?.textContent.trim()+' · Mesos-Watch';
 show(view,param).catch(()=>{});
 if(view==='megaphones')loadMegaphoneView(new URLSearchParams(query));
 if(view==='settings')loadSettings();
 if(!param)window.scrollTo({top:0});
}
window.addEventListener('hashchange',route);

// ---- World ----
const ws=worlds(),sel=$('world');
sel.replaceChildren(...(ws.length?ws.map(w=>new Option(w,w)):[new Option('All worlds','')]));
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
 if(!strip.length)return;const m=strip[stripIdx++%strip.length];
 $('mega-text').replaceChildren(...[m.sender&&el('b',{textContent:m.sender+' : '}),document.createTextNode(m.message)].filter(Boolean));
 $('mega-pos').textContent=strip.length>1?`${(stripIdx-1)%strip.length+1}/${strip.length}`:'';
}
setInterval(loadStrip,60000);

// ---- FM Megaphones view ----
let plans=[],chosen=null;
async function loadMegaphoneView(q){
 if(q.get('paid'))note('Payment received. Your megaphone is in the review queue and its time starts when it is approved and a slot is free.','ok');
 else if(q.get('cancelled'))note('Checkout cancelled. You were not charged.','');
 if(!configured()){$('mg-buy').disabled=true;note('Megaphones are not available yet: the site owner has not connected the database and payments.','warn');$('mg-live').replaceChildren(el('li',{className:'empty',textContent:'Unavailable until the site is connected.'}));$('mg-mine').replaceChildren(el('li',{className:'empty',textContent:'Unavailable until the site is connected.'}));renderPlans(FALLBACK_PLANS);return;}
 try{plans=await megaphonePlans();renderPlans(plans);}catch(e){note(e.message,'error');$('mg-buy').disabled=true;}
 refreshMine();
 try{const live=await liveMegaphones(sel.value);$('mg-live').replaceChildren(...(live.length?live.map(m=>el('li',{},el('span',{textContent:(m.sender?m.sender+' : ':'')+m.message}),el('small',{textContent:'until '+new Date(m.ends_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}))):[el('li',{className:'empty',textContent:'No megaphones live right now.'})]));}catch(e){$('mg-live').replaceChildren(el('li',{className:'empty',textContent:e.message}));}
}
// Shown when the database is unreachable; the real prices come from megaphone_plans (supabase/migrations).
const FALLBACK_PLANS=[{id:'p60',label:'1 hour',price_cents:100,minutes:60},{id:'p150',label:'2.5 hours',price_cents:200,minutes:150},{id:'p360',label:'6 hours',price_cents:400,minutes:360},{id:'p720',label:'12 hours',price_cents:700,minutes:720},{id:'p1440',label:'24 hours',price_cents:1200,minutes:1440}];
// Saving against the 1-hour rate (the cheapest plan per minute is the reference only if it is the shortest).
function planNote(p,list){const base=list.reduce((a,b)=>a.minutes<b.minutes?a:b);const perHour=p.price_cents*60/p.minutes,save=Math.round(100*(1-perHour/(base.price_cents*60/base.minutes)));return money(Math.round(perHour))+' per hour'+(save>0?` · save ${save}%`:'');}
function renderPlans(list){
 $('mg-plans').replaceChildren(...list.map((p,i)=>{const id='plan-'+p.id;const input=el('input',{type:'radio',name:'mg-plan',id,value:p.id,checked:chosen?chosen===p.id:i===0});input.onchange=()=>{chosen=p.id;preview();};
  return el('label',{className:'plan',htmlFor:id},input,el('strong',{textContent:p.label}),el('b',{textContent:money(p.price_cents)}),el('small',{textContent:planNote(p,list)}));}));
 chosen=chosen||list[0]?.id;preview();
}
function preview(){
 const r=checkMegaphone({message:$('mg-message').value,sender:$('mg-sender').value});
 $('mg-count').textContent=`${$('mg-message').value.length}/${MAX_MESSAGE}`;
 $('mg-preview').replaceChildren(el('span',{className:'mega-label',textContent:'📢 Megaphone'}),el('span',{className:'mega-text'},...[r.sender&&el('b',{textContent:r.sender+' : '}),document.createTextNode(r.message||'Your message appears here')].filter(Boolean)));
 $('mg-errors').replaceChildren(...r.errors.filter(e=>$('mg-message').value||!/at least/.test(e)).map(e=>el('li',{textContent:e})));
 $('mg-buy').disabled=!configured()||!!r.errors.length||!chosen;
 const p=plans.find(x=>x.id===chosen);$('mg-buy').textContent=p?`Pay ${money(p.price_cents)} · secure checkout`:'Choose a duration';
}
function note(text,kind){const n=$('mg-note');n.textContent=text;n.className='status'+(kind?' '+kind:'');n.hidden=!text;}
async function refreshMine(){
 try{const mine=await myMegaphones();
  const label={awaiting_payment:'Awaiting payment',paid_pending_review:'Paid · waiting for review',queued:'Approved · queued',live:'Live now',expired:'Finished',rejected:'Rejected',refunded:'Refunded',cancelled:'Cancelled',removed:'Removed'};
  $('mg-mine').replaceChildren(...(mine.length?mine.map(m=>el('li',{},el('span',{textContent:m.message}),el('small',{textContent:[label[m.display_status]||m.display_status,`${m.minutes} min · ${money(m.price_cents)}`,m.starts_at&&m.display_status!=='expired'?'starts '+new Date(m.starts_at).toLocaleString():'',m.reject_reason,m.livemode?'':'test payment'].filter(Boolean).join(' · ')}))):[el('li',{className:'empty',textContent:'You have not bought a megaphone in this browser.'})]));
 }catch(e){$('mg-mine').replaceChildren(el('li',{className:'empty',textContent:e.message}));}
}
$('mg-message').oninput=preview;$('mg-sender').oninput=preview;
$('mg-form').onsubmit=async e=>{e.preventDefault();const r=checkMegaphone({message:$('mg-message').value,sender:$('mg-sender').value});if(r.errors.length)return preview();
 $('mg-buy').disabled=true;note('Opening secure checkout…','');
 try{const out=await startCheckout({message:r.message,sender:r.sender,world:sel.value,plan_id:chosen});location.href=out.url;}
 catch(e){note(e.message,'error');preview();}};

// ---- Settings ----
async function loadSettings(){
 const s=await adminState().catch(()=>({email:null,admin:false}));
 $('adm-state').textContent=s.email?(s.admin?`Signed in as ${s.email} (admin).`:`Signed in as ${s.email}, which is not an admin account.`):'Not signed in. Only site admins need this.';
 $('adm-out').hidden=!s.email;$('adm-login').hidden=!!s.email;$('adm-panel').hidden=!s.admin;
 if(s.admin){loadQueue();loadItems();loadSync();}
}
const SYNC_LABEL={requested:'Downloading…',applied:'Updated',unchanged:'No changes',failed:'Failed'};
async function loadSync(){
 try{const log=await catalogSyncLog();
  $('adm-sync-log').replaceChildren(...(log.length?log.map(r=>el('li',{},el('span',{className:'msg',textContent:`${SYNC_LABEL[r.status]||r.status}${r.items!=null?` · ${r.items} items`:''}`}),el('small',{textContent:`${new Date(r.requested_at).toLocaleString()}${r.message?' · '+r.message:''}`}))):[el('li',{className:'empty',textContent:'No automatic update has run yet. The first one runs at the next 06:17 UTC, or press Update now.'})]));
 }catch(e){$('adm-sync-log').replaceChildren(el('li',{className:'empty error',textContent:e.message}));}
}
$('adm-sync').onclick=async()=>{const b=$('adm-sync');b.disabled=true;try{const id=await catalogSyncNow();b.textContent=id?'Downloading… applied within 5 minutes':'A download is already running';}catch(e){b.textContent=e.message;}loadSync();setTimeout(()=>{b.disabled=false;b.textContent='Update now';loadSync();},60000);};
$('adm-login').onsubmit=async e=>{e.preventDefault();try{await adminSignIn($('adm-email').value.trim());$('adm-state').textContent='Check your inbox for the sign-in link.';}catch(err){$('adm-state').textContent=err.message;}};
$('adm-out').onclick=async()=>{await signOut();loadSettings();};
async function loadQueue(){
 try{const q=await moderationQueue();
  $('adm-queue').replaceChildren(...(q.length?q.map(m=>{const reason=el('input',{placeholder:'Reason (shown to buyer)',maxLength:200});
   const act=(a,extra)=>async()=>{try{await moderateMegaphone(a,m.id,{reason:reason.value,...extra});loadQueue();loadStrip();}catch(e){alertRow.textContent=e.message;}};
   const alertRow=el('small',{className:'err'});
   return el('li',{},el('span',{className:'msg',textContent:(m.sender?m.sender+' : ':'')+m.message}),el('small',{textContent:`${m.display_status} · ${m.minutes} min · ${money(m.price_cents)}${m.livemode?'':' (test)'} · ${ago(m.created_at)}${m.starts_at?' · '+new Date(m.starts_at).toLocaleString()+' → '+new Date(m.ends_at).toLocaleTimeString():''}`}),
    el('div',{className:'row'},reason,m.display_status==='paid_pending_review'&&el('button',{textContent:'Approve',className:'primary',onclick:act('approve')}),['paid_pending_review','awaiting_payment'].includes(m.display_status)&&el('button',{textContent:m.payment_intent?'Reject & refund':'Reject',onclick:act('reject')}),['queued','live'].includes(m.display_status)&&el('button',{textContent:'Remove & refund',onclick:act('remove',{refund:true})}),['queued','live'].includes(m.display_status)&&el('button',{textContent:'Remove, no refund',onclick:act('remove',{refund:false})})),alertRow);}):[el('li',{className:'empty',textContent:'Nothing waiting.'})]));
 }catch(e){$('adm-queue').replaceChildren(el('li',{className:'empty error',textContent:e.message}));}
}
async function loadItems(){
 try{const items=await unverifiedItems();
  $('adm-items').replaceChildren(...(items.length?items.map(it=>{const gid=el('input',{type:'number',placeholder:'Game item ID',min:1000000,max:9999999,value:it.game_id||''}),name=el('input',{value:it.name,maxLength:60}),msg=el('small');
   // Names outside the Classic catalog are nearly always NX items, so NX is the default type.
   const cat=el('select',{ariaLabel:'Item type'},...[['cash','NX'],['equip','Equipment'],['use','Use'],['setup','Setup'],['etc','Etc']].map(([v,t])=>new Option(t,v,false,v===(it.category!=='unknown'?it.category:'cash'))));
   return el('li',{},iconEl(it,28),name,cat,gid,el('button',{textContent:'Verify',onclick:async()=>{try{await updateItem(it.id,{name:name.value.trim(),category:cat.value,game_id:gid.value?+gid.value:null,verified:true});loadItems();}catch(e){msg.textContent=e.message;}}}),el('small',{textContent:'first seen '+ago(it.first_seen)}),msg);}):[el('li',{className:'empty',textContent:'No community items waiting for review.'})]));
 }catch(e){$('adm-items').replaceChildren(el('li',{className:'empty error',textContent:e.message}));}
}
// Two-step confirm built into the page (no browser dialogs).
$('set-clear-sales').onclick=()=>{const b=$('set-clear-sales');if(b.dataset.armed){window.dispatchEvent(new Event('mesoswatch:clear-sales'));b.textContent='Sales history cleared';delete b.dataset.armed;setTimeout(()=>b.textContent='Clear my sales history',2500);}else{b.dataset.armed='1';b.textContent='Click again to clear';setTimeout(()=>{delete b.dataset.armed;b.textContent='Clear my sales history';},4000);}};
$('set-reset-consent').onclick=()=>{try{localStorage.removeItem('mw-scan-consent');}catch{}const c=$('scan-consent');if(c.checked){c.checked=false;c.dispatchEvent(new Event('change'));}$('set-reset-consent').textContent='Scanner agreement reset';};

document.addEventListener('keydown',e=>{if(e.key==='/'&&!/input|textarea|select/i.test(document.activeElement.tagName)){e.preventDefault();if(document.body.dataset.view!=='checker')location.hash='#checker';$('q').focus();}});
$('config-missing').hidden=configured();
if(configured())megaphonePlans().catch(e=>{if(e.message===NOT_SET_UP){$('config-missing').textContent=NOT_SET_UP;$('config-missing').hidden=false;}});
route();loadStrip();
