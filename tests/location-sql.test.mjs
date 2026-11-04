// Listing locations and sold sightings (migration 20261104000100) on the full migration stack in PGlite: scanner listings
// without a complete location are refused, FM rooms and named maps are stored structurally, greyed-out rows stay out of
// asking prices and sales, and repeated sold sightings are one row.
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite({extensions:{pg_trgm}});
await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;`);
for(const f of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
const A='00000000-0000-0000-0000-00000000000a',B='00000000-0000-0000-0000-00000000000b';
await db.exec(`insert into auth.users values('${A}','a@example.test'),('${B}','b@example.test')`);
const as=async(uid,sql,args=[])=>{await db.exec(`set role ${uid?'authenticated':'anon'};select set_config('request.jwt.claim.sub','${uid}',false)`);try{return(await db.query(sql,args)).rows;}finally{await db.exec('reset role');}};
const item=(await db.query(`insert into items(name,game_id,verified,source,release_status)values('Work Gloves',1082002,true,'catalog','released')returning id`)).rows[0].id;
const scan=(uid,loc,extra={})=>as(uid,`insert into observations(kind,world,item_name,price,qty,shop_key,shop_title,map,channel,capture_source,location_type,room,location_source,location_confidence)
 values($1,'Windia','Work Gloves',$2,1,$3,'Trash',$4,$5,'scanner',$6,$7,$8,$9)returning id,map,room,location_type`,[extra.kind||'ask',extra.price||450000000,extra.shop||'windia|trash',loc.map||'',loc.channel??null,loc.type||'',loc.room??null,loc.source??'AUTO',loc.confidence??90]);

// ---- Publishing validation ----
await assert.rejects(scan(A,{}),/location required/,'no location: refused');
await assert.rejects(scan(A,{type:'FM_ROOM',room:7}),/location required/,'FM room without a channel: refused');
await assert.rejects(scan(A,{type:'FM_ROOM',channel:1}),/location required/,'FM listing without a room: refused');
await assert.rejects(scan(A,{type:'NAMED_MAP',channel:2,map:''}),/location required/,'named map without a name: refused');
await assert.rejects(scan(A,{type:'FM_ROOM',channel:1,room:7,source:''}),/source required/,'AUTO or MANUAL is required');
await assert.rejects(scan(A,{type:'FM_ROOM',channel:1,room:7},{kind:'sale'}),/sold sightings/,'the scanner never reports sales');
const [fmRoom]=await scan(A,{type:'FM_ROOM',channel:1,room:7,map:'anything'});
assert.deepEqual([fmRoom.location_type,fmRoom.room,fmRoom.map],['FM_ROOM',7,'Free Market 7'],'CH 1 · FM Room 7, map name normalised');
const [named]=await scan(A,{type:'NAMED_MAP',channel:2,map:'Hidden Street',source:'MANUAL'},{price:300000000,shop:'windia|other'});
assert.deepEqual([named.location_type,named.room,named.map],['NAMED_MAP',null,'Hidden Street'],'CH 2 · Hidden Street');
assert.equal((await scan(A,{type:'FM_ROOM',channel:1,room:7})).length,0,'the same listing again is a duplicate');
// Store Watcher sales (not the scanner) are unaffected.
assert.equal((await as(A,`insert into observations(kind,world,item_name,price,capture_source)values('sale','Windia','Work Gloves',1,'store')returning id`)).length,1);
const listings=await as('',`select * from current_listings($1,'Windia')`,[item]);
assert.deepEqual(listings.map(l=>[l.channel,l.location_type,l.room,l.map,l.location_source]).sort(),[[1,'FM_ROOM',7,'Free Market 7','AUTO'],[2,'NAMED_MAP',null,'Hidden Street','MANUAL']],'Where to find, per listing');

// ---- Sold sightings ----
const sold=(uid,extra={})=>as(uid,`insert into sold_sightings(world,channel,location_type,room,map,location_source,shop_key,shop_title,item_name,listed_price,qty)
 values('Windia',$1,$2,$3,$4,'AUTO',$5,'Trash',$6,450000000,1)returning id,map`,[extra.channel??1,extra.type||'FM_ROOM',extra.room===undefined?7:extra.room,extra.map||'',extra.shop||'windia|trash',extra.item||'work gloves']);
await assert.rejects(as('',`insert into sold_sightings(world,channel,location_type,room,location_source,item_name,listed_price)values('Windia',1,'FM_ROOM',7,'AUTO','Work Gloves',1)`),/permission|denied|violates/,'anonymous visitors cannot add sightings');
await assert.rejects(sold(A,{room:null}),/check/,'a sold sighting needs a complete location too');
assert.equal((await sold(A))[0].map,'Free Market 7');
assert.equal((await sold(B)).length,0,'another player seeing the same greyed-out row: one sighting');
assert.equal((await sold(A,{item:'Not A Real Item'})).length,0,'unknown names never create items from sold rows');
assert.equal((await sold(B,{channel:2,type:'NAMED_MAP',room:null,map:'Hidden Street',shop:'windia|other'})).length,1);
assert.equal((await as('',`select count(*)::int n from sold_sightings where item_id=$1`,[item]))[0].n,2);
const s=(await as('',`select item_summary($1,'Windia') s`,[item]))[0].s;
assert.equal(s.sales_30d,0,'sold sightings are not sales');
assert.equal(s.lowest_ask_24h,300000000,'asking prices come from active listings only');

// ---- Player stores: FM room or named map ----
const store=(loc)=>as(A,`insert into player_stores(character_name,name,world,channel,room,map_name)values('Internaly','Trash','Windia',1,$1,$2)returning id`,[loc.room??null,loc.map||'']);
await assert.rejects(store({}),/player_stores_location/,'a store needs a room or a map');
await assert.rejects(store({room:7,map:'Hidden Street'}),/player_stores_location/,'not both');
assert.equal((await store({map:'Hidden Street'})).length,1);
assert.equal((await store({room:7})).length,1);
assert.deepEqual((await as('',`select room,map_name from public_player_stores order by room nulls first`)).map(r=>[r.room,r.map_name]),[[null,'Hidden Street'],[7,'']]);
console.log('Locations: incomplete scanner listings refused, FM rooms and named maps stored, sold sightings kept apart and deduplicated, store locations validated.');
