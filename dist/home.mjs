// Home page extras below the price checker: market statistics and community stores. Real counts only; nothing is estimated.
import {client,configured} from './api.mjs?v=ms-2';
import {publicStores} from './community-api.mjs';
import {ago} from './checker.mjs?v=ms-2';
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=Object.assign(document.createElement(tag),props);e.append(...kids.filter(k=>k!=null&&k!==false));return e;};
const fmt=n=>n==null?'—':Number(n).toLocaleString('en-US');

// Rejected observations are hidden through market_observations once migration 20261101001300 is applied; before that the
// table itself is the market.
let source=null;
async function count(table,filter=q=>q){const {count,error}=await filter((await client()).from(table).select('id',{count:'exact',head:true}));if(error)throw error;return count;}
async function listings(since){
 const world=$('world')?.value||'',f=q=>{q=q.gte('seen_at',since);return world?q.eq('world',world):q;};
 if(!source){try{const n=await count('market_observations',f);source='market_observations';return n;}catch{source='observations';}}
 return count(source,f);
}
export async function loadStats(){
 const box=$('home-stats');if(!box)return;
 if(!configured()){box.replaceChildren(el('p',{className:'empty',textContent:'Market statistics appear once the community database is connected.'}));return;}
 const day=new Date(Date.now()-864e5).toISOString(),week=new Date(Date.now()-7*864e5).toISOString();
 const tile=(label,value,note)=>el('div',{className:'kpi'},el('span',{textContent:label}),el('strong',{textContent:value}),el('small',{textContent:note}));
 try{
  const [d,w,items]=await Promise.all([listings(day),listings(week),count('visible_items')]);
  box.replaceChildren(tile('Listings seen · 24 h',fmt(d),d?'from shared FM scans':'No market data available yet'),tile('Listings seen · 7 d',fmt(w),'asking prices, not sales'),tile('Items in the catalog',fmt(items),'searchable with or without prices'));
 }catch(e){box.replaceChildren(el('p',{className:'empty error',textContent:'Statistics unavailable: '+e.message}));}
}
export async function loadStores(){
 const list=$('home-stores');if(!list)return;
 if(!configured()){list.replaceChildren(el('li',{className:'empty',textContent:'Player stores appear once the community database is connected.'}));return;}
 try{const stores=(await publicStores($('world')?.value||'')).slice(0,6);
  list.replaceChildren(...(stores.length?stores.map(s=>el('li',{},el('a',{href:'#stores/'+encodeURIComponent(s.id),textContent:s.name}),el('small',{textContent:[s.character_name,s.world,s.channel?'Ch '+s.channel:'',s.room,'updated '+ago(s.updated_at)].filter(Boolean).join(' · ')}))):[el('li',{className:'empty',textContent:'No player stores published yet. Check back as the community grows.'})]));
 }catch(e){list.replaceChildren(el('li',{className:'empty',textContent:/not set up|PGRST|does not exist|schema cache/i.test(e.message)?'Player stores open once the site owner applies the player-store migration.':e.message}));}
}
function refresh(){if(document.body.dataset.view==='checker'&&!$('home')?.hidden){loadStats();loadStores();}}
window.addEventListener('mesoswatch:view',e=>{if(e.detail.view==='checker'&&!e.detail.param)refresh();});
window.addEventListener('mesoswatch:observed',()=>loadStats());
$('world')?.addEventListener('change',refresh);
refresh();
