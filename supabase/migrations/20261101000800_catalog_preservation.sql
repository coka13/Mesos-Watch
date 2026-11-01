-- Preservation-first replacement. No existing catalog rows, prices or identities are deleted.
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
create or replace function public.catalog_apply(p_doc jsonb, p_cash jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rows integer; v_existing integer; v_incoming integer;
begin
  if not exists(select 1 from site_settings where key='catalog_source_approved' and value='true') then raise exception 'Catalog source requires documented permission and admin approval'; end if;
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
           regexp_replace(btrim(coalesce(e ->> 'name', '')), '\s+', ' ', 'g') as name,
           e ->> 'category' as cat, e ->> 'sub_category' as sub,
           case when jsonb_typeof(e -> 'stats') = 'object' then e -> 'stats' else '{}'::jsonb end as s,
           e -> 'req_classes' as rc, e -> 'spec' as spec, e ->> 'description' as descr, null::jsonb as period
    from jsonb_array_elements(p_doc) e
    where jsonb_typeof(e -> 'id') = 'number' and (e ->> 'id') ~ '^[0-9]+$'
  ), cash as (
    select 1 as rank, (e ->> 'id')::integer as game_id,
           regexp_replace(btrim(coalesce(e ->> 'name', '')), '\s+', ' ', 'g') as name,
           'NX' as cat, coalesce(nullif(e ->> 'sub_category', ''), e ->> 'category') as sub,
           '{}'::jsonb as s, null::jsonb as rc, null::jsonb as spec, e ->> 'description' as descr, e -> 'period' as period
    from jsonb_array_elements(p_cash -> 'categories') c, jsonb_array_elements(case when jsonb_typeof(c -> 'items') = 'array' then c -> 'items' else '[]'::jsonb end) e
    where jsonb_typeof(e -> 'id') = 'number' and (e ->> 'id') ~ '^[0-9]+$'
  ), tradeable as (
    select * from src
    where char_length(name) between 2 and 60
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

  insert into items (game_id, name, category, subcategory, base_stats, source, source_url, verified)
    select game_id, name, category, subcategory, base_stats, 'catalog', source_url, false from catalog_new n where not exists(select 1 from items i where i.game_id=n.game_id and i.name_key<>norm_name(n.name))
  on conflict (name_key) do update set subcategory=excluded.subcategory,
    base_stats=case when items.verified then items.base_stats else excluded.base_stats end,
    source_url=coalesce(items.source_url,excluded.source_url)
    where items.game_id=excluded.game_id or items.game_id is null;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;
revoke all on function public.catalog_apply(jsonb, jsonb) from public, anon, authenticated;
