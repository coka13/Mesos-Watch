// Site admin, inside Settings: megaphone moderation, sale evidence, reports, Cash Shop candidates and community items. Nothing here is
// shown unless the database says this account is an admin, and the database enforces every action regardless.
import {configured,client,adminSignIn,adminState,signOut,moderationQueue,moderateMegaphone,unverifiedItems,updateItem,getItem} from './api.mjs?v=depth-1';
import {iconEl,mesoAmt,ago} from './checker.mjs?v=depth-1';
import {result} from './community-api.mjs';
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const e=Object.assign(document.createElement(tag),props);e.append(...kids.filter(k=>k!=null&&k!==false));return e;};
const money=c=>'$'+(c/100).toFixed(2);
const link=item=>el('a',{className:'item-link',href:'#item/'+item.id},iconEl(item,28),el('span',{textContent:item.name}));
const empty=(id,text)=>$(id).replaceChildren(el('li',{className:'empty',textContent:text}));
const failed=(id,e)=>$(id).replaceChildren(el('li',{className:'empty error',textContent:e.message}));

async function loadState(){
 if(!configured()){$('adm-state').textContent='The database is not connected.';$('adm-login').hidden=true;return;}
 const s=await adminState().catch(()=>({email:null,admin:false}));
 $('adm-state').textContent=s.email?(s.admin?`Signed in as ${s.email} (admin).`:`Signed in as ${s.email}, which is not an admin account.`):'Only site admins need this.';
 $('adm-out').hidden=!s.email;$('adm-login').hidden=!!s.email;$('adm-panel').hidden=!s.admin;
 if(s.admin){await Promise.all([loadQueue(),loadReview(),loadItems()]);window.dispatchEvent(new Event('mesoswatch:admin-ready'));}
}
$('adm-login').onsubmit=async e=>{e.preventDefault();try{await adminSignIn($('adm-email').value.trim());$('adm-state').textContent='Check your inbox for the sign-in link.';}catch(err){$('adm-state').textContent=err.message;}};
$('adm-out').onclick=async()=>{await signOut();loadState();};

async function loadQueue(){
 try{
  const q=await moderationQueue();
  if(!q.length)return empty('adm-queue','Nothing waiting.');
  $('adm-queue').replaceChildren(...q.map(m=>{
   const reason=el('input',{placeholder:'Reason (shown to buyer)',maxLength:200}),note=el('small',{className:'err'});
   const act=(a,extra)=>async()=>{try{await moderateMegaphone(a,m.id,{reason:reason.value,...extra});loadQueue();}catch(e){note.textContent=e.message;}};
   const open=['queued','live'].includes(m.display_status),review=['paid_pending_review','awaiting_payment'].includes(m.display_status);
   return el('li',{},el('span',{className:'msg',textContent:(m.sender?m.sender+' : ':'')+m.message}),
    el('small',{textContent:`${m.display_status} · ${m.minutes} min · ${money(m.price_cents)}${m.livemode?'':' (test)'} · ${ago(m.created_at)}${m.starts_at?' · '+new Date(m.starts_at).toLocaleString()+' → '+new Date(m.ends_at).toLocaleTimeString():''}`}),
    el('div',{className:'row'},reason,m.display_status==='paid_pending_review'&&el('button',{textContent:'Approve',className:'primary',onclick:act('approve')}),review&&el('button',{textContent:m.payment_intent?'Reject & refund':'Reject',onclick:act('reject')}),open&&el('button',{textContent:'Remove & refund',onclick:act('remove',{refund:true})}),open&&el('button',{textContent:'Remove, no refund',onclick:act('remove',{refund:false})})),note);
  }));
 }catch(e){failed('adm-queue',e);}
}
async function loadReview(){
 const sb=await client(),done=fn=>async()=>{try{await fn();await loadReview();}catch(e){$('adm-note').textContent=e.message;}};
 try{
  const sales=await result(sb.from('observations').select('id,item_id,item_name,price,qty,seen_at,world,confidence').eq('kind','sale').eq('verification_status','reported').order('seen_at',{ascending:false}).limit(50));
  if(!sales.length)empty('admin-sale-reviews','No reported sales waiting.');
  else $('admin-sale-reviews').replaceChildren(...await Promise.all(sales.map(async r=>{
   const reason=el('textarea',{placeholder:'Independent evidence and your reason (10+ characters)',ariaLabel:'Review reason'}),item=await getItem(r.item_id);
   return el('li',{},item?link(item):el('span',{textContent:r.item_name}),mesoAmt(Number(r.price).toLocaleString()),el('small',{textContent:`Sale #${r.id} · ×${r.qty} · ${ago(r.seen_at)} · OCR confidence ${r.confidence??'unknown'}`}),reason,
    ...['verified','rejected'].map(decision=>el('button',{textContent:decision==='verified'?'Verify with evidence':'Reject',onclick:done(()=>result(sb.rpc('review_observation',{p_id:r.id,p_decision:decision,p_reason:reason.value})))})));
  })));
 }catch(e){failed('admin-sale-reviews',e);}
 try{
  const reports=await result(sb.from('market_reports').select('*').eq('status','open').order('created_at').limit(50));
  if(!reports.length)empty('admin-market-reports','No open reports.');
  else $('admin-market-reports').replaceChildren(...reports.map(r=>{
   const note=el('input',{placeholder:'Review note (10+ characters)',ariaLabel:'Review note'});
   return el('li',{},el('span',{textContent:r.reason}),el('small',{textContent:(r.observation_id?'Listing #'+r.observation_id:'Campaign '+r.megaphone_id)+' · '+ago(r.created_at)}),note,
    ...[['dismissed','Dismiss'],['actioned','Mark actioned']].map(([status,label])=>el('button',{textContent:label,onclick:done(()=>result(sb.rpc('review_market_report',{p_id:r.id,p_status:status,p_note:note.value})))})));
  }));
 }catch(e){failed('admin-market-reports',e);}
 try{
  const cash=await result(sb.from('cash_item_candidates').select('*').eq('status','pending').order('created_at').limit(50));
  if(!cash.length)empty('admin-cash-reviews','No Cash Shop candidates waiting.');
  else $('admin-cash-reviews').replaceChildren(...cash.map(c=>{
   const gid=el('input',{type:'number',min:1,placeholder:'Verified game item ID'}),source=el('input',{type:'url',placeholder:'Classic release source URL'}),review=el('textarea',{placeholder:'Evidence and review note (10+ characters)'});
   return el('li',{},el('b',{textContent:c.name}),el('small',{textContent:(c.nx_price===null?'Unknown NX price':c.nx_price+' NX')+' · '+c.category+' · '+c.source_note}),gid,source,review,
    ...[['accepted','Accept'],['rejected','Reject']].map(([decision,label])=>el('button',{textContent:label,onclick:done(()=>result(sb.rpc('review_cash_candidate',{p_id:c.id,p_decision:decision,p_game_id:gid.value?Number(gid.value):null,p_source:source.value,p_note:review.value})))})));
  }));
 }catch(e){failed('admin-cash-reviews',e);}
}
async function loadItems(){
 try{
  const items=await unverifiedItems();
  if(!items.length)return empty('adm-items','No community items waiting for review.');
  $('adm-items').replaceChildren(...items.map(it=>{
   const gid=el('input',{type:'number',placeholder:'Game item ID',min:1000000,max:9999999,value:it.game_id||''}),name=el('input',{value:it.name,maxLength:60}),msg=el('small');
   // Names outside the Classic catalog are nearly always NX items, so NX is the default type.
   const source=el('input',{placeholder:'Classic release source URL (https://…)',type:'url'}),cat=el('select',{ariaLabel:'Item type'},...[['cash','NX'],['equip','Equipment'],['use','Use'],['setup','Setup'],['etc','Etc']].map(([v,t])=>new Option(t,v,false,v===(it.category!=='unknown'?it.category:'cash'))));
   return el('li',{},iconEl(it,28),name,cat,gid,source,el('button',{textContent:'Verify',onclick:async()=>{try{if(!source.value.trim().startsWith('https://'))throw Error('Add the release source URL.');await updateItem(it.id,{name:name.value.trim(),category:cat.value,game_id:gid.value?+gid.value:null,verified:true,release_status:'released',last_verified_at:new Date().toISOString(),verification_source:source.value.trim()});loadItems();}catch(e){msg.textContent=e.message;}}}),el('small',{textContent:'first seen '+ago(it.first_seen)}),msg);
  }));
 }catch(e){failed('adm-items',e);}
}
$('site-admin').addEventListener('toggle',()=>{if($('site-admin').open)loadState();});
window.addEventListener('mesoswatch:view',e=>{if(e.detail.view==='settings'&&$('site-admin').open)loadState();});
