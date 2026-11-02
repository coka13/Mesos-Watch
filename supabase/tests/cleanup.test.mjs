// The incorrect-listings cleanup and its rollback, on the schema production has today (migrations up to 000700) and on the
// full migration stack. Run: npm test
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'node:fs';import assert from 'node:assert/strict';
const cleanup=fs.readFileSync('supabase/cleanup/20261102_incorrect_listings.sql','utf8');
const rollback=fs.readFileSync('supabase/cleanup/20261102_incorrect_listings_rollback.sql','utf8');
const R='2ea7f24c-b59f-4d7a-a649-24d6714556cb',U='00000000-0000-0000-0000-00000000000a';
// The five audited rows, with their production ids, item ids and prices.
const AUDIT=[[1,13086,'Black Coat of Death',19679],[2,11827,'Tiger Mask',23679],[3,13083,'Ghost Costume',20679],[4,13104,'Ghost Suit',19679],[5,12244,'Pumpkin Hat',20679]];

async function setup(last){
 const db=new PGlite({extensions:{pg_trgm}});
 await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;`);
 for(const f of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&(!last||f<=last)).sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await db.exec(`insert into auth.users(id) values('${R}'),('${U}')`);
 for(const [,id,name]of AUDIT)await db.query(`insert into items(id,game_id,name,category,source,verified) overriding system value values($1,$2,$3,'cash','observed',true)`,[id,1000000+id,name]);
 await db.exec('alter table observations disable trigger observations_guard');
 for(const [oid,item,name,price]of AUDIT)await db.query(`insert into observations(id,kind,reporter,item_id,item_name,price,seen_at) overriding system value values($1,'ask',$2,$3,$4,$5,'2026-11-01T15:17:00Z')`,[oid,R,item,name,price]);
 await db.exec("alter table observations enable trigger observations_guard;select setval(pg_get_serial_sequence('observations','id'),5);select setval(pg_get_serial_sequence('items','id'),20000)");
 await db.query(`insert into items(name,game_id,category,source,verified) values('Unrelated Potion',2000000,'use','catalog',true)`);
 return db;
}
const count=async(db,sql)=>Number((await db.query(sql)).rows[0].n);

for(const last of ['20261101000700_trend_icons.sql',null]){
 const db=await setup(last),label=last?'production schema':'full schema';
 const items=await count(db,'select count(*) n from items');
 await db.exec(cleanup);
 assert.equal(await count(db,'select count(*) n from observations'),0,label+': listings removed');
 assert.equal(await count(db,'select count(*) n from cleanup_archive.observations_20261102'),5,label+': archived first');
 assert.equal(await count(db,'select count(*) n from items'),items,label+': catalog untouched');
 assert.equal(await count(db,'select count(*) n from auth.users'),2,label+': users untouched');
 const summary=(await db.query(`select * from item_summary(11827,'')`)).rows[0]||{};
 assert.ok(!Object.values(summary).some(v=>Number(v)===23679),label+': no derived price survives');
 await assert.rejects(db.exec(cleanup),/already ran/,label+': not run twice');await db.exec('rollback');
 await db.exec(rollback);
 assert.deepEqual((await db.query('select id,item_id,price,reporter,seen_at from observations order by id')).rows.map(r=>[r.id,r.item_id,Number(r.price),r.reporter,new Date(r.seen_at).toISOString()]),AUDIT.map(([a,b,,d])=>[a,b,d,R,'2026-11-01T15:17:00.000Z']),label+': rollback restores ids, prices, reporter and time');
 assert.ok((await db.query(`select tgenabled from pg_trigger where tgname='observations_guard'`)).rows.every(x=>x.tgenabled==='O'),'insert guard re-enabled');
 // Any difference from the audit aborts without changes.
 await db.query(`update observations set price=19679 where id=2`);
 await assert.rejects(db.exec(cleanup),/differ from the audit/);
 await db.exec('rollback');
 assert.equal(await count(db,'select count(*) n from observations'),5,label+': aborted run changed nothing');
 await db.close();
}
// New observations after the audit are never selected.
{const db=await setup('20261101000700_trend_icons.sql');
 await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${U}',false);grant insert,select on observations to authenticated;`).catch(()=>{});
 await db.exec('reset role');await db.exec(`grant all on all tables in schema public to authenticated;set role authenticated;select set_config('request.jwt.claim.sub','${U}',false)`);
 await db.query(`insert into observations(kind,item_name,price) values('ask','Tiger Mask',19679)`);await db.exec('reset role');
 await db.exec(cleanup);
 assert.equal(await count(db,'select count(*) n from observations'),1,'post-audit observation kept');await db.close();}
console.log('Listings cleanup: exact audited rows only, archived, catalog/users untouched, derived prices reset, rollback, abort on mismatch: ok');
