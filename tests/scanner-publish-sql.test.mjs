// Automatic FM Scanner publishing (migration 20261104000200) on the full migration stack in PGlite: scanner listings must
// name a known item, an asking price seen sold later leaves current listings but keeps its history, and a relisted row counts.
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
// The shop key is built from the shop title (shop.mjs shopKeyOf), so the title is the key's last part.
const title=key=>key.split('|').pop().replace(/^./,c=>c.toUpperCase());
const ask=(uid,extra={})=>as(uid,`insert into observations(kind,world,item_name,price,qty,shop_key,shop_title,map,channel,capture_source,location_type,room,location_source,location_confidence)
 values('ask','Windia',$1,$2,1,$3,$5,'',1,$4,'FM_ROOM',7,'AUTO',95)returning id`,[extra.item||'Work Gloves',extra.price||1679,extra.shop??'windia|free market 7|trash',extra.source||'scanner',title(extra.shop??'windia|free market 7|trash')]);
const sold=(uid,extra={})=>as(uid,`insert into sold_sightings(world,channel,location_type,room,location_source,shop_key,shop_title,item_name,listed_price,qty)
 values('Windia',1,'FM_ROOM',7,'AUTO',$1,$3,'Work Gloves',$2,1)returning id`,[extra.shop??'windia|free market 7|trash',extra.price||1679,title(extra.shop??'windia|free market 7|trash')]);
const current=async()=>(await as('',`select price from current_listings($1,'Windia')`,[item])).map(r=>Number(r.price)).sort((a,b)=>a-b);
const items=async()=>(await db.query(`select count(*)::int n from items`)).rows[0].n;

// Identity: an unknown name from the scanner is skipped and never becomes an item; the Store Watcher path is unchanged.
const before=await items();
assert.equal((await ask(A,{item:'Wrok Glvoes Misread'})).length,0,'unknown scanner item: not published');
assert.equal(await items(),before,'no item created from scanner OCR');
assert.equal((await as(A,`insert into observations(kind,world,item_name,price,qty,capture_source)values('sale','Windia','Brand New Item',5,1,'store')returning id`)).length,1,'store sales still add items');
await assert.rejects(as(A,`insert into observations(kind,world,item_name,price,qty,shop_key,channel,capture_source,location_type,room,location_source,sold_at)values('ask','Windia','Work Gloves',9,1,'x',1,'scanner','FM_ROOM',7,'AUTO',now())`),/permission|denied/,'clients cannot set sold_at');

// Unsold, then sold: the ask leaves current listings, stays in history, and the sold sighting keeps the listed price.
const [listed]=await ask(A);await ask(A,{price:2000,shop:'windia|free market 7|other'});
assert.deepEqual(await current(),[1679,2000]);
assert.equal((await ask(A)).length,0,'the same row on a repeated scan: one listing');
assert.equal((await sold(B)).length,1,'another player sees the row greyed out');
assert.deepEqual(await current(),[2000],'sold listing is no longer current');
const row=(await db.query(`select sold_at,price from observations where id=$1`,[listed.id])).rows[0];
assert.ok(row.sold_at,'the original asking price is kept, marked sold');assert.equal(Number(row.price),1679);
assert.equal((await sold(A)).length,0,'the same sold row again: one sighting');
assert.equal((await db.query(`select count(*)::int n from sold_sightings where listed_price=1679`)).rows[0].n,1);
const s=(await as('',`select item_summary($1,'Windia') s`,[item]))[0].s;
assert.equal(s.sales_30d,0,'sold sightings are listed prices, not confirmed sales');

// Relisted at the same price after it sold: a new current listing, not a duplicate of the sold one.
assert.equal((await ask(A)).length,1,'relisted row is published');
assert.deepEqual(await current(),[1679,2000]);
// A sighting in another shop does not touch this one.
await sold(A,{shop:'windia|free market 7|someone else'});
assert.deepEqual(await current(),[1679,2000]);
console.log('Scanner publishing: unknown items refused, sold rows end their listing and keep its price, repeats deduplicated, relistings counted.');
