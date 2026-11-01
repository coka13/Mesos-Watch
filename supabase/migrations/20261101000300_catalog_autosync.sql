-- Automatic catalog updates: once a day the database downloads the MapleStory Classic item list (OSMS Data Explorer,
-- CC BY 4.0) with pg_net, and applies it when it changed, using the same rules as supabase/import-catalog.mjs.
-- Scheduling uses pg_cron. Both extensions ship with Supabase; this file enables them.

create table if not exists public.catalog_sync_log (
  id bigint generated always as identity primary key,
  request_id bigint,
  requested_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'requested' check (status in ('requested', 'applied', 'unchanged', 'failed')),
  items integer,
  content_md5 text,
  message text
);
alter table public.catalog_sync_log enable row level security;
drop policy if exists "admins read sync log" on public.catalog_sync_log;
create policy "admins read sync log" on public.catalog_sync_log for select using (public.is_admin());
grant select on public.catalog_sync_log to authenticated;

-- Apply one downloaded item list. Mirrors toRows/toSql in supabase/import-catalog.mjs (checked by supabase/tests/sql.test.mjs):
-- tradeable items only, one row per distinct name (lowest id), catalog rows that left the game are removed unless prices use them.
create or replace function public.catalog_apply(p_doc jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rows integer; v_existing integer;
begin
  if jsonb_typeof(p_doc) <> 'array' then raise exception 'catalog: expected a JSON array'; end if;
  -- A truncated or broken download must never wipe the catalog.
  select count(*) into v_existing from items where source = 'catalog';
  if jsonb_array_length(p_doc) < greatest(500, v_existing / 2) then
    raise exception 'catalog: only % items in the download (have %), not applied', jsonb_array_length(p_doc), v_existing;
  end if;

  drop table if exists pg_temp.catalog_new;
  create temporary table catalog_new on commit drop as
  with src as (
    select (e ->> 'id')::integer as game_id,
           regexp_replace(btrim(coalesce(e ->> 'name', '')), '\s+', ' ', 'g') as name,
           e ->> 'category' as cat, e ->> 'sub_category' as sub,
           case when jsonb_typeof(e -> 'stats') = 'object' then e -> 'stats' else '{}'::jsonb end as s,
           e -> 'req_classes' as rc, e -> 'spec' as spec, e ->> 'description' as descr
    from jsonb_array_elements(p_doc) e
    where jsonb_typeof(e -> 'id') = 'number' and (e ->> 'id') ~ '^[0-9]+$'
  ), tradeable as (
    select * from src
    where char_length(name) between 2 and 60
      and coalesce(s ->> 'tradeBlock', '0') in ('0', 'false') and coalesce(s ->> 'quest', '0') in ('0', 'false')
  ), one_per_name as (
    select distinct on (norm_name(name)) * from tradeable order by norm_name(name), game_id
  )
  select game_id, name,
         case cat when 'Equipment' then 'equip' when 'Consumable' then 'use' when 'Setup' then 'setup' when 'Etc' then 'etc' else 'unknown' end as category,
         left(sub, 40) as subcategory,
         jsonb_strip_nulls(jsonb_build_object(
           'reqLevel', case when jsonb_typeof(s -> 'reqLevel') = 'number' and (s ->> 'reqLevel')::numeric <> 0 then s -> 'reqLevel' end,
           'jobs', case when jsonb_typeof(rc) = 'array' and jsonb_array_length(rc) > 0 then rc end,
           'stats', (select nullif(jsonb_object_agg(k, s -> k), '{}'::jsonb) from unnest(array['incSTR','incDEX','incINT','incLUK','incMHP','incMMP','incPAD','incMAD','incPDD','incMDD','incACC','incEVA','incSpeed','incJump','incCRT','incCRD','knockback','tuc','attackSpeed','reqSTR','reqDEX','reqINT','reqLUK','reqPOP']) k
                     where jsonb_typeof(s -> k) = 'number' and (s ->> k)::numeric <> 0),
           'spec', case when spec is not null and spec not in ('null'::jsonb, 'false'::jsonb, '""'::jsonb, '0'::jsonb) then spec end,
           'desc', nullif(left(btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(descr, ''), '\\n|\n', ' ', 'g'), '#\w', '', 'g'), '\s+', ' ', 'g')), 400), '')
         )) as base_stats
  from one_per_name;

  update items set game_id = null where source = 'catalog' and game_id is not null;
  insert into items (game_id, name, category, subcategory, base_stats, source, source_url, verified)
    select game_id, name, category, subcategory, base_stats, 'catalog', 'https://osmsdataexplorer.com/data/api/v1/items.json', true from catalog_new
  on conflict (name_key) do update set game_id = excluded.game_id, category = excluded.category, subcategory = excluded.subcategory,
    base_stats = excluded.base_stats, source = 'catalog', source_url = excluded.source_url, verified = true;
  get diagnostics v_rows = row_count;
  delete from items i where i.source = 'catalog' and i.game_id is null
    and not exists (select 1 from observations o where o.item_id = i.id) and not exists (select 1 from icon_votes v where v.item_id = i.id);
  return v_rows;
end $$;
revoke all on function public.catalog_apply(jsonb) from public, anon, authenticated;

-- Step 1 (daily): ask pg_net to download the list. The response arrives asynchronously. Only the scheduler and
-- catalog_sync_now (admins) can call this.
create or replace function public.catalog_sync_request() returns bigint
language plpgsql security definer set search_path = public as $$
declare v_req bigint;
begin
  if exists (select 1 from catalog_sync_log where status = 'requested' and requested_at > now() - interval '10 minutes') then
    return null;  -- one download at a time
  end if;
  select net.http_get(url := 'https://osmsdataexplorer.com/data/api/v1/items.json',
                      headers := '{"User-Agent": "MESOS-WATCH catalog sync (once a day)"}'::jsonb,
                      timeout_milliseconds := 60000) into v_req;
  insert into catalog_sync_log (request_id) values (v_req);
  return v_req;
end $$;
revoke all on function public.catalog_sync_request() from public, anon, authenticated;

-- "Update now" in Settings -> Admin.
create or replace function public.catalog_sync_now() returns bigint
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  return catalog_sync_request();
end $$;
revoke all on function public.catalog_sync_now() from public, anon;
grant execute on function public.catalog_sync_now() to authenticated;

-- Step 2 (every 5 minutes): apply any finished download. Unchanged content is recorded and skipped.
create or replace function public.catalog_sync_apply() returns void
language plpgsql security definer set search_path = public as $$
declare r record; v_status int; v_body text; v_md5 text; v_items int;
begin
  for r in select * from catalog_sync_log where status = 'requested' order by id loop
    select status_code, content into v_status, v_body from net._http_response where id = r.request_id;
    if not found then
      if r.requested_at < now() - interval '1 hour' then
        update catalog_sync_log set status = 'failed', finished_at = now(), message = 'No response from the data source' where id = r.id;
      end if;
      continue;
    end if;
    if v_status is distinct from 200 then
      update catalog_sync_log set status = 'failed', finished_at = now(), message = 'Data source answered HTTP ' || coalesce(v_status::text, 'error') where id = r.id;
      continue;
    end if;
    v_md5 := md5(v_body);
    if v_md5 = (select content_md5 from catalog_sync_log where status = 'applied' order by id desc limit 1) then
      update catalog_sync_log set status = 'unchanged', finished_at = now(), content_md5 = v_md5 where id = r.id;
      continue;
    end if;
    begin
      v_items := catalog_apply(v_body::jsonb);
      update catalog_sync_log set status = 'applied', finished_at = now(), content_md5 = v_md5, items = v_items where id = r.id;
    exception when others then
      update catalog_sync_log set status = 'failed', finished_at = now(), message = left(sqlerrm, 300) where id = r.id;
    end;
  end loop;
end $$;
revoke all on function public.catalog_sync_apply() from public, anon, authenticated;

-- Turn the extensions on and schedule the jobs (skipped where the extensions are unavailable, e.g. local tests).
do $$ begin
  begin
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_net/pg_cron unavailable (%): automatic catalog updates not scheduled', sqlerrm;
    return;
  end;
  perform cron.unschedule(jobid) from cron.job where jobname in ('catalog-sync-request', 'catalog-sync-apply');
  perform cron.schedule('catalog-sync-request', '17 6 * * *', 'select public.catalog_sync_request()');
  perform cron.schedule('catalog-sync-apply', '*/5 * * * *', 'select public.catalog_sync_apply()');
end $$;
