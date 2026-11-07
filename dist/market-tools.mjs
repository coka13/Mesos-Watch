// Trading tools inside the existing pages: buy-low/sell-high and price alerts on Market Trends, the alert and profit forms on item
// pages, and reporting a listing. Every figure shows what it rests on; nothing here is a promise that a trade will work.
import {configured,marketFlips,itemStats,myAlerts,saveAlert,removeAlert,checkAlerts,markAlertRead,reportListing} from './api.mjs?v=depth-1';
import {iconEl,mesoAmt,ago,statText} from './checker.mjs?v=depth-1';
import {account,needAccount,SignInNeeded,opportunities} from './community-api.mjs';
import {calculateTrade} from './trading.mjs';
import {INSUFFICIENT,MIN} from './price-source.mjs?v=1';
const $=id=>document.getElementById(id),world=()=>$('world').value||'';
const el=(tag,props={},...kids)=>{const e=Object.assign(document.createElement(tag),props);e.append(...kids.filter(k=>k!=null&&k!==false));return e;};
const fmt=n=>Number(n).toLocaleString('en-US');
const link=item=>el('a',{href:'#item/'+item.id,className:'item-link'},iconEl(item,28),el('span',{textContent:item.name}));
const say=(id,text,kind='')=>{const e=$(id);e.textContent=text;e.className=(e.dataset.base||'status')+(kind?' '+kind:'');};
const STORE_FEE=3;

// ---- Buy low, sell high ----
const BASIS={seen_sold:'rows seen sold',asking:'asking median'};
async function loadFlips(){
 if(!configured()){say('flips-note','The price database is not connected yet.');return;}
 const days=+$('market-window').value||7;
 say('flips-note','Loading…');
 try{
  const [rows,same]=await Promise.all([marketFlips(world(),days),opportunities(world()).catch(()=>[])]);
  if(rows===null){say('flips-note','This appears once the site’s database is updated.');return;}
  $('flips-rows').replaceChildren(...rows.map(r=>el('tr',{},el('td',{},link(r)),
   el('td',{className:'num'},mesoAmt(fmt(r.buy),13)),el('td',{className:'num'},mesoAmt(fmt(r.sell),13)),
   el('td',{className:'num up',title:`Sold at ${fmt(r.sell)}, less the ${STORE_FEE}% store fee, minus the ${fmt(r.buy)} paid`},mesoAmt(fmt(r.profit),13)),
   el('td',{className:'num',textContent:r.roi_pct+'%'}),
   el('td',{textContent:`${fmt(r.samples)} ${BASIS[r.basis]||r.basis}`+(r.category==='equip'?' · stats may differ':''),title:r.category==='equip'?'Equipment varies by stats: the cheap listing may be a weaker item. Check it on the item page.':''}),
   el('td',{className:'when',textContent:ago(r.last_seen),title:new Date(r.last_seen).toLocaleString()}))));
  $('flips-empty').hidden=rows.length>0;
  say('flips-note',`Lowest credible listing against what the item typically goes for, after the ${STORE_FEE}% store fee. Prices from the last ${days===1?'24 hours':days+' days'}. Asking prices can be gone by the time you arrive: an estimate, not a promise.`);
  $('market-opportunities').replaceChildren(...(same.length?same.map(r=>el('li',{},link({id:r.item_id,...r}),el('span',{textContent:statText(r.stats)}),mesoAmt(fmt(r.lowest)),document.createTextNode(' to '),mesoAmt(fmt(r.highest)),el('small',{textContent:r.shops+' shops · '+ago(r.last_seen)+' · same captured stats'}))):[el('li',{className:'empty',textContent:'Needs the same stats read in at least two shops within an hour.'})]));
 }catch(e){say('flips-note',e.message,'error');}
}

// ---- Alerts ----
function alertRow(a){
 const price=el('input',{type:'number',min:1,max:1e11,step:1,value:a.threshold||'',ariaLabel:'Alert price in mesos',className:'alert-price'}),note=el('small',{});
 const save=el('button',{type:'button',textContent:'Save',onclick:guard(note,async()=>{const n=Number(price.value);if(!Number.isSafeInteger(n)||n<1||n>1e11)throw Error('Enter a whole number of mesos.');await saveAlert({id:a.id,threshold:n,direction:a.direction});note.textContent='Saved.';})});
 const remove=el('button',{type:'button',className:'secondary',textContent:'Remove',onclick:guard(note,async()=>{await removeAlert(a.id);await loadAlerts();})});
 const typical=el('td',{className:'num muted',textContent:'…'});
 itemStats(a.item_id,world(),7).then(s=>{typical.className='num';typical.replaceChildren(s?.median&&s.listings>=MIN.typical?mesoAmt(fmt(s.median),13):document.createTextNode(INSUFFICIENT));}).catch(()=>{typical.textContent='—';});
 return el('tr',{},el('td',{},link(a.item)),typical,el('td',{className:'num'},price),el('td',{className:'alert-actions'},save,remove,note));
}
const guard=(note,fn)=>async()=>{try{await fn();}catch(e){note.textContent=e.message;}};
async function loadAlerts(){
 if(!configured()){say('alerts-note','The price database is not connected yet.');return;}
 const user=await account().catch(()=>null);
 $('alerts-table').hidden=!user;$('alerts-signin').hidden=!!user;
 if(!user){say('alerts-note','Sign in to keep price alerts. They follow your account, on any device.');return;}
 const rows=await myAlerts(world());
 if(rows===null){say('alerts-note','Alerts appear once the site’s database is updated.');return;}
 $('alerts-rows').replaceChildren(...rows.map(alertRow));
 $('alerts-empty').hidden=rows.length>0;
 say('alerts-note','Checked every minute while Mesos-Watch is open in a tab, against open listings seen in the last hour. Nothing is sent while the site is closed.');
 await pollAlerts();
}
// New hits show on every page, until they are dismissed.
let polling=null;
async function pollAlerts(){
 if(!configured()||document.hidden)return;
 try{
  if(!await account())return;
  const hits=await checkAlerts(),box=$('alert-banner');
  box.hidden=!hits.length;
  box.replaceChildren(...hits.slice(0,3).map(h=>{
   const item=h.watch?.item;
   return el('div',{className:'alert-hit'},item?link(item):null,el('b',{},mesoAmt(fmt(h.price),13)),el('small',{textContent:'asking price · '+ago(h.created_at)+' · confirm it is still there'}),
    el('button',{type:'button',className:'secondary',textContent:'Dismiss',onclick:async()=>{await markAlertRead(h.id).catch(()=>{});pollAlerts();}}));
  }));
 }catch{/* an unavailable check is retried on the next pass */}
}
function startPolling(){if(!polling)polling=setInterval(pollAlerts,6e4);pollAlerts();}
$('alerts-signin').onclick=async()=>{try{await needAccount($('alerts-signin'),'Sign in to keep price alerts.');}catch(e){if(!(e instanceof SignInNeeded))say('alerts-note',e.message,'error');}};

// ---- Item page ----
let current=null;
$('ip-alert-form').onsubmit=async e=>{
 e.preventDefault();const item=current;if(!item)return;
 const n=Number($('ip-alert-price').value);
 if(!Number.isSafeInteger(n)||n<1||n>1e11)return say('ip-alert-note','Enter a whole number of mesos.','error');
 try{
  await needAccount($('ip-alert-form'),'Sign in to keep price alerts.');
  await saveAlert({itemId:item.id,world:world(),threshold:n,direction:'below'});
  window.dispatchEvent(new CustomEvent('mesoswatch:watched',{detail:item}));
  say('ip-alert-note',`Alert set: you will see it here when ${item.name} is listed at ${fmt(n)} mesos or less. Your alerts are under Market Trends.`,'ok');startPolling();
 }catch(err){if(err instanceof SignInNeeded)say('ip-alert-note','Sign in above to save this alert.');else say('ip-alert-note',err.message,'error');}
};
function trade(){
 try{
  const r=calculateTrade({buy:Number($('trade-buy').value),sell:Number($('trade-sell').value),quantity:Number($('trade-qty').value),feePercent:Number($('trade-fee').value),flatFee:0});
  const tile=(label,value)=>el('div',{className:'kpi'},el('span',{textContent:label}),value===null?el('strong',{textContent:'Not attainable'}):el('strong',{},mesoAmt(fmt(value))));
  $('trade-output').replaceChildren(tile('Net profit',r.profit),tile('Fees',r.fees),tile('Break-even price each',r.breakEven),
   el('div',{className:'kpi'},el('span',{textContent:'Return on cost'}),el('strong',{textContent:r.roi===null?'—':r.roi.toFixed(1)+'%'}),el('small',{textContent:r.margin===null?'':r.margin.toFixed(1)+'% margin'})));
  say('trade-note','');
 }catch(e){$('trade-output').replaceChildren();say('trade-note',e.message,'error');}
}
$('trade-form').addEventListener('input',trade);$('trade-form').onsubmit=e=>e.preventDefault();
// The item page's figures fill the calculator, with where each came from, and can be overtyped.
window.addEventListener('mesoswatch:item-prices',e=>{
 const {item,lowest,typical}=e.detail;current=item;
 $('ip-alert-price').value=lowest?Math.max(1,Math.round(lowest*.9)):'';say('ip-alert-note','');
 $('trade-buy').value=lowest||0;$('trade-sell').value=typical||0;$('trade-qty').value=1;$('trade-fee').value=STORE_FEE;
 say('trade-note',lowest&&typical?'Filled in with the lowest listing and the typical price. Change them to test your own numbers.':'Not enough prices yet to fill this in: enter your own numbers.');
 trade();
});
window.addEventListener('mesoswatch:item',e=>{current=e.detail;});

// ---- Reporting a listing ----
let reporting=null;
window.addEventListener('mesoswatch:report',async e=>{
 reporting=e.detail;$('report-what').textContent=e.detail.label||'';$('report-reason').value='';say('report-status','');
 $('report-send').disabled=false;$('report-dialog').showModal();
 if(!await account().catch(()=>null)){say('report-status','Reports need an account, so that they can be reviewed. Sign in from your alerts under Market Trends, then report this listing again.');$('report-send').disabled=true;}
});
$('report-form').onsubmit=async e=>{
 e.preventDefault();const reason=$('report-reason').value.trim();
 if(reason.length<10)return say('report-status','Say what is wrong in at least 10 characters.','error');
 try{await reportListing(reporting.observationId,reason);say('report-status','Report sent for review. Nothing was removed.','ok');$('report-send').disabled=true;}
 catch(err){say('report-status',err.message,'error');}
};
$('report-cancel').onclick=()=>$('report-dialog').close();

window.addEventListener('mesoswatch:view',e=>{if(e.detail.view==='trends'){loadFlips();loadAlerts().catch(err=>say('alerts-note',err.message,'error'));}});
$('market-window').addEventListener('change',loadFlips);
window.addEventListener('mesoswatch:world',()=>{loadFlips();loadAlerts().catch(()=>{});});
for(const id of ['flips-note','alerts-note','ip-alert-note','trade-note','report-status'])$(id).dataset.base=$(id).className;
if(document.body.dataset.view==='trends'){loadFlips();loadAlerts().catch(()=>{});}
if(configured())startPolling();
