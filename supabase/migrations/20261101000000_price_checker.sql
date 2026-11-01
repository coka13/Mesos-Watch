-- MESOS - WATCH community price checker.
-- Apply with the Supabase CLI (supabase db push) or paste into Dashboard -> SQL Editor and run, then run the megaphone migration.
-- Also enable Authentication -> Sign In / Providers -> "Allow anonymous sign-ins". Visitors are never asked to log in.

create extension if not exists pg_trgm;

-- Admins manage the catalog and megaphones. Add one with: insert into public.admins values ('<your auth user id>');
create table if not exists public.admins (user_id uuid primary key references auth.users (id) on delete cascade);
alter table public.admins enable row level security;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public
  as $$ select exists (select 1 from admins where user_id = auth.uid()) $$;
drop policy if exists "admins see admins" on public.admins;
create policy "admins see admins" on public.admins for select using (public.is_admin());

create or replace function public.norm_name(t text) returns text language sql immutable
  as $$ select lower(regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g')) $$;

-- Item catalog. Rows come from a permitted catalog import (source 'catalog', with the game's item id) or are created
-- automatically from names the scanner reads (source 'observed'); observed names show in search once two players saw them.
create table if not exists public.items (
  id bigint generated always as identity primary key,
  game_id integer unique,
  name text not null check (char_length(name) between 2 and 60),
  name_key text generated always as (public.norm_name(name)) stored unique,
  category text not null default 'unknown' check (category in ('equip', 'use', 'setup', 'etc', 'cash', 'unknown')),
  subcategory text check (char_length(subcategory) <= 40),
  base_stats jsonb not null default '{}' check (jsonb_typeof(base_stats) = 'object'),
  icon_path text,
  icon_hash text check (icon_hash ~ '^[0-9a-f]{16}$'),
  source text not null default 'observed' check (source in ('observed', 'catalog')),
  source_url text check (source_url ~ '^https://'),
  verified boolean not null default false,
  first_seen timestamptz not null default now()
);
create index if not exists items_name_trgm on public.items using gin (name_key gin_trgm_ops);
alter table public.items enable row level security;
drop policy if exists "anyone reads items" on public.items;
create policy "anyone reads items" on public.items for select using (true);
drop policy if exists "admins edit items" on public.items;
create policy "admins edit items" on public.items for update using (public.is_admin()) with check (public.is_admin());

-- Observations: 'ask' = a price on a shop listing; 'sale' = a sale the seller's own Sold Items window showed.
create table if not exists public.observations (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('ask', 'sale')),
  reporter uuid not null default auth.uid() references auth.users (id) on delete cascade,
  world text not null default '' check (char_length(world) <= 32),
  item_id bigint not null references public.items (id) on delete cascade,
  item_name text not null check (char_length(item_name) between 2 and 60),
  price bigint not null check (price between 1 and 100000000000),
  qty integer not null default 1 check (qty between 1 and 9999),
  stats jsonb not null default '{}' check (jsonb_typeof(stats) = 'object' and char_length(stats::text) <= 600),
  shop_key text not null default '' check (char_length(shop_key) <= 64),
  shop_title text not null default '' check (char_length(shop_title) <= 40),
  map text not null default '' check (char_length(map) <= 40),
  channel smallint check (channel between 1 and 40),
  seen_at timestamptz not null default now()
);
create index if not exists observations_item_seen on public.observations (item_id, world, seen_at desc);
create index if not exists observations_world_seen on public.observations (world, seen_at desc);
create index if not exists observations_reporter_seen on public.observations (reporter, seen_at desc);
alter table public.observations enable row level security;
drop policy if exists "anyone reads observations" on public.observations;
create policy "anyone reads observations" on public.observations for select using (true);
drop policy if exists "players add own observations" on public.observations;
create policy "players add own observations" on public.observations for insert to authenticated with check (reporter = auth.uid());
drop policy if exists "admins remove observations" on public.observations;
create policy "admins remove observations" on public.observations for delete using (public.is_admin());

-- Server-side checks on every insert: fixed time and reporter, rate limit, duplicates ignored, item resolved or created.
create or replace function public.observations_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_item bigint;
begin
  new.seen_at := now();
  new.reporter := auth.uid();
  if new.reporter is null then raise exception 'sign-in required' using errcode = '42501'; end if;
  new.item_name := regexp_replace(btrim(new.item_name), '\s+', ' ', 'g');
  if (select count(*) from observations where reporter = new.reporter and seen_at > now() - interval '10 minutes') >= 150 then
    raise exception 'rate limit' using errcode = 'P0001';
  end if;
  select id into v_item from items where name_key = norm_name(new.item_name);
  if v_item is null then
    insert into items (name) values (new.item_name) on conflict (name_key) do nothing returning id into v_item;
    if v_item is null then select id into v_item from items where name_key = norm_name(new.item_name); end if;
  end if;
  new.item_id := v_item;
  -- The same player seeing the same listing again within 6 hours (or the same sale within 10 minutes) is not new data.
  if exists (select 1 from observations o
             where o.reporter = new.reporter and o.kind = new.kind and o.world = new.world and o.item_id = new.item_id
               and o.price = new.price and o.stats = new.stats and o.shop_key = new.shop_key
               and o.seen_at > now() - case when new.kind = 'ask' then interval '6 hours' else interval '10 minutes' end) then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists observations_guard on public.observations;
create trigger observations_guard before insert on public.observations for each row execute function public.observations_guard();

-- Icons are cropped from players' screens. An item's icon is set once two different players sent the same image hash.
create table if not exists public.icon_votes (
  item_id bigint not null references public.items (id) on delete cascade,
  reporter uuid not null default auth.uid() references auth.users (id) on delete cascade,
  hash text not null check (hash ~ '^[0-9a-f]{16}$'),
  path text not null check (path ~ '^observed/[0-9]+/[0-9a-f]{16}\.png$'),
  created_at timestamptz not null default now(),
  primary key (item_id, reporter)
);
alter table public.icon_votes enable row level security;
create or replace function public.vote_icon(p_item bigint, p_hash text, p_path text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_votes int;
begin
  if auth.uid() is null then raise exception 'sign-in required' using errcode = '42501'; end if;
  if p_path <> 'observed/' || p_item || '/' || p_hash || '.png' then raise exception 'bad icon path'; end if;
  insert into icon_votes (item_id, reporter, hash, path) values (p_item, auth.uid(), p_hash, p_path)
    on conflict (item_id, reporter) do update set hash = excluded.hash, path = excluded.path, created_at = now();
  select count(distinct reporter) into v_votes from icon_votes where item_id = p_item and hash = p_hash;
  if v_votes >= 2 then
    update items set icon_path = p_path, icon_hash = p_hash where id = p_item and (icon_path is null or source = 'observed') and icon_hash is distinct from p_hash;
    return true;
  end if;
  return false;
end $$;
grant execute on function public.vote_icon(bigint, text, text) to authenticated;

-- Map OCR'd names to catalog items before reporting: exact name, a name the game cut off with "..." when only one item
-- fits, or the closest catalog name when it is clearly the best (handles misreads like "Crwerall Armor").
create or replace function public.match_item_names(p_names text[])
returns table (input text, item_id bigint, name text, game_id integer, score real)
language plpgsql stable set search_path = public as $$
declare v_in text; v_key text; v_prefix text; r record; v_best record; v_second real;
begin
  foreach v_in in array p_names[1:60] loop
    v_key := norm_name(v_in);
    select i.id, i.name, i.game_id into r from items i where i.name_key = v_key and (i.source = 'catalog' or i.verified);
    if found then input := v_in; item_id := r.id; name := r.name; game_id := r.game_id; score := 1; return next; continue; end if;
    if v_key ~ '(\.\.\.|…)$' then
      v_prefix := regexp_replace(v_key, '\s*(\.\.\.|…)$', '');
      if char_length(v_prefix) >= 8 and (select count(*) from items i where i.source = 'catalog' and i.name_key like v_prefix || '%') = 1 then
        select i.id, i.name, i.game_id into r from items i where i.source = 'catalog' and i.name_key like v_prefix || '%';
        input := v_in; item_id := r.id; name := r.name; game_id := r.game_id; score := 1; return next; continue;
      end if;
    end if;
    select i.id, i.name, i.game_id, similarity(i.name_key, v_key) as s into v_best from items i
      where (i.source = 'catalog' or i.verified) and i.name_key % v_key order by similarity(i.name_key, v_key) desc, i.id limit 1;
    -- Trigrams ignore word order, so a fuzzy match must also start the same way and be about as long (OCR slips, not reworded names).
    if v_best.id is not null and v_best.s >= 0.55 and v_key !~ '(\.\.\.|…)$'
       and left(norm_name(v_best.name), 3) = left(v_key, 3)
       and abs(char_length(v_best.name) - char_length(v_key)) <= greatest(2, char_length(v_key) / 7) then
      select max(similarity(i.name_key, v_key)) into v_second from items i
        where (i.source = 'catalog' or i.verified) and i.name_key % v_key and i.id <> v_best.id;
      if v_second is null or v_best.s - v_second >= 0.08 then
        input := v_in; item_id := v_best.id; name := v_best.name; game_id := v_best.game_id; score := v_best.s; return next; continue;
      end if;
    end if;
    input := v_in; item_id := null; name := null; game_id := null; score := 0; return next;
  end loop;
end $$;
grant execute on function public.match_item_names(text[]) to anon, authenticated;

-- Items players can search: catalog entries, or observed names that two different players read.
create or replace view public.visible_items with (security_invoker = true) as
select i.* from public.items i
where i.source = 'catalog' or i.verified
   or (select count(distinct o.reporter) from public.observations o where o.item_id = i.id) >= 2;

-- Asking-price helpers. One player counts once per item, shop and price, so a single person cannot swing a median.
create or replace function public.ask_prices(p_item bigint, p_world text, p_since timestamptz)
returns table (price bigint) language sql stable set search_path = public as $$
  select distinct on (reporter, shop_key, price, stats) price from observations
  where kind = 'ask' and item_id = p_item and world = p_world and seen_at > p_since
$$;

create or replace function public.search_items(q text, p_world text default '', lim int default 12)
returns table (id bigint, name text, category text, subcategory text, icon_path text, game_id integer, median_ask bigint, low_ask bigint, asks_7d bigint, last_seen timestamptz)
language sql stable set search_path = public as $$
  with m as (
    select v.*, case when v.name_key like norm_name(q) || '%' then 2 when v.name_key like '%' || norm_name(q) || '%' then 1 else 0 end as rank_kind,
           similarity(v.name_key, norm_name(q)) as sim
    from visible_items v
    where char_length(btrim(q)) >= 1 and (v.name_key like '%' || norm_name(q) || '%' or similarity(v.name_key, norm_name(q)) > 0.3)
  ), stats as (
    select o.item_id, percentile_disc(0.5) within group (order by o.price) as median_ask, min(o.price) filter (where o.seen_at > now() - interval '24 hours') as low_ask,
           count(*) as asks_7d, max(o.seen_at) as last_seen
    from observations o where o.kind = 'ask' and o.world = p_world and o.seen_at > now() - interval '7 days' and o.item_id in (select m.id from m)
    group by o.item_id
  )
  select m.id, m.name, m.category, m.subcategory, m.icon_path, m.game_id, s.median_ask, s.low_ask, coalesce(s.asks_7d, 0), s.last_seen
  from m left join stats s on s.item_id = m.id
  order by m.rank_kind desc, coalesce(s.asks_7d, 0) desc, m.sim desc, m.name
  limit least(greatest(lim, 1), 25)
$$;

-- Everything the item page shows above the fold. estimated_value is only given when enough sales were seen; never guessed.
create or replace function public.item_summary(p_item bigint, p_world text default '')
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'lowest_ask_24h', (select min(price) from observations where kind = 'ask' and item_id = p_item and world = p_world and seen_at > now() - interval '24 hours'),
    'median_ask_7d', (select percentile_disc(0.5) within group (order by price) from ask_prices(p_item, p_world, now() - interval '7 days')),
    'median_ask_prev_7d', (select percentile_disc(0.5) within group (order by price) from observations
                           where kind = 'ask' and item_id = p_item and world = p_world and seen_at between now() - interval '14 days' and now() - interval '7 days'),
    'asks_24h', (select count(*) from observations where kind = 'ask' and item_id = p_item and world = p_world and seen_at > now() - interval '24 hours'),
    'asks_7d', (select count(*) from observations where kind = 'ask' and item_id = p_item and world = p_world and seen_at > now() - interval '7 days'),
    'reporters_7d', (select count(distinct reporter) from observations where item_id = p_item and world = p_world and seen_at > now() - interval '7 days'),
    'sales_30d', (select count(*) from observations where kind = 'sale' and item_id = p_item and world = p_world and seen_at > now() - interval '30 days'),
    'sale_reporters_30d', (select count(distinct reporter) from observations where kind = 'sale' and item_id = p_item and world = p_world and seen_at > now() - interval '30 days'),
    'median_sale_30d', (select percentile_disc(0.5) within group (order by price) from observations where kind = 'sale' and item_id = p_item and world = p_world and seen_at > now() - interval '30 days'),
    'estimated_value', (select case when count(*) >= 3 and count(distinct reporter) >= 2 then percentile_disc(0.5) within group (order by price) end
                        from observations where kind = 'sale' and item_id = p_item and world = p_world and seen_at > now() - interval '30 days'),
    'last_seen', (select max(seen_at) from observations where item_id = p_item and world = p_world)
  )
$$;

-- Listings seen in the last 24 hours: the newest sighting of each shop + price + stats.
create or replace function public.current_listings(p_item bigint, p_world text default '', lim int default 50)
returns table (price bigint, qty integer, stats jsonb, shop_title text, map text, channel smallint, seen_at timestamptz, sightings bigint)
language sql stable set search_path = public as $$
  select max(price), max(qty), stats, max(shop_title), max(map), max(channel), max(seen_at), count(*)
  from observations
  where kind = 'ask' and item_id = p_item and world = p_world and seen_at > now() - interval '24 hours'
  group by case when shop_key = '' then reporter::text else shop_key end, price, stats
  order by max(price), max(seen_at) desc
  limit least(greatest(lim, 1), 200)
$$;

-- History buckets: 24h by hour, 7d by 6 hours, 30d and 90d by day. Asks and sales are separate series.
create or replace function public.price_history(p_item bigint, p_world text default '', p_range text default '7d')
returns table (bucket timestamptz, kind text, low bigint, median bigint, high bigint, n bigint)
language plpgsql stable set search_path = public as $$
declare v_since interval; v_step interval;
begin
  case p_range
    when '24h' then v_since := interval '24 hours'; v_step := interval '1 hour';
    when '7d' then v_since := interval '7 days'; v_step := interval '6 hours';
    when '30d' then v_since := interval '30 days'; v_step := interval '1 day';
    when '90d' then v_since := interval '90 days'; v_step := interval '1 day';
    else raise exception 'range must be 24h, 7d, 30d or 90d';
  end case;
  return query
    select date_bin(v_step, o.seen_at, timestamptz '2000-01-01'), o.kind, min(o.price), percentile_disc(0.5) within group (order by o.price), max(o.price), count(*)
    from observations o where o.item_id = p_item and o.world = p_world and o.seen_at > now() - v_since
    group by 1, 2 order by 1, 2;
end $$;

-- Distinct stat lines seen for an item in 30 days (scrolled / upgraded variations). '{}' = stats not read.
create or replace function public.item_variations(p_item bigint, p_world text default '')
returns table (stats jsonb, median bigint, low bigint, n bigint, last_seen timestamptz)
language sql stable set search_path = public as $$
  select stats, percentile_disc(0.5) within group (order by price), min(price), count(*), max(seen_at)
  from observations where kind = 'ask' and item_id = p_item and world = p_world and seen_at > now() - interval '30 days' and stats <> '{}'::jsonb
  group by stats order by count(*) desc limit 30
$$;

-- Market trends: 7-day median against the previous 7 days, for items with enough sightings in both weeks.
create or replace function public.market_trends(p_world text default '', lim int default 30)
returns table (id bigint, name text, icon_path text, category text, median_now bigint, median_prev bigint, change_pct numeric, asks_7d bigint, last_seen timestamptz)
language sql stable set search_path = public as $$
  with now_w as (
    select item_id, percentile_disc(0.5) within group (order by price) as med, count(*) as n, max(seen_at) as last_seen
    from observations where kind = 'ask' and world = p_world and seen_at > now() - interval '7 days' group by item_id
  ), prev_w as (
    select item_id, percentile_disc(0.5) within group (order by price) as med, count(*) as n
    from observations where kind = 'ask' and world = p_world and seen_at between now() - interval '14 days' and now() - interval '7 days' group by item_id
  )
  select i.id, i.name, i.icon_path, i.category, n.med, p.med,
         case when p.med is not null and p.n >= 3 and n.n >= 3 then round(100.0 * (n.med - p.med) / p.med, 1) end,
         n.n, n.last_seen
  from now_w n join visible_items i on i.id = n.item_id left join prev_w p on p.item_id = n.item_id
  order by n.n desc limit least(greatest(lim, 1), 100)
$$;

grant select on public.items, public.visible_items, public.observations to anon, authenticated;
grant insert (kind, world, item_name, price, qty, stats, shop_key, shop_title, map, channel) on public.observations to authenticated;
grant update (game_id, name, category, subcategory, base_stats, source_url, verified, icon_path) on public.items to authenticated;
grant delete on public.observations to authenticated;
grant execute on function public.search_items(text, text, int), public.item_summary(bigint, text), public.current_listings(bigint, text, int),
  public.price_history(bigint, text, text), public.item_variations(bigint, text), public.market_trends(text, int), public.ask_prices(bigint, text, timestamptz),
  public.is_admin(), public.norm_name(text) to anon, authenticated;

-- Live updates for the price checker.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'observations') then
    alter publication supabase_realtime add table public.observations;
  end if;
end $$;

-- Icon storage: small PNGs only, public read, players write only under observed/<item id>/.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('item-icons', 'item-icons', true, 16384, array['image/png']) on conflict (id) do nothing;
    drop policy if exists "players upload observed icons" on storage.objects;
    create policy "players upload observed icons" on storage.objects for insert to authenticated
      with check (bucket_id = 'item-icons' and name ~ '^observed/[0-9]+/[0-9a-f]{16}\.png$');
  end if;
end $$;
