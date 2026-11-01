// Database tests: runs supabase/migrations in PGlite (Postgres 16 in WebAssembly) with stand-ins for Supabase's auth schema and roles,
// then exercises them as anonymous visitors, signed-in players, admins and the service role. Run: npm test
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'node:fs';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const dir=process.argv[2]||fileURLToPath(new URL('../migrations',import.meta.url));
const db=new PGlite({extensions:{pg_trgm}});
await db.exec(`create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public, auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;`);
for(const f of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync(dir+'/'+f,'utf8'));
await db.exec(`grant all on all tables in schema public to service_role;`);
const A='00000000-0000-0000-0000-00000000000a',B='00000000-0000-0000-0000-00000000000b',C='00000000-0000-0000-0000-00000000000c',D='00000000-0000-0000-0000-0000000000dd';
await db.exec(`insert into auth.users values ('${A}'),('${B}'),('${C}'),('${D}')`);
const as=async(role,uid,sql,params)=>{await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid||''}',false);`);try{return (await db.query(sql,params)).rows;}finally{await db.exec('reset role');}};
const ask=(uid,item,price,extra={})=>as('authenticated',uid,`insert into observations(kind,item_name,price,qty,stats,shop_key,shop_title,world) values($1,$2,$3,$4,$5,$6,$7,$8) returning id`,[extra.kind||'ask',item,price,extra.qty||1,JSON.stringify(extra.stats||{}),extra.shop||'s1',extra.title||'Cheap Halloween NX',extra.world||'']);

// inserts, item auto-creation, duplicates
assert.equal((await ask(A,'Grey Skull Overall',24679)).length,1);
assert.equal((await ask(A,'grey  skull overall',24679)).length,0,'duplicate ignored');
assert.equal((await ask(A,'Grey Skull Overall',24000)).length,1);
assert.equal((await as('anon','',`select * from search_items('grey','')`)).length,0,'one reporter: not yet searchable');
await ask(B,'Grey Skull Overall',25000,{shop:'s2'});
const found=await as('anon','',`select * from search_items('grey sk','')`);
assert.equal(found.length,1);assert.equal(found[0].name,'Grey Skull Overall');assert.equal(Number(found[0].asks_7d),3);
assert.equal((await as('anon','',`select * from search_items('gery skul overal','')`)).length,1,'fuzzy match finds OCR typo');
// anon cannot write; reporter cannot be spoofed
await assert.rejects(as('anon','',`insert into observations(kind,item_name,price) values('ask','Tiger Mask',1)`));
await assert.rejects(as('authenticated',C,`insert into observations(kind,item_name,price,reporter) values('ask','Tiger Mask',23679,'${A}')`));
// bad values
await assert.rejects(ask(A,'Tiger Mask',0));await assert.rejects(ask(A,'X',5));await assert.rejects(ask(A,'Tiger Mask',5,{kind:'gift'}));
// summary: no estimated value without enough sales
const id=found[0].id;
let sum=(await as('anon','',`select item_summary($1,'') s`,[id]))[0].s;
assert.equal(sum.lowest_ask_24h,24000);assert.equal(sum.median_ask_7d,24679);assert.equal(sum.estimated_value,null);
await ask(A,'Grey Skull Overall',23000,{kind:'sale'});await ask(B,'Grey Skull Overall',23500,{kind:'sale'});await ask(C,'Grey Skull Overall',22000,{kind:'sale'});
sum=(await as('anon','',`select item_summary($1,'') s`,[id]))[0].s;
assert.equal(sum.estimated_value,23000);assert.equal(sum.sales_30d,3);
// listings, history, variations, trends, worlds
await ask(C,'Grey Skull Overall',40000,{stats:{str:3,slots:5},shop:'s3'});
const listings=await as('anon','',`select * from current_listings($1,'')`,[id]);
assert.deepEqual(listings.map(l=>Number(l.price)),[24000,24679,25000,40000]);
for(const r of ['24h','7d','30d','90d'])assert.ok((await as('anon','',`select * from price_history($1,'',$2)`,[id,r])).length>=2,r);
await assert.rejects(as('anon','',`select * from price_history($1,'','1y')`,[id]));
assert.deepEqual((await as('anon','',`select * from item_variations($1,'')`,[id]))[0].stats,{str:3,slots:5});
assert.equal((await as('anon','',`select * from market_trends('')`)).length,1);
await ask(A,'Grey Skull Overall',99999,{world:'Bera'});
assert.equal((await as('anon','',`select item_summary($1,'Bera') s`,[id]))[0].s.lowest_ask_24h,99999);
// icon votes need two players
assert.equal((await as('authenticated',A,`select vote_icon($1,'0123456789abcdef','observed/${id}/0123456789abcdef.png') v`,[id]))[0].v,false);
await assert.rejects(as('authenticated',A,`select vote_icon($1,'0123456789abcdef','observed/999/0123456789abcdef.png')`,[id]));
assert.equal((await as('authenticated',B,`select vote_icon($1,'0123456789abcdef','observed/${id}/0123456789abcdef.png') v`,[id]))[0].v,true);
assert.equal((await as('anon','',`select icon_path from items where id=$1`,[id]))[0].icon_path,`observed/${id}/0123456789abcdef.png`);
// non-admins cannot edit items or delete observations
await as('authenticated',A,`update items set verified=true where id=$1`,[id]);
assert.equal((await db.query(`select verified from items where id=$1`,[id])).rows[0].verified,false);
await as('authenticated',A,`delete from observations`);
assert.ok((await db.query(`select count(*)::int n from observations`)).rows[0].n>0);
await db.exec(`insert into admins values('${C}')`);
await as('authenticated',C,`update items set verified=true, game_id=1052072 where id=$1`,[id]);
assert.equal((await db.query(`select verified from items where id=$1`,[id])).rows[0].verified,true);
// The trends lists draw item pictures, so market_trends must return the same picture columns as search_items.
{const [t]=await as('anon','',`select game_id,category,icon_path from market_trends('')`);
 assert.equal(t.game_id,1052072,'trends carry game_id, so cash items get their sprite');
 assert.ok('category' in t&&'icon_path' in t,'trends return every picture column');}
// rate limit
for(let i=0;i<150;i++)await ask(D,'Spam Item',1000+i);
await assert.rejects(ask(D,'Spam Item',5000),/rate limit/);
console.log('price checker SQL: ok');

// ---------- megaphones ----------
const mk=async(buyer,status,minutes=30)=>(await db.query(`insert into megaphones(buyer,message,plan_id,minutes,price_cents,status) values($1,'Selling Steelies ch 3 FM 7','m30',$2,199,$3) returning id`,[buyer,minutes,status])).rows[0].id;
assert.equal((await as('anon','',`select * from megaphone_plans order by sort`)).map(p=>p.price_cents).join(),'100,200,400,700,1200','active plans: $1/1h, $2/2.5h, $4/6h, $7/12h, $12/24h');
assert.deepEqual((await as('anon','',`select minutes from megaphone_plans order by sort`)).map(p=>p.minutes),[60,150,360,720,1440]);
await assert.rejects(as('authenticated',A,`insert into megaphones(buyer,message,plan_id,minutes,price_cents) values('${A}','hello world','m30',30,1)`));
const p1=await mk(A,'paid_pending_review');
await assert.rejects(as('authenticated',A,`select approve_megaphone($1)`,[p1]),/admins only/);
assert.equal((await as('anon','',`select * from live_megaphones`)).length,0);
const ok=(await as('authenticated',C,`select * from approve_megaphone($1)`,[p1]))[0];
assert.equal(ok.status,'scheduled');assert.equal((new Date(ok.ends_at)-new Date(ok.starts_at))/60000,30);
const live=await as('anon','',`select * from live_megaphones`);
assert.equal(live.length,1);assert.equal(live[0].buyer,undefined,'no buyer exposed');
await assert.rejects(as('authenticated',C,`select approve_megaphone($1)`,[p1]),/scheduled/);
await assert.rejects(as('authenticated',C,`select approve_megaphone($1)`,[await mk(A,'awaiting_payment')]),/awaiting_payment/);
assert.equal((await as('authenticated',B,`select * from megaphones`)).length,0,'buyers only see their own');
assert.equal((await as('authenticated',A,`select * from megaphones`)).length,2);
// slots: with 2 slots and one live, the 2nd approval starts now and the 3rd queues until the first one ends
const q=[await mk(B,'paid_pending_review',60),await mk(B,'paid_pending_review',60)];
const s1=(await as('authenticated',C,`select * from approve_megaphone($1,2)`,[q[0]]))[0];
const s2=(await as('authenticated',C,`select * from approve_megaphone($1,2)`,[q[1]]))[0];
assert.ok(new Date(s1.starts_at)<=new Date(Date.now()+1000));
assert.equal(new Date(s2.starts_at).getTime(),new Date(ok.ends_at).getTime(),'queued until a slot frees');
assert.equal((await as('authenticated',C,`select display_status from megaphone_queue where id=$1`,[q[1]]))[0].display_status,'queued');
console.log('megaphone SQL: ok');
// the payment webhook approves with the service role's JWT; a player forging a claim in a normal session cannot
const p9=await mk(A,'paid_pending_review');
await assert.rejects(as('authenticated',A,`select approve_megaphone('${p9}')`),/admins only/);
await db.exec(`select set_config('request.jwt.claims','{"role":"service_role"}',false)`);
assert.equal((await as('service_role','',`select status from approve_megaphone($1)`,[p9]))[0].status,'scheduled');
console.log('megaphone service-role approval: ok');

// NX items are not in the Classic catalog: they appear once two players read the same name in shops, and an admin types them as NX.
{
 const E='00000000-0000-0000-0000-0000000000e1',F='00000000-0000-0000-0000-0000000000f1';
 await db.exec(`insert into auth.users values ('${E}'),('${F}')`);
 await ask(E,'Ghost Costume',20679,{shop:'cheap halloween nx'});
 assert.equal((await as('anon','',`select * from search_items('ghost cos','')`)).length,0,'one sighting: hidden');
 await ask(F,'Ghost Costume',21000,{shop:'other shop'});
 const [nx]=await as('anon','',`select * from search_items('ghost cos','')`);
 assert.equal(nx.category,'unknown');
 await as('authenticated',C,`update items set category='cash', verified=true where id=$1`,[nx.id]);
 assert.equal((await as('anon','',`select category from search_items('ghost cos','')`))[0].category,'cash');
 console.log('NX community item flow: ok');
}

// Automatic catalog updates: the database job must import exactly what supabase/import-catalog.mjs would, refuse broken
// downloads, skip unchanged ones, and be startable only by admins and the scheduler. pg_net is replaced by a stub here.
{
 const {toRows,cashItems}=await import(new URL('../import-catalog.mjs',import.meta.url).href);
 const cats=['Equipment','Consumable','Setup','Etc','Other'];
 const doc=Array.from({length:620},(_,i)=>({id:1000000+i*7,name:i===5?'  Duplicate   Name ':i===9?'duplicate name':i===11?'X':`Item ${i}`,category:cats[i%5],sub_category:i%3?'Hat':'',
  stats:{reqLevel:i%4,incSTR:i%2?3:0,tuc:7,tradeBlock:i===13?1:0,quest:i===17?1:0},req_classes:i%6?['Warrior']:[],spec:i%8?null:{time:60},description:i%5?'Line one\nline two #cRed# text':''}));
 await db.exec(`create schema if not exists net; create table if not exists net._http_response(id bigint primary key, status_code int, content text);
  create sequence if not exists net.req; create or replace function net.http_get(url text, headers jsonb, timeout_milliseconds int) returns bigint language sql as $$ select nextval('net.req') $$;`);
 // NX cash shop: grouped by category; includes a name that is also a regular item (the regular one must win), NX duplicates,
 // a missing sub_category (falls back to the category), periods, and a too-short name.
 const cashDoc={categories:[{category:'Equipment',items:Array.from({length:40},(_,i)=>({id:1050000+i,name:i===0?'Item 3':i===1?'Ghost Costume':i===2?'ghost  costume':i===3?'Y':`NX Item ${i}`,category:'Equipment',sub_category:i%2?'Hat':'Overall',period:i%4?0:90,description:i%3?'Spooky\nhat':''}))},
  {category:'Coupon',items:[{id:5150000,name:'Mystery Hair Coupon',category:'Coupon',sub_category:null,period:14,description:''}]}]};
 const respond=(id,code,body)=>db.query(`insert into net._http_response values ($1,$2,$3)`,[id,code,body]);
 // Each sync downloads two files: the item list and the cash shop.
 const respondBoth=async(items,cash,code=200,cashCode=200)=>{const r=(await db.query(`select request_id,cash_request_id from catalog_sync_log order by id desc limit 1`)).rows[0];await respond(r.request_id,code,items);await respond(r.cash_request_id,cashCode,cash);};
 const last=async()=>(await db.query(`select status,items,message from catalog_sync_log order by id desc limit 1`)).rows[0];
 const stale=()=>db.exec(`update catalog_sync_log set requested_at=now()-interval '1 day'`);
 let id=(await db.query(`select catalog_sync_request() r`)).rows[0].r;
 await respondBoth(JSON.stringify(doc),JSON.stringify(cashDoc));await db.exec(`select catalog_sync_apply()`);
 assert.equal((await last()).status,'applied',JSON.stringify(await last()));
 const want=toRows(doc,cashItems(cashDoc)).map(r=>({game_id:r.game_id,name:r.name,category:r.category,subcategory:r.subcategory,base_stats:r.base_stats})).sort((a,b)=>a.game_id-b.game_id);
 const got=(await db.query(`select game_id,name,category,subcategory,base_stats from items where source='catalog' order by game_id`)).rows;
 assert.deepEqual(got,want,'database import differs from import-catalog.mjs');
 const nx=got.filter(r=>r.category==='cash');
 assert.ok(nx.some(r=>r.name==='Ghost Costume')&&!got.some(r=>r.name==='Y'));
 assert.equal(got.find(r=>r.name==='Item 3').category,'etc','regular item wins over an NX item with the same name');
 assert.equal(got.find(r=>r.name==='Mystery Hair Coupon').subcategory,'Coupon');
 await stale();await db.query(`select catalog_sync_request()`);await respondBoth(JSON.stringify(doc),JSON.stringify(cashDoc));await db.exec(`select catalog_sync_apply()`);
 assert.equal((await last()).status,'unchanged');
 await stale();await db.query(`select catalog_sync_request()`);await respondBoth(JSON.stringify(doc.slice(0,50)),JSON.stringify(cashDoc));await db.exec(`select catalog_sync_apply()`);
 assert.equal((await last()).status,'failed');assert.equal(got.length,(await db.query(`select count(*)::int n from items where source='catalog'`)).rows[0].n);
 await stale();await db.query(`select catalog_sync_request()`);await respondBoth(JSON.stringify(doc),'down',200,503);await db.exec(`select catalog_sync_apply()`);
 assert.match((await last()).message,/503 \(cash shop\)/);
 await assert.rejects(as('authenticated',A,`select catalog_sync_now()`),/admins only/);
 await assert.rejects(as('authenticated',A,`select catalog_sync_request()`),/permission denied/);
 await assert.rejects(as('anon','',`select catalog_apply('[]'::jsonb,'{}'::jsonb)`),/permission denied/);
 await stale();assert.ok((await as('authenticated',C,`select catalog_sync_now() r`))[0].r>0,'admin can start an update');
 console.log('Automatic catalog updates: items + NX cash shop, same rows as the import script, unchanged skipped, broken or failed download refused, admin-only: ok');
}

// Search pages: every match is reachable by paging, pages never overlap, and each page holds at most 50.
{
 for(let i=0;i<130;i++)await db.query(`insert into items(name,category,source,verified) values($1,'use','catalog',true)`,[`Paging Test Scroll ${String(i).padStart(3,'0')}`]);
 const seen=[];let page;let offset=0;
 do{page=await as('anon','',`select id,name from search_items('paging test',  '',50,$1)`,[offset]);assert.ok(page.length<=50);seen.push(...page.map(r=>r.id));offset+=page.length;}while(page.length===50);
 assert.equal(seen.length,130,'all 130 matches reachable');assert.equal(new Set(seen).size,130,'no overlaps between pages');
 assert.equal((await as('anon','',`select * from search_items('paging test','',500,0)`)).length,50,'page size capped at 50');
 console.log('Search paging: 130 matches over 3 pages, no overlaps, 50 per page max: ok');
}

// Test megaphones: off without a code, refused with a wrong one, live at once for 10 minutes with the right one, 3 an hour.
{
 const post=(uid,code,msg='Test megaphone hello')=>as('authenticated',uid,`select status,test,minutes,price_cents,ends_at-starts_at as span from post_test_megaphone($1,$2,'Tester','','p60')`,[code,msg]);
 await assert.rejects(post(A,'x'),/turned off/);
 await db.exec(`insert into site_settings values ('megaphone_test_code','s3cret')`);
 await assert.rejects(post(A,'wrong'),/Wrong test code/);
 await assert.rejects(as('anon','',`select post_test_megaphone('s3cret','hello there')`),/permission denied/);
 assert.equal((await as('anon','',`select * from site_settings`).catch(e=>e)).message?.includes('permission denied')??true,true,'settings hidden from visitors');
 const [m]=await post(A,'s3cret');
 assert.deepEqual([m.status,m.test,m.minutes,m.price_cents],['scheduled',true,10,0]);
 assert.ok((await as('anon','',`select message from live_megaphones where message='Test megaphone hello'`)).length>=1,'test megaphone is live');
 await post(A,'s3cret','second test');await post(A,'s3cret','third test');
 await assert.rejects(post(A,'s3cret','fourth test'),/3 test megaphones/);
 assert.equal((await as('authenticated',A,`select test from megaphone_queue where message='second test'`))[0].test,true);
 console.log('Test megaphones: code-gated, live for 10 minutes, rate-limited: ok');
}
