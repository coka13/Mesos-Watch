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
// Market index (migration 20261104000300). Before that migration, market_trends answers instead, with the newer columns empty.
export async function marketIndex(world='',lim=300){
 const sb=await client();
 const {data,error}=await sb.rpc('market_index',{p_world:world,lim});
 if(!error)return data;
 if(error.code!=='PGRST202')throw Error('Could not load the market index: '+error.message);
 return(await marketTrends(world,100)).map(r=>({...r,ask_median:r.median_now,listings_7d:r.asks_7d,for_sale_now:null,sold_seen_7d:null,sales_30d:null,legacy:true}));
}
// Reference prices from outside sources (NiaDB), for this world and for all worlds.
export async function referencePrices(itemId,world=''){
 const sb=await client(),w=String(world).replace(/["\\,()]/g,'');
 const {data,error}=await sb.from('reference_prices').select('id,world,source,source_name,source_url,price_type,price_low,price_typical,price_high,sample_size,window_days,as_of,recorded_at,note').eq('item_id',itemId).or(w?`world.eq."${w}",world.eq.""`:'world.eq.""').order('as_of',{ascending:false}).limit(30);
 if(error){if(/^(PGRST20[25]|42P01)$/.test(error.code||''))return[];throw Error('Could not load reference prices: '+error.message);}
 return data;
}
export async function addReferencePrice(row){const sb=await client();return rows(sb.from('reference_prices').insert(row).select().single(),'Could not save the reference price');}
export async function removeReferencePrice(id){const sb=await client();return rows(sb.from('reference_prices').delete().eq('id',id).select('id'),'Could not remove the reference price');}
export async function recentObservations(world='',lim=25){
 const sb=await client();
 const obs=await rows(sb.from('market_observations').select('id,kind,verification_status,item_id,item_name,price,qty,shop_title,map,seen_at').eq('world',world).or('kind.eq.ask,verification_status.eq.verified').order('seen_at',{ascending:false}).limit(lim),'Could not load recent prices');
 const ids=[...new Set(obs.map(o=>o.item_id))];
 const its=ids.length?await rows(sb.from('items').select('id,name,game_id,icon_path,category').in('id',ids),'Could not load items'):[];
 const byId=new Map(its.map(i=>[i.id,i]));
 return obs.map(o=>({...o,item:byId.get(o.item_id)||{id:o.item_id,name:o.item_name}}));
}

export const matchNames=async names=>names.length?rows((await client()).rpc('match_item_names',{p_names:names}),'Could not match item names'):[];

// observations: [{kind:'ask'|'sale', item, price, qty, stats?, shopKey?, shopTitle?, map?, channel?, location?}].
// location: database columns from location.mjs locationColumns (the FM Scanner's listings must carry one; the server checks it).
// Names are resolved against the catalog first; a cut-off name ("…") that matches no single item is dropped, and so is any
// FM Scanner name that matches no item.
export async function reportObservations(observations,{world=''}={}){
 const clean=observations.map(o=>({...o,item:String(o.item||'').replace(/\s+/g,' ').trim(),price:Math.round(Number(o.price)),qty:Math.max(1,Math.min(9999,Math.round(Number(o.qty)||1)))}))
  .filter(o=>o.item.length>=2&&Number.isFinite(o.price)&&o.price>=1&&o.price<=1e11);
 if(!clean.length)return [];
 const sb=await session();
 const matched=new Map((await matchNames([...new Set(clean.map(o=>o.item))])).map(m=>[m.input,m]));
 const out=[];
 for(const o of clean){
  const m=matched.get(o.item),truncated=/(\.\.\.|…)$/.test(o.item);
  if(!m?.name&&(truncated||o.source==='scanner'))continue;  // the scanner publishes known items only (the server enforces it too)
  out.push({kind:o.kind==='sale'?'sale':'ask',world,confidence:Number.isFinite(o.confidence)?Math.max(0,Math.min(100,o.confidence)):null,capture_source:o.source==='scanner'?'scanner':o.kind==='sale'?'store':'scanner',item_name:(m?.name||o.item).slice(0,60),price:o.price,qty:o.qty,stats:o.stats||{},shop_key:String(o.shopKey||'').slice(0,64),shop_title:String(o.shopTitle||'').slice(0,40),map:String(o.map||'').slice(0,40),channel:o.channel>=1&&o.channel<=40?o.channel:null,...(o.location||{})});
 }
 if(!out.length)return [];
 const {data,error}=await sb.from('observations').insert(out).select('id,kind,item_id,item_name');
 if(error)throw Error(/rate limit/i.test(error.message)?'Too many reports from this browser. Scanning resumes in a few minutes.':/location required/i.test(error.message)?'Not published: the listing has no complete location (channel and FM room or map).':'Could not save prices: '+error.message);
 // Rows the server skipped as duplicates are not returned. catalog: the name matched a catalog item (which has its own icon).
 const catalog=new Set([...matched.values()].filter(m=>m.name&&m.game_id).map(m=>m.name));
 return (data||[]).map(d=>({...d,catalog:catalog.has(d.item_name),item:{id:d.item_id,name:d.item_name,game_id:[...matched.values()].find(m=>m.name===d.item_name)?.game_id}}));
}

// Greyed-out rows seen in other players' shops: [{item, price (the displayed price), qty, stats?, shopKey?, shopTitle?, confidence?, location}].
// Kept apart from asking prices and sales. The server drops names that are not known items and repeated sightings.
export async function reportSoldSightings(list,{world=''}={}){
 const sb=await session(),matched=new Map((await matchNames([...new Set(list.map(o=>o.item))])).map(m=>[m.input,m]));
 const out=list.map(o=>({o,m:matched.get(o.item)})).filter(({m})=>m?.name).map(({o,m})=>({world,item_name:m.name.slice(0,60),listed_price:Math.round(o.price),qty:Math.max(1,Math.min(9999,Math.round(o.qty||1))),stats:o.stats||{},
  shop_key:String(o.shopKey||'').slice(0,64),shop_title:String(o.shopTitle||'').slice(0,40),confidence:Number.isFinite(o.confidence)?Math.max(0,Math.min(100,Math.round(o.confidence))):null,...o.location}));
 if(!out.length)return [];
 const {data,error}=await sb.from('sold_sightings').insert(out).select('id,item_id,item_name,listed_price');
 if(error)throw Error(/rate limit/i.test(error.message)?'Too many reports from this browser. Scanning resumes in a few minutes.':'Could not save sold items: '+error.message);
 const by=new Map([...matched.values()].filter(m=>m.name).map(m=>[m.name,m]));
 return (data||[]).map(d=>{const m=by.get(d.item_name);return{...d,item:{id:d.item_id,name:d.item_name,game_id:m?.game_id,category:m?.category,icon_path:m?.icon_path}};});
}
export const soldSightings=async(id,world='')=>rows((await client()).from('sold_sightings').select('id,listed_price,qty,stats,shop_title,seller_name,channel,location_type,room,map,seen_at').eq('item_id',id).eq('world',world).gte('seen_at',new Date(Date.now()-7*864e5).toISOString()).order('seen_at',{ascending:false}).limit(50),'Could not load sold items');

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
let megaItems=true;
export const liveMegaphones=async(world='')=>{if(megaItems){try{return await liveMegaphonesWith(world,'id,message,sender,world,ends_at,item_id,item_name,item_game_id,item_icon_path,item_category');}catch{megaItems=false;}}return liveMegaphonesWith(world,'id,message,sender,world,ends_at');};
const liveMegaphonesWith=async(world,cols)=>{const q=(await client()).from('live_megaphones').select(cols);const w=String(world).replace(/["\\,()]/g,'');return rows((w?q.or(`world.eq."${w}",world.eq.""`):q.eq('world','')).order('starts_at'),'Could not load megaphones');};
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

// ---- Market depth (migration 20261107000000). Until it is applied each call falls back to what the database has. ----
const missing=e=>/^(PGRST20[25]|42P01|42883)$/.test(e?.code||'');
// The market index over a window of days. Row fields are the same with or without the migration; legacy rows are 7 days only.
export async function marketIndexWindow(world='',days=7,lim=300){
 const sb=await client(),{data,error}=await sb.rpc('market_index_window',{p_world:world,lim,p_days:days});
 if(!error)return data;
 if(!missing(error))throw Error('Could not load the market index: '+error.message);
 return(await marketIndex(world,lim)).map(r=>({...r,window_days:7,listings:r.listings_7d,sold_seen:r.sold_seen_7d,sold_median:r.sold_median_7d,sales:r.sales_30d,sale_median:r.sale_median_30d,stale_listings:null,unusual:null,sell_through_pct:null,windowless:true}));
}
export async function itemStats(id,world='',days=7){const {data,error}=await(await client()).rpc('item_stats',{p_item:id,p_world:world,p_days:days});if(error){if(missing(error))return null;throw Error('Could not load prices: '+error.message);}return data;}
export async function marketFlips(world='',days=7){const {data,error}=await(await client()).rpc('market_flips',{p_world:world,p_days:days,lim:30});if(error){if(missing(error))return null;throw Error('Could not load opportunities: '+error.message);}return data;}
// A shop seen whole no longer shows some listings: they are gone (inferred, and reversed if they are seen again).
export async function closeMissingListings({world='',channel,map,shopKey,shopTitle,items}){
 const sb=await session(),matched=new Map((await matchNames([...new Set(items.map(i=>i.item))])).map(m=>[m.input,m]));
 const keep=items.map(i=>({item_id:matched.get(i.item)?.item_id,price:i.price,qty:i.qty})).filter(k=>k.item_id);
 if(keep.length<items.length)return 0;
 const {data,error}=await sb.rpc('close_missing_listings',{p_world:world,p_channel:channel,p_map:map,p_shop_key:shopKey,p_shop_title:shopTitle,p_keep:keep});
 if(error){if(missing(error)||/rate limit/i.test(error.message))return 0;throw Error('Could not update the shop: '+error.message);}
 return data||0;
}
export async function rankings(world='',{job='',page=0,size=50}={}){
 let q=(await client()).from('public_rankings').select('id,name,job,level,last_seen').eq('world',world);if(job)q=q.eq('job',job);
 const {data,error}=await q.order('level',{ascending:false}).order('last_seen',{ascending:false}).range(page*size,page*size+size);
 if(error){if(missing(error))return null;throw Error('Could not load the rankings: '+error.message);}
 return{rows:data.slice(0,size),more:data.length>size};
}
export async function publishCharacter({world='',name,job,level}){const sb=await session(),{error}=await sb.rpc('report_character',{p_world:world,p_name:name,p_job:job,p_level:level});if(error)throw Error(/another player/.test(error.message)?'That character was already published by another player.':/too many/.test(error.message)?'You have published the most characters allowed.':'Could not publish: '+error.message);}
export async function unpublishCharacter({world='',name}){const sb=await session(),{data,error}=await sb.rpc('remove_character',{p_name:name,p_world:world});if(error)throw Error('Could not remove: '+error.message);return data;}
export async function siteNotice(){const {data,error}=await(await client()).rpc('site_notice');return error?'':String(data||'');}
export async function reportListing(observationId,reason){const sb=await client(),{error}=await sb.from('market_reports').insert({observation_id:observationId,reason});if(error)throw Error(/rate/i.test(error.message)?'You have sent several reports recently. Try again later.':/duplicate|unique/i.test(error.message)?'You already reported this listing.':'Could not send the report: '+error.message);}
// Price alerts. The database checks them; this only reads them, and only for a signed-in player.
export async function myAlerts(world=''){
 const sb=await client(),{data,error}=await sb.from('watchlist').select('id,item_id,world,stats,threshold,direction,created_at,item:items(id,name,game_id,icon_path,category)').eq('world',world).order('created_at',{ascending:false});
 if(error){if(missing(error))return null;throw Error('Could not load your alerts: '+error.message);}
 return data;
}
export async function saveAlert({id=null,itemId,world='',threshold,direction='below'}){
 const sb=await client(),q=id?sb.from('watchlist').update({threshold,direction}).eq('id',id):sb.from('watchlist').upsert({item_id:itemId,world,stats:{},threshold,direction},{onConflict:'owner,item_id,world,stats'});
 const {error}=await q;if(error)throw Error('Could not save the alert: '+error.message);
}
export async function removeAlert(id){const {error}=await(await client()).from('watchlist').delete().eq('id',id);if(error)throw Error('Could not remove the alert: '+error.message);}
export async function checkAlerts(){
 const sb=await client(),{error}=await sb.rpc('evaluate_price_alerts');if(error&&!missing(error))throw Error('Could not check alerts: '+error.message);
 const {data,error:e}=await sb.from('price_alert_events').select('id,price,read_at,created_at,watch:watchlist(world,item:items(id,name,game_id,icon_path,category))').is('read_at',null).order('created_at',{ascending:false}).limit(20);
 if(e){if(missing(e))return[];throw Error('Could not load alerts: '+e.message);}
 return data;
}
export async function markAlertRead(id){const {error}=await(await client()).from('price_alert_events').update({read_at:new Date().toISOString()}).eq('id',id);if(error)throw Error('Could not update the alert: '+error.message);}
