// Phase 1: SELECT-only production inventory and local row snapshot. Never restores or migrates.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
const root=path.resolve(import.meta.dirname,'..');
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env.local'),'utf8').split(/\r?\n/).map(l=>l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/)).filter(Boolean).map(m=>[m[1],m[2].replace(/^['"]|['"]$/g,'')]));
if(!env.SUPABASE_DB_URL||!/^postgres(?:ql)?:\/\//.test(env.SUPABASE_DB_URL)){
 console.error('Audit blocked: no configured PostgreSQL connection URL in .env.local. No database connection attempted.');process.exit(1);
}
const out=path.resolve(root,'../phase1-private-backup');fs.mkdirSync(out,{recursive:true});
const client=new pg.Client({connectionString:env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:15000});
const quote=s=>'"'+s.replaceAll('"','""')+'"';
try{
 await client.connect();
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await client.query("SET LOCAL statement_timeout = '60s'");
 const tables=(await client.query("SELECT table_schema,table_name FROM information_schema.tables WHERE table_schema IN ('public','auth','storage','supabase_migrations') AND table_type='BASE TABLE' ORDER BY 1,2")).rows;
 const counts=[];
 for(const t of tables){
  const rows=(await client.query(`SELECT to_jsonb(t) AS row FROM ${quote(t.table_schema)}.${quote(t.table_name)} t`)).rows.map(r=>r.row);
  const filename=t.table_schema+'.'+t.table_name+'.json';const data=JSON.stringify(rows);
  fs.writeFileSync(path.join(out,filename),data,{mode:0o600});
  counts.push({...t,count:rows.length,file:filename,sha256:crypto.createHash('sha256').update(data).digest('hex')});
 }
 const queries={columns:"SELECT * FROM information_schema.columns WHERE table_schema IN ('public','auth','storage') ORDER BY table_schema,table_name,ordinal_position",policies:"SELECT * FROM pg_policies WHERE schemaname IN ('public','auth','storage')",indexes:"SELECT * FROM pg_indexes WHERE schemaname IN ('public','auth','storage')",functions:"SELECT n.nspname AS schema,p.proname AS name,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')",constraints:"SELECT n.nspname AS schema,c.relname AS table_name,con.conname,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage')",triggers:"SELECT event_object_schema,event_object_table,trigger_name,action_statement FROM information_schema.triggers WHERE event_object_schema='public'"};
 const metadata={};for(const [key,sql]of Object.entries(queries))metadata[key]=(await client.query(sql)).rows;
 const cron=(await client.query("SELECT to_regclass('cron.job') IS NOT NULL AS present")).rows[0].present;
 if(cron)metadata.jobs=(await client.query('SELECT jobid,schedule,command,active FROM cron.job')).rows;
 await client.query('ROLLBACK');
 fs.writeFileSync(path.join(out,'schema-metadata.json'),JSON.stringify(metadata,null,2),{mode:0o600});
 const manifest={created_at:new Date().toISOString(),transaction:'REPEATABLE READ READ ONLY; rolled back',tables:counts,limitations:['Logical JSON snapshot, not a pg_dump disaster-recovery archive.','Storage objects are not downloaded; only storage metadata is backed up.','No infrastructure secrets, roles, extension internals or external service configuration backup.']};
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
 console.log(JSON.stringify({backup:out,tables:counts.map(({table_schema,table_name,count})=>({schema:table_schema,table:table_name,count})),publicFunctions:metadata.functions.length,policies:metadata.policies.length,jobs:metadata.jobs?.map(({schedule,active})=>({schedule,active}))},null,2));
}catch(e){console.error('Audit failed:',e.code||e.name);process.exitCode=1;}finally{await client.end().catch(()=>{});}
