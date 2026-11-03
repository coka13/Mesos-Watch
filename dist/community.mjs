import {configured,searchItems,getItem,itemSummary,client} from './api.mjs?v=ms-2';
import {iconEl,mesoAmt,ago,statText} from './checker.mjs?v=ms-2';
import {calculateTrade} from './trading.mjs';
import * as api from './community-api.mjs';
const $=id=>document.getElementById(id),world=()=>$('world').value||'';
const el=(tag,props={},...children)=>{const e=Object.assign(document.createElement(tag),props);e.append(...children.filter(x=>x!=null));return e;};
const note=(text,error=false)=>{$('community-status').textContent=text;$('community-status').className='status'+(error?' error':'');};
const run=fn=>async e=>{e?.preventDefault();try{await fn(e);}catch(err){note(err.message,true);}};
const link=item=>el('a',{href:'#item/'+item.id,className:'item-link'},iconEl(item,28),el('span',{textContent:item.name}));
async function loadStores(param){
 if(!configured())throw Error('Player stores appear once the community database is connected.');

 const all=await api.publicStores(world());
 $('public-stores').replaceChildren(...(all.length?all.map(s=>{const a=el('a',{href:'#stores/'+s.id,textContent:s.name});a.onclick=run(()=>openPublicStore(s));return el('li',{},a,el('span',{textContent:s.character_name+' · '+s.world+' · Ch '+s.channel+' FM '+s.room}),el('small',{textContent:'Updated '+ago(s.updated_at)}));}):[el('li',{className:'empty',textContent:'No active player stores yet.'})]));
 const linked=param&&all.find(s=>String(s.id)===String(param));if(linked)await openPublicStore(linked);
 const routeId=location.hash.split('/')[1];if(routeId){const s=all.find(s=>s.id===routeId);if(s)await openPublicStore(s);else{const sb=await client();const [found]=await api.result(sb.from('public_player_stores').select('*').eq('id',routeId).limit(1));if(found)await openPublicStore(found);}}
}
async function openPublicStore(s){
 $('public-store-detail').hidden=false;$('public-store-title').textContent=s.name+' · '+s.character_name;$('public-store-description').textContent=s.description;
 const rows=await api.storeListings(s.id);$('public-store-items').replaceChildren(...(rows.length?rows.map(r=>el('li',{},link({...r,id:r.item_id,name:r.item_name}),mesoAmt(Number(r.price).toLocaleString()),el('span',{textContent:'×'+r.qty+' · '+statText(r.stats)}),el('small',{textContent:r.source+' · '+ago(r.updated_at)+' · expires '+new Date(r.expires_at).toLocaleString()}))):[el('li',{className:'empty',textContent:'No active listings. Published listings expire after 24 hours.'})]));
}
function trade(){try{const r=calculateTrade({buy:Number($('trade-buy').value),sell:Number($('trade-sell').value),quantity:Number($('trade-qty').value),feePercent:Number($('trade-fee').value),flatFee:Number($('trade-flat').value)});$('trade-output').replaceChildren(...[['Net profit',r.profit],['Fees',r.fees],['Break-even price each',r.breakEven]].map(([label,value])=>el('div',{className:'kpi'},el('span',{textContent:label}),value===null?el('strong',{textContent:'Not attainable'}):el('strong',{},mesoAmt(value.toLocaleString())))),el('p',{textContent:'ROI '+(r.roi===null?'undefined (zero cost)':r.roi.toFixed(2)+'%')+' · Profit margin '+(r.margin===null?'undefined (no positive net revenue)':r.margin.toFixed(2)+'%')+' · Estimates only; confirm in-game fees.'}));}catch(e){$('trade-output').textContent=e.message;}}
$('trade-form').oninput=trade;$('trade-form').onsubmit=e=>e.preventDefault();trade();
$('trade-compare').onclick=run(async()=>{const rows=await searchItems($('trade-item').value.trim(),world(),10);$('trade-market').replaceChildren(...rows.map(r=>el('li',{},link(r),el('button',{textContent:'Compare',onclick:run(async()=>{const s=await itemSummary(r.id,world());$('trade-market-note').textContent=s.median_ask_7d?'7-day asking median '+Number(s.median_ask_7d).toLocaleString()+' mesos · last seen '+ago(s.last_seen)+' · variants may differ.':'No market data available yet';})}))));});
async function loadOpportunities(){const rows=await api.opportunities(world());$('market-opportunities').replaceChildren(...(rows.length?rows.map(r=>el('li',{},link({id:r.item_id,...r}),el('span',{textContent:statText(r.stats)}),mesoAmt(Number(r.lowest).toLocaleString()),document.createTextNode(' to '),mesoAmt(Number(r.highest).toLocaleString()),el('small',{textContent:r.shops+' shops · last seen '+ago(r.last_seen)+' · captured stats match; full variant and availability unconfirmed'}))):[el('li',{className:'empty',textContent:'No comparable recent observations. Requires matching captured stats in at least two shops within one hour.'})]));}
window.addEventListener('mesoswatch:view',e=>{if(['stores','opportunities'].includes(e.detail.view))run(e.detail.view==='stores'?()=>loadStores(e.detail.param):loadOpportunities)();});

if(document.body.dataset.view==='stores')run(loadStores)();
if(document.body.dataset.view==='opportunities')run(loadOpportunities)();
