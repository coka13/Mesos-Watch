// Imports NiaDB reference prices from a data file NiaDB has permitted you to use, into public.reference_prices.
//   node scripts/import-reference-prices.mjs --file niadb-prices.json --permission "NiaDB email 2026-11-10, J. Doe" [--dry-run]
//
// NiaDB's reuse policy (https://meowdb.com/reuse) requires written permission before crawling its site, API or data files,
// or republishing a catalog. This script never downloads anything: it reads a local file and refuses to run without
// --permission, which is stored with every imported row (import_ref). For one-off figures, use the admin form on the item
// page instead (individual facts with a link to the page are allowed without asking).
//
// File: a JSON array of
//   {game_id | name, price_type: 'asking'|'sold'|'npc_sell', price_typical, price_low?, price_high?, sample_size?,
//    window_days?, as_of: ISO date of the figure on NiaDB, source_url: the NiaDB item page, world?}
// Rows are added, never overwritten: the same item, world, type and as_of again is skipped.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

export const TYPES=['asking','sold','npc_sell'];
export const PAGE=/^https:\/\/(www\.)?meowdb\.com\/msclassic\/\S+$/;
const price=v=>v==null||v===''?null:Number.isInteger(+v)&&+v>=1&&+v<=1e11?+v:NaN;

// Every row checked before anything is written: the import is all or nothing.
export function validateRows(rows,now=Date.now()){
 const ok=[],errors=[];
 if(!Array.isArray(rows))return{ok,errors:['The file must contain a JSON array.']};
 rows.forEach((r,i)=>{
  const at=`row ${i+1}`,e=[];
  const gameId=r.game_id==null?null:Number.isInteger(+r.game_id)?+r.game_id:NaN,name=String(r.name||'').trim();
  if(gameId===null&&!name)e.push('game_id or name required');
  if(Number.isNaN(gameId))e.push('game_id must be a whole number');
  if(!TYPES.includes(r.price_type))e.push(`price_type must be one of ${TYPES.join(', ')}`);
  const typical=price(r.price_typical),low=price(r.price_low),high=price(r.price_high);
  if(!typical)e.push('price_typical must be a whole number of mesos from 1');
  if(Number.isNaN(low)||Number.isNaN(high))e.push('price_low/price_high must be whole numbers of mesos from 1');
  if(typical&&low&&low>typical)e.push('price_low above price_typical');
  if(typical&&high&&high<typical)e.push('price_high below price_typical');
  const asOf=Date.parse(r.as_of);
  if(!Number.isFinite(asOf))e.push('as_of must be the date of the figure on NiaDB');else if(asOf>now+36e5)e.push('as_of is in the future');
  if(!PAGE.test(String(r.source_url||'')))e.push('source_url must be the specific NiaDB page (https://meowdb.com/msclassic/...)');
  const sample=r.sample_size==null?null:+r.sample_size,days=r.window_days==null?null:+r.window_days;
  if(sample!==null&&!(Number.isInteger(sample)&&sample>=0))e.push('sample_size must be a whole number');
  if(days!==null&&!(Number.isInteger(days)&&days>=1&&days<=365))e.push('window_days must be 1 to 365');
  if(e.length)errors.push(`${at}: ${e.join('; ')}`);
  else ok.push({game_id:gameId,name,world:String(r.world||'').slice(0,32),price_type:r.price_type,price_typical:typical,price_low:low,price_high:high,
   sample_size:sample,window_days:days,as_of:new Date(asOf).toISOString(),source_url:r.source_url});
 });
 return{ok,errors};
}

export function parseArgs(argv){
 const a={dryRun:false};
 for(let i=0;i<argv.length;i++){if(argv[i]==='--file')a.file=argv[++i];else if(argv[i]==='--permission')a.permission=argv[++i];else if(argv[i]==='--dry-run')a.dryRun=true;}
 if(!a.file)throw Error('--file <json> is required.');
 if(!a.permission||a.permission.trim().length<10)throw Error('--permission "<who granted it, how and when>" is required: NiaDB needs written permission before its data is imported in bulk (https://meowdb.com/reuse).');
 return a;
}

async function main(){
 const args=parseArgs(process.argv.slice(2));
 const {ok,errors}=validateRows(JSON.parse(fs.readFileSync(args.file,'utf8')));
 if(errors.length){console.error(errors.slice(0,50).join('\n'));throw Error(`${errors.length} invalid row(s); nothing imported.`);}
 console.log(`${ok.length} valid row(s).`);
 if(args.dryRun)return;
 const env=fs.existsSync('.env.local')?Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).map(l=>l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/)).filter(Boolean).map(m=>[m[1],m[2].replace(/^['"]|['"]$/g,'')])):{};
 const url=process.env.SUPABASE_DB_URL||env.SUPABASE_DB_URL;
 if(!url)throw Error('Set SUPABASE_DB_URL in .env.local.');
 const {default:pg}=await import('pg');
 const db=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}});
 await db.connect();
 try{
  await db.query('begin');
  let added=0,missing=[];
  for(const r of ok){
   const item=(await db.query(`select id from items where ($1::int is not null and game_id=$1) or ($1::int is null and name_key=norm_name($2)) limit 1`,[r.game_id,r.name])).rows[0];
   if(!item){missing.push(r.game_id??r.name);continue;}
   const res=await db.query(`insert into reference_prices(item_id,world,source,source_url,price_type,price_low,price_typical,price_high,sample_size,window_days,as_of,import_ref)
    values($1,$2,'niadb',$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing`,[item.id,r.world,r.source_url,r.price_type,r.price_low,r.price_typical,r.price_high,r.sample_size,r.window_days,r.as_of,args.permission.trim().slice(0,200)]);
   added+=res.rowCount;
  }
  if(missing.length)throw Error(`${missing.length} item(s) not in the catalog (${missing.slice(0,10).join(', ')}); nothing imported.`);
  await db.query('commit');
  console.log(`Imported ${added} reference price(s); ${ok.length-added} already present.`);
 }catch(e){await db.query('rollback');throw e;}finally{await db.end();}
}
if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exit(1);});
