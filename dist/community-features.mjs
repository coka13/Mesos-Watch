import {client,configured,getItem}from './api.mjs?v=ms-4';
import {iconEl,mesoAmt,ago}from './checker.mjs?v=ms-8';
import {result}from './community-api.mjs';
const $=id=>document.getElementById(id),world=()=>$('world').value||'';
const el=(t,p={},...kids)=>{const e=Object.assign(document.createElement(t),p);e.append(...kids.filter(x=>x!=null));return e;};
const message=(text,error=false)=>{$('community-status').textContent=text;$('community-status').className='status'+(error?' error':'');};
const run=fn=>async e=>{e?.preventDefault();try{await fn();}catch(err){message(err.message,true);}};
const link=item=>el('a',{className:'item-link',href:'#item/'+item.id},iconEl(item,28),el('span',{textContent:item.name}));
async function loadRooms(){if(!configured())return;const sb=await client();const [rooms,items]=await Promise.all([result(sb.rpc('recent_fm_rooms',{p_world:world()})),result(sb.from('visible_items').select('id,name,game_id,category,icon_path,last_verified_at').order('last_verified_at',{ascending:false,nullsFirst:false}).limit(8))]);$('recent-fm-rooms').replaceChildren(...(rooms.length?rooms.map(r=>el('li',{},el('b',{textContent:r.map+(r.channel?' · Ch '+r.channel:'')}),el('small',{textContent:ago(r.last_seen)+' · '+r.observations+' observations · '+r.contributors+' contributor accounts; not independent identities'}))):[el('li',{className:'empty',textContent:'No FM rooms observed in the last 24 hours.'})]));$('recent-catalog-items').replaceChildren(...items.map(r=>el('li',{},link(r),el('small',{textContent:(r.category==='cash'?'NX · ':'')+'verified '+ago(r.last_verified_at)}))));}
function storeAnalytics(){let rows=[];try{rows=JSON.parse(localStorage.getItem('mw-sales')||'[]');if(!Array.isArray(rows))rows=[];}catch{}const corroborated=rows.filter(r=>r.corroborated===true&&Number.isFinite(r.amount));$('personal-analytics').textContent=rows.length+' local detections · '+corroborated.length+' OCR-corroborated · '+corroborated.reduce((n,r)=>n+r.amount,0).toLocaleString()+' mesos corroborated total change. These are not independently reviewed trades. Export history before clearing browser data.';}
window.addEventListener('mesoswatch:view',e=>{if(e.detail.view==='checker')run(loadRooms)();if(e.detail.view==='store')storeAnalytics();});
if(document.body.dataset.view==='checker')run(loadRooms)();storeAnalytics();

const categoryButtons=[...document.querySelectorAll('#catalog-categories button')];
const categoryList=$('catalog-category-items'),more=$('catalog-more'),categoryStatus=$('catalog-status');
const pageSize=50;
let category='',offset=0,request=0;

async function loadCategory(){
 const current=++request;
 more.disabled=true;
 categoryStatus.textContent='Loading items…';
 try{
  if(!configured())throw Error('Catalog database not connected.');
  const rows=await result((await client()).from('visible_items').select('id,name,game_id,icon_path,category')
   .eq('category',category).order('name').order('id').range(offset,offset+pageSize));
  if(current!==request)return;
  const page=rows.slice(0,pageSize);
  if(!offset&&!page.length)categoryList.append(el('li',{className:'empty',textContent:'No verified items available in this category yet.'}));
  categoryList.append(...page.map(item=>el('li',{},link(item))));
  offset+=page.length;
  more.hidden=rows.length<=pageSize;
  categoryStatus.textContent=offset?offset.toLocaleString()+' items shown.':'';
 }catch(e){
  if(current!==request)return;
  categoryStatus.textContent=e.message;
  more.hidden=false;
 }finally{
  if(current===request)more.disabled=false;
 }
}
for(const button of categoryButtons){
 button.setAttribute('aria-pressed','false');
 button.onclick=()=>{
  category=button.dataset.category;
  offset=0;
  categoryList.replaceChildren();
  more.hidden=true;
  for(const option of categoryButtons)option.setAttribute('aria-pressed',String(option===button));
  loadCategory();
 };
}
more.onclick=loadCategory;
