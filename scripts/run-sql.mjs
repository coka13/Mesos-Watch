// Runs SQL against the Supabase database using SUPABASE_DB_URL from .env.local (gitignored; never commit it).
//   node scripts/run-sql.mjs supabase/migrations/20261101000300_catalog_autosync.sql
//   node scripts/run-sql.mjs -c "select count(*) from items"
import fs from 'node:fs';
import pg from 'pg';

const env=fs.existsSync('.env.local')?Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).map(l=>l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/)).filter(Boolean).map(m=>[m[1],m[2].replace(/^['"]|['"]$/g,'')])):{};
const url=process.env.SUPABASE_DB_URL||env.SUPABASE_DB_URL;
if(!url)throw Error('Set SUPABASE_DB_URL in .env.local (Supabase -> Connect -> Session pooler connection string, with the database password).');
const args=process.argv.slice(2);
const sql=args[0]==='-c'?args[1]:fs.readFileSync(args[0],'utf8');
const client=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}});
await client.connect();
try{
 const res=await client.query(sql);
 for(const r of [].concat(res)){if(r.rows?.length)console.table(r.rows.slice(0,50));else console.log(r.command,r.rowCount??'');}
}finally{await client.end();}
