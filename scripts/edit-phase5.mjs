import fs from 'node:fs';
const old=fs.readFileSync('supabase/migrations/20261101000000_price_checker.sql','utf8');
let sum=old.slice(old.indexOf('create or replace function public.item_summary'),old.indexOf('-- Listings seen'));
sum=sum.replace("'lowest_ask_24h'", "'verified_sales_only',true,\n    'lowest_ask_24h'");
sum=sum.replaceAll("kind = 'sale' and", "kind = 'sale' and verification_status='verified' and");
let history=old.slice(old.indexOf('create or replace function public.price_history'),old.indexOf('-- Distinct stat lines'));
history=history.replace('where o.item_id = p_item',"where (o.kind='ask' or o.verification_status='verified') and o.item_id = p_item");
fs.writeFileSync('supabase/migrations/20261101000900_observation_evidence.sql',`-- Existing reported sales remain intact but never become verified automatically.
alter table public.observations add column if not exists verification_status text not null default 'reported' check(verification_status in ('reported','verified','rejected'));
alter table public.observations add column if not exists confidence numeric check(confidence between 0 and 100);
alter table public.observations add column if not exists capture_source text not null default 'unknown' check(capture_source in ('unknown','scanner','store','manual'));
create function public.observation_evidence_guard() returns trigger language plpgsql set search_path=public as $$
begin new.verification_status:='reported'; return new; end $$;
create trigger observation_evidence_guard before insert on public.observations for each row execute function public.observation_evidence_guard();
create table public.observation_reviews(
 id bigint generated always as identity primary key,
 observation_id bigint not null references public.observations(id) on delete restrict,
 reviewer uuid not null references auth.users(id) on delete restrict,
 decision text not null check(decision in ('verified','rejected')), reason text not null check(length(reason) between 10 and 1000),created_at timestamptz not null default now());
alter table public.observation_reviews enable row level security;
create policy "admins read evidence reviews" on public.observation_reviews for select to authenticated using(public.is_admin());
grant select on public.observation_reviews to authenticated;
create function public.review_observation(p_id bigint,p_decision text,p_reason text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'admins only' using errcode='42501'; end if;
 if p_decision not in ('verified','rejected') or length(btrim(p_reason)) not between 10 and 1000 then raise exception 'Valid decision and evidence reason required'; end if;
 perform 1 from observations where id=p_id for update;
 if not found then raise exception 'Observation not found'; end if;
 insert into observation_reviews(observation_id,reviewer,decision,reason)values(p_id,auth.uid(),p_decision,btrim(p_reason));
 update observations set verification_status=p_decision where id=p_id;
end $$;
revoke all on function public.review_observation(bigint,text,text) from public,anon;
grant execute on function public.review_observation(bigint,text,text) to authenticated;
`+sum+history);
let api=fs.readFileSync('dist/api.mjs','utf8');
api=api.replace("world,item_name:","world,confidence:Number.isFinite(o.confidence)?Math.max(0,Math.min(100,o.confidence)):null,capture_source:o.kind==='sale'?'store':'scanner',item_name:");
api=api.replace("return data.map(d=>", "return (data||[]).map(d=>");
// Withhold unverified valuation even when the backend has not yet received the new migration.
api=api.replace("export const itemSummary=async(id,world='')=>rows((await client()).rpc('item_summary',{p_item:id,p_world:world}),'Could not load prices');", "export const itemSummary=async(id,world='')=>{const s=await rows((await client()).rpc('item_summary',{p_item:id,p_world:world}),'Could not load prices');return s.verified_sales_only?s:{...s,estimated_value:null,median_sale_30d:null,sales_30d:0,sale_reporters_30d:0};};");
fs.writeFileSync('dist/api.mjs',api);
let scanner=fs.readFileSync('dist/scanner.mjs','utf8');scanner=scanner.replace("qty:l.qty,stats:l.stats,shopKey", "qty:l.qty,confidence:Math.min(100,l.nameConf??65),stats:l.stats,shopKey");fs.writeFileSync('dist/scanner.mjs',scanner);
for(const file of ['dist/index.html','dist/checker.mjs']){let s=fs.readFileSync(file,'utf8');s=s.replaceAll('Confirmed sale','Reviewed sale').replaceAll('confirmed sale','reviewed sale').replaceAll('confirmed sales','reviewed sales');s=s.replace('A sale a seller’s own Sold Items window showed. Estimated value uses these only, once there are enough.','A reported sale reviewed with supporting evidence. Client OCR alone does not verify a trade.');s=s.replace('Needs 3 sales from 2 sellers','Needs 3 reviewed sales from 2 sellers');s=s.replace('No listings seen in the last 24 hours.','No market data available yet');s=s.replace('Listings seen in the last 24 hours','Recently observed asking prices · availability unconfirmed');fs.writeFileSync(file,s);}
// Only reviewed sales can appear as completed transactions in charts, including on older deployments.
api=fs.readFileSync('dist/api.mjs','utf8');api=api.replace("export const priceHistory=async(id,world='',range='7d')=>rows((await client()).rpc('price_history',{p_item:id,p_world:world,p_range:range}),'Could not load history');", "export const priceHistory=async(id,world='',range='7d')=>{const s=await rows((await client()).rpc('item_summary',{p_item:id,p_world:world}),'Could not check evidence version');const h=await rows((await client()).rpc('price_history',{p_item:id,p_world:world,p_range:range}),'Could not load history');return s.verified_sales_only?h:h.filter(r=>r.kind==='ask');};");fs.writeFileSync('dist/api.mjs',api);
