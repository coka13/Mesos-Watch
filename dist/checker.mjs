// Price Checker (home), item pages, Market Trends and Price History.
import {whereToFind,matchesFilter} from './location.mjs?v=loc-1';
import {configured,searchItems,getItem,itemSummary,currentListings,soldSightings,priceHistory,itemVariations,marketTrends,marketIndex,recentObservations,subscribe,iconUrl,baseStats,CATEGORY_LABEL,searchPaging,referencePrices,addReferencePrice,removeReferencePrice,adminState} from './api.mjs?v=ms-4';
import {chartSvg,shortMesos} from './chart.mjs?v=iqr-1';
import {INSUFFICIENT,MIN,REFERENCE_TYPES,sourceText,typicalAsk,typicalSold,vsTypical,latestReferences} from './price-source.mjs?v=1';
const $=id=>document.getElementById(id);
const fmt=n=>n==null?'—':Number(n).toLocaleString('en-US',{maximumFractionDigits:20});
const el=(tag,props={},...kids)=>{const e=Object.assign(document.createElement(tag),props);e.append(...kids.filter(k=>k!=null&&k!==false));return e;};
const world=()=>$('world').value||'';
const STAT_LABEL={str:'STR',dex:'DEX',int:'INT',luk:'LUK',hp:'HP',mp:'MP',watk:'W.ATT',matk:'M.ATT',wdef:'W.DEF',mdef:'M.DEF',acc:'ACC',avoid:'AVOID',speed:'Speed',jump:'Jump',slots:'Slots'};
export const statText=s=>Object.entries(s||{}).map(([k,v])=>`${STAT_LABEL[k]||k} ${k==='slots'?v:'+'+v}`).join(' · ');

export function ago(iso){if(!iso)return'never';const s=(Date.now()-new Date(iso))/1000;return s<60?'just now':s<3600?Math.round(s/60)+' min ago':s<86400?Math.round(s/3600)+' h ago':Math.round(s/86400)+' d ago';}
const freshness=iso=>{if(!iso)return'stale';const h=(Date.now()-new Date(iso))/36e5;return h<1?'fresh':h<24?'recent':'stale';};

// Item picture: catalog icon, community icon, or art drawn from the item's own name and category. Every item shows a
// picture, so a row never reads as a blank gap next to its neighbours.
const ART={
 equip:{hue:205,g:'<path d="M16 2.5l4.2 7.5L16 22l-4.2-12z"/><rect x="7.5" y="21" width="17" height="3.4" rx="1.7"/><rect x="14.3" y="24" width="3.4" height="5.5" rx="1.7"/>'},
 use:{hue:145,g:'<path d="M12.6 6h6.8v4.4l3.6 7.2A7.6 7.6 0 1 1 9 17.6l3.6-7.2z"/><rect x="11.2" y="2.6" width="9.6" height="3.2" rx="1.6" fill="@"/>'},
 setup:{hue:38,g:'<rect x="7" y="4.5" width="18" height="23" rx="2.6"/><rect x="10.6" y="9.5" width="10.8" height="2.4" rx="1.2" fill="@"/><rect x="10.6" y="14.5" width="10.8" height="2.4" rx="1.2" fill="@"/><rect x="10.6" y="19.5" width="6.4" height="2.4" rx="1.2" fill="@"/>'},
 etc:{hue:268,g:'<circle cx="16" cy="16" r="10.5"/><circle cx="16" cy="16" r="5.6" fill="@"/>'},
 cash:{hue:330,g:'<path d="M16 3l3.9 8.1 8.8 1.1-6.5 6.1 1.7 8.7L16 23.1 8.1 27.1l1.7-8.7L3.3 12.2l8.8-1.1z"/>'},
 unknown:{hue:190,g:'<path d="M16 4l10.5 7.6L16 28 5.5 11.6z"/><path d="M5.5 11.6h21" stroke="@" stroke-width="2.4" fill="none"/>'},
};
function artTile(item,box){
 const cat=ART[item?.category]?item.category:'unknown',name=String(item?.name||item?.item_name||'');
 let h=2166136261;for(let i=0;i<name.length;i++)h=(h^name.charCodeAt(i))*16777619>>>0;
 const hue=(ART[cat].hue+(h%30)-14+360)%360,deep=`hsl(${hue} 52% 33%)`,lite=`hsl(${hue} 62% 86%)`;
 box.dataset.art=cat;box.style.setProperty('--art-deep',deep);box.style.setProperty('--art-lite',`hsl(${hue} 45% 92%)`);
 box.innerHTML=`<svg viewBox="0 0 32 32" aria-hidden="true"><g fill="${deep}">${ART[cat].g.replaceAll('@',lite)}</g></svg>`;
}
export function iconEl(item,size=32){
 const box=el('span',{className:'item-icon',style:`--s:${size}px`});
 const fallback=()=>{artTile(item,box);box.title='Generic category placeholder; the correct item icon is not available';};
 const src=iconUrl(item);
 if(src){const img=el('img',{alt:'',loading:'lazy',decoding:'async',width:size,height:size});img.onerror=()=>{img.remove();fallback();};img.src=src;box.append(img);}else fallback();
 return box;
}
const itemLink=(item,text)=>el('a',{href:'#item/'+item.id,className:'item-link'},iconEl(item,28),el('span',{textContent:text||item.name}));

// Meso coin, beside every amount of mesos so a price never reads as a plain count. The sprite is the in-game mesos coin.
export function mesoEl(size=14){return el('span',{className:'meso',style:`--m:${size}px`,title:'mesos'},el('img',{src:'meso.png?v=real-1',alt:'',width:size,height:size,decoding:'async'}));}
export const mesoAmt=(text,size=14)=>{const raw=String(text),numeric=/^[+-]?[\d,]+$/.test(raw)?Number(raw.replaceAll(',','')):null;return el('span',{className:'meso-amt',title:numeric===null?raw:numeric.toLocaleString('en-US',{maximumFractionDigits:20})+' mesos'},mesoEl(size),document.createTextNode(numeric===null?raw:shortMesos(numeric)),...(numeric===null?[]:[el('span',{className:'price-unit',textContent:' mesos'})]));};
export const MesoPrice=(value,size=14)=>mesoAmt(Number(value).toLocaleString('en-US',{maximumFractionDigits:20}),size);
export const ItemDisplay=(item,size=28)=>el('span',{className:'item-link',title:[item.name,statText(item.base_stats?.stats),item.release_status].filter(Boolean).join(' · ')},iconEl(item,size),el('span',{textContent:item.name}));

// ---- Search with autocomplete (used on the home page and in Price History) ----
// Results arrive in pages; the next page loads when the list is scrolled (or arrowed) near its end, so every match is reachable.
const PAGE=50;
function attachSearch(input,list,onPick){
 let items=[],active=-1,seq=0,timer=null,query='',done=true,loading=false,offset=0;
 const close=()=>{clearTimeout(timer);seq++;query='';loading=false;done=true;list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
 const footer=()=>{
  if(loading)return'Loading more…';
  if(!done)return'';
  if(!searchPaging()&&items.length>=25)return'Showing the first 25 matches. Type more of the name to narrow it down.';
  return items.length>PAGE?`All ${items.length} matches shown`:'';
 };
 // The price beside a match is the asking-price median of the week, and only with enough sightings to mean something.
 const priceNote=it=>it.median_ask&&+it.asks_7d>=MIN.typical?shortMesos(+it.median_ask)+' asking · 7 d':+it.asks_7d>0?`${+it.asks_7d} sighting${+it.asks_7d===1?'':'s'} · ${INSUFFICIENT.toLowerCase()}`:it.category==='unknown'?'community item':'no prices yet';
 const render=(scrollToActive=true)=>{const top=list.scrollTop;list.replaceChildren(...items.map((it,i)=>{const li=el('li',{role:'option',id:list.id+'-'+i,className:i===active?'active':''},iconEl(it,28),el('span',{className:'s-name',textContent:it.name}),el('small',{textContent:[it.category==='cash'?'NX':'',priceNote(it)].filter(Boolean).join(' · ')}));li.setAttribute('aria-selected',String(i===active));li.onmousedown=e=>e.preventDefault();li.onclick=()=>pick(i);return li;}));
  const note=footer();if(note&&items.length)list.append(el('li',{className:'s-empty',textContent:note}));
  if(!items.length)list.append(el('li',{className:'s-empty',textContent:configured()?'No matching items. Check the spelling, or it may not have been scanned yet.':'The price database is not connected yet.'}));
  list.hidden=false;input.setAttribute('aria-expanded','true');input.setAttribute('aria-activedescendant',active>=0?list.id+'-'+active:'');
  fit();list.scrollTop=top;if(scrollToActive&&active>=0)list.children[active]?.scrollIntoView({block:'nearest'});
  if(!done&&!loading&&list.scrollHeight<=list.clientHeight+4)loadMore();};  // a tall window may show a whole page: fetch the next
 const loadMore=async()=>{
  if(done||loading||!query)return;
  const my=seq;loading=true;render(false);
  try{const r=await searchItems(query,world(),PAGE,offset);if(my!==seq)return;offset+=r.length;const seen=new Set(items.map(i=>i.id));items=items.concat(r.filter(i=>!seen.has(i.id)));done=r.length<PAGE;}
  catch{if(my!==seq)return;done=true;}
  finally{if(my===seq){loading=false;render(false);}}
 };
 list.addEventListener('scroll',()=>{if(list.scrollTop+list.clientHeight>=list.scrollHeight-80)loadMore();});
 // The list scrolls inside itself and must end above the bottom of the window; with too little room, bring the box up first.
 const fit=()=>{
  if(list.hidden)return;
  let below=window.innerHeight-input.getBoundingClientRect().bottom-28;
  if(below<240){window.scrollBy({top:Math.min(240-below,input.getBoundingClientRect().top-12)});below=window.innerHeight-input.getBoundingClientRect().bottom-28;}
  list.style.maxHeight=Math.max(160,Math.min(420,below))+'px';
 };
 window.addEventListener('resize',fit);
 const pick=i=>{const it=items[i];if(!it)return;close();input.value=it.name;onPick(it);};
 input.addEventListener('input',()=>{clearTimeout(timer);const q=input.value.trim();close();if(!q)return;const my=seq;const searchWorld=world();timer=setTimeout(async()=>{query=q;try{const r=await searchItems(q,searchWorld,PAGE,0);if(my!==seq||searchWorld!==world())return;items=r;offset=r.length;done=r.length<PAGE||!searchPaging();active=r.length?0:-1;list.scrollTop=0;render();}catch(e){if(my!==seq)return;items=[];done=true;render();list.lastChild.textContent=e.message;}},160);});
 input.addEventListener('keydown',e=>{if(list.hidden)return;if(e.key==='ArrowDown'){e.preventDefault();active=Math.min(items.length-1,active+1);render();if(active>=items.length-3)loadMore();}else if(e.key==='ArrowUp'){e.preventDefault();active=Math.max(0,active-1);render();}else if(e.key==='Enter'){e.preventDefault();pick(active<0?0:active);}else if(e.key==='Escape')close();});
 input.addEventListener('blur',close);
 $('world').addEventListener('change',close);
}

// ---- Home ----
let unsub=null,currentItem=null,range='7d',refreshTimer=null;
let routeRequest=0,summaryRequest=0,chartRequest=0,historyRequest=0;
async function loadHome(){
 const request=routeRequest;
 $('home').hidden=false;$('item-page').hidden=true;currentItem=null;
 if(!configured()){$('home-feed').replaceChildren(el('li',{className:'empty',textContent:'The community price database is not connected yet. Prices appear here once the site owner connects it and players start scanning.'}));$('home-top').replaceChildren(el('li',{className:'empty',textContent:'Nothing to show until the database is connected.'}));return;}
 try{
  const [recent,top]=await Promise.all([recentObservations(world(),20),marketTrends(world(),12)]);
  if(request!==routeRequest)return;
  $('home-feed').replaceChildren(...(recent.length?recent.map(feedRow):[el('li',{className:'empty',textContent:'No market data available yet'})]));
  $('home-top').replaceChildren(...(top.length?top.map(t=>el('li',{},itemLink(t),el('b',{},+t.asks_7d>=MIN.typical?mesoAmt(fmt(t.median_now)):document.createTextNode(INSUFFICIENT)),el('small',{textContent:`asking median · FM Scanner · ${fmt(t.asks_7d)} seen · ${ago(t.last_seen)}`,title:'Last seen '+new Date(t.last_seen).toLocaleString()}))):[el('li',{className:'empty',textContent:'Nothing scanned this week yet.'})]));
 }catch(e){if(request!==routeRequest)return;$('home-feed').replaceChildren(el('li',{className:'empty error',textContent:e.message}));$('home-top').replaceChildren(el('li',{className:'empty',textContent:'Unavailable right now.'}));}
}
const feedRow=o=>el('li',{className:o.kind==='sale'?'sale':''},itemLink(o.item,o.item_name),el('b',{},mesoAmt(fmt(o.price))),el('small',{title:(o.kind==='sale'?'Confirmed sale, reviewed by an admin':'Asking price read by the FM Scanner')+' · '+new Date(o.seen_at).toLocaleString(),textContent:[o.kind==='sale'?'confirmed sale · reviewed':'asking · FM Scanner',o.qty>1?'×'+o.qty:'',o.shop_title,o.map,ago(o.seen_at)].filter(Boolean).join(' · ')}));

// ---- Item page ----
async function loadItem(id){
 const request=routeRequest;
 $('home').hidden=true;$('item-page').hidden=false;
 $('ip-name').textContent='Loading item…';
 for(const field of ['ip-icon','ip-meta','ip-links','ip-chart','ip-base','ip-vars','ip-ref','ip-listings-src','ip-sold-src','ip-chart-src'])$(field).replaceChildren();
 for(const field of ['k-low','k-median','k-value','k-fresh'])kpi(field,null,'');
 lastSummary=null;
 delete $('k-fresh').dataset.fresh;
 lastListings=[];lastSold=[];renderListings();
 $('ip-vars-empty').hidden=false;
 $('ip-vars-empty').textContent='No stat lines read yet. Stats are captured when a scanning player hovers a listing and its tooltip shows.';
 if(!configured()){$('ip-name').textContent='Price database not connected';return;}
 try{
  const item=await getItem(id);if(request!==routeRequest)return;if(!item){$('ip-name').textContent='Item not found';return;}
  currentItem=item;$('q').value=item.name;
  $('ip-icon').replaceChildren(iconEl(item,48));$('ip-name').textContent=item.name;
  const origin=item.source==='catalog'?'Item ID '+item.game_id:item.category==='cash'?(item.verified?'NX item (confirmed by an admin)':'NX item'):item.verified?'Community item (reviewed by an admin)':'Community item: not in the MapleStory Classic catalog, often an NX item';
  $('ip-meta').textContent=[item.release_status?'Release: '+item.release_status:'Release status unverified',item.last_verified_at?'Verified '+ago(item.last_verified_at):'',item.subcategory||'',CATEGORY_LABEL[item.category]||'',origin,item.base_stats?.reqLevel?'Lv. '+item.base_stats.reqLevel:'',item.base_stats?.jobs?.join('/')].filter(Boolean).join(' · ');
  $('ip-links').replaceChildren(...[item.game_id&&el('a',{href:'https://osmsdataexplorer.com',target:'_blank',rel:'noopener',textContent:'Item data: OSMS Data Explorer ↗'}),el('a',{href:'#history/'+item.id,textContent:'Full history →'})].filter(Boolean));
  window.dispatchEvent(new CustomEvent('mesoswatch:item',{detail:item}));
  document.title=item.name+' price · Mesos-Watch';
  await Promise.allSettled([
   loadSummary().catch(e=>{if(request===routeRequest){$('ip-listings-empty').hidden=false;$('ip-listings-empty').textContent=e.message;}}),
   loadChart(),
   loadVariations().catch(e=>{if(request===routeRequest)$('ip-vars-empty').textContent=e.message;}),
   loadBase(item),
   loadReferences(item),
  ]);
 }catch(e){if(request===routeRequest)$('ip-name').textContent=e.message;}
}
async function loadSummary(){
 const item=currentItem;if(!item)return;
 const request=++summaryRequest;
 const [s,listings,sold]=await Promise.all([itemSummary(item.id,world()),currentListings(item.id,world()),soldSightings(item.id,world()).catch(()=>[])]);
 if(request!==summaryRequest||item!==currentItem)return;
 lastListings=listings;lastSold=sold;lastSummary=s;
 const typical=typicalAsk(s);
 const trend=typical.ok&&s.median_ask_prev_7d?Math.round(100*(s.median_ask_7d-s.median_ask_prev_7d)/s.median_ask_prev_7d):null;
 const forSale=s.for_sale_now??s.asks_24h;
 kpi('k-low',s.lowest_ask_24h,s.lowest_ask_24h?`${fmt(forSale)} listing${forSale==1?'':'s'} for sale now (seen in 24 h)`:'No listings for sale seen in the last 24 h',sourceText({type:'asking',at:s.ask_last_seen,window:'24 h'}));
 kpi('k-median',typical.ok?typical.value:null,typical.ok?[typical.range?`Middle half ${fmt(typical.range[0])}–${fmt(typical.range[1])}`:'',`${fmt(typical.n)} listings · ${fmt(s.reporters_7d)} player${s.reporters_7d==1?'':'s'}`,trend!=null?`${trend>0?'▲':trend<0?'▼':'■'} ${Math.abs(trend)}% vs last week`:''].filter(Boolean).join(' · '):typical.reason,
  sourceText({type:'asking',at:s.ask_last_seen,n:typical.n,window:'7 d'}),typical.n>0);
 kpi('k-value',s.estimated_value,s.estimated_value?`Median of ${fmt(s.sales_30d)} sales from ${fmt(s.sale_reporters_30d)} sellers (30 d)`:`Needs 3 reviewed sales from 2 sellers (have ${fmt(s.sales_30d)})`,
  sourceText({source:'sale',type:'sale',at:s.last_sale_at,n:s.sales_30d,unit:'sale',window:'30 d'}),+s.sales_30d>0);
 const f=freshness(s.last_seen);$('k-fresh').querySelector('strong').textContent=s.last_seen?ago(s.last_seen):'Never';$('k-fresh').querySelector('small').textContent=s.last_seen?new Date(s.last_seen).toLocaleString():'Not scanned yet in this world';$('k-fresh').dataset.fresh=f;
 const listSrc=sourceText({type:'asking',at:s.ask_last_seen,n:listings.length,window:'last 24 h'});
 $('ip-listings-src').replaceChildren(el('span',{textContent:listSrc.text,title:listSrc.title}));
 const ts=typicalSold(s),soldSrc=sourceText({type:'seenSold',at:s.sold_last_seen,n:s.sold_seen_7d??sold.length,unit:'sighting',window:'7 d'});
 $('ip-sold-src').replaceChildren(el('span',{textContent:(ts.ok?`Typical listed price of sold rows ${fmt(ts.value)}${ts.range?` (middle half ${fmt(ts.range[0])}–${fmt(ts.range[1])})`:''}`:`Typical sold price: ${INSUFFICIENT} (${ts.reason})`)+' · '+soldSrc.text,title:soldSrc.title}));
 renderListings();
}
// Where to find: "CH 1 • FM Room 7" / "CH 2 • Hidden Street", with a copy button; older rows without a structured location
// show what they have.
let lastListings=[],lastSold=[],lastSummary=null;
function whereCell(l){
 const where=whereToFind(l);if(!where)return el('td',{className:'muted',textContent:'—'});
 const copy=el('button',{type:'button',className:'secondary',textContent:'Copy',title:'Copy the location'});
 copy.onclick=async()=>{try{await navigator.clipboard.writeText(where);copy.textContent='Copied';}catch{copy.textContent='Copy failed';}setTimeout(()=>{copy.textContent='Copy';},1500);};
 return el('td',{className:'where-find'},el('span',{textContent:where,title:l.location_source==='MANUAL'?'Location entered by the player':l.location_source==='AUTO'?'Location read from the screen':''}),copy);
}
// Against the typical asking price of the week, when there is one. Five times off either way is flagged, never hidden.
function vsCell(v,typical){
 if(!v)return el('td',{className:'num muted',textContent:'—',title:typical.ok?'':`${INSUFFICIENT}: ${typical.reason}`});
 return el('td',{className:'num vs'+(v.pct>0?' pricier':v.pct<0?' cheaper':''),textContent:v.text,title:`Typical asking price this week: ${fmt(typical.value)} mesos`});
}
const seenTitle=l=>['Last seen '+new Date(l.seen_at).toLocaleString(),l.first_seen?'first seen '+new Date(l.first_seen).toLocaleString():'',l.sightings>1?`read ${fmt(l.sightings)} times`:'',l.reporters>1?`by ${fmt(l.reporters)} players`:''].filter(Boolean).join(' · ');
const filters=()=>({channel:$('ip-f-channel')?.value||'',room:$('ip-f-room')?.value||'',map:$('ip-f-map')?.value||''});
function renderListings(){
 const f=filters(),listings=lastListings.filter(l=>matchesFilter(l,f)),sold=lastSold.filter(l=>matchesFilter(l,f));
 listings.sort($('ip-listing-sort').value==='recent'
  ?(a,b)=>Date.parse(b.seen_at)-Date.parse(a.seen_at)
  :(a,b)=>a.price-b.price);
 const typical=typicalAsk(lastSummary);
 const body=$('ip-listings');body.replaceChildren(...listings.map(l=>{
  const v=typical.ok?vsTypical(+l.price,typical.value):null;
  return el('tr',{},el('td',{className:'num'},mesoAmt(fmt(l.price),13)),vsCell(v,typical),el('td',{className:'num',textContent:l.qty>1?'×'+l.qty:'1'}),el('td',{textContent:statText(l.stats)||'—',className:Object.keys(l.stats||{}).length?'stats':'muted'}),el('td',{textContent:[l.shop_title,l.seller_name].filter(Boolean).join(' · ')||'—'}),whereCell(l),
   el('td',{className:'badges'},el('span',{className:'fm-badge',textContent:'For sale',title:'Asking price: what the shop lists it for, not a confirmed sale'}),
    v?.unusual?el('span',{className:'fm-badge skipped',textContent:'Check price',title:'Far from the typical asking price: possibly a misread or a mistake in game. Check before buying.'}):null,
    +l.reporters>1?el('span',{className:'fm-badge',textContent:'×'+l.reporters+' players',title:'Read by '+l.reporters+' different players'}):null),
   el('td',{className:'when',textContent:ago(l.seen_at),title:seenTitle(l)}));}));
 $('ip-listings-empty').hidden=listings.length>0;
 $('ip-listings-empty').textContent=lastListings.length?'No listings in that channel, room or map':'No market data available yet';
 // "Work Gloves — 450,000,000 mesos — SOLD"
 const name=currentItem?.name||'';
 $('ip-sold')?.replaceChildren(...sold.map(r=>el('li',{className:'sold'},el('span',{className:'item-link'},iconEl(currentItem||{name},24),document.createTextNode(name)),mesoAmt(fmt(r.listed_price),13),el('span',{className:'fm-badge sold',textContent:'SOLD',title:'Listed price shown on the greyed-out row, not what the buyer paid'}),
  el('small',{title:'Seen sold by the FM Scanner · '+new Date(r.seen_at).toLocaleString(),textContent:['listed price',r.qty>1?'×'+r.qty:'',r.shop_title,r.seller_name,whereToFind(r),ago(r.seen_at)].filter(Boolean).join(' · ')}))));
 if($('ip-sold-empty'))$('ip-sold-empty').hidden=sold.length>0;
}
for(const id of ['ip-f-channel','ip-f-room','ip-f-map'])document.getElementById(id)?.addEventListener('input',renderListings);
$('ip-listing-sort').addEventListener('change',renderListings);
// A headline figure, what it is based on, and its source (name, data type, time). With some data but not enough for a
// reliable figure: "Insufficient data"; with none: a dash.
function kpi(id,value,sub,src=null,insufficient=false){
 const k=$(id);
 k.querySelector('strong').replaceChildren(value?mesoAmt(fmt(value),18):document.createTextNode(insufficient?INSUFFICIENT:'—'));
 k.querySelector('small').textContent=sub;k.classList.toggle('none',!value);k.classList.toggle('insufficient',!value&&insufficient);
 let line=k.querySelector('.kpi-src');
 if(!src){line?.remove();return;}
 if(!line)k.append(line=el('em',{className:'kpi-src'}));
 line.textContent=src.text;line.title=src.title;
}
const KIND_LABEL={ask:'Asking',sold:'Seen sold (listed price)',sale:'Confirmed sale'};
async function loadChart(){
 const item=currentItem;if(!item)return;
 const request=++chartRequest,selectedRange=range;
 try{
  const rows=await priceHistory(item.id,world(),selectedRange);
  if(request!==chartRequest||item!==currentItem)return;
  $('ip-chart').innerHTML=chartSvg(rows,{range:selectedRange});
  const count=k=>rows.filter(r=>r.kind===k).reduce((n,r)=>n+Number(r.n),0),last=rows.length?rows[rows.length-1].bucket:null;
  $('ip-chart-src').textContent=`Sources: FM Scanner asking prices (${fmt(count('ask'))}) and rows seen sold (${fmt(count('sold'))}); confirmed sales reviewed by admins (${fmt(count('sale'))}). ${selectedRange} window${last?', latest bucket '+new Date(last).toLocaleString():''}. Medians and ranges are observed prices, never estimates.`;
 }catch(e){if(request===chartRequest&&item===currentItem)$('ip-chart').textContent=e.message;}
}
async function loadVariations(){
 const item=currentItem,rows=await itemVariations(item.id,world());
 if(item!==currentItem)return;
 $('ip-vars').replaceChildren(...rows.map(v=>el('tr',{},el('td',{className:'stats',textContent:statText(v.stats)}),el('td',{className:'num'},mesoAmt(fmt(v.median),13)),el('td',{className:'num'},mesoAmt(fmt(v.low),13)),el('td',{className:'num',textContent:fmt(v.n)}),el('td',{className:'when',textContent:ago(v.last_seen)}))));
 $('ip-vars-empty').hidden=rows.length>0;
}
async function loadBase(item){
 const box=$('ip-base');
 if(item.source!=='catalog'){box.replaceChildren(el('p',{className:'muted',textContent:item.category==='cash'?'NX items are not in the MapleStory Classic item data, so there are no base stats here. The picture and prices come from players’ shop scans.':'This name was read from shops but is not in the MapleStory Classic item catalog. Usually that means an NX item; sometimes a misread. Base stats are unknown; prices are still tracked, and it only appears in search once two players have seen it.'}));return;}
 const d=baseStats(item);
 box.replaceChildren(...[d.description&&el('p',{className:'desc',textContent:d.description}),d.stats.length?el('dl',{},...d.stats.flatMap(([k,v])=>[el('dt',{textContent:k}),el('dd',{textContent:String(v)})])):el('p',{className:'muted',textContent:'No base stats listed for this item.'}),el('p',{className:'credit'},'MapleStory Classic World game data from ',el('a',{href:'https://osmsdataexplorer.com',target:'_blank',rel:'noopener',textContent:'OSMS Data Explorer'}),' (',el('a',{href:'https://creativecommons.org/licenses/by/4.0/',target:'_blank',rel:'noopener',textContent:'CC BY 4.0'}),'). Game data © NEXON.')].filter(Boolean));
}

// ---- Reference prices (NiaDB) ----
// Baseline figures from NiaDB, each linked to the NiaDB page it came from (NiaDB's attribution rule) with NiaDB's own date
// and price type. Shown apart from market prices and never mixed into them. Admins record them one at a time from NiaDB
// pages; bulk copying or automated collection needs NiaDB's written permission (https://meowdb.com/reuse).
const NIADB_PAGE=/^https:\/\/(www\.)?meowdb\.com\/msclassic\/\S+$/;
async function loadReferences(item){
 const box=$('ip-ref');box.replaceChildren();
 let rows=[],admin=false;
 try{[rows,admin]=await Promise.all([referencePrices(item.id,world()),adminState().then(a=>a.admin).catch(()=>false)]);}
 catch(e){if(item===currentItem)box.replaceChildren(el('p',{className:'muted',textContent:e.message}));return;}
 if(item!==currentItem)return;
 const refs=latestReferences(rows);
 box.append(el('h4',{textContent:'Reference prices'}));
 if(!refs.length)box.append(el('p',{className:'muted',textContent:`${INSUFFICIENT}: no reference price recorded for this item. The market prices on this page come only from players’ scans.`}));
 for(const r of refs){
  const range=r.price_low&&r.price_high?` (${fmt(r.price_low)}–${fmt(r.price_high)})`:'';
  const remove=admin?el('button',{type:'button',className:'secondary',textContent:'Remove'}):null;
  if(remove)remove.onclick=async()=>{remove.disabled=true;try{await removeReferencePrice(r.id);loadReferences(item);}catch(e){remove.textContent=e.message;}};
  box.append(el('div',{className:'ref-price'+(r.stale?' stale':'')},
   el('span',{className:'ref-type',textContent:REFERENCE_TYPES[r.price_type]||r.price_type}),
   el('b',{},mesoAmt(fmt(r.price_typical),13),document.createTextNode(range)),
   el('small',{title:'Recorded on Mesos-Watch '+new Date(r.recorded_at).toLocaleString()},'Source: ',el('a',{href:r.source_url,target:'_blank',rel:'noopener',textContent:r.source_name+' ↗'}),
    document.createTextNode([' · '+(REFERENCE_TYPES[r.price_type]||r.price_type),'as of '+new Date(r.as_of).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}),
     r.sample_size?fmt(r.sample_size)+' reports':'',r.window_days?'over '+r.window_days+' d':'',r.world||'all worlds',r.stale?'older than 30 days':''].filter(Boolean).join(' · '))),
   remove));
 }
 if(refs.length)box.append(el('p',{className:'credit'},'Reference data from ',el('a',{href:'https://meowdb.com/msclassic',target:'_blank',rel:'noopener',textContent:'NiaDB'}),', linked to each item page. Not part of the market prices above.'));
 if(admin)box.append(referenceForm(item));
}
function referenceForm(item){
 const field=(label,input)=>el('label',{className:'fm-field'},label+' ',input);
 const num=(name,required=false)=>el('input',{name,type:'number',min:1,step:1,required,inputMode:'numeric'});
 const type=el('select',{name:'price_type'},...Object.entries(REFERENCE_TYPES).map(([value,text])=>el('option',{value,textContent:text})));
 const url=el('input',{name:'source_url',type:'url',required:true,placeholder:'https://meowdb.com/msclassic/item-db/…',pattern:NIADB_PAGE.source});
 const asOf=el('input',{name:'as_of',type:'date',required:true,max:new Date().toISOString().slice(0,10)});
 const msg=el('p',{className:'hint',role:'status'});
 const form=el('form',{className:'ref-form'},type,field('Typical',num('price_typical',true)),field('Low',num('price_low')),field('High',num('price_high')),
  field('Reports',num('sample_size')),field('Window (days)',num('window_days')),field('As of (NiaDB date)',asOf),field('NiaDB item page',url),
  el('button',{type:'submit',className:'primary',textContent:'Save reference price'}),msg);
 form.onsubmit=async e=>{
  e.preventDefault();const d=Object.fromEntries(new FormData(form)),n=k=>d[k]?Math.round(+d[k]):null;
  if(!NIADB_PAGE.test(d.source_url)){msg.textContent='Link the specific NiaDB item page the figure is from (a homepage link is not attribution).';return;}
  try{await addReferencePrice({item_id:item.id,world:world(),source:'niadb',source_url:d.source_url.trim(),price_type:d.price_type,price_typical:n('price_typical'),price_low:n('price_low'),price_high:n('price_high'),sample_size:n('sample_size'),window_days:n('window_days'),as_of:new Date(d.as_of+'T12:00:00Z').toISOString()});
   loadReferences(item);}catch(err){msg.textContent=err.message;}
 };
 return el('details',{className:'ref-admin'},el('summary',{textContent:'Add a reference price from NiaDB (admin)'}),
  el('p',{className:'hint',textContent:'Copy individual figures from one NiaDB item page and link that page. Bulk copying, crawling or automated collection needs NiaDB’s written permission first.'}),form);
}

// ---- Market trends ----
let marketRows=[],marketRequest=0;
// Rows from market_index. Items without a reliable median sort after those with one.
const median=r=>+r.listings_7d>=MIN.typical&&r.ask_median?+r.ask_median:null;
const byNum=(f,dir=1)=>(a,b)=>{const x=f(a),y=f(b);return x==null&&y==null?0:x==null?1:y==null?-1:dir*(x-y);};
const marketSort={
 forsale:(a,b)=>(+b.for_sale_now||0)-(+a.for_sale_now||0)||(+b.listings_7d||0)-(+a.listings_7d||0),
 volume:(a,b)=>(+b.listings_7d||0)-(+a.listings_7d||0),
 sold:(a,b)=>(+b.sold_seen_7d||0)-(+a.sold_seen_7d||0)||(+b.sales_30d||0)-(+a.sales_30d||0),
 up:byNum(r=>r.change_24h_pct==null?null:+r.change_24h_pct,-1),
 down:byNum(r=>r.change_24h_pct==null?null:+r.change_24h_pct,1),
 recent:(a,b)=>Date.parse(b.last_seen)-Date.parse(a.last_seen),
 low:byNum(median,1),
 high:byNum(median,-1),
};
const insufficient=title=>el('span',{className:'muted insufficient',textContent:INSUFFICIENT,title});
function typicalCell(r){
 const n=+r.listings_7d||0;
 if(!median(r))return el('td',{className:'num'},insufficient(n?`${n} listing${n===1?'':'s'} this week; a typical price needs ${MIN.typical}`:'No asking prices this week'));
 const range=n>=MIN.range&&r.ask_p25&&r.ask_p75?`${shortMesos(+r.ask_p25)}–${shortMesos(+r.ask_p75)}`:'';
 return el('td',{className:'num',title:`Median of ${n} listings this week${range?'; middle half '+range:''} · FM Scanner asking prices`},mesoAmt(fmt(r.ask_median)),range?el('small',{className:'range',textContent:range}):null);
}
function changeCell(r){
 if(r.change_24h_pct==null)return el('td',{className:'num'},insufficient('Needs 3+ sightings in each of the last two days'));
 const p=+r.change_24h_pct;
 return el('td',{className:'num vs'+(p>0?' up':p<0?' down':''),textContent:(p>0?'▲ ':p<0?'▼ ':'')+Math.abs(p)+'%',title:`Asking median ${fmt(r.median_24h)} in the last 24 h against ${fmt(r.median_prev_24h)} the day before`});
}
function soldCell(r){
 const seen=+r.sold_seen_7d||0,sales=+r.sales_30d||0;
 if(r.legacy)return el('td',{className:'num muted',textContent:'—'});
 return el('td',{className:'num',title:`${seen} row${seen===1?'':'s'} seen sold in shops in 7 days (listed prices)${r.sold_median_7d?', median '+fmt(r.sold_median_7d):''}; ${sales} confirmed sale${sales===1?'':'s'} in 30 days${r.sale_median_30d?', median '+fmt(r.sale_median_30d):''}`},
  document.createTextNode(fmt(seen)),sales?el('small',{className:'range',textContent:`${fmt(sales)} confirmed`}):null);
}
function renderMarketIndex(){
 const q=$('market-filter').value.trim().toLowerCase();
 const matches=marketRows.filter(row=>row.name.toLowerCase().includes(q));
 matches.sort(marketSort[$('market-sort').value]||marketSort.forsale);
 $('market-index-rows').replaceChildren(...matches.map(row=>el('tr',{},
  el('td',{},itemLink(row)),
  typicalCell(row),
  changeCell(row),
  el('td',{className:'num',textContent:row.for_sale_now==null?'—':fmt(row.for_sale_now),title:row.lowest_now?'Lowest now '+fmt(row.lowest_now)+' mesos':''}),
  soldCell(row),
  el('td',{textContent:ago(row.last_seen),title:new Date(row.last_seen).toLocaleString()})
 )));
 const latest=marketRows.reduce((t,r)=>Math.max(t,Date.parse(r.last_seen)||0),0);
 const src=sourceText({type:'asking',at:latest?new Date(latest).toISOString():null,n:marketRows.length,unit:'item',window:'7 d'});
 $('market-index-note').textContent=marketRows.length
  ?`${matches.length} of ${marketRows.length} items. ${src.text}. Typical = median asking price of distinct listings, with the middle half; sold = rows seen sold in shops (listed price) and admin-confirmed sales. Open an item for history and where to find it.`
  :'No recent market data available.';
 $('market-index-note').title=src.title;
}
$('market-filter').addEventListener('input',renderMarketIndex);
$('market-sort').addEventListener('change',renderMarketIndex);
async function loadTrends(){
 const request=++marketRequest,route=routeRequest;
 marketRows=[];
 renderMarketIndex();
 if(!configured()){$('trends-note').textContent='The price database is not connected yet.';$('market-index-note').textContent=$('trends-note').textContent;return;}
 $('trends-note').textContent='Loading…';
 $('market-index-note').textContent='Loading recent market data…';
 try{const [rows,index]=await Promise.all([marketTrends(world(),100),marketIndex(world())]);
  if(request!==marketRequest||route!==routeRequest)return;
  marketRows=index;renderMarketIndex();
  const moved=rows.filter(r=>r.change_pct!=null);
  const fill=(id,list,val)=>$(id).replaceChildren(...(list.length?list.map(r=>el('li',{},itemLink(r),el('b',{textContent:val(r)}),el('small',{title:'FM Scanner asking prices · last seen '+new Date(r.last_seen).toLocaleString()},...(+r.asks_7d>=MIN.typical?[mesoAmt(fmt(r.median_now),11),document.createTextNode(' asking median')]:[document.createTextNode('Median: '+INSUFFICIENT)]),document.createTextNode(` · ${fmt(r.asks_7d)} seen · ${ago(r.last_seen)}`)))):[el('li',{className:'empty',textContent:`${INSUFFICIENT}: needs 3+ sightings in each of the last two weeks.`})]));
  fill('t-up',moved.filter(r=>+r.change_pct>0).sort((a,b)=>b.change_pct-a.change_pct).slice(0,10),r=>'▲ '+r.change_pct+'%');
  fill('t-down',moved.filter(r=>+r.change_pct<0).sort((a,b)=>a.change_pct-b.change_pct).slice(0,10),r=>'▼ '+Math.abs(r.change_pct)+'%');
  fill('t-most',rows.slice(0,15),r=>fmt(r.asks_7d)+' seen');
  $('trends-note').textContent='Source: FM Scanner asking prices. Medians this week against last week; never estimated.';
 }catch(e){if(request===marketRequest&&route===routeRequest){$('trends-note').textContent=e.message;$('market-index-note').textContent=e.message;}}
}

// ---- Price history ----
let hItem=null,hRange='30d';
function historyMessage(text){
 $('h-body').hidden=false;
 $('h-title').textContent='Price history';
 $('h-chart').textContent=text;
 $('h-table').replaceChildren();
 $('h-empty').hidden=true;
}
async function loadHistory(id){
 const request=++historyRequest,route=routeRequest,selectedRange=hRange;
 const isCurrent=()=>request===historyRequest&&route===routeRequest;
 if(id){
  $('h-body').hidden=true;
  hItem=null;
  try{
   const item=await getItem(id);
   if(!isCurrent())return;
   if(!item){historyMessage('Item not found.');return;}
   hItem=item;
  }catch(e){if(isCurrent())historyMessage(e.message);return;}
 }
 if(!hItem){$('h-body').hidden=true;return;}
 $('h-body').hidden=false;$('h-q').value=hItem.name;$('h-title').replaceChildren(itemLink(hItem));
 for(const b of document.querySelectorAll('#h-ranges button'))b.classList.toggle('active',b.dataset.range===hRange);
 $('h-chart').textContent='Loading price history…';$('h-table').replaceChildren();$('h-empty').hidden=true;
 try{const rows=await priceHistory(hItem.id,world(),selectedRange);
  if(!isCurrent())return;
  $('h-chart').innerHTML=chartSvg(rows,{range:selectedRange});
  $('h-table').replaceChildren(...rows.slice().reverse().map(r=>el('tr',{},el('td',{textContent:new Date(r.bucket).toLocaleString([],selectedRange==='24h'||selectedRange==='7d'?{month:'short',day:'numeric',hour:'numeric'}:{month:'short',day:'numeric'})}),el('td',{textContent:KIND_LABEL[r.kind]||r.kind}),el('td',{className:'num',textContent:fmt(r.low)}),el('td',{className:'num',textContent:fmt(r.median)}),el('td',{className:'num',textContent:fmt(r.high)}),el('td',{className:'num',textContent:fmt(r.n)}))));
  $('h-empty').hidden=rows.length>0;
 }catch(e){if(isCurrent())$('h-chart').textContent=e.message;}
}

// ---- Routing hooks (site.mjs calls these) ----
export async function show(view,arg){
 routeRequest++;
 currentItem=null;
 clearTimeout(refreshTimer);
 if(view==='checker'){if(arg)await loadItem(+arg);else{document.title='Mesos-Watch · MapleStory Classic FM Price Checker';await loadHome();}}
 if(view==='trends')await loadTrends();
 if(view==='history')await loadHistory(arg?+arg:null);
 await live();
}
let liveRequest=0,livePending=false;
async function live(){
 if(!configured()||unsub||livePending)return;
 const request=++liveRequest;livePending=true;
 try{const stop=await subscribe(world(),o=>{
  if(request!==liveRequest)return;
  if(!$('home').hidden&&!$('home').closest('.view').hidden){$('home-feed').prepend(feedRow({...o,item:{id:o.item_id,name:o.item_name}}));while($('home-feed').children.length>20)$('home-feed').lastChild.remove();}
  if(currentItem&&o.item_id===currentItem.id){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{Promise.allSettled([loadSummary(),loadChart()]);},2500);}
  $('live-dot').classList.add('pulse');setTimeout(()=>$('live-dot').classList.remove('pulse'),900);
 });
 if(request!==liveRequest){stop();return;}
 unsub=stop;$('live-dot').hidden=false;
 }catch{}finally{if(request===liveRequest)livePending=false;}
}
export function worldChanged(){
 liveRequest++;livePending=false;unsub?.();unsub=null;$('live-dot').hidden=true;
}

attachSearch($('q'),$('q-list'),it=>{location.hash='#item/'+it.id;});
attachSearch($('h-q'),$('h-list'),it=>{location.hash='#history/'+it.id;});
for(const b of document.querySelectorAll('#ip-ranges button'))b.onclick=()=>{range=b.dataset.range;for(const o of document.querySelectorAll('#ip-ranges button'))o.classList.toggle('active',o===b);loadChart();};
for(const b of document.querySelectorAll('#h-ranges button'))b.onclick=()=>{hRange=b.dataset.range;loadHistory();};
window.addEventListener('mesoswatch:observed',()=>{if(currentItem)loadSummary().catch(()=>{});});
