// Data access for the price checker, scanner and megaphones (Supabase; see supabase/migrations). Loads the client only when configured.
const config=window.MESOSWATCH_CONFIG||{},cfg=config.prices||{},items=config.items||{};
const LIB='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const ICON_BASE=items.iconBase||'https://osmsdataexplorer.com/data/current/images/items/';
let clientPromise=null,sessionPromise=null;

export const configured=()=>/^https:\/\/[\w-]+\.supabase\.co\/?$/.test(cfg.supabaseUrl||'')&&!!cfg.supabaseAnonKey;
export const worlds=()=>Array.isArray(cfg.worlds)?cfg.worlds.filter(w=>typeof w==='string'&&w):[];
export const norm=s=>String(s||'').trim().replace(/\s+/g,' ').toLowerCase();
const baseUrl=()=>cfg.supabaseUrl.replace(/\/$/,'');

export function client(){
 if(!configured())return Promise.reject(Error('The community price database is not connected yet.'));
 return clientPromise||=import(LIB).then(({createClient})=>createClient(baseUrl(),cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}})).catch(e=>{clientPromise=null;throw e;});
}
// Writes need a session; visitors get an anonymous one, never a login prompt.
export function session(){
 return sessionPromise||=(async()=>{const sb=await client();const {data}=await sb.auth.getSession();if(!data.session){const {error}=await sb.auth.signInAnonymously();if(error)throw Error('Could not start an anonymous session. Is anonymous sign-in enabled in Supabase?');}return sb;})().catch(e=>{sessionPromise=null;throw e;});
}
// Missing tables/functions mean the migrations have not been run on this Supabase project yet.
export const NOT_SET_UP='The price database is connected but not set up yet. Site owner: run the SQL in supabase/migrations (see SETUP.md).';
const rows=async(p,what)=>{const {data,error}=await p;if(error)throw Error(/^(PGRST20[25]|42P01|42883)$/.test(error.code||'')?NOT_SET_UP:what+': '+error.message);return data;};

// Catalog icons come from the OSMS Data Explorer dataset by game id; community icons from storage; otherwise none (the page draws a fallback).
// NX items are not in that dataset, so their picture is the one players' scanners captured from shops.
export function iconUrl(item){
 const community=item?.icon_path&&configured()?`${baseUrl()}/storage/v1/object/public/item-icons/${item.icon_path}`:null;
 if(item?.category==='cash'&&community)return community;
 if(item?.game_id)return ICON_BASE+String(item.game_id).padStart(8,'0')+'.png';
 return community;
}
export const CATEGORY_LABEL={equip:'Equipment',use:'Use',setup:'Setup',etc:'Etc',cash:'NX'};

// Pages of up to 50 (migration 20261101000400). Until that migration is run, the older search_items answers instead:
// first page only, at most 25, and searchPaging() reports false so the page can say so.
let paged=true;
export const searchPaging=()=>paged;
export async function searchItems(q,world='',lim=50,offset=0){
 const sb=await client();
 if(paged){const {data,error}=await sb.rpc('search_items',{q,p_world:world,lim,p_offset:offset});if(!error)return data;if(error.code!=='PGRST202')throw Error('Search failed: '+error.message);paged=false;}
 return offset>0?[]:rows(sb.rpc('search_items',{q,p_world:world,lim:Math.min(lim,25)}),'Search failed');
}
export const getItem=async id=>rows((await client()).from('items').select('*').eq('id',id).maybeSingle(),'Could not load the item');
export const itemSummary=async(id,world='')=>{const s=await rows((await client()).rpc('item_summary',{p_item:id,p_world:world}),'Could not load prices');return s.verified_sales_only?s:{...s,estimated_value:null,median_sale_30d:null,sales_30d:0,sale_reporters_30d:0};};
export const currentListings=async(id,world='')=>rows((await client()).rpc('current_listings',{p_item:id,p_world:world,lim:100}),'Could not load listings');
export const priceHistory=async(id,world='',range='7d')=>{const s=await rows((await client()).rpc('item_summary',{p_item:id,p_world:world}),'Could not check evidence version');const h=await rows((await client()).rpc('price_history',{p_item:id,p_world:world,p_range:range}),'Could not load history');return s.verified_sales_only?h:h.filter(r=>r.kind==='ask');};
export const itemVariations=async(id,world='')=>rows((await client()).rpc('item_variations',{p_item:id,p_world:world}),'Could not load variations');
export async function marketTrends(world='',lim=60){
 const sb=await client();
 const list=await rows(sb.rpc('market_trends',{p_world:world,lim}),'Could not load trends');
 // The trends lists draw item pictures. market_trends only carries the picture columns from migration 20261101000700 on,
 // so on an un-migrated project they are filled in here the same way the live feed fills them.
 const need=list.filter(r=>!('game_id' in r));
 if(need.length){
  const ids=[...new Set(need.map(r=>r.id))];
  const its=await rows(sb.from('items').select('id,game_id,icon_path,category').in('id',ids),'Could not load items').catch(()=>[]);
  const by=new Map(its.map(i=>[i.id,i]));
  for(const r of need)Object.assign(r,by.get(r.id)||{});
 }
 return list;
}
export async function recentObservations(world='',lim=25){
 const sb=await client();
 const obs=await rows(sb.from('market_observations').select('id,kind,verification_status,item_id,item_name,price,qty,shop_title,map,seen_at').eq('world',world).or('kind.eq.ask,verification_status.eq.verified').order('seen_at',{ascending:false}).limit(lim),'Could not load recent prices');
 const ids=[...new Set(obs.map(o=>o.item_id))];
 const its=ids.length?await rows(sb.from('items').select('id,name,game_id,icon_path,category').in('id',ids),'Could not load items'):[];
 const byId=new Map(its.map(i=>[i.id,i]));
 return obs.map(o=>({...o,item:byId.get(o.item_id)||{id:o.item_id,name:o.item_name}}));
}

export const matchNames=async names=>names.length?rows((await client()).rpc('match_item_names',{p_names:names}),'Could not match item names'):[];

// observations: [{kind:'ask'|'sale', item, price, qty, stats?, shopKey?, shopTitle?, map?, channel?}].
// Names are resolved against the catalog first; a cut-off name ("…") that matches no single item is dropped.
export async function reportObservations(observations,{world=''}={}){
 const clean=observations.map(o=>({...o,item:String(o.item||'').replace(/\s+/g,' ').trim(),price:Math.round(Number(o.price)),qty:Math.max(1,Math.min(9999,Math.round(Number(o.qty)||1)))}))
  .filter(o=>o.item.length>=2&&Number.isFinite(o.price)&&o.price>=1&&o.price<=1e11);
 if(!clean.length)return [];
 const sb=await session();
 const matched=new Map((await matchNames([...new Set(clean.map(o=>o.item))])).map(m=>[m.input,m]));
 const out=[];
 for(const o of clean){
  const m=matched.get(o.item),truncated=/(\.\.\.|…)$/.test(o.item);
  if(!m?.name&&truncated)continue;
  out.push({kind:o.kind==='sale'?'sale':'ask',world,confidence:Number.isFinite(o.confidence)?Math.max(0,Math.min(100,o.confidence)):null,capture_source:o.kind==='sale'?'store':'scanner',item_name:(m?.name||o.item).slice(0,60),price:o.price,qty:o.qty,stats:o.stats||{},shop_key:String(o.shopKey||'').slice(0,64),shop_title:String(o.shopTitle||'').slice(0,40),map:String(o.map||'').slice(0,40),channel:o.channel>=1&&o.channel<=40?o.channel:null});
 }
 if(!out.length)return [];
 const {data,error}=await sb.from('observations').insert(out).select('id,item_id,item_name');
 if(error)throw Error(/rate limit/i.test(error.message)?'Too many reports from this browser. Scanning resumes in a few minutes.':'Could not save prices: '+error.message);
 // Rows the server skipped as duplicates are not returned. catalog: the name matched a catalog item (which has its own icon).
 const catalog=new Set([...matched.values()].filter(m=>m.name&&m.game_id).map(m=>m.name));
 return (data||[]).map(d=>({...d,catalog:catalog.has(d.item_name),item:{id:d.item_id,name:d.item_name,game_id:[...matched.values()].find(m=>m.name===d.item_name)?.game_id}}));
}

// Community icon: an exact-size PNG of the sprite next to a listing. Becomes the item's icon once two players agree.
export async function shareIcon(itemId,hash,blob){
 const sb=await session(),path=`observed/${itemId}/${hash}.png`;
 const up=await sb.storage.from('item-icons').upload(path,blob,{contentType:'image/png',upsert:false});
 if(up.error&&!/exists|duplicate/i.test(up.error.message))throw Error('Icon upload failed: '+up.error.message);
 return rows(sb.rpc('vote_icon',{p_item:itemId,p_hash:hash,p_path:path}),'Icon vote failed');
}

export async function subscribe(world,onInsert){
 const sb=await client();
 const ch=sb.channel('observations-'+(world||'all')).on('postgres_changes',{event:'INSERT',schema:'public',table:'observations',filter:`world=eq.${world}`},p=>onInsert(p.new)).subscribe();
 return()=>sb.removeChannel(ch);
}

// Base stats stored with the catalog row (see supabase/import-catalog.mjs), as [label, value] pairs for the item page.
const STAT_NAMES={incSTR:'STR',incDEX:'DEX',incINT:'INT',incLUK:'LUK',incMHP:'HP',incMMP:'MP',incPAD:'Weapon ATT',incMAD:'Magic ATT',incPDD:'Weapon DEF',incMDD:'Magic DEF',incACC:'Accuracy',incEVA:'Avoidability',incSpeed:'Speed',incJump:'Jump',incCRT:'Critical rate %',incCRD:'Critical damage %',knockback:'Knockback %',tuc:'Upgrade slots',attackSpeed:'Attack speed',reqSTR:'Req. STR',reqDEX:'Req. DEX',reqINT:'Req. INT',reqLUK:'Req. LUK',reqPOP:'Req. fame'};
const SPEC_NAMES={hp:'Restores HP',mp:'Restores MP',hpR:'Restores HP %',mpR:'Restores MP %',pad:'Weapon ATT +',mad:'Magic ATT +',pdd:'Weapon DEF +',mdd:'Magic DEF +',acc:'Accuracy +',eva:'Avoidability +',speed:'Speed +',jump:'Jump +'};
export function baseStats(item){
 const b=item?.base_stats||{},stats=[];
 for(const [k,label] of Object.entries(STAT_NAMES))if(typeof b.stats?.[k]==='number')stats.push([label,b.stats[k]]);
 for(const [k,label] of Object.entries(SPEC_NAMES))if(typeof b.spec?.[k]==='number'&&b.spec[k]!==0)stats.push([label,b.spec[k]]);
 if(typeof b.spec?.time==='number'&&b.spec.time>0)stats.push(['Duration',Math.round(b.spec.time/1000)+' s']);
 return{description:b.desc||'',stats};
}

// ---- Megaphones ----
export const megaphonePlans=async()=>rows((await client()).from('megaphone_plans').select('*').order('sort'),'Could not load megaphone plans');
// Megaphones for this world plus those bought for all worlds (world ''). `in` with an empty string renders as an empty list, so use or/eq.
export const liveMegaphones=async(world='')=>{const q=(await client()).from('live_megaphones').select('id,message,sender,world,ends_at');const w=String(world).replace(/["\\,()]/g,'');return rows((w?q.or(`world.eq."${w}",world.eq.""`):q.eq('world','')).order('starts_at'),'Could not load megaphones');};
export async function myMegaphones(){const sb=await session();const {data:u}=await sb.auth.getUser();if(!u.user)return[];return rows(sb.from('megaphone_queue').select('id,message,sender,plan_id,minutes,price_cents,status,display_status,starts_at,ends_at,reject_reason,created_at,livemode').eq('buyer',u.user.id).order('created_at',{ascending:false}).limit(20),'Could not load your megaphones');}
async function invoke(name,body){
 const sb=await session();
 const {data,error}=await sb.functions.invoke(name,{body});
 if(error){
  // A function that isn't deployed fails its CORS preflight, which supabase-js reports as a fetch error.
  if(error.name==='FunctionsFetchError'||error.context?.status===404)throw Error('Megaphone checkout isn’t switched on yet: the site owner still has to deploy the payment functions (SETUP.md, step 6). You have not been charged.');
  let msg=error.message;try{msg=(await error.context.json()).error||msg;}catch{}throw Error(msg);
 }
 return data;
}
export const startCheckout=body=>invoke('megaphone-checkout',{...body,return_url:location.origin+location.pathname});
export const moderateMegaphone=(action,id,extra={})=>invoke('megaphone-admin',{action,id,...extra});

// ---- Admin (email sign-in; ordinary visitors never need this) ----
export async function adminSignIn(email){const sb=await client();const {error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:location.origin+location.pathname+'#settings'}});if(error)throw Error(error.message);}
export async function adminState(){if(!configured())return{email:null,admin:false};const sb=await client();const {data}=await sb.auth.getUser();const email=data.user?.email||null;if(!email)return{email:null,admin:false};const {data:admin}=await sb.rpc('is_admin');return{email,admin:!!admin};}
export async function signOut(){const sb=await client();await sb.auth.signOut();sessionPromise=null;}
export const moderationQueue=async()=>rows((await client()).from('megaphone_queue').select('*').in('display_status',['paid_pending_review','queued','live','awaiting_payment']).order('created_at',{ascending:false}).limit(100),'Could not load the queue');
export const unverifiedItems=async()=>rows((await client()).from('items').select('id,name,category,game_id,icon_path,first_seen').or('verified.eq.false,release_status.eq.unverified').order('first_seen',{ascending:false}).limit(50),'Could not load items');
// Automatic catalog updates (supabase/migrations/*_catalog_autosync.sql): recent runs, and a manual "update now".
export const catalogSyncLog=async()=>rows((await client()).from('catalog_sync_log').select('requested_at,finished_at,status,items,message').order('id',{ascending:false}).limit(6),'Could not load catalog updates');
export const catalogSyncNow=async()=>rows((await client()).rpc('catalog_sync_now'),'Could not start a catalog update');
export async function updateItem(id,patch){const sb=await client();return rows(sb.from('items').update(patch).eq('id',id).select().single(),'Could not update the item');}
