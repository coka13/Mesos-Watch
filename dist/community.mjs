import {configured,searchItems,getItem,itemSummary,client} from './api.mjs?v=ms-4';
import {iconEl,mesoAmt,ago,statText} from './checker.mjs?v=ms-8';

import {whereToFind} from './location.mjs?v=loc-1';
import * as api from './community-api.mjs';
const $=id=>document.getElementById(id),world=()=>$('world').value||'';
const el=(tag,props={},...children)=>{const e=Object.assign(document.createElement(tag),props);e.append(...children.filter(x=>x!=null));return e;};
const note=(text,error=false)=>{$('community-status').textContent=text;$('community-status').className='status'+(error?' error':'');};
const run=fn=>async e=>{e?.preventDefault();try{await fn(e);}catch(err){note(err.message,true);}};
const link=item=>el('a',{href:'#item/'+item.id,className:'item-link'},iconEl(item,28),el('span',{textContent:item.name}));
async function loadStores(param){
 if(!configured())throw Error('Player stores appear once the community database is connected.');

 const all=await api.publicStores(world());
 $('public-stores').replaceChildren(...(all.length?all.map(s=>{const a=el('a',{href:'#stores/'+s.id,textContent:s.name});a.onclick=run(()=>openPublicStore(s));return el('li',{},a,el('span',{textContent:s.character_name+' · '+s.world+' · Where to find: '+whereToFind(s)}),el('small',{textContent:'Updated '+ago(s.updated_at)}));}):[el('li',{className:'empty',textContent:'No active player stores yet.'})]));
 const linked=param&&all.find(s=>String(s.id)===String(param));if(linked)await openPublicStore(linked);
 const routeId=location.hash.split('/')[1];if(routeId){const s=all.find(s=>s.id===routeId);if(s)await openPublicStore(s);else{const sb=await client();const [found]=await api.result(sb.from('public_player_stores').select('*').eq('id',routeId).limit(1));if(found)await openPublicStore(found);}}
}
async function openPublicStore(s){
 $('public-store-detail').hidden=false;$('public-store-title').textContent=s.name+' · '+s.character_name;$('public-store-description').textContent=[s.world&&('Where to find: '+[s.world,whereToFind(s)].join(' • ')),s.description].filter(Boolean).join(' — ');
 // Items still for sale first; sold ones (published from Store Watcher) keep their price with a Sold badge.
 const rows=(await api.storeListings(s.id)).sort((a,b)=>!!a.sold-!!b.sold);$('public-store-items').replaceChildren(...(rows.length?rows.map(r=>el('li',{},el('span',{className:'fm-badge'+(r.sold?' sold':''),textContent:r.sold?'Sold':'For sale'}),link({...r,id:r.item_id,name:r.item_name}),mesoAmt(Number(r.price).toLocaleString()),el('span',{textContent:'×'+r.qty+' · '+statText(r.stats)}),el('small',{textContent:r.source+' · '+ago(r.updated_at)+' · expires '+new Date(r.expires_at).toLocaleString()}))):[el('li',{className:'empty',textContent:'No active listings. Published listings expire after 24 hours.'})]));
}
window.addEventListener('mesoswatch:view',e=>{if(e.detail.view==='stores')run(()=>loadStores(e.detail.param))();});

if(document.body.dataset.view==='stores')run(loadStores)();
