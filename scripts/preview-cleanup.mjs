// Read-only preview of explicitly selected observation IDs. No deletion capability.
import fs from 'node:fs';
import pg from 'pg';
const [selectionFile,outputDirectory]=process.argv.slice(2);
if(!selectionFile||!outputDirectory)throw Error('Usage: node scripts/preview-cleanup.mjs <selection.json> <private-output-directory>');
const selection=JSON.parse(fs.readFileSync(selectionFile,'utf8'));
if(!Array.isArray(selection.ids)||!selection.ids.length||selection.ids.length>10000||!selection.ids.every(id=>Number.isSafeInteger(id)&&id>0)||!selection.reason?.trim())throw Error('Provide 1–10000 explicit positive observation IDs and a reason.');
if(!process.env.SUPABASE_DB_URL)throw Error('Missing private SUPABASE_DB_URL; no connection attempted.');
const db=new pg.Client({connectionString:process.env.SUPABASE_DB_URL,connectionTimeoutMillis:10000});
try{
 await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await db.query("SET LOCAL statement_timeout='30s'");
 const rows=(await db.query('select * from public.observations where id=any($1::bigint[]) order by id',[selection.ids])).rows;
 const counts=(await db.query('select kind,count(*)::int count from public.observations where id=any($1::bigint[]) group by kind',[selection.ids])).rows;
 const protectedCounts=(await db.query('select (select count(*) from public.items)::text items,(select count(*) from auth.users)::text users,(select count(*) from public.megaphones)::text campaigns')).rows[0];
 fs.mkdirSync(outputDirectory,{recursive:true});
 fs.writeFileSync(outputDirectory+'/observations.json',JSON.stringify(rows,null,2));
 fs.writeFileSync(outputDirectory+'/preview.json',JSON.stringify({createdAt:new Date().toISOString(),reason:selection.reason,requested:new Set(selection.ids).size,found:rows.length,counts,protectedCounts,affectedItems:[...new Set(rows.map(r=>r.item_id))],requires:['Verified full backup and isolated restore','Review legitimate sales and user listings','Explicit approval of these exact IDs','Block identified import source before cleanup'],deleted:0},null,2));
 await db.query('ROLLBACK');console.log('Read-only preview saved. No records deleted. Protect output with private ACLs.');
}finally{await db.end();}
