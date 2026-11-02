import {configured,searchItems,getItem,itemSummary,client} from './api.mjs?v=ms-2';
import {iconEl,mesoAmt,ago,statText} from './checker.mjs?v=ms-2';
import {calculateTrade} from './trading.mjs';
import * as api from './community-api.mjs';
const $=id=>document.getElementById(id),world=()=>$('world').value||'';
const el=(tag,props={},...children)=>{const e=Object.assign(document.createElement(tag),props);e.append(...children.filter(x=>x!=null));return e;};
const note=(text,error=false)=>{$('community-status').textContent=text;$('community-status').className='status'+(error?' error':'');};
const run=fn=>async e=>{e?.preventDefault();try{await fn(e);}catch(err){note(err.message,true);}};
const link=item=>el('a',{href:'#item/'+item.id,className:'item-link'},iconEl(item,28),el('span',{textContent:item.name}));
let stores=[],storeId=null,listingId=null,selected=null,listingItems=new Map();
async function loadStores(){
 if(!configured())throw Error('Connect the price database before publishing stores.');
 const user=await api.account();$('player-login').hidden=!!user;$('player-account').textContent=user?'Signed in as '+user.email:'Sign in by email to manage a public store.';$('store-editor').hidden=!user;
 const all=await api.publicStores(world());
 $('public-stores').replaceChildren(...(all.length?all.map(s=>{const a=el('a',{href:'#stores/'+s.id,textContent:s.name});a.onclick=run(()=>openPublicStore(s));return el('li',{},a,el('span',{textContent:s.character_name+' · '+s.world+' · Ch '+s.channel+' FM '+s.room}),el('small',{textContent:'Updated '+ago(s.updated_at)}));}):[el('li',{className:'empty',textContent:'No active player stores yet.'})]));
 stores=user?await api.ownStores():[];$('owned-store').replaceChildren(new Option('Create a store',''),...stores.map(s=>new Option(s.name,s.id)));
 if(storeId&&stores.some(s=>s.id===storeId)){$('owned-store').value=storeId;await editStore();}
 const routeId=location.hash.split('/')[1];if(routeId){const s=all.find(s=>s.id===routeId);if(s)await openPublicStore(s);else{const sb=await client();const [found]=await api.result(sb.from('public_player_stores').select('*').eq('id',routeId).limit(1));if(found)await openPublicStore(found);}}
}
async function openPublicStore(s){
 $('public-store-detail').hidden=false;$('public-store-title').textContent=s.name+' · '+s.character_name;$('public-store-description').textContent=s.description;
 const rows=await api.storeListings(s.id);$('public-store-items').replaceChildren(...(rows.length?rows.map(r=>el('li',{},link({...r,id:r.item_id,name:r.item_name}),mesoAmt(Number(r.price).toLocaleString()),el('span',{textContent:'×'+r.qty+' · '+statText(r.stats)}),el('small',{textContent:r.source+' · '+ago(r.updated_at)+' · expires '+new Date(r.expires_at).toLocaleString()}))):[el('li',{className:'empty',textContent:'No active listings. Published listings expire after 24 hours.'})]));
}
async function editStore(){
 storeId=$('owned-store').value||null;const s=stores.find(x=>x.id===storeId);
 for(const [id,key]of [['store-character','character_name'],['store-name','name'],['store-world','world'],['store-channel','channel'],['store-room','room'],['store-description','description']])$(id).value=s?.[key]??(['store-channel','store-room'].includes(id)?1:'');
 $('store-active').checked=s?.active??true;$('store-delete').hidden=!s;$('listing-editor').hidden=!s;
 if(s)await loadOwnedListings();
}
async function loadOwnedListings(){
 const rows=await api.storeListings(storeId,true);listingItems=new Map();
 const enriched=await Promise.all(rows.map(async r=>({...r,item:await getItem(r.item_id)})));
 $('owned-listings').replaceChildren(...enriched.map(r=>{listingItems.set(r.id,r);return el('li',{},link(r.item),mesoAmt(Number(r.price).toLocaleString()),el('span',{textContent:'×'+r.qty+' · '+(r.active?'active':'inactive')+' · '+ago(r.updated_at)}),el('button',{textContent:'Edit',onclick:()=>{listingId=r.id;selected=r.item;$('listing-item').value=r.item.name;$('listing-price').value=r.price;$('listing-qty').value=r.qty;$('listing-stats').value=JSON.stringify(r.stats);$('listing-observation').value=r.observation_id||'';$('listing-active').checked=r.active;}}),el('button',{textContent:'Remove',onclick:run(async()=>{await api.removeListing(r.id);await loadOwnedListings();})}));}));
}
$('player-login').onsubmit=run(async()=>{await api.signIn($('player-email').value.trim());note('Check your email for a sign-in link.');});
$('owned-store').onchange=run(editStore);
$('store-form').onsubmit=run(async()=>{const s=await api.saveStore(storeId,{character_name:$('store-character').value.trim(),name:$('store-name').value.trim(),world:$('store-world').value.trim(),channel:Number($('store-channel').value),room:Number($('store-room').value),description:$('store-description').value.trim(),active:$('store-active').checked});storeId=s.id;await loadStores();note('Store saved.');});
$('store-delete').onclick=run(async()=>{const s=stores.find(x=>x.id===storeId);if(!s)return;await api.saveStore(storeId,{active:false});note('Store deactivated; its listings are hidden.');await loadStores();});
let searchSeq=0,searchTimer;
$('listing-item').oninput=()=>{selected=null;clearTimeout(searchTimer);const seq=++searchSeq;searchTimer=setTimeout(run(async()=>{const q=$('listing-item').value.trim();if(q.length<2){$('listing-matches').replaceChildren();return;}const rows=await searchItems(q,world(),10);if(seq!==searchSeq)return;$('listing-matches').replaceChildren(...rows.map(r=>el('li',{},el('button',{type:'button',onclick:()=>{selected=r;$('listing-item').value=r.name;$('listing-matches').replaceChildren();}},iconEl(r,24),document.createTextNode(r.name)))));}),200);};
$('listing-form').onsubmit=run(async()=>{if(!selected)throw Error('Select a verified item from search results.');let stats;try{stats=JSON.parse($('listing-stats').value||'{}');}catch{throw Error('Captured stats must be a JSON object.');}const patch={item_id:selected.id,price:Number($('listing-price').value),qty:Number($('listing-qty').value),stats,observation_id:$('listing-observation').value?Number($('listing-observation').value):null,active:$('listing-active').checked};if(!listingId)patch.store_id=storeId;await api.saveListing(listingId,patch);listingId=null;selected=null;$('listing-form').reset();$('listing-stats').value='{}';await loadOwnedListings();note('User listing saved for 24 hours.');});
$('listing-cancel').onclick=()=>{listingId=null;selected=null;$('listing-form').reset();$('listing-stats').value='{}';};
$('listing-assist').onclick=run(async()=>{const id=Number($('listing-observation').value);if(!Number.isSafeInteger(id)||id<1)throw Error('Enter an observation ID.');const sb=await client();const r=await api.result(sb.from('observations').select('item_id,price,qty,stats,seen_at,world,kind').eq('id',id).single());const s=stores.find(x=>x.id===storeId);if(r.kind!=='ask'||r.world!==s.world||Date.now()-new Date(r.seen_at)>864e5)throw Error('Use a recent asking-price observation from this world.');selected=await getItem(r.item_id);$('listing-item').value=selected.name;$('listing-price').value=r.price;$('listing-qty').value=r.qty;$('listing-stats').value=JSON.stringify(r.stats);note('Observation filled in. Review before publishing; ownership and current inventory are unverified.');});
function trade(){try{const r=calculateTrade({buy:Number($('trade-buy').value),sell:Number($('trade-sell').value),quantity:Number($('trade-qty').value),feePercent:Number($('trade-fee').value),flatFee:Number($('trade-flat').value)});$('trade-output').replaceChildren(...[['Net profit',r.profit],['Fees',r.fees],['Break-even price each',r.breakEven]].map(([label,value])=>el('div',{className:'kpi'},el('span',{textContent:label}),value===null?el('strong',{textContent:'Not attainable'}):el('strong',{},mesoAmt(value.toLocaleString())))),el('p',{textContent:'ROI '+(r.roi===null?'undefined (zero cost)':r.roi.toFixed(2)+'%')+' · Profit margin '+(r.margin===null?'undefined (no positive net revenue)':r.margin.toFixed(2)+'%')+' · Estimates only; confirm in-game fees.'}));}catch(e){$('trade-output').textContent=e.message;}}
$('trade-form').oninput=trade;$('trade-form').onsubmit=e=>e.preventDefault();trade();
$('trade-compare').onclick=run(async()=>{const rows=await searchItems($('trade-item').value.trim(),world(),10);$('trade-market').replaceChildren(...rows.map(r=>el('li',{},link(r),el('button',{textContent:'Compare',onclick:run(async()=>{const s=await itemSummary(r.id,world());$('trade-market-note').textContent=s.median_ask_7d?'7-day asking median '+Number(s.median_ask_7d).toLocaleString()+' mesos · last seen '+ago(s.last_seen)+' · variants may differ.':'No market data available yet';})}))));});
async function loadOpportunities(){const rows=await api.opportunities(world());$('market-opportunities').replaceChildren(...(rows.length?rows.map(r=>el('li',{},link({id:r.item_id,...r}),el('span',{textContent:statText(r.stats)}),mesoAmt(Number(r.lowest).toLocaleString()),document.createTextNode(' to '),mesoAmt(Number(r.highest).toLocaleString()),el('small',{textContent:r.shops+' shops · last seen '+ago(r.last_seen)+' · captured stats match; full variant and availability unconfirmed'}))):[el('li',{className:'empty',textContent:'No comparable recent observations. Requires matching captured stats in at least two shops within one hour.'})]));}
window.addEventListener('mesoswatch:view',e=>{if(['stores','opportunities'].includes(e.detail.view))run(e.detail.view==='stores'?loadStores:loadOpportunities)();});
window.addEventListener('mesoswatch:account',()=>run(loadStores)());
if(document.body.dataset.view==='stores')run(loadStores)();
if(document.body.dataset.view==='opportunities')run(loadOpportunities)();
