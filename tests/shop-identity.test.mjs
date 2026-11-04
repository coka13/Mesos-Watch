// Shop identity across reads, with the misreads seen in production on 2026-11-04, and price-source helpers.
import assert from 'node:assert/strict';
import {createShopMemory} from '../dist/shop-identity.mjs';
import {sourceText,typicalAsk,typicalSold,vsTypical,latestReferences,INSUFFICIENT,MIN} from '../dist/price-source.mjs';

const shops=createShopMemory(),place='|4|FM_ROOM|14|',t0=Date.parse('2026-11-04T21:07:59Z');
const leo=['dark master sergeant|3400|{}','blue jewelry boots|2000|{}','blue jewelry boots|1800|{}','gold earrings|4000|{}','sky sneak pants|2500|{}'];
assert.equal(shops.resolve(place,'LeoTsuwubasal',leo,t0),'LeoTsuwubasal');
assert.equal(shops.resolve(place,'Clac e',leo.slice(0,4),t0+4*60e3),'LeoTsuwubasal','misread title: same shop, first title kept');
assert.equal(shops.resolve(place,'',['sky sneak pants|2500|{}'],t0+5*60e3),'LeoTsuwubasal','unread title, the shop’s one visible row');
assert.equal(shops.resolve(place,'Other Shop',['emerald ore|89|{}','horny mushroom cap|35|{}'],t0+6*60e3),'Other Shop','no shared rows: another shop');
assert.equal(shops.resolve('|4|FM_ROOM|15|','Clac e',leo,t0+6*60e3),'Clac e','same rows in another room: another shop');
assert.equal(shops.resolve(place,'',['emerald ore|120|{}'],t0+7*60e3),'','unknown shop without a title stays untitled');
assert.equal(shops.resolve(place,'Clac e',leo,t0+31*60e3+1),'Clac e','after 30 minutes the memory has expired');
// One shared row of a two-row shop is not enough.
const m=createShopMemory();m.resolve(place,'Alpha',['a|1|{}','b|2|{}','c|3|{}']);
assert.equal(m.resolve(place,'Beta',['a|1|{}','x|9|{}','y|8|{}']),'Beta');
// Majority title wins over the first read once it is read more often.
const k=createShopMemory();k.resolve(place,'Lea',['a|1|{}','b|2|{}']);k.resolve(place,'Leo',['a|1|{}','b|2|{}']);
assert.equal(k.resolve(place,'Leo',['a|1|{}','b|2|{}']),'Leo');

// Price sources and sufficiency.
const now=Date.parse('2026-11-05T12:00:00Z');
const src=sourceText({type:'asking',at:'2026-11-05T09:00:00Z',n:5,window:'7 d',now});
assert.equal(src.text,'Source: FM Scanner · Asking price · 7 d · 5 listings · updated 3 h ago');
assert.ok(src.title.includes('Mesos-Watch FM Scanner')&&src.title.includes('2026'));
assert.equal(sourceText({source:'niadb',type:'reference',now}).text,'Source: NiaDB · Reference price · no data yet');
assert.deepEqual(typicalAsk({median_ask_7d:300,listings_7d:2}),{ok:false,n:2,reason:`2 listings this week; needs ${MIN.typical}`});
assert.equal(typicalAsk(null).ok,false);
assert.deepEqual(typicalAsk({median_ask_7d:300,listings_7d:3,ask_p25_7d:200,ask_p75_7d:400}),{ok:true,n:3,value:300,range:null},'range needs 4 listings');
assert.deepEqual(typicalAsk({median_ask_7d:300,listings_7d:5,ask_p25_7d:200,ask_p75_7d:400}).range,[200,400]);
assert.equal(typicalSold({sold_median_7d:250,sold_seen_7d:2}).ok,false);
assert.equal(typicalSold({sold_median_7d:250,sold_seen_7d:3}).value,250);
assert.deepEqual(vsTypical(1500,1000),{pct:50,unusual:false,text:'▲ 50%'});
assert.equal(vsTypical(250,1000).unusual,false);assert.equal(vsTypical(100,1000).unusual,true);assert.equal(vsTypical(150,1000).unusual,true);assert.equal(vsTypical(10000,1000).unusual,true);
assert.equal(vsTypical(1000,1000).text,'= typical');assert.equal(vsTypical(0,1000),null);assert.equal(vsTypical(5,null),null);
const refs=latestReferences([{price_type:'asking',as_of:'2026-10-01T00:00:00Z',price_typical:1},{price_type:'asking',as_of:'2026-11-01T00:00:00Z',price_typical:2},{price_type:'sold',as_of:'2026-09-01T00:00:00Z',price_typical:3}],now);
assert.deepEqual(refs.map(r=>[r.price_type,r.price_typical,r.stale]),[['asking',2,false],['sold',3,true]]);
assert.equal(INSUFFICIENT,'Insufficient data');
console.log('Shop identity: misread and unread titles keep the shop’s title, other rooms and unrelated rows stay apart, memory expires. Price sources: labels with name, type and time; insufficient-data thresholds; vs typical; latest reference per type.');
