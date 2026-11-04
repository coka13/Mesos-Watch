// supabase/cleanup/20261105_duplicate_listings.sql and its rollback, on the production rows as audited on 2026-11-05.
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'node:fs';import assert from 'node:assert/strict';
const run=f=>fs.readFileSync('supabase/cleanup/'+f,'utf8');
// PGlite errors carry its whole bundle in the stack; report the database message only.
process.on('uncaughtException',e=>{console.error(e.code==='ERR_ASSERTION'?e:'Error: '+e.message);process.exit(1);});
async function setup(){
 const db=new PGlite({extensions:{pg_trgm}});
 await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;`);
 for(const f of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 const R='e97316a2-0000-0000-0000-000000000001';
 await db.exec(`insert into auth.users values('${R}','r@example.test')`);
 for(const n of ['Sapphire Earrings','Dark Master Sergeant','Blue Jewelry Boots','Gold Earrings','Sky Sneak Pants','Emerald Ore'])await db.query(`insert into items(name,source,verified)values($1,'catalog',true)`,[n]);
 // [id, item, price, title, time, located]
 const rows=[[6,'Sapphire Earrings',7679,'Interr Iy','2026-11-03T22:26:08Z',false],[7,'Sapphire Earrings',7679,'','2026-11-03T22:30:11Z',false],
  [11,'Emerald Ore',120,'','2026-11-04T21:06:19Z',true],[12,'Dark Master Sergeant',3400,'LeoTsuwubasal','2026-11-04T21:07:59Z',true],[13,'Blue Jewelry Boots',2000,'LeoTsuwubasal','2026-11-04T21:07:59Z',true],
  [14,'Blue Jewelry Boots',1800,'LeoTsuwubasal','2026-11-04T21:07:59Z',true],[16,'Gold Earrings',4000,'LeoTsuwubasal','2026-11-04T21:07:59Z',true],[17,'Sky Sneak Pants',2500,'LeoTsuwubasal','2026-11-04T21:07:59Z',true],
  [18,'Emerald Ore',89,'eT','2026-11-04T21:11:25Z',true],[19,'Sky Sneak Pants',2500,'','2026-11-04T21:12:25Z',true],[20,'Dark Master Sergeant',3400,'Clac e','2026-11-04T21:12:46Z',true],
  [21,'Blue Jewelry Boots',2000,'Clac e','2026-11-04T21:12:46Z',true],[22,'Blue Jewelry Boots',1800,'Clac e','2026-11-04T21:12:46Z',true],[24,'Gold Earrings',4000,'Clac e','2026-11-04T21:12:46Z',true]];
 await db.exec('alter table observations disable trigger user');
 for(const [id,item,price,title,at,located] of rows)await db.query(`insert into observations(id,kind,reporter,world,item_id,item_name,price,qty,shop_key,shop_title,map,channel,location_type,room,location_source,capture_source,seen_at,last_seen_at) overriding system value
  values($1,'ask',$2,'',(select id from items where name=$3),$3,$4,1,$5,$6,$7,$8,$9,$10,$11,'scanner',$12,$12)`,
  [id,R,item,price,title?('|free market 14|'+title).toLowerCase():'',title,located?'Free Market 14':'',located?4:null,located?'FM_ROOM':'',located?14:null,located?'AUTO':'',at]);
 await db.exec('alter table observations enable trigger user');
 return db;
}
const snapshot=async db=>(await db.query(`select id,price,seen_count,last_seen_at from observations order by id`)).rows.map(r=>[r.id,Number(r.price),r.seen_count,new Date(r.last_seen_at).toISOString()]);

const db=await setup(),before=await snapshot(db);
await db.exec(run('20261105_duplicate_listings.sql'));
const after=await db.query(`select id,seen_count,last_seen_at from observations order by id`);
assert.deepEqual(after.rows.map(r=>r.id),[6,11,12,13,14,16,17,18],'only the 6 duplicates removed');
const by=Object.fromEntries(after.rows.map(r=>[r.id,r]));
for(const id of [6,12,13,14,16,17])assert.equal(by[id].seen_count,2,'original counts the duplicate as a sighting: '+id);
assert.equal(new Date(by[17].last_seen_at).toISOString(),'2026-11-04T21:12:25.000Z');
assert.equal(by[11].seen_count,1);assert.equal(by[18].seen_count,1,'unrelated listings untouched');
await assert.rejects(db.exec(run('20261105_duplicate_listings.sql')),/already ran/,'runs once');
await db.exec('rollback');  // run-sql.mjs closes its connection on an error; this session stays open
await db.exec(run('20261105_duplicate_listings_rollback.sql'));
assert.deepEqual(await snapshot(db),before,'rollback restores rows and counters exactly');
// Rows that differ from the audit: nothing changes.
await db.query(`update observations set price=3401 where id=20`);
const changed=await snapshot(db);
await assert.rejects(db.exec(run('20261105_duplicate_listings.sql')),/differ from the audit/);
await db.exec('rollback').catch(()=>{});
assert.deepEqual(await snapshot(db),changed,'abort leaves everything as it was');
console.log('Duplicate listings cleanup: exact audited pairs only, folded into their originals as sightings, unrelated rows untouched, runs once, rollback exact, abort on mismatch: ok');
