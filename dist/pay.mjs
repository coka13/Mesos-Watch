// PayPal and crypto (NOWPayments) payments for megaphones, sponsor slots and donations. The browser only starts a payment
// and returns from it; prices come from the database and every payment is confirmed on the server
// (supabase/functions/pay-create, paypal-capture, nowpayments-ipn) before anything goes live.
import {configured,client,session,adminState} from './api.mjs?v=ms-4';

const config=window.MESOSWATCH_CONFIG||{},pay=config.payments||{};
const PROVIDERS=(Array.isArray(pay.providers)?pay.providers:['paypal','crypto']).filter(p=>p==='paypal'||p==='crypto');
const LABEL={paypal:'PayPal',crypto:'Crypto'};
const $=id=>document.getElementById(id);
function el(tag,props={},...kids){const n=Object.assign(document.createElement(tag),props);for(const k of kids)if(k!=null&&k!==false)n.append(k);return n;}
const money=c=>'$'+(c/100).toFixed(c%100?2:0);

async function invoke(name,body){
 const sb=await session();
 const {data,error}=await sb.functions.invoke(name,{body});
 if(error){let msg=error.message;try{msg=(await error.context.json()).error||msg;}catch{}
  throw Error(/Failed to send|Function not found|404/.test(msg)?'Payments are not set up yet (the site owner still has to deploy them).':msg);}
 if(data?.error)throw Error(data.error);
 return data;
}

// Start a payment and leave for the provider. kind: megaphone | sponsor | donation; provider: paypal | crypto.
export async function startPayment(kind,provider,fields){
 if(!PROVIDERS.includes(provider))throw Error('That payment method is not available.');
 try{sessionStorage.setItem('mw-pay-back',location.hash||'#checker');}catch{}
 const out=await invoke('pay-create',{...fields,kind,provider,return_url:location.origin+location.pathname});
 location.href=out.url;
}

// ---- Returning from PayPal / NOWPayments: #pay?kind=…&id=…&provider=…&result=return|cancel ----
function toast(text,kind=''){
 let t=$('pay-toast');if(!t){t=el('div',{id:'pay-toast',className:'pay-toast',role:'status'});document.body.append(t);}
 t.className='pay-toast status '+kind;t.textContent=text;t.hidden=false;clearTimeout(t._h);t._h=setTimeout(()=>{t.hidden=true;},kind==='error'?20000:12000);
 t.onclick=()=>{t.hidden=true;};
}
const DONE={megaphone:'Payment received. Your megaphone is in the review queue; its time starts when it is approved and a slot is free.',
 sponsor:'Payment received. Your sponsor banner goes live after a quick review.',donation:'Thank you for supporting Mesos-Watch! 💛'};
async function handleReturn(){
 const raw=location.hash.replace(/^#/,'');if(!raw.startsWith('pay?'))return;
 const q=new URLSearchParams(raw.slice(4)),kind=q.get('kind'),id=q.get('id'),provider=q.get('provider'),result=q.get('result');
 let back='#checker';try{back=sessionStorage.getItem('mw-pay-back')||back;sessionStorage.removeItem('mw-pay-back');}catch{}
 if(kind==='megaphone')back='#megaphones';
 history.replaceState(null,'',location.pathname+location.search+back);window.dispatchEvent(new HashChangeEvent('hashchange'));
 if(!/^(megaphone|sponsor|donation)$/.test(kind||'')||!/^[0-9a-f-]{36}$/.test(id||''))return;
 try{
  if(provider==='paypal'){
   toast(result==='cancel'?'Payment cancelled. You were not charged.':'Confirming your PayPal payment…');
   const out=await invoke('paypal-capture',{kind,id,...(result==='cancel'?{cancel:true}:{})});
   if(result==='cancel')return;
   if(out.status==='paid'||out.status==='paid_pending_review'||out.status==='scheduled')toast(DONE[kind],'ok');
   else if(out.status==='pending')toast('PayPal is still processing this payment. It activates automatically once PayPal completes it.','warn');
   else toast(out.note||'The payment was not completed.','warn');
  }else if(provider==='crypto'){
   toast(result==='cancel'?'Crypto payment cancelled. Nothing was charged.':'Crypto payment sent. It is confirmed automatically after the blockchain confirmations (usually a few minutes).',result==='cancel'?'':'ok');
  }
 }catch(e){toast(e.message,'error');}
}

// ---- Megaphones: PayPal / crypto buttons next to the existing button (Stripe only if the owner enables it). ----
function megaphoneButtons(){
 const buy=$('mg-buy');if(!buy||$('mg-pay-buttons'))return;
 const wrap=el('div',{id:'mg-pay-buttons',className:'pay-buttons'});
 for(const p of PROVIDERS)wrap.append(el('button',{type:'submit',className:'primary pay-'+p,textContent:'Pay with '+LABEL[p]},));
 [...wrap.children].forEach((b,i)=>{b.dataset.provider=PROVIDERS[i];});
 buy.after(wrap);
 const stripe=pay.stripe===true;buy.hidden=!stripe;
 // Mirror the form's enabled state and price label from the existing button.
 const sync=()=>{const price=(buy.textContent.match(/\$[\d.]+/)||[''])[0];for(const b of wrap.children){b.disabled=buy.disabled;b.textContent=`Pay ${price?price+' ':''}with ${LABEL[b.dataset.provider]}`;}};
 new MutationObserver(sync).observe(buy,{attributes:true,childList:true,characterData:true,subtree:true});sync();
 const hint=[...buy.closest('form,section')?.querySelectorAll('.hint')||[]].find(h=>/stripe/i.test(h.textContent));
 if(hint&&!stripe)hint.textContent='Secure checkout by PayPal (card or PayPal balance) or crypto via NOWPayments (BTC, ETH, USDT and more). Your megaphone goes live only after the payment is confirmed and reviewed.';
}

// ---- Donations: amount chips and PayPal / crypto buttons in the Support card. ----
function donationBox(){
 const card=$('support');if(!card||$('donate-pay'))return;
 let amount=5;
 const chips=el('div',{className:'donate-amounts',role:'radiogroup',ariaLabel:'Donation amount'});
 const custom=el('input',{type:'number',min:1,max:500,step:1,placeholder:'Other',className:'donate-custom',ariaLabel:'Other amount in dollars'});
 const pick=v=>{amount=v;for(const c of chips.querySelectorAll('button'))c.setAttribute('aria-checked',String(+c.dataset.v===v));};
 for(const v of [3,5,10,25])chips.append(el('button',{type:'button',className:'chip',role:'radio',textContent:'$'+v,onclick:()=>{custom.value='';pick(v);}}));
 [...chips.children].forEach(c=>{c.dataset.v=c.textContent.slice(1);});chips.append(custom);custom.oninput=()=>pick(Math.floor(+custom.value)||0);pick(5);
 const name=el('input',{maxLength:30,placeholder:'Name for the thank-you list (optional)'}),msg=el('input',{maxLength:140,placeholder:'A short note (optional)'});
 const pub=el('input',{type:'checkbox'}),note=el('small',{className:'donate-note'});
 const go=p=>async()=>{if(!configured()){note.textContent='Donations open once the site is connected.';return;}
  if(!(amount>=1&&amount<=500)){note.textContent='Choose an amount from $1 to $500.';return;}
  note.textContent='Opening secure checkout…';try{await startPayment('donation',p,{amount,name:name.value,message:msg.value,public:pub.checked});}catch(e){note.textContent=e.message;}};
 const box=el('div',{id:'donate-pay',className:'donate-pay'},chips,
  el('details',{className:'donate-extra'},el('summary',{textContent:'Add your name or a note'}),name,msg,el('label',{className:'check'},pub,' Show my name and note on the thank-you list')),
  el('div',{className:'pay-buttons'},...PROVIDERS.map(p=>el('button',{type:'button',className:'donate pay-'+p,textContent:'Donate with '+LABEL[p],onclick:go(p)}))),note);
 const link=$('donate');if(link&&link.classList.contains('disabled'))link.hidden=true;
 const old=$('donation-note');if(old&&link?.hidden)old.hidden=true;
 card.append(box);
 if(configured())client().then(sb=>sb.from('donor_wall').select('name,message').limit(8)).then(({data})=>{if(data?.length)card.append(el('div',{className:'donor-wall'},el('b',{textContent:'Thank you'}),el('ul',{},...data.map(d=>el('li',{},el('span',{textContent:d.name}),d.message?el('small',{textContent:' — '+d.message}):null)))));}).catch(()=>{});
}

// ---- Sponsors: the live banner, and "Sponsor this spot" (choose days, title, link, image, pay). ----
const httpsUrl=s=>{try{const u=new URL(String(s).trim());return u.protocol==='https:'&&u.hostname.includes('.')&&!u.username?u.href:null;}catch{return null;}};
function banner(s){
 const a=el('a',{href:s.url,target:'_blank',rel:'sponsored noopener noreferrer',className:'sponsor-link'});
 if(s.image_url){const img=el('img',{src:s.image_url,alt:s.title,loading:'lazy',referrerPolicy:'no-referrer'});img.onerror=()=>img.replaceWith(el('strong',{textContent:s.title}));a.append(img);}
 else a.append(el('strong',{textContent:s.title}));
 return a;
}
async function liveSponsor(){
 const box=$('ad-content');if(!box||!configured())return;
 try{const sb=await client();const {data}=await sb.from('live_sponsors').select('title,url,image_url');
  const safe=(data||[]).filter(s=>httpsUrl(s.url)&&(!s.image_url||httpsUrl(s.image_url)));
  if(safe.length)box.replaceChildren(banner(safe[Math.floor(Math.random()*safe.length)]));
 }catch{}
}
function sponsorDialog(){
 const slot=$('ad-slot');if(!slot||$('sponsor-open'))return;
 slot.append(el('button',{id:'sponsor-open',type:'button',className:'sponsor-open',textContent:'Sponsor this spot →',onclick:openSponsor}));
}
let plans=null;
async function openSponsor(){
 let d=$('sponsor-dialog');
 if(!d){
  const title=el('input',{maxLength:40,placeholder:'e.g. Cheap Stars ch 3 FM 7',required:true}),url=el('input',{type:'url',placeholder:'https://…',required:true}),image=el('input',{type:'url',placeholder:'https://… (optional, shown at up to 300×250)'});
  const plansBox=el('div',{className:'plans',role:'radiogroup',ariaLabel:'Duration'}),preview=el('div',{className:'ad-inner sponsor-preview'}),note=el('p',{className:'hint'}),errors=el('ul',{className:'errors'});
  let chosen=null;
  const check=()=>{const e=[];if(title.value.trim().length<2)e.push('Add a title (2–40 characters).');if(!httpsUrl(url.value))e.push('The link must be a full https:// address.');if(image.value.trim()&&!httpsUrl(image.value))e.push('The image must be an https:// address.');if(!chosen)e.push('Choose a duration.');return e;};
  const render=()=>{errors.replaceChildren(...check().filter(()=>title.value||url.value).map(t=>el('li',{textContent:t})));preview.replaceChildren(banner({title:title.value.trim()||'Your sponsor banner',url:httpsUrl(url.value)||'https://example.com',image_url:httpsUrl(image.value)}));for(const b of buttons.children)b.disabled=check().length>0;};
  const go=p=>async()=>{if(check().length)return render();note.textContent='Opening secure checkout…';try{await startPayment('sponsor',p,{title:title.value,url:url.value,image_url:image.value,plan_id:chosen});}catch(e){note.textContent=e.message;}};
  const buttons=el('div',{className:'pay-buttons'},...PROVIDERS.map(p=>el('button',{type:'button',className:'primary pay-'+p,textContent:'Pay with '+LABEL[p],onclick:go(p)})));
  for(const i of [title,url,image])i.oninput=render;
  d=el('dialog',{id:'sponsor-dialog',className:'sponsor-dialog'},el('form',{method:'dialog'},
   el('h2',{textContent:'Sponsor Mesos-Watch'}),el('p',{className:'hint',textContent:'Your banner shows in the sponsor box on every page for the days you buy (up to 3 sponsors share the spot in rotation). It goes live after a quick review; links must be safe and MapleStory-appropriate. No real-money trading.'}),
   plansBox,el('label',{textContent:'Title'}),title,el('label',{textContent:'Link'}),url,el('label',{textContent:'Image (optional)'}),image,errors,
   el('div',{className:'mg-preview-wrap'},el('span',{className:'hint',textContent:'Preview'}),preview),buttons,note,
   el('button',{className:'sponsor-close',value:'close',textContent:'Close'})));
  document.body.append(d);
  try{if(!configured())throw Error('Sponsor slots open once the site is connected.');const sb=await client();const {data,error}=await sb.from('sponsor_plans').select('*').order('sort');if(error)throw error;plans=data;}
  catch(e){note.textContent=/sponsor_plans/.test(e.message||'')?'Sponsor slots are not set up yet.':e.message;plans=[];}
  plansBox.replaceChildren(...plans.map((p,i)=>{const r=el('input',{type:'radio',name:'sp-plan',value:p.id,checked:i===0});if(i===0)chosen=p.id;r.onchange=()=>{chosen=p.id;render();};
   return el('label',{className:'plan'},r,el('strong',{textContent:p.label}),el('b',{textContent:money(p.price_cents)}),el('small',{textContent:money(Math.round(p.price_cents/p.days))+' per day'}));}));
  render();
 }
 d.showModal();
}

// ---- Admin: sponsor review and donations, inside Settings → Admin. ----
async function adminPanels(){
 const panel=$('adm-panel');if(!panel||panel.hidden||!configured())return;
 const state=await adminState().catch(()=>null);if(!state?.admin)return;
 let box=$('adm-pay');
 if(!box){box=el('section',{id:'adm-pay',className:'activity'},el('div',{className:'section-head'},el('div',{},el('div',{className:'eyebrow',textContent:'PAYPAL & CRYPTO'}),el('h2',{textContent:'Sponsors and donations'}))),
  el('h3',{textContent:'Sponsor slots'}),el('ul',{id:'adm-sponsors',className:'mod-list'}),el('h3',{textContent:'Recent donations'}),el('p',{id:'adm-don-total',className:'hint'}),el('ul',{id:'adm-donations',className:'mod-list'}),
  el('p',{className:'hint',textContent:'Rejecting or removing a paid slot does not refund it automatically: refund it in the PayPal or NOWPayments dashboard, then mark it refunded here.'}));panel.append(box);}
 const sb=await client();
 const act=(fn,args)=>async()=>{const {error}=await sb.rpc(fn,typeof args==='function'?args():args);if(error)toast(error.message,'error');adminPanels();};
 const {data:sp}=await sb.from('sponsor_queue').select('*').in('display_status',['paid_pending_review','queued','live','rejected','removed']).order('created_at',{ascending:false}).limit(40);
 $('adm-sponsors').replaceChildren(...((sp||[]).length?sp.map(s=>{const reason=el('input',{placeholder:'Reason (optional)',maxLength:200});
  const b=(t,fn,args)=>el('button',{type:'button',textContent:t,onclick:act(fn,args)});
  return el('li',{},banner(s),el('small',{textContent:[s.display_status,`${s.days} days · ${money(s.price_cents)} · ${s.provider}${s.livemode?'':' (test)'}`,s.starts_at?new Date(s.starts_at).toLocaleDateString()+' → '+new Date(s.ends_at).toLocaleDateString():''].filter(Boolean).join(' · ')}),
   s.status==='paid_pending_review'?b('Approve','approve_sponsor',{p_id:s.id}):null,s.status==='paid_pending_review'?b('Reject','moderate_sponsor',()=>({p_id:s.id,p_action:'reject',p_reason:reason.value})):null,
   s.status==='scheduled'?b('Remove','moderate_sponsor',()=>({p_id:s.id,p_action:'remove',p_reason:reason.value})):null,['rejected','removed'].includes(s.status)?b('Mark refunded','moderate_sponsor',{p_id:s.id,p_action:'refunded'}):null,
   ['paid_pending_review','scheduled'].includes(s.status)?reason:null);}):[el('li',{className:'empty',textContent:'No sponsor slots yet.'})]));
 const {data:dn}=await sb.from('donations').select('amount_cents,name,message,provider,status,livemode,paid_at,public').eq('status','paid').order('paid_at',{ascending:false}).limit(30);
 const real=(dn||[]).filter(d=>d.livemode);$('adm-don-total').textContent=`${real.length} real donations shown · ${money(real.reduce((a,d)=>a+d.amount_cents,0))}`;
 $('adm-donations').replaceChildren(...((dn||[]).length?dn.map(d=>el('li',{},el('span',{textContent:`${money(d.amount_cents)} · ${d.name||'Anonymous'}${d.message?' — '+d.message:''}`}),el('small',{textContent:`${d.provider}${d.livemode?'':' (test)'} · ${new Date(d.paid_at).toLocaleString()}${d.public?' · on thank-you list':''}`}))):[el('li',{className:'empty',textContent:'No donations yet.'})]));
}

function init(){megaphoneButtons();donationBox();sponsorDialog();liveSponsor();handleReturn();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
window.addEventListener('hashchange',handleReturn);
window.addEventListener('mesoswatch:view',e=>{if(e.detail?.view==='settings')setTimeout(adminPanels,600);});
