// Where a price comes from, what kind of price it is, and whether there is enough data to show one (pure: no DOM).
// Every price on the site is shown with its source name, data type and timestamp. Kinds never mix:
//   asking    — a price on a shop listing, read by the FM Scanner (not proof anything sold at it)
//   seenSold  — the listed price on a greyed-out (sold) shop row: the item sold, the buyer's price is not shown by the game
//   sale      — a sale from a seller's own Sold Items window, verified by an admin
//   reference — a baseline from an outside source (NiaDB), with that source's own date
//   player    — a price a player published for their own store
export const INSUFFICIENT='Insufficient data';
export const SOURCES={
 scanner:{name:'Mesos-Watch FM Scanner',short:'FM Scanner'},
 sale:{name:'Mesos-Watch reviewed sales',short:'Reviewed sales'},
 niadb:{name:'NiaDB',short:'NiaDB'},
 player:{name:'Player Stores (published by the seller)',short:'Player Stores'},
};
export const TYPES={
 asking:'Asking price',
 seenSold:'Seen sold · listed price',
 sale:'Confirmed sale',
 reference:'Reference price',
 npc:'NPC sell price',
 player:'Seller’s own listing',
};
export const REFERENCE_TYPES={asking:'Reference asking price',sold:'Reference sold price',npc_sell:'NPC sell price'};
// Below these counts a typical price or range is "Insufficient data" (one or two listings say little about a market).
export const MIN={typical:3,range:4,seenSold:3};

export function ago(iso,now=Date.now()){
 if(!iso)return'never';const t=Date.parse(iso);if(!Number.isFinite(t))return'never';
 const s=(now-t)/1000;return s<60?'just now':s<3600?Math.round(s/60)+' min ago':s<86400?Math.round(s/3600)+' h ago':Math.round(s/86400)+' d ago';
}
const exact=iso=>{const d=new Date(iso);return Number.isFinite(+d)?d.toLocaleString('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';};
// "Source: FM Scanner · Asking price · 5 listings · updated 3 h ago" and the exact time for a tooltip.
export function sourceText({source='scanner',type='asking',at=null,n=null,unit='listing',now=Date.now(),window=''}={}){
 const s=SOURCES[source]||{short:String(source)},t=TYPES[type]||REFERENCE_TYPES[type]||String(type);
 const count=Number.isFinite(+n)&&n!==null?`${Number(n).toLocaleString('en-US')} ${unit}${+n===1?'':'s'}`:'';
 return{text:['Source: '+s.short,t,window,count,at?'updated '+ago(at,now):'no data yet'].filter(Boolean).join(' · '),title:[s.name||s.short,t,at?exact(at):''].filter(Boolean).join(' · ')};
}
// Typical asking price (median) and middle half, only from enough distinct listings.
export function typicalAsk(s){
 const n=+s?.listings_7d||0;
 if(!s?.median_ask_7d||n<MIN.typical)return{ok:false,n,reason:n?`${n} listing${n===1?'':'s'} this week; needs ${MIN.typical}`:'No listings this week'};
 const range=n>=MIN.range&&s.ask_p25_7d&&s.ask_p75_7d?[+s.ask_p25_7d,+s.ask_p75_7d]:null;
 return{ok:true,n,value:+s.median_ask_7d,range};
}
export function typicalSold(s){
 const n=+s?.sold_seen_7d||0;
 if(!s?.sold_median_7d||n<MIN.seenSold)return{ok:false,n,reason:n?`${n} seen sold this week; needs ${MIN.seenSold}`:'None seen sold this week'};
 return{ok:true,n,value:+s.sold_median_7d,range:s.sold_p25_7d&&s.sold_p75_7d?[+s.sold_p25_7d,+s.sold_p75_7d]:null};
}
// A listing against the typical asking price. "Unusual" (5x either way) usually means a misread digit or a mistake in game:
// shown with a warning, never removed.
export function vsTypical(price,typical){
 if(!(price>0)||!(typical>0))return null;
 const pct=Math.round(100*(price-typical)/typical),ratio=price/typical;
 return{pct,unusual:ratio>=5||ratio<=0.2,text:pct===0?'= typical':(pct>0?'▲ ':'▼ ')+Math.abs(pct)+'%'};
}
// Latest reference price per type, newest first; older than 30 days is marked stale.
export function latestReferences(rows,now=Date.now()){
 const by=new Map();
 for(const r of [...(rows||[])].sort((a,b)=>Date.parse(b.as_of)-Date.parse(a.as_of)))if(!by.has(r.price_type))by.set(r.price_type,{...r,stale:now-Date.parse(r.as_of)>30*864e5});
 return[...by.values()];
}
