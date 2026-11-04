// NiaDB reference-price import: refuses to run without a recorded permission, checks every row before writing, and the
// rows it accepts are accepted by the database (migration 20261104000300) in PGlite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {validateRows,parseArgs} from '../scripts/import-reference-prices.mjs';

assert.throws(()=>parseArgs(['--file','x.json']),/permission/,'no permission, no import');
assert.throws(()=>parseArgs(['--file','x.json','--permission','yes']),/permission/,'a real permission reference');
assert.throws(()=>parseArgs(['--permission','NiaDB email 2026-11-10']),/--file/);
assert.equal(parseArgs(['--file','x.json','--permission','NiaDB email 2026-11-10','--dry-run']).dryRun,true);

const now=Date.parse('2026-11-05T12:00:00Z');
const good={game_id:1082002,price_type:'asking',price_typical:1200,price_low:1000,price_high:1500,sample_size:12,window_days:14,as_of:'2026-11-04',source_url:'https://meowdb.com/msclassic/item-db/3062'};
assert.equal(validateRows([good],now).ok.length,1);
const bad=[
 [{...good,source_url:'https://meowdb.com/'},/specific NiaDB page/],
 [{...good,source_url:'https://example.com/msclassic/x'},/specific NiaDB page/],
 [{...good,price_type:'estimate'},/price_type/],
 [{...good,price_typical:12.5},/price_typical/],
 [{...good,price_low:2000},/price_low above/],
 [{...good,as_of:'2026-12-01'},/future/],
 [{...good,as_of:'soon'},/as_of/],
 [{...good,game_id:undefined,name:''},/game_id or name/],
 [{...good,window_days:0},/window_days/],
];
for(const [row,re] of bad){const r=validateRows([good,row],now);assert.equal(r.errors.length,1);assert.match(r.errors[0],re);assert.match(r.errors[0],/^row 2/);}
assert.deepEqual(validateRows({},now).errors,['The file must contain a JSON array.']);

// What validation accepts, the table accepts.
const db=new PGlite({extensions:{pg_trgm}});
await db.exec(`create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;grant usage on schema public,auth to anon,authenticated,service_role;`);
for(const f of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
const id=(await db.query(`insert into items(name,game_id,verified,source,release_status)values('Work Gloves',1082002,true,'catalog','released')returning id`)).rows[0].id;
const [r]=validateRows([good],now).ok;
const ins=()=>db.query(`insert into reference_prices(item_id,world,source,source_url,price_type,price_low,price_typical,price_high,sample_size,window_days,as_of,import_ref)
 values($1,$2,'niadb',$3,$4,$5,$6,$7,$8,$9,$10,'NiaDB email 2026-11-10') on conflict do nothing`,[id,r.world,r.source_url,r.price_type,r.price_low,r.price_typical,r.price_high,r.sample_size,r.window_days,r.as_of]);
assert.equal((await ins()).affectedRows,1);assert.equal((await ins()).affectedRows,0,'the same figure again is skipped');
assert.equal((await db.query(`select recorded_by,source_name from reference_prices`)).rows[0].source_name,'NiaDB');
console.log('Reference import: permission required, rows checked before writing (page link, type, whole mesos, ranges, dates), accepted rows fit the table, repeats skipped.');
