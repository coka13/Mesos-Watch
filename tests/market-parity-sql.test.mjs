// Market statistics, duplicate-free scanner listings and reference prices (migration 20261104000300) on the full migration
// stack in PGlite. The duplicate cases are the ones seen in production on 2026-11-04: one shop read as "LeoTsuwubasal",
// "LeaTsuwubasal" and with no title, each read a different shop key.
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite({extensions:{pg_trgm}});
await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;`);
for(const f of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
const A='00000000-0000-0000-0000-00000000000a',B='00000000-0000-0000-0000-00000000000b',ADMIN='00000000-0000-0000-0000-0000000000ad';
await db.exec(`insert into auth.users values('${A}','a@example.test'),('${B}','b@example.test'),('${ADMIN}','admin@example.test');insert into admins values('${ADMIN}')`);
const as=async(uid,sql,args=[])=>{await db.exec(`set role ${uid?'authenticated':'anon'};select set_config('request.jwt.claim.sub','${uid}',false)`);try{return(await db.query(sql,args)).rows;}finally{await db.exec('reset role');}};
const newItem=async name=>(await db.query(`insert into items(name,game_id,verified,source,release_status)values($1,$2,true,'catalog','released')returning id`,[name,1000000+Math.floor(Math.random()*8e6)])).rows[0].id;
const boots=await newItem('Blue Jewelry Boots'),gloves=await newItem('Work Gloves');
const key=title=>title?('|free market 14|'+title).toLowerCase():'';
const ask=(uid,{item='Blue Jewelry Boots',price=2000,title='LeoTsuwubasal',channel=4,room=14,qty=1}={})=>as(uid,`insert into observations(kind,world,item_name,price,qty,shop_key,shop_title,map,channel,capture_source,location_type,room,location_source,location_confidence)
 values('ask','',$1,$2,$3,$4,$5,'',$6,'scanner','FM_ROOM',$7,'AUTO',75)returning id`,[item,price,qty,key(title),title,channel,room]);
const sold=(uid,{item='Blue Jewelry Boots',price=2000,title='LeoTsuwubasal',channel=4,room=14}={})=>as(uid,`insert into sold_sightings(world,channel,location_type,room,location_source,shop_key,shop_title,item_name,listed_price,qty)
 values('',$1,'FM_ROOM',$2,'AUTO',$3,$4,$5,$6,1)returning id`,[channel,room,key(title),title,item,price]);
const rows=async item=>(await db.query(`select id,price,seen_count,shop_title from observations where item_id=$1 order by id`,[item])).rows;
const current=async item=>await as('',`select * from current_listings($1,'')`,[item]);

// One listing, one row: a title misread, a missing title and another player all refresh the same listing.
const [first]=await ask(A);
assert.equal((await ask(A,{title:'LeaTsuwubasal'})).length,0,'similar title: same listing');
assert.equal((await ask(A,{title:''})).length,0,'unread title: same listing');
assert.equal((await ask(B)).length,0,'another player: same listing');
assert.deepEqual((await rows(boots)).map(r=>[Number(r.id),r.seen_count]),[[first.id,4]],'one row, seen 4 times');
let [listing]=await current(boots);
assert.equal(Number(listing.sightings),4);assert.equal(Number(listing.reporters),2,'read by two players');
// A different shop in the same room with a dissimilar title, another channel, another room, quantity or price: separate.
assert.equal((await ask(A,{title:'Clac e'})).length,1,'dissimilar title: another shop');
assert.equal((await ask(A,{channel:5})).length,1,'other channel');
assert.equal((await ask(A,{room:15})).length,1,'other room');
assert.equal((await ask(A,{qty:2})).length,1,'other quantity');
assert.equal((await ask(A,{price:1800})).length,1,'other price');
assert.equal((await rows(boots)).length,6);
// Stale: a listing last seen more than 24 hours ago is no longer current, and a sighting after 6 hours is a new row.
await db.query(`update observations set seen_at=now()-interval '30 hours',last_seen_at=now()-interval '30 hours' where id=$1`,[first.id]);
assert.ok(!(await current(boots)).some(l=>l.shop_title==='LeoTsuwubasal'&&Number(l.price)===2000&&l.channel===4&&l.room===14&&l.qty===1),'stale listing left current listings');
assert.equal((await ask(A)).length,1,'seen again a day later: a new sighting row');
// Clients cannot set the counters.
await assert.rejects(as(A,`insert into observations(kind,world,item_name,price,qty,shop_key,channel,capture_source,location_type,room,location_source,seen_count)values('ask','','Work Gloves',9,1,'x',1,'scanner','FM_ROOM',7,'AUTO',99)`),/permission|denied/);

// Sold: a sold row read with a misread title still ends the listing; seeing it again is one sighting.
const [g]=await ask(A,{item:'Work Gloves',price:450,title:'Trash'});
assert.equal((await sold(B,{item:'Work Gloves',price:450,title:'Trahs'})).length,1);
assert.ok((await db.query(`select sold_at from observations where id=$1`,[g.id])).rows[0].sold_at,'listing marked sold');
assert.equal((await sold(A,{item:'Work Gloves',price:450,title:''})).length,0,'same sold row, title unread: one sighting');
assert.equal((await sold(A,{item:'Work Gloves',price:450,title:'Totally Other Shop'})).length,1,'another shop: its own sighting');
assert.equal((await ask(A,{item:'Work Gloves',price:450,title:'Trash'})).length,1,'relisted after it sold: a new listing');

// Statistics: distinct listings, observed prices only, and the three kinds apart.
const stat=await newItem('Steel Igor');
for(const [p,t] of [[100,'S1'],[200,'S2'],[300,'S3'],[400,'S4'],[10000,'S5']])await ask(A,{item:'Steel Igor',price:p,title:t});
await ask(B,{item:'Steel Igor',price:100,title:'S1'});  // a re-read, not a sixth listing
await sold(A,{item:'Steel Igor',price:250,title:'X1'});await sold(A,{item:'Steel Igor',price:270,title:'X2'});
const s=(await as('',`select item_summary($1,'') s`,[stat]))[0].s;
assert.equal(s.listings_7d,5,'re-reads are not listings');
assert.equal(s.median_ask_7d,300);assert.equal(s.ask_p25_7d,200);assert.equal(s.ask_p75_7d,400);
for(const v of [s.median_ask_7d,s.ask_p25_7d,s.ask_p75_7d])assert.ok([100,200,300,400,10000].includes(v),'every statistic is an observed price');
assert.equal(s.for_sale_now,5);assert.equal(s.lowest_ask_24h,100);
assert.equal(s.sold_seen_7d,2);assert.equal(s.sold_median_7d,250);
assert.equal(s.sales_30d,0,'sold sightings are not confirmed sales');assert.equal(s.estimated_value,null);
assert.equal(s.verified_sales_only,true);
const h=await as('',`select * from price_history($1,'','7d')`,[stat]);
assert.deepEqual([...new Set(h.map(r=>r.kind))].sort(),['ask','sold']);
const askRow=h.find(r=>r.kind==='ask');assert.ok(Number(askRow.p25)<=Number(askRow.median)&&Number(askRow.median)<=Number(askRow.p75));
await assert.rejects(as('',`select * from price_history($1,'','1y')`,[stat]));

// Market index: one row per item with market data, counts and 24h change only with enough data.
const idx=await as('',`select * from market_index('')`);
const ig=idx.find(r=>Number(r.id)===Number(stat));
assert.equal(Number(ig.listings_7d),5);assert.equal(Number(ig.for_sale_now),5);assert.equal(Number(ig.ask_median),300);
assert.equal(Number(ig.sold_seen_7d),2);assert.equal(Number(ig.sold_median_7d),250);assert.equal(Number(ig.sales_30d),0);
assert.equal(ig.change_24h_pct,null,'no earlier day: no 24 h change');
// observations_guard fixes seen_at on insert: insert yesterday's listings, then move them back in time.
for(const p of [50,60,75])await ask(A,{item:'Steel Igor',price:p,title:'Old'+p});
await db.query(`update observations set seen_at=now()-interval '30 hours',last_seen_at=now()-interval '30 hours' where item_id=$1 and price in (50,60,75)`,[stat]);
const ig2=(await as('',`select * from market_index('')`)).find(r=>Number(r.id)===Number(stat));
assert.equal(Number(ig2.median_prev_24h),60);assert.equal(Number(ig2.median_24h),300);assert.equal(Number(ig2.change_24h_pct),400);
assert.ok(!idx.some(r=>r.name==='Unseen Item'),'items without data are not listed');

// Reference prices: admins only, a specific NiaDB page, the source's own timestamp, never in the future.
const ref=(uid,extra={})=>as(uid,`insert into reference_prices(item_id,source,source_url,price_type,price_low,price_typical,price_high,sample_size,window_days,as_of)
 values($1,'niadb',$2,$3,$4,$5,$6,12,14,$7)returning id,source_name,recorded_by`,[extra.item??stat,extra.url??'https://meowdb.com/msclassic/item-db/3062',extra.type??'asking',extra.low??90,extra.typical??120,extra.high??150,extra.asOf??new Date(Date.now()-864e5).toISOString()]);
const before=(await as('',`select item_summary($1,'') s`,[stat]))[0].s;
await assert.rejects(ref(A),/row-level security|permission/,'players cannot add reference prices');
const [r]=await ref(ADMIN);assert.equal(r.source_name,'NiaDB');assert.equal(r.recorded_by,ADMIN);
await assert.rejects(ref(ADMIN,{url:'https://meowdb.com/'}),/check/,'homepage link is not attribution');
await assert.rejects(ref(ADMIN,{url:'https://example.com/msclassic/item-db/1'}),/check/,'only NiaDB pages');
await assert.rejects(ref(ADMIN,{asOf:new Date(Date.now()+864e6).toISOString()}),/future/);
await assert.rejects(ref(ADMIN,{low:500,typical:120}),/check/,'low above typical');
await assert.rejects(ref(ADMIN,{type:'estimate'}),/check/,'only defined price types');
assert.equal((await as('',`select count(*)::int n from reference_prices where item_id=$1`,[stat]))[0].n,1,'visitors read reference prices');
const s2=(await as('',`select item_summary($1,'') s`,[stat]))[0].s;
assert.deepEqual(s2,before,'reference prices never enter market statistics');
await assert.rejects(as(A,`delete from reference_prices where id=$1 returning id`,[r.id]).then(x=>{if(!x.length)throw Error('permission: nothing deleted');}),/permission/);
console.log('Market parity SQL: misread and missing shop titles merged, other players refresh listings, stale listings leave, sold rows matched, distinct-listing statistics with observed prices only, market index, 24 h change gate, admin-only attributed NiaDB reference prices.');
