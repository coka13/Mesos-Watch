// Price Checker (home), item pages, Market Trends and Price History.
import {configured,searchItems,getItem,itemSummary,currentListings,priceHistory,itemVariations,marketTrends,recentObservations,subscribe,iconUrl,baseStats,CATEGORY_LABEL,searchPaging} from './api.mjs?v=ms-2';
import {chartSvg,shortMesos} from './chart.mjs?v=pc-1';
const $=id=>document.getElementById(id);
const fmt=n=>n==null?'—':Number(n).toLocaleString('en-US');
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
 const fallback=()=>{artTile(item,box);box.title='Picture drawn from the item name: no scan of this item yet';};
 const src=iconUrl(item);
 if(src){const img=el('img',{src,alt:'',loading:'lazy',decoding:'async',width:size,height:size});img.onerror=()=>{img.remove();fallback();};box.append(img);}else fallback();
 return box;
}
const itemLink=(item,text)=>el('a',{href:'#item/'+item.id,className:'item-link'},iconEl(item,28),el('span',{textContent:text||item.name}));

// Meso coin, beside every amount of mesos so a price never reads as a plain count. The sprite is the in-game mesos coin.
export function mesoEl(size=14){return el('span',{className:'meso',style:`--m:${size}px`,title:'mesos'},el('img',{src:'meso.png?v=ms-1',alt:'',width:size,height:size,decoding:'async'}));}
export const mesoAmt=(text,size=14)=>el('span',{className:'meso-amt'},mesoEl(size),document.createTextNode(String(text)));

// ---- Search with autocomplete (used on the home page and in Price History) ----
// Results arrive in pages; the next page loads when the list is scrolled (or arrowed) near its end, so every match is reachable.
const PAGE=50;
function attachSearch(input,list,onPick){
 let items=[],active=-1,seq=0,timer=null,query='',done=true,loading=false;
 const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');active=-1;};
 const footer=()=>{
  if(loading)return'Loading more…';
  if(!done)return'';
  if(!searchPaging()&&items.length>=25)return'Showing the first 25 matches. Type more of the name to narrow it down.';
  return items.length>PAGE?`All ${items.length} matches shown`:'';
 };
 const render=(scrollToActive=true)=>{const top=list.scrollTop;list.replaceChildren(...items.map((it,i)=>{const li=el('li',{role:'option',id:list.id+'-'+i,className:i===active?'active':''},iconEl(it,28),el('span',{className:'s-name',textContent:it.name}),el('small',{textContent:[it.category==='cash'?'NX':'',it.median_ask?shortMesos(+it.median_ask)+' typical':it.category==='unknown'?'community item':'no prices yet'].filter(Boolean).join(' · ')}));li.setAttribute('aria-selected',String(i===active));li.onmousedown=e=>{e.preventDefault();pick(i);};return li;}));
  const note=footer();if(note&&items.length)list.append(el('li',{className:'s-empty',textContent:note}));
  if(!items.length)list.append(el('li',{className:'s-empty',textContent:configured()?'No matching items. Check the spelling, or it may not have been scanned yet.':'The price database is not connected yet.'}));
  list.hidden=false;input.setAttribute('aria-expanded','true');input.setAttribute('aria-activedescendant',active>=0?list.id+'-'+active:'');
  fit();list.scrollTop=top;if(scrollToActive&&active>=0)list.children[active]?.scrollIntoView({block:'nearest'});
  if(!done&&!loading&&list.scrollHeight<=list.clientHeight+4)loadMore();};  // a tall window may show a whole page: fetch the next
 const loadMore=async()=>{
  if(done||loading||!query)return;
  const my=seq;loading=true;render(false);
  try{const r=await searchItems(query,world(),PAGE,items.length);if(my!==seq)return;const seen=new Set(items.map(i=>i.id));items=items.concat(r.filter(i=>!seen.has(i.id)));done=r.length<PAGE;}
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
 input.addEventListener('input',()=>{clearTimeout(timer);const q=input.value.trim();if(!q){close();return;}timer=setTimeout(async()=>{const my=++seq;query=q;loading=false;try{const r=await searchItems(q,world(),PAGE,0);if(my!==seq)return;items=r;done=r.length<PAGE||!searchPaging();active=r.length?0:-1;list.scrollTop=0;render();}catch(e){if(my!==seq)return;items=[];done=true;render();list.lastChild.textContent=e.message;}},160);});
 input.addEventListener('keydown',e=>{if(list.hidden)return;if(e.key==='ArrowDown'){e.preventDefault();active=Math.min(items.length-1,active+1);render();if(active>=items.length-3)loadMore();}else if(e.key==='ArrowUp'){e.preventDefault();active=Math.max(0,active-1);render();}else if(e.key==='Enter'){e.preventDefault();pick(active<0?0:active);}else if(e.key==='Escape')close();});
 input.addEventListener('blur',()=>setTimeout(close,120));
}

// ---- Home ----
let unsub=null,currentItem=null,range='7d',refreshTimer=null;
async function loadHome(){
 $('home').hidden=false;$('item-page').hidden=true;currentItem=null;
 if(!configured()){$('home-feed').replaceChildren(el('li',{className:'empty',textContent:'The community price database is not connected yet. Prices appear here once the site owner connects it and players start scanning.'}));$('home-top').replaceChildren(el('li',{className:'empty',textContent:'Nothing to show until the database is connected.'}));return;}
 try{
  const [recent,top]=await Promise.all([recentObservations(world(),20),marketTrends(world(),12)]);
  $('home-feed').replaceChildren(...(recent.length?recent.map(feedRow):[el('li',{className:'empty',textContent:'No prices yet for this world. Be the first: open Live FM Scanner and share your game window.'})]));
  $('home-top').replaceChildren(...(top.length?top.map(t=>el('li',{},itemLink(t),el('b',{},mesoAmt(shortMesos(+t.median_now))),el('small',{textContent:`${fmt(t.asks_7d)} seen · ${ago(t.last_seen)}`}))):[el('li',{className:'empty',textContent:'Nothing scanned this week yet.'})]));
 }catch(e){$('home-feed').replaceChildren(el('li',{className:'empty error',textContent:e.message}));$('home-top').replaceChildren(el('li',{className:'empty',textContent:'Unavailable right now.'}));}
}
const feedRow=o=>el('li',{className:o.kind==='sale'?'sale':''},itemLink(o.item,o.item_name),el('b',{},mesoAmt(fmt(o.price))),el('small',{textContent:[o.kind==='sale'?'sold':'asking',o.qty>1?'×'+o.qty:'',o.shop_title,o.map,ago(o.seen_at)].filter(Boolean).join(' · ')}));

// ---- Item page ----
async function loadItem(id){
 $('home').hidden=true;$('item-page').hidden=false;
 if(!configured()){$('ip-name').textContent='Price database not connected';return;}
 try{
  const item=await getItem(id);if(!item){$('ip-name').textContent='Item not found';return;}
  currentItem=item;$('q').value=item.name;
  $('ip-icon').replaceChildren(iconEl(item,48));$('ip-name').textContent=item.name;
  const origin=item.source==='catalog'?'Item ID '+item.game_id:item.category==='cash'?(item.verified?'NX item (confirmed by an admin)':'NX item'):item.verified?'Community item (confirmed by an admin)':'Community item: not in the MapleStory Classic catalog, often an NX item';
  $('ip-meta').textContent=[item.subcategory||'',CATEGORY_LABEL[item.category]||'',origin,item.base_stats?.reqLevel?'Lv. '+item.base_stats.reqLevel:'',item.base_stats?.jobs?.join('/')].filter(Boolean).join(' · ');
  $('ip-links').replaceChildren(...[item.game_id&&el('a',{href:'https://osmsdataexplorer.com',target:'_blank',rel:'noopener',textContent:'Item data: OSMS Data Explorer ↗'}),el('a',{href:'#history/'+item.id,textContent:'Full history →'})].filter(Boolean));
  document.title=item.name+' price · Mesos-Watch';
  await Promise.all([loadSummary(),loadChart(),loadVariations(),loadBase(item)]);
 }catch(e){$('ip-name').textContent=e.message;}
}
async function loadSummary(){
 const item=currentItem;if(!item)return;
 const [s,listings]=await Promise.all([itemSummary(item.id,world()),currentListings(item.id,world())]);
 const trend=s.median_ask_7d&&s.median_ask_prev_7d?Math.round(100*(s.median_ask_7d-s.median_ask_prev_7d)/s.median_ask_prev_7d):null;
 kpi('k-low',s.lowest_ask_24h,s.lowest_ask_24h?`${fmt(s.asks_24h)} listings seen in 24 h`:'No listings seen in the last 24 h');
 kpi('k-median',s.median_ask_7d,s.median_ask_7d?`${fmt(s.asks_7d)} sightings · ${fmt(s.reporters_7d)} player${s.reporters_7d==1?'':'s'}`+(trend!=null?` · ${trend>0?'▲':trend<0?'▼':'■'} ${Math.abs(trend)}% vs last week`:''):'No asking prices this week');
 kpi('k-value',s.estimated_value,s.estimated_value?`Median of ${fmt(s.sales_30d)} sales from ${fmt(s.sale_reporters_30d)} sellers (30 d)`:`Needs 3 reviewed sales from 2 sellers (have ${fmt(s.sales_30d)})`);
 const f=freshness(s.last_seen);$('k-fresh').querySelector('strong').textContent=s.last_seen?ago(s.last_seen):'Never';$('k-fresh').querySelector('small').textContent=s.last_seen?new Date(s.last_seen).toLocaleString():'Not scanned yet in this world';$('k-fresh').dataset.fresh=f;
 const body=$('ip-listings');body.replaceChildren(...listings.map(l=>el('tr',{},el('td',{className:'num'},mesoAmt(fmt(l.price),13)),el('td',{className:'num',textContent:l.qty>1?'×'+l.qty:'1'}),el('td',{textContent:statText(l.stats)||'—',className:Object.keys(l.stats||{}).length?'stats':'muted'}),el('td',{textContent:[l.shop_title,l.map,l.channel?'Ch '+l.channel:''].filter(Boolean).join(' · ')||'—'}),el('td',{className:'when',textContent:ago(l.seen_at)}))));
 $('ip-listings-empty').hidden=listings.length>0;
}
function kpi(id,value,sub){const k=$(id);k.querySelector('strong').replaceChildren(value?mesoAmt(fmt(value),18):document.createTextNode('—'));k.querySelector('small').textContent=sub;k.classList.toggle('none',!value);}
async function loadChart(){if(!currentItem)return;const rows=await priceHistory(currentItem.id,world(),range);$('ip-chart').innerHTML=chartSvg(rows,{range});}
async function loadVariations(){
 const rows=await itemVariations(currentItem.id,world());
 $('ip-vars').replaceChildren(...rows.map(v=>el('tr',{},el('td',{className:'stats',textContent:statText(v.stats)}),el('td',{className:'num'},mesoAmt(fmt(v.median),13)),el('td',{className:'num'},mesoAmt(fmt(v.low),13)),el('td',{className:'num',textContent:fmt(v.n)}),el('td',{className:'when',textContent:ago(v.last_seen)}))));
 $('ip-vars-empty').hidden=rows.length>0;
}
async function loadBase(item){
 const box=$('ip-base');
 if(item.source!=='catalog'){box.replaceChildren(el('p',{className:'muted',textContent:item.category==='cash'?'NX items are not in the MapleStory Classic item data, so there are no base stats here. The picture and prices come from players’ shop scans.':'This name was read from shops but is not in the MapleStory Classic item catalog. Usually that means an NX item; sometimes a misread. Base stats are unknown; prices are still tracked, and it only appears in search once two players have seen it.'}));return;}
 const d=baseStats(item);
 box.replaceChildren(...[d.description&&el('p',{className:'desc',textContent:d.description}),d.stats.length?el('dl',{},...d.stats.flatMap(([k,v])=>[el('dt',{textContent:k}),el('dd',{textContent:String(v)})])):el('p',{className:'muted',textContent:'No base stats listed for this item.'}),el('p',{className:'credit'},'MapleStory Classic World game data from ',el('a',{href:'https://osmsdataexplorer.com',target:'_blank',rel:'noopener',textContent:'OSMS Data Explorer'}),' (',el('a',{href:'https://creativecommons.org/licenses/by/4.0/',target:'_blank',rel:'noopener',textContent:'CC BY 4.0'}),'). Game data © NEXON.')].filter(Boolean));
}

// ---- Market trends ----
async function loadTrends(){
 if(!configured()){$('trends-note').textContent='The price database is not connected yet.';return;}
 $('trends-note').textContent='Loading…';
 try{const rows=await marketTrends(world(),100);
  const moved=rows.filter(r=>r.change_pct!=null);
  const fill=(id,list,val)=>$(id).replaceChildren(...(list.length?list.map(r=>el('li',{},itemLink(r),el('b',{textContent:val(r)}),el('small',{},mesoAmt(shortMesos(+r.median_now),11),document.createTextNode(` now · ${fmt(r.asks_7d)} seen · ${ago(r.last_seen)}`)))):[el('li',{className:'empty',textContent:'Not enough data yet: needs 3+ sightings in each of the last two weeks.'})]));
  fill('t-up',moved.filter(r=>+r.change_pct>0).sort((a,b)=>b.change_pct-a.change_pct).slice(0,10),r=>'▲ '+r.change_pct+'%');
  fill('t-down',moved.filter(r=>+r.change_pct<0).sort((a,b)=>a.change_pct-b.change_pct).slice(0,10),r=>'▼ '+Math.abs(r.change_pct)+'%');
  fill('t-most',rows.slice(0,15),r=>fmt(r.asks_7d)+' seen');
  $('trends-note').textContent=`Asking-price medians, this week against last week. ${rows.length} items scanned this week.`;
 }catch(e){$('trends-note').textContent=e.message;}
}

// ---- Price history ----
let hItem=null,hRange='30d';
async function loadHistory(id){
 if(id){try{hItem=await getItem(id);}catch(e){$('h-title').textContent=e.message;return;}}
 if(!hItem){$('h-body').hidden=true;return;}
 $('h-body').hidden=false;$('h-q').value=hItem.name;$('h-title').replaceChildren(itemLink(hItem));
 for(const b of document.querySelectorAll('#h-ranges button'))b.classList.toggle('active',b.dataset.range===hRange);
 try{const rows=await priceHistory(hItem.id,world(),hRange);
  $('h-chart').innerHTML=chartSvg(rows,{range:hRange});
  $('h-table').replaceChildren(...rows.slice().reverse().map(r=>el('tr',{},el('td',{textContent:new Date(r.bucket).toLocaleString([],hRange==='24h'||hRange==='7d'?{month:'short',day:'numeric',hour:'numeric'}:{month:'short',day:'numeric'})}),el('td',{textContent:r.kind==='sale'?'Sale':'Asking'}),el('td',{className:'num',textContent:fmt(r.low)}),el('td',{className:'num',textContent:fmt(r.median)}),el('td',{className:'num',textContent:fmt(r.high)}),el('td',{className:'num',textContent:fmt(r.n)}))));
  $('h-empty').hidden=rows.length>0;
 }catch(e){$('h-chart').textContent=e.message;}
}

// ---- Routing hooks (site.mjs calls these) ----
export async function show(view,arg){
 if(view==='checker'){if(arg)await loadItem(+arg);else{document.title='Mesos-Watch · MapleStory Classic FM Price Checker';await loadHome();}}
 if(view==='trends')await loadTrends();
 if(view==='history')await loadHistory(arg?+arg:null);
 await live();
}
async function live(){
 if(!configured()||unsub)return;
 try{unsub=await subscribe(world(),o=>{
  if(!$('home').hidden&&!$('home').closest('.view').hidden){$('home-feed').prepend(feedRow({...o,item:{id:o.item_id,name:o.item_name}}));while($('home-feed').children.length>20)$('home-feed').lastChild.remove();}
  if(currentItem&&o.item_id===currentItem.id){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>{loadSummary();loadChart();},2500);}
  $('live-dot').classList.add('pulse');setTimeout(()=>$('live-dot').classList.remove('pulse'),900);
 });$('live-dot').hidden=false;}catch{}
}
export function worldChanged(){unsub?.();unsub=null;}

attachSearch($('q'),$('q-list'),it=>{location.hash='#item/'+it.id;});
attachSearch($('h-q'),$('h-list'),it=>{location.hash='#history/'+it.id;});
for(const b of document.querySelectorAll('#ip-ranges button'))b.onclick=()=>{range=b.dataset.range;for(const o of document.querySelectorAll('#ip-ranges button'))o.classList.toggle('active',o===b);loadChart().catch(e=>$('ip-chart').textContent=e.message);};
for(const b of document.querySelectorAll('#h-ranges button'))b.onclick=()=>{hRange=b.dataset.range;loadHistory();};
window.addEventListener('mesoswatch:observed',()=>{if(currentItem)loadSummary().catch(()=>{});});
