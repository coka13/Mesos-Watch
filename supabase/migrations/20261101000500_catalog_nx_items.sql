-- NX items: the automatic catalog update also downloads the MapleStory Classic cash shop (OSMS Data Explorer cash_shop.json)
-- and imports it as category 'cash', exactly like supabase/import-catalog.mjs (checked by supabase/tests/sql.test.mjs).
-- Run after 20261101000300_catalog_autosync.sql.
-- Names are collapsed before trimming: some source names end in a line break ("Blue Dragon Horn\r\n"), which btrim alone keeps.

alter table public.catalog_sync_log add column if not exists cash_request_id bigint;

drop function if exists public.catalog_apply(jsonb);
create or replace function public.catalog_apply(p_doc jsonb, p_cash jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rows integer; v_existing integer; v_incoming integer;
begin
  if jsonb_typeof(p_doc) <> 'array' then raise exception 'catalog: expected a JSON array of items'; end if;
  if jsonb_typeof(p_cash -> 'categories') <> 'array' then raise exception 'catalog: expected the cash shop categories'; end if;
  -- A truncated or broken download must never wipe the catalog.
  select count(*) into v_existing from items where source = 'catalog';
  v_incoming := jsonb_array_length(p_doc) + (select coalesce(sum(jsonb_array_length(c -> 'items')), 0) from jsonb_array_elements(p_cash -> 'categories') c where jsonb_typeof(c -> 'items') = 'array');
  if jsonb_array_length(p_doc) < 500 or v_incoming < v_existing / 2 then
    raise exception 'catalog: only % items in the download (have %), not applied', v_incoming, v_existing;
  end if;

  drop table if exists pg_temp.catalog_new;
  create temporary table catalog_new on commit drop as
  with src as (
    select 0 as rank, (e ->> 'id')::integer as game_id,
           btrim(regexp_replace(coalesce(e ->> 'name', ''), '\s+', ' ', 'g')) as name,
           e ->> 'category' as cat, e ->> 'sub_category' as sub,
           case when jsonb_typeof(e -> 'stats') = 'object' then e -> 'stats' else '{}'::jsonb end as s,
           e -> 'req_classes' as rc, e -> 'spec' as spec, e ->> 'description' as descr, null::jsonb as period
    from jsonb_array_elements(p_doc) e
    where jsonb_typeof(e -> 'id') = 'number' and (e ->> 'id') ~ '^[0-9]+$'
  ), cash as (
    select 1 as rank, (e ->> 'id')::integer as game_id,
           btrim(regexp_replace(coalesce(e ->> 'name', ''), '\s+', ' ', 'g')) as name,
           'NX' as cat, coalesce(nullif(e ->> 'sub_category', ''), e ->> 'category') as sub,
           '{}'::jsonb as s, null::jsonb as rc, null::jsonb as spec, e ->> 'description' as descr, e -> 'period' as period
    from jsonb_array_elements(p_cash -> 'categories') c, jsonb_array_elements(case when jsonb_typeof(c -> 'items') = 'array' then c -> 'items' else '[]'::jsonb end) e
    where jsonb_typeof(e -> 'id') = 'number' and (e ->> 'id') ~ '^[0-9]+$'
  ), tradeable as (
    select * from src
    where char_length(name) between 2 and 60
      and coalesce(s ->> 'tradeBlock', '0') in ('0', 'false') and coalesce(s ->> 'quest', '0') in ('0', 'false')
    union all
    select * from cash where char_length(name) between 2 and 60
  ), one_per_name as (
    -- A regular item wins over an NX item of the same name; otherwise the lowest id.
    select distinct on (norm_name(name)) * from tradeable order by norm_name(name), rank, game_id
  )
  select game_id, name,
         case cat when 'Equipment' then 'equip' when 'Consumable' then 'use' when 'Setup' then 'setup' when 'Etc' then 'etc' when 'NX' then 'cash' else 'unknown' end as category,
         case when rank = 1 then nullif(left(coalesce(sub, ''), 40), '') else left(sub, 40) end as subcategory,
         case when rank = 1 then 'https://osmsdataexplorer.com/data/current/cash_shop.json' else 'https://osmsdataexplorer.com/data/api/v1/items.json' end as source_url,
         jsonb_strip_nulls(jsonb_build_object(
           'reqLevel', case when jsonb_typeof(s -> 'reqLevel') = 'number' and (s ->> 'reqLevel')::numeric <> 0 then s -> 'reqLevel' end,
           'jobs', case when jsonb_typeof(rc) = 'array' and jsonb_array_length(rc) > 0 then rc end,
           'stats', (select nullif(jsonb_object_agg(k, s -> k), '{}'::jsonb) from unnest(array['incSTR','incDEX','incINT','incLUK','incMHP','incMMP','incPAD','incMAD','incPDD','incMDD','incACC','incEVA','incSpeed','incJump','incCRT','incCRD','knockback','tuc','attackSpeed','reqSTR','reqDEX','reqINT','reqLUK','reqPOP']) k
                     where jsonb_typeof(s -> k) = 'number' and (s ->> k)::numeric <> 0),
           'spec', case when spec is not null and spec not in ('null'::jsonb, 'false'::jsonb, '""'::jsonb, '0'::jsonb) then spec end,
           'period', case when jsonb_typeof(period) = 'number' and (period #>> '{}')::numeric > 0 then period end,
           'desc', nullif(left(btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(descr, ''), '\\n|\n', ' ', 'g'), '#\w', '', 'g'), '\s+', ' ', 'g')), 400), '')
         )) as base_stats
  from one_per_name;

  update items set game_id = null where source = 'catalog' and game_id is not null;
  insert into items (game_id, name, category, subcategory, base_stats, source, source_url, verified)
    select game_id, name, category, subcategory, base_stats, 'catalog', source_url, true from catalog_new
  on conflict (name_key) do update set game_id = excluded.game_id, category = excluded.category, subcategory = excluded.subcategory,
    base_stats = excluded.base_stats, source = 'catalog', source_url = excluded.source_url, verified = true;
  get diagnostics v_rows = row_count;
  delete from items i where i.source = 'catalog' and i.game_id is null
    and not exists (select 1 from observations o where o.item_id = i.id) and not exists (select 1 from icon_votes v where v.item_id = i.id);
  return v_rows;
end $$;
revoke all on function public.catalog_apply(jsonb, jsonb) from public, anon, authenticated;

-- Download both files.
create or replace function public.catalog_sync_request() returns bigint
language plpgsql security definer set search_path = public as $$
declare v_req bigint; v_cash bigint; v_headers jsonb := '{"User-Agent": "MESOS-WATCH catalog sync (once a day)"}';
begin
  if exists (select 1 from catalog_sync_log where status = 'requested' and requested_at > now() - interval '10 minutes') then
    return null;  -- one download at a time
  end if;
  select net.http_get(url := 'https://osmsdataexplorer.com/data/api/v1/items.json', headers := v_headers, timeout_milliseconds := 60000) into v_req;
  select net.http_get(url := 'https://osmsdataexplorer.com/data/current/cash_shop.json', headers := v_headers, timeout_milliseconds := 60000) into v_cash;
  insert into catalog_sync_log (request_id, cash_request_id) values (v_req, v_cash);
  return v_req;
end $$;
revoke all on function public.catalog_sync_request() from public, anon, authenticated;

-- Apply once both downloads have arrived; skip when neither file changed.
create or replace function public.catalog_sync_apply() returns void
language plpgsql security definer set search_path = public as $$
declare r record; a record; b record; v_md5 text; v_items int;
begin
  for r in select * from catalog_sync_log where status = 'requested' order by id loop
    select status_code, content into a from net._http_response where id = r.request_id;
    select status_code, content into b from net._http_response where id = r.cash_request_id;
    if a is null or b is null or a.status_code is null or b.status_code is null then
      if r.requested_at < now() - interval '1 hour' then
        update catalog_sync_log set status = 'failed', finished_at = now(), message = 'No response from the data source' where id = r.id;
      end if;
      continue;
    end if;
    if a.status_code <> 200 or b.status_code <> 200 then
      update catalog_sync_log set status = 'failed', finished_at = now(),
        message = 'Data source answered HTTP ' || a.status_code || ' (items) / ' || b.status_code || ' (cash shop)' where id = r.id;
      continue;
    end if;
    v_md5 := md5(a.content || md5(b.content));
    if v_md5 = (select content_md5 from catalog_sync_log where status = 'applied' order by id desc limit 1) then
      update catalog_sync_log set status = 'unchanged', finished_at = now(), content_md5 = v_md5 where id = r.id;
      continue;
    end if;
    begin
      v_items := catalog_apply(a.content::jsonb, b.content::jsonb);
      update catalog_sync_log set status = 'applied', finished_at = now(), content_md5 = v_md5, items = v_items where id = r.id;
    exception when others then
      update catalog_sync_log set status = 'failed', finished_at = now(), message = left(sqlerrm, 300) where id = r.id;
    end;
  end loop;
end $$;
revoke all on function public.catalog_sync_apply() from public, anon, authenticated;
