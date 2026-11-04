-- Market statistics, duplicate-free scanner listings and attributed reference prices.
--  * One listing, one row: shop titles are read by OCR and vary between reads ("LeoTsuwubasal", "LeaTsuwubasal", or nothing),
--    so the shop key alone does not identify a shop. A scanner asking price matching an unsold one at the same place (world,
--    channel, FM room or map), item, price, quantity and stats within 6 hours, from a shop whose title is the same, unread, or
--    similar, is the same listing seen again, by anyone: it refreshes that listing's last_seen_at and seen_count instead of
--    adding a row. Sold sightings use the same shop match.
--  * Statistics count distinct listings, not re-reads, and use percentile_disc: every median and range bound shown is a price
--    that was actually observed, never an interpolated one.
--  * Three kinds of price stay apart everywhere: asking prices (observations kind 'ask'), prices of rows seen sold in shops
--    (sold_sightings: the listed price on a greyed-out row) and confirmed sales (observations kind 'sale', admin-verified).
--  * reference_prices: baseline prices from an outside source (NiaDB), entered by admins, each with the source page, the
--    source's own timestamp and its price type. Never mixed into the market statistics above.

-- ---- Listings seen again ----
alter table public.observations add column if not exists last_seen_at timestamptz;
alter table public.observations add column if not exists seen_count integer not null default 1 check(seen_count>=1);
-- Other players who read the same listing (at most 20 kept).
alter table public.observations add column if not exists confirmed_by uuid[] not null default '{}' check(cardinality(confirmed_by)<=20);
update public.observations set last_seen_at=seen_at where last_seen_at is null;
alter table public.observations alter column last_seen_at set default now();
alter table public.observations alter column last_seen_at set not null;
create index if not exists observations_ask_place on public.observations(item_id,world,channel,map,price) where kind='ask' and sold_at is null;
-- The view is select *: recreated so it carries the new columns.
create or replace view public.market_observations with(security_invoker=true) as select * from observations where verification_status<>'rejected';
grant select on public.market_observations to anon,authenticated;

-- Same shop: the same key, or a title that is missing on either side, or titles that read alike.
create or replace function public.same_shop(a_key text,a_title text,b_key text,b_title text) returns boolean
language sql stable set search_path=public as $$
 select (a_key<>'' and a_key=b_key) or btrim(coalesce(a_title,''))='' or btrim(coalesce(b_title,''))=''
  or similarity(lower(btrim(a_title)),lower(btrim(b_title)))>=0.3
$$;

-- As in 20261104000200, with located asking prices matched across players and shop-title misreads.
create or replace function public.observations_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_item bigint; v_same bigint;
begin
  new.seen_at := now();
  new.last_seen_at := now();
  new.seen_count := 1;
  new.confirmed_by := '{}';
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
  if new.kind = 'ask' and new.location_type <> '' then
    select o.id into v_same from observations o
     where o.kind = 'ask' and o.world = new.world and o.item_id = new.item_id and o.price = new.price and o.qty = new.qty
       and o.stats = new.stats and o.channel is not distinct from new.channel and o.map = new.map and o.location_type <> ''
       and o.sold_at is null and o.verification_status <> 'rejected' and o.seen_at > now() - interval '6 hours'
       and same_shop(o.shop_key, o.shop_title, new.shop_key, new.shop_title)
     order by o.seen_at desc limit 1;
    if v_same is not null then
      update observations set last_seen_at = now(), seen_count = seen_count + 1,
        confirmed_by = case when reporter = new.reporter or new.reporter = any(confirmed_by) or cardinality(confirmed_by) >= 20
                            then confirmed_by else confirmed_by || new.reporter end
       where id = v_same;
      return null;
    end if;
    return new;
  end if;
  -- Unlocated rows (store sales, older clients): the same player seeing the same listing again within 6 hours (or the same
  -- sale within 10 minutes) is not new data.
  if exists (select 1 from observations o
             where o.reporter = new.reporter and o.kind = new.kind and o.world = new.world and o.item_id = new.item_id
               and o.price = new.price and o.stats = new.stats and o.shop_key = new.shop_key and o.sold_at is null
               and o.seen_at > now() - case when new.kind = 'ask' then interval '6 hours' else interval '10 minutes' end) then
    return null;
  end if;
  return new;
end $$;

-- As in 20261104000200, with the same shop match. Two rows without any title are only the same shop for the same player.
create or replace function public.sold_sightings_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 new.seen_at:=now();new.reporter:=auth.uid();
 if new.reporter is null then raise exception 'sign-in required' using errcode='42501'; end if;
 new.item_name:=regexp_replace(btrim(new.item_name),'\s+',' ','g');
 if (select count(*) from sold_sightings where reporter=new.reporter and seen_at>now()-interval '10 minutes')>=100 then
  raise exception 'rate limit' using errcode='P0001'; end if;
 select id into new.item_id from items where name_key=norm_name(new.item_name);
 if new.item_id is null then return null; end if;
 if new.location_type='FM_ROOM' and new.room is not null then new.map:='Free Market '||new.room; end if;
 update observations o set sold_at=now()
  where o.kind='ask' and o.sold_at is null and o.world=new.world and o.item_id=new.item_id and o.price=new.listed_price
   and o.qty=new.qty and o.stats=new.stats and o.channel=new.channel and o.map=new.map
   and (case when btrim(new.shop_title)='' and btrim(o.shop_title)='' then o.reporter=new.reporter
        else same_shop(o.shop_key,o.shop_title,new.shop_key,new.shop_title) end)
   and o.last_seen_at>now()-interval '24 hours';
 if exists(select 1 from sold_sightings s where s.world=new.world and s.item_id=new.item_id and s.listed_price=new.listed_price
   and s.qty=new.qty and s.stats=new.stats and s.channel=new.channel and s.map=new.map
   and (case when btrim(new.shop_title)='' and btrim(s.shop_title)='' then s.reporter=new.reporter
        else same_shop(s.shop_key,s.shop_title,new.shop_key,new.shop_title) end)
   and s.seen_at>now()-interval '24 hours') then return null; end if;
 return new;
end $$;

-- Current listings: unsold asking prices seen in the last 24 hours. seen_at is when the listing was last seen;
-- first_seen when it was first published; sightings how often it was read; reporters how many players read it.
drop function if exists public.current_listings(bigint,text,int);
create function public.current_listings(p_item bigint, p_world text default '', lim int default 50)
returns table (price bigint, qty integer, stats jsonb, shop_title text, map text, channel smallint, seen_at timestamptz, sightings bigint,
 location_type text, room smallint, location_source text, seller_name text, first_seen timestamptz, reporters bigint)
language sql stable set search_path = public as $$
  with o as (
    select *, case when shop_key = '' then reporter::text else shop_key end k from market_observations
    where kind = 'ask' and item_id = p_item and world = p_world and last_seen_at > now() - interval '24 hours' and sold_at is null
  ), g as (
    select k, price p, stats s, max(qty) q, max(shop_title) t, max(map) m, max(channel) c, max(last_seen_at) last_seen, sum(seen_count) n,
     max(location_type) lt, max(room) r, max(location_source) ls, max(seller_name) sn, min(seen_at) first_seen
    from o group by k, price, stats
  ), who as (
    select o.k, o.price p, o.stats s, count(distinct x) n from o cross join lateral unnest(o.confirmed_by || o.reporter) x group by 1, 2, 3
  )
  select g.p, g.q, g.s, g.t, g.m, g.c, g.last_seen, g.n, g.lt, g.r, g.ls, g.sn, g.first_seen, who.n
  from g join who on who.k = g.k and who.p = g.p and who.s = g.s
  order by g.p, g.last_seen desc
  limit least(greatest(lim, 1), 200)
$$;
grant execute on function public.current_listings(bigint,text,int) to anon,authenticated;

-- Distinct listings (a shop's row at one price, quantity and stats) seen between p_from and p_to.
create or replace function public.listing_asks(p_item bigint, p_world text, p_from timestamptz, p_to timestamptz default now())
returns table (price bigint, last_seen timestamptz, sold boolean) language sql stable set search_path = public as $$
  select distinct on (case when shop_key = '' then reporter::text else shop_key end, price, stats, qty)
         price, last_seen_at, sold_at is not null
  from market_observations
  where kind = 'ask' and item_id = p_item and world = p_world and last_seen_at > p_from and seen_at <= p_to
  order by case when shop_key = '' then reporter::text else shop_key end, price, stats, qty, last_seen_at desc
$$;
grant execute on function public.listing_asks(bigint,text,timestamptz,timestamptz) to anon,authenticated;

create or replace function public.item_summary(p_item bigint, p_world text default '')
returns jsonb language sql stable set search_path = public as $$
  with l7 as (select * from listing_asks(p_item, p_world, now() - interval '7 days')),
       sold7 as (select listed_price, seen_at from sold_sightings where item_id = p_item and world = p_world and seen_at > now() - interval '7 days'),
       sale30 as (select price, reporter, seen_at from market_observations where kind = 'sale' and verification_status = 'verified'
                  and item_id = p_item and world = p_world and seen_at > now() - interval '30 days')
  select jsonb_build_object(
    'verified_sales_only', true,
    'lowest_ask_24h', (select min(price) from market_observations where kind = 'ask' and sold_at is null and item_id = p_item and world = p_world and last_seen_at > now() - interval '24 hours'),
    'for_sale_now', (select count(*) from l7 where not sold and last_seen > now() - interval '24 hours'),
    'median_ask_7d', (select percentile_disc(0.5) within group (order by price) from l7),
    'ask_p25_7d', (select percentile_disc(0.25) within group (order by price) from l7),
    'ask_p75_7d', (select percentile_disc(0.75) within group (order by price) from l7),
    'listings_7d', (select count(*) from l7),
    'median_ask_prev_7d', (select percentile_disc(0.5) within group (order by price) from listing_asks(p_item, p_world, now() - interval '14 days', now() - interval '7 days')),
    'asks_24h', (select count(*) from market_observations where kind = 'ask' and item_id = p_item and world = p_world and last_seen_at > now() - interval '24 hours'),
    'asks_7d', (select count(*) from market_observations where kind = 'ask' and item_id = p_item and world = p_world and last_seen_at > now() - interval '7 days'),
    'ask_last_seen', (select max(last_seen_at) from market_observations where kind = 'ask' and item_id = p_item and world = p_world),
    'reporters_7d', (select count(distinct reporter) from market_observations where item_id = p_item and world = p_world and last_seen_at > now() - interval '7 days'),
    'sold_seen_7d', (select count(*) from sold7),
    'sold_median_7d', (select percentile_disc(0.5) within group (order by listed_price) from sold7),
    'sold_p25_7d', (select percentile_disc(0.25) within group (order by listed_price) from sold7),
    'sold_p75_7d', (select percentile_disc(0.75) within group (order by listed_price) from sold7),
    'sold_last_seen', (select max(seen_at) from sold_sightings where item_id = p_item and world = p_world),
    'sales_30d', (select count(*) from sale30),
    'sale_reporters_30d', (select count(distinct reporter) from sale30),
    'median_sale_30d', (select percentile_disc(0.5) within group (order by price) from sale30),
    'last_sale_at', (select max(seen_at) from sale30),
    'estimated_value', (select case when count(*) >= 3 and count(distinct reporter) >= 2 then percentile_disc(0.5) within group (order by price) end from sale30),
    'last_seen', (select max(t) from (select max(last_seen_at) t from market_observations where item_id = p_item and world = p_world
                                      union all select max(seen_at) from sold_sightings where item_id = p_item and world = p_world) x)
  )
$$;

-- Price history per time bucket and kind: 'ask' (asking prices), 'sold' (listed prices of rows seen sold) and 'sale'
-- (confirmed sales). low/high are the extremes, p25/p75 the middle half.
drop function if exists public.price_history(bigint,text,text);
create function public.price_history(p_item bigint, p_world text default '', p_range text default '7d')
returns table (bucket timestamptz, kind text, low bigint, p25 bigint, median bigint, p75 bigint, high bigint, n bigint)
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
    select date_bin(v_step, x.t, timestamptz '2000-01-01'), x.kind, min(x.price),
           percentile_disc(0.25) within group (order by x.price), percentile_disc(0.5) within group (order by x.price),
           percentile_disc(0.75) within group (order by x.price), max(x.price), count(*)
    from (select o.seen_at t, o.kind, o.price from market_observations o
          where (o.kind = 'ask' or o.verification_status = 'verified') and o.item_id = p_item and o.world = p_world and o.seen_at > now() - v_since
          union all
          select s.seen_at, 'sold', s.listed_price from sold_sightings s where s.item_id = p_item and s.world = p_world and s.seen_at > now() - v_since) x
    group by 1, 2 order by 1, 2;
end $$;
grant execute on function public.price_history(bigint,text,text) to anon,authenticated;

-- Market index: every item with market data this week (or a confirmed sale this month).
--  ask_*: distinct listings seen in 7 days; for_sale_now/lowest_now: unsold listings seen in 24 hours;
--  change_24h_pct: median asking price of the last 24 hours against the 24 hours before, only with 3+ sightings in each;
--  sold_*: rows seen sold in shops in 7 days (listed prices); sales_30d/sale_median_30d: confirmed sales in 30 days.
create or replace function public.market_index(p_world text default '', lim int default 200)
returns table (id bigint, name text, category text, game_id integer, icon_path text,
 ask_median bigint, ask_p25 bigint, ask_p75 bigint, listings_7d bigint, for_sale_now bigint, lowest_now bigint,
 median_24h bigint, median_prev_24h bigint, change_24h_pct numeric,
 sold_seen_7d bigint, sold_median_7d bigint, sales_30d bigint, sale_median_30d bigint, last_seen timestamptz)
language sql stable set search_path = public as $$
  with l as (
    select distinct on (o.item_id, case when o.shop_key = '' then o.reporter::text else o.shop_key end, o.price, o.stats, o.qty)
           o.item_id, o.price, o.last_seen_at, o.sold_at is not null as sold
    from market_observations o
    where o.kind = 'ask' and o.world = p_world and o.last_seen_at > now() - interval '7 days'
    order by o.item_id, case when o.shop_key = '' then o.reporter::text else o.shop_key end, o.price, o.stats, o.qty, o.last_seen_at desc
  ), a as (
    select item_id, percentile_disc(0.5) within group (order by price) med, percentile_disc(0.25) within group (order by price) p25,
           percentile_disc(0.75) within group (order by price) p75, count(*) n,
           count(*) filter (where not sold and last_seen_at > now() - interval '24 hours') for_sale,
           min(price) filter (where not sold and last_seen_at > now() - interval '24 hours') lowest, max(last_seen_at) last_seen
    from l group by item_id
  ), d as (
    select item_id,
           percentile_disc(0.5) within group (order by price) filter (where seen_at > now() - interval '24 hours') m1,
           count(*) filter (where seen_at > now() - interval '24 hours') n1,
           percentile_disc(0.5) within group (order by price) filter (where seen_at <= now() - interval '24 hours') m0,
           count(*) filter (where seen_at <= now() - interval '24 hours') n0
    from market_observations where kind = 'ask' and world = p_world and seen_at > now() - interval '48 hours' group by item_id
  ), s as (
    select item_id, count(*) n, percentile_disc(0.5) within group (order by listed_price) med, max(seen_at) last_seen
    from sold_sightings where world = p_world and seen_at > now() - interval '7 days' group by item_id
  ), v as (
    select item_id, count(*) n, percentile_disc(0.5) within group (order by price) med, max(seen_at) last_seen
    from market_observations where kind = 'sale' and verification_status = 'verified' and world = p_world and seen_at > now() - interval '30 days'
    group by item_id
  ), ids as (select item_id from a union select item_id from s union select item_id from v)
  select i.id, i.name, i.category, i.game_id, i.icon_path,
         a.med, a.p25, a.p75, coalesce(a.n, 0), coalesce(a.for_sale, 0), a.lowest,
         case when d.n1 >= 3 then d.m1 end, case when d.n0 >= 3 then d.m0 end,
         case when d.n1 >= 3 and d.n0 >= 3 and d.m0 > 0 then round(100.0 * (d.m1 - d.m0) / d.m0, 1) end,
         coalesce(s.n, 0), s.med, coalesce(v.n, 0), v.med,
         greatest(a.last_seen, s.last_seen, v.last_seen)
  from ids join visible_items i on i.id = ids.item_id
  left join a on a.item_id = ids.item_id left join d on d.item_id = ids.item_id
  left join s on s.item_id = ids.item_id left join v on v.item_id = ids.item_id
  order by coalesce(a.for_sale, 0) desc, coalesce(a.n, 0) + coalesce(s.n, 0) desc, greatest(a.last_seen, s.last_seen, v.last_seen) desc, i.id
  limit least(greatest(lim, 1), 500)
$$;
grant execute on function public.market_index(text,int) to anon,authenticated;

-- ---- Reference prices (NiaDB) ----
-- NiaDB's reuse policy (https://meowdb.com/reuse) allows individual facts with attribution to the specific page; crawling,
-- its API or data files, and bulk republishing need written permission. Rows are therefore entered by admins one at a time,
-- or imported by scripts/import-reference-prices.mjs from data NiaDB has permitted (import_ref records that permission).
create table if not exists public.reference_prices(
 id bigint generated always as identity primary key,
 item_id bigint not null references public.items(id) on delete cascade,
 world text not null default '' check(char_length(world)<=32),
 source text not null check(source in ('niadb')),
 source_name text not null default 'NiaDB' check(char_length(source_name) between 2 and 40),
 source_url text not null check(source_url ~ '^https://(www\.)?meowdb\.com/msclassic/\S+$' and char_length(source_url)<=300),
 price_type text not null check(price_type in ('asking','sold','npc_sell')),
 price_low bigint check(price_low between 1 and 100000000000),
 price_typical bigint not null check(price_typical between 1 and 100000000000),
 price_high bigint check(price_high between 1 and 100000000000),
 sample_size integer check(sample_size between 0 and 10000000),
 window_days smallint check(window_days between 1 and 365),
 as_of timestamptz not null,
 recorded_at timestamptz not null default now(),
 recorded_by uuid default auth.uid() references auth.users(id) on delete set null,
 import_ref text not null default '' check(char_length(import_ref)<=200),
 note text not null default '' check(char_length(note)<=200),
 check(price_low is null or price_low<=price_typical),
 check(price_high is null or price_high>=price_typical),
 unique(item_id,world,source,price_type,as_of)
);
create index if not exists reference_prices_item on public.reference_prices(item_id,world,as_of desc);
alter table public.reference_prices enable row level security;
drop policy if exists "anyone reads reference prices" on public.reference_prices;
create policy "anyone reads reference prices" on public.reference_prices for select using(true);
drop policy if exists "admins add reference prices" on public.reference_prices;
create policy "admins add reference prices" on public.reference_prices for insert to authenticated with check(public.is_admin());
drop policy if exists "admins remove reference prices" on public.reference_prices;
create policy "admins remove reference prices" on public.reference_prices for delete to authenticated using(public.is_admin());
grant select on public.reference_prices to anon,authenticated;
grant insert(item_id,world,source,source_name,source_url,price_type,price_low,price_typical,price_high,sample_size,window_days,as_of,note) on public.reference_prices to authenticated;
grant delete on public.reference_prices to authenticated;

-- The source's timestamp cannot be in the future; who recorded it and when are set here.
create or replace function public.reference_prices_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if new.as_of>now()+interval '1 hour' then raise exception 'as_of is in the future' using errcode='22023'; end if;
 new.recorded_at:=now();
 if auth.uid() is not null then new.recorded_by:=auth.uid(); end if;
 new.source_name:=case new.source when 'niadb' then 'NiaDB' else new.source_name end;
 return new;
end $$;
drop trigger if exists reference_prices_guard on public.reference_prices;
create trigger reference_prices_guard before insert on public.reference_prices for each row execute function public.reference_prices_guard();
