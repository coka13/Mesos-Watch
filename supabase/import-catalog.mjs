// Imports the MapleStory Classic World item catalog (names, ids, categories, requirements, base stats, descriptions)
// and the Classic cash shop (NX items) from the OSMS Data Explorer public dataset into the items table. Re-run it after a game patch to pick up new items.
// Dataset: CC BY 4.0, "Data from OSMS Data Explorer (https://osmsdataexplorer.com)". Credit is shown on item pages.
// Game data and icons belong to Nexon.
//
//   SUPABASE_URL=https://xyz.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node supabase/import-catalog.mjs
//   node supabase/import-catalog.mjs --sql catalog.sql                  (write SQL to paste into the SQL Editor; no key needed)
//   node supabase/import-catalog.mjs --file items.json --cash cash_shop.json --dry-run   (use saved files; print counts only)
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

export const SOURCE='https://osmsdataexplorer.com/data/api/v1/items.json';
export const CASH_SOURCE='https://osmsdataexplorer.com/data/current/cash_shop.json';
export const CREDIT='Data from OSMS Data Explorer (https://osmsdataexplorer.com), CC BY 4.0';
const CATEGORY={Equipment:'equip',Consumable:'use',Setup:'setup',Etc:'etc'};
// Stats shown on the item page; requirement keys go to their own fields.
const STAT_KEYS=['incSTR','incDEX','incINT','incLUK','incMHP','incMMP','incPAD','incMAD','incPDD','incMDD','incACC','incEVA','incSpeed','incJump','incCRT','incCRD','knockback','tuc','attackSpeed','reqSTR','reqDEX','reqINT','reqLUK','reqPOP'];
const norm=s=>String(s||'').trim().replace(/\s+/g,' ').toLowerCase();

// cash_shop.json groups NX items by cash shop category: {categories:[{category, items:[...]}]}.
export const cashItems=doc=>Array.isArray(doc?.categories)?doc.categories.flatMap(c=>Array.isArray(c?.items)?c.items:[]):[];

// One row per distinct name (the scanner matches by name), lowest id first; a regular item wins over an NX item of the same name.
// Untradeable and quest items never reach a shop. NX items (cash) come from the cash shop list.
export function toRows(list,cash=[]){
 const best=new Map();
 for(const it of [...list].sort((a,b)=>a.id-b.id)){
  const name=String(it.name||'').trim().replace(/\s+/g,' ');
  const s=it.stats||{};
  if(name.length<2||name.length>60||!Number.isInteger(it.id)||s.tradeBlock||s.quest)continue;
  const key=norm(name);if(best.has(key))continue;
  const stats=Object.fromEntries(STAT_KEYS.filter(k=>typeof s[k]==='number'&&s[k]!==0).map(k=>[k,s[k]]));
  const desc=String(it.description||'').replace(/\\n|\n/g,' ').replace(/#\w/g,'').replace(/\s+/g,' ').trim().slice(0,400);
  best.set(key,{game_id:it.id,name,category:CATEGORY[it.category]||'unknown',subcategory:it.sub_category?.slice(0,40)??null,
   base_stats:{...(s.reqLevel?{reqLevel:s.reqLevel}:{}),...(it.req_classes?.length?{jobs:it.req_classes}:{}),...(Object.keys(stats).length?{stats}:{}),...(it.spec?{spec:it.spec}:{}),...(desc?{desc}:{})},
   source:'catalog',source_url:SOURCE,verified:true});
 }
 for(const it of [...cash].sort((a,b)=>a.id-b.id)){
  const name=String(it.name||'').trim().replace(/\s+/g,' ');
  if(name.length<2||name.length>60||!Number.isInteger(it.id))continue;
  const key=norm(name);if(best.has(key))continue;
  const desc=String(it.description||'').replace(/\\n|\n/g,' ').replace(/#\w/g,'').replace(/\s+/g,' ').trim().slice(0,400);
  best.set(key,{game_id:it.id,name,category:'cash',subcategory:String(it.sub_category||it.category||'').slice(0,40)||null,
   base_stats:{...(typeof it.period==='number'&&it.period>0?{period:it.period}:{}),...(desc?{desc}:{})},
   source:'catalog',source_url:CASH_SOURCE,verified:true});
 }
 return [...best.values()];
}

const lit=v=>v==null?'null':"'"+String(v).replace(/'/g,"''")+"'";
// Upsert by name; v83 catalog rows from an older import that are not in Classic are removed unless prices reference them.
export function toSql(rows){
 const values=rows.map(r=>`(${r.game_id},${lit(r.name)},${lit(r.category)},${lit(r.subcategory)},${lit(JSON.stringify(r.base_stats))}::jsonb,'catalog',${lit(r.source_url)},false)`);
 return `begin;

insert into public.items (game_id,name,category,subcategory,base_stats,source,source_url,verified) values
${values.join(',\n')}
on conflict do nothing;

commit;
`;
}

async function main(){
 if(process.env.CATALOG_SOURCE_APPROVED!=='true')throw Error('Set CATALOG_SOURCE_APPROVED=true only after recording source permission. No download attempted.');
 const args=process.argv.slice(2),arg=f=>args.includes(f)?args[args.indexOf(f)+1]:null,file=arg('--file'),sqlOut=arg('--sql'),dry=args.includes('--dry-run');
 const get=async u=>(await fetch(u,{headers:{'User-Agent':'MESOS-WATCH catalog import (one request per file per run)'}})).json();
 const list=file?JSON.parse(fs.readFileSync(file,'utf8')):await get(SOURCE);
 const cashFile=arg('--cash'),cash=cashItems(cashFile?JSON.parse(fs.readFileSync(cashFile,'utf8')):await get(CASH_SOURCE));
 if(!Array.isArray(list))throw Error('Unexpected response from '+SOURCE);
 if(!cash.length)throw Error('Unexpected response from '+CASH_SOURCE);
 const rows=toRows(list,cash);
 console.log(`${list.length} items + ${cash.length} NX items from the source, ${rows.length} distinct names (${rows.filter(r=>r.category==='cash').length} NX).`);
 if(dry)return;
 if(sqlOut){fs.writeFileSync(sqlOut,"begin;\nselect public.catalog_apply("+lit(JSON.stringify(list))+"::jsonb,"+lit(JSON.stringify({categories:[{items:cash}]}))+"::jsonb);\ncommit;\n");console.log(`Wrote ${sqlOut}. Paste it into Supabase -> SQL Editor and run it.`);return;}
 const url=process.env.SUPABASE_URL?.replace(/\/$/,''),key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role key: keep it off the website), or use --sql.');
 const r=await fetch(url+'/rest/v1/rpc/catalog_apply',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_doc:list,p_cash:{categories:[{items:cash}]}})});
 if(!r.ok)throw Error('Review import failed: HTTP '+r.status);
 console.log('Catalog candidates saved for admin release review; existing records preserved.');
}
if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exit(1);});
