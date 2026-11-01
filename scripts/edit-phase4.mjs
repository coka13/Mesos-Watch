import fs from 'node:fs';
const base=fs.readFileSync('supabase/migrations/20261101000500_catalog_nx_items.sql','utf8');
let fn=base.slice(base.indexOf('create or replace function public.catalog_apply'),base.indexOf('-- Download both files.'));
fn=fn.replace('begin\n',`begin
  if not exists(select 1 from site_settings where key='catalog_source_approved' and value='true') then raise exception 'Catalog source requires documented permission and admin approval'; end if;
`);
fn=fn.replace(/\s+and coalesce\(s ->> 'tradeBlock'[^\n]+/,'');
fn=fn.replace(/  update items set game_id = null[^\n]+\n/,'');
fn=fn.replace("'catalog', source_url, true from catalog_new", "'catalog', source_url, false from catalog_new n where not exists(select 1 from items i where i.game_id=n.game_id and i.name_key<>norm_name(n.name))");
fn=fn.replace(/  on conflict \(name_key\)[\s\S]*?  get diagnostics/,`  on conflict (name_key) do update set subcategory=excluded.subcategory,
    base_stats=case when items.verified then items.base_stats else excluded.base_stats end,
    source_url=coalesce(items.source_url,excluded.source_url)
    where items.game_id=excluded.game_id or items.game_id is null;
  get diagnostics`);
fn=fn.replace(/  delete from items i[\s\S]*?  return v_rows;/,'  return v_rows;');
const header=`-- Preservation-first replacement. No existing catalog rows, prices or identities are deleted.
alter table public.items add column if not exists release_status text not null default 'unverified'
  check(release_status in ('unverified','released','available','discontinued','unreleased'));
alter table public.items add column if not exists last_verified_at timestamptz;
alter table public.items add column if not exists verification_source text;
grant update(release_status,last_verified_at,verification_source) on public.items to authenticated;
-- Newly imported names require review; preserve existing verification flags without claiming release status.
create or replace view public.visible_items with (security_invoker=true) as
 select i.* from public.items i where i.verified and i.release_status in ('released','available','discontinued');
-- Disable unattended downloads until the source's permission is recorded by the operator.
alter function public.catalog_sync_request() rename to catalog_sync_request_legacy;
create function public.catalog_sync_request() returns bigint language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from site_settings where key='catalog_source_approved' and value='true') then raise exception 'Catalog source not approved'; end if;
 return catalog_sync_request_legacy();
end $$;
revoke all on function public.catalog_sync_request() from public,anon,authenticated;
revoke all on function public.catalog_sync_request_legacy() from public,anon,authenticated;
`;
fs.writeFileSync('supabase/migrations/20261101000800_catalog_preservation.sql',header+fn);
let imp=fs.readFileSync('supabase/import-catalog.mjs','utf8');
// Keep the legacy converter for regression tests; CLI writes through the reviewed, preservation-first RPC.
imp=imp.replace("async function main(){",`async function main(){
 if(process.env.CATALOG_SOURCE_APPROVED!=='true')throw Error('Set CATALOG_SOURCE_APPROVED=true only after recording source permission. No download attempted.');`);
imp=imp.replace("if(sqlOut){fs.writeFileSync(sqlOut,toSql(rows));", "if(sqlOut){fs.writeFileSync(sqlOut,\"begin;\\nselect public.catalog_apply(\"+lit(JSON.stringify(list))+\"::jsonb,\"+lit(JSON.stringify({categories:[{items:cash}]}))+\"::jsonb);\\ncommit;\\n\");");
imp=imp.replace(/ for\(let i=0;i<rows.length;i\+=500\)\{[\s\S]*? console.log\('\\nCatalog imported.'\);/,` const r=await fetch(url+'/rest/v1/rpc/catalog_apply',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_doc:list,p_cash:{categories:[{items:cash}]}})});
 if(!r.ok)throw Error('Review import failed: HTTP '+r.status);
 console.log('Catalog candidates saved for admin release review; existing records preserved.');`);
// Legacy SQL generator is also made non-destructive so even old callers cannot delete or unverify records.
imp=imp.replace("update public.items set game_id=null where source='catalog' and game_id is not null;",'');
imp=imp.replace(/delete from public.items i where i.source='catalog'[\s\S]*?v.item_id=i.id\);/,'');
imp=imp.replace("on conflict (name_key) do update set game_id=excluded.game_id,category=excluded.category,subcategory=excluded.subcategory,base_stats=excluded.base_stats,source='catalog',source_url=excluded.source_url,verified=true;","on conflict do nothing;");
imp=imp.replace(",true)`);",",false)`);");
fs.writeFileSync('supabase/import-catalog.mjs',imp);
// Review actions must record a source and an actual release decision.
let site=fs.readFileSync('dist/site.mjs','utf8');
site=site.replace("game_id:gid.value?+gid.value:null,verified:true", "game_id:gid.value?+gid.value:null,verified:true,release_status:'released',last_verified_at:new Date().toISOString(),verification_source:source.value.trim()");
site=site.replace("const cat=el('select'", "const source=el('input',{placeholder:'Classic release verification URL (https://…)',type:'url',required:true});\n   const cat=el('select'");
site=site.replace("name,cat,gid,el('button'", "name,cat,gid,source,el('button'");
site=site.replace("try{await updateItem", "try{if(!/^https:\\/\\//.test(source.value.trim()))throw Error('Provide a release verification source URL.');await updateItem");
site=site.replace("it.category:'cash'", "it.category:'equip'");
fs.writeFileSync('dist/site.mjs',site);
let api=fs.readFileSync('dist/api.mjs','utf8');api=api.replace(".eq('source','observed').eq('verified',false)",".or('verified.eq.false,release_status.eq.unverified')");fs.writeFileSync('dist/api.mjs',api);
