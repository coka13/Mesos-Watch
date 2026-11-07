-- Market windows, the listing lifecycle, buy-low/sell-high detection and self-reported rankings. Additive: every earlier function keeps
-- its signature, so a site published before this migration keeps working.
--  * Windows: market_index_window and item_stats report any of 1, 7, 14, 30 or 90 days, with what the figures rest on: distinct
--    listings, stale listings, repeat sightings folded into them, and prices so far from the median that they are probably misreads.
--  * Lifecycle: a listing is for sale, seen sold (sold_at), or gone (gone_at). Gone is inferred, never a sale: a scan of a shop short
--    enough to be seen whole no longer showed it. It is reversible, since seeing the listing again clears it, and every closure is
--    recorded in listing_closures. Sold always wins over gone.
--  * Flips: a credible for-sale listing below what the item typically sells for, after the 3% store fee. The basis of the target
--    price (seen sold or asking) comes with it, and nothing is proposed without enough listings behind that basis.
--  * Rankings: a player chooses to publish their own character from the Companion. Labelled self-reported: nothing here proves the
--    publisher owns the character.

-- ---- Listing lifecycle ----
alter table public.observations add column if not exists gone_at timestamptz;
create or replace view public.market_observations with(security_invoker=true) as select * from observations where verification_status<>'rejected';
grant select on public.market_observations to anon,authenticated;
create index if not exists observations_ask_recent on public.observations(world,last_seen_at desc) where kind='ask';
create index if not exists sold_sightings_world_seen on public.sold_sightings(world,seen_at desc);

create table if not exists public.listing_closures(
 id bigint generated always as identity primary key,
 observation_id bigint not null references public.observations(id) on delete cascade,
 closed_by uuid references auth.users(id) on delete set null,
 closed_at timestamptz not null default now()
);
create index if not exists listing_closures_by on public.listing_closures(closed_by,closed_at desc);
alter table public.listing_closures enable row level security;

-- As in 20261104000300. A listing read again is back on sale: it clears gone_at.
create or replace function public.observations_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_item bigint; v_same bigint;
begin
  new.seen_at := now();
  new.last_seen_at := now();
  new.seen_count := 1;
  new.confirmed_by := '{}';
  new.gone_at := null;
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
      update observations set last_seen_at = now(), seen_count = seen_count + 1, gone_at = null,
        confirmed_by = case when reporter = new.reporter or new.reporter = any(confirmed_by) or cardinality(confirmed_by) >= 20
                            then confirmed_by else confirmed_by || new.reporter end
       where id = v_same;
      return null;
    end if;
    return new;
  end if;
  if exists (select 1 from observations o
             where o.reporter = new.reporter and o.kind = new.kind and o.world = new.world and o.item_id = new.item_id
               and o.price = new.price and o.stats = new.stats and o.shop_key = new.shop_key and o.sold_at is null
               and o.seen_at > now() - case when new.kind = 'ask' then interval '6 hours' else interval '10 minutes' end) then
    return null;
  end if;
  return new;
end $$;

-- A scan showed this shop whole, and these listings ({item_id,price,qty}) are what it still has. Others seen there in the last 24
-- hours are gone. Only a titled shop can be matched this way, a listing just published is left alone, and at most 12 close per call.
create or replace function public.close_missing_listings(p_world text,p_channel smallint,p_map text,p_shop_key text,p_shop_title text,p_keep jsonb)
returns integer language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_n integer;
begin
 if v_user is null then raise exception 'sign-in required' using errcode='42501'; end if;
 if btrim(coalesce(p_shop_title,''))='' or p_channel is null or btrim(coalesce(p_map,''))='' then return 0; end if;
 if (select count(*) from listing_closures where closed_by=v_user and closed_at>now()-interval '10 minutes')>=60 then
  raise exception 'rate limit' using errcode='P0001'; end if;
 with target as (
  select o.id from observations o
  where o.kind='ask' and o.world=p_world and o.channel=p_channel and o.map=p_map and o.sold_at is null and o.gone_at is null
   and o.last_seen_at>now()-interval '24 hours' and o.last_seen_at<now()-interval '2 minutes'
   and btrim(o.shop_title)<>'' and same_shop(o.shop_key,o.shop_title,p_shop_key,p_shop_title)
   and not exists(select 1 from jsonb_to_recordset(coalesce(p_keep,'[]'::jsonb)) k(item_id bigint,price bigint,qty integer)
                  where k.item_id=o.item_id and k.price=o.price and k.qty=o.qty)
  order by o.last_seen_at limit 12
 ),up as (update observations o set gone_at=now() from target where o.id=target.id returning o.id),
 logged as (insert into listing_closures(observation_id,closed_by) select id,v_user from up returning 1)
 select count(*) into v_n from logged;
 return v_n;
end $$;
revoke all on function public.close_missing_listings(text,smallint,text,text,text,jsonb) from public,anon;
grant execute on function public.close_missing_listings(text,smallint,text,text,text,jsonb) to authenticated;

-- ---- Current listings ----
-- As in 20261104000300, without gone listings, with the newest row's id (for reporting a listing).
drop function if exists public.current_listings(bigint,text,int);
create function public.current_listings(p_item bigint, p_world text default '', lim int default 50)
returns table (price bigint, qty integer, stats jsonb, shop_title text, map text, channel smallint, seen_at timestamptz, sightings bigint,
 location_type text, room smallint, location_source text, seller_name text, first_seen timestamptz, reporters bigint, observation_id bigint)
language sql stable set search_path = public as $$
  with o as (
    select *, case when shop_key = '' then reporter::text else shop_key end k from market_observations
    where kind = 'ask' and item_id = p_item and world = p_world and last_seen_at > now() - interval '24 hours' and sold_at is null and gone_at is null
  ), g as (
    select k, price p, stats s, max(qty) q, max(shop_title) t, max(map) m, max(channel) c, max(last_seen_at) last_seen, sum(seen_count) n,
     max(location_type) lt, max(room) r, max(location_source) ls, max(seller_name) sn, min(seen_at) first_seen, max(id) oid
    from o group by k, price, stats
  ), who as (
    select o.k, o.price p, o.stats s, count(distinct x) n from o cross join lateral unnest(o.confirmed_by || o.reporter) x group by 1, 2, 3
  )
  select g.p, g.q, g.s, g.t, g.m, g.c, g.last_seen, g.n, g.lt, g.r, g.ls, g.sn, g.first_seen, who.n, g.oid
  from g join who on who.k = g.k and who.p = g.p and who.s = g.s
  order by g.p, g.last_seen desc
  limit least(greatest(lim, 1), 200)
$$;
grant execute on function public.current_listings(bigint,text,int) to anon,authenticated;

-- Distinct listings in a window; gone listings are no longer for sale but stay in the statistics: they were asked for.
create or replace function public.listing_asks(p_item bigint, p_world text, p_from timestamptz, p_to timestamptz default now())
returns table (price bigint, last_seen timestamptz, sold boolean) language sql stable set search_path = public as $$
  select distinct on (case when shop_key = '' then reporter::text else shop_key end, price, stats, qty)
         price, last_seen_at, sold_at is not null or gone_at is not null
  from market_observations
  where kind = 'ask' and item_id = p_item and world = p_world and last_seen_at > p_from and seen_at <= p_to
  order by case when shop_key = '' then reporter::text else shop_key end, price, stats, qty, last_seen_at desc
$$;

-- ---- Windows ----
create or replace function public.valid_window(p_days int) returns int language sql immutable as $$
 select case when p_days in (1,7,14,30,90) then p_days else 7 end
$$;
-- One item over a window. "Unusual" is what the site flags as a probable misread: 5x from the median, either way. Such prices stay in
-- the record and the medians (which they barely move), but not in the lowest price, which one misread would otherwise set.
create or replace function public.item_stats(p_item bigint, p_world text default '', p_days int default 7)
returns jsonb language sql stable set search_path = public as $$
  with w as (select make_interval(days=>valid_window(p_days)) span),
  raw as (
    select distinct on (case when shop_key = '' then reporter::text else shop_key end, price, stats, qty)
           price, last_seen_at, seen_count, sold_at is not null sold, gone_at is not null gone
    from market_observations, w
    where kind = 'ask' and item_id = p_item and world = p_world and last_seen_at > now() - w.span
    order by case when shop_key = '' then reporter::text else shop_key end, price, stats, qty, last_seen_at desc
  ), m as (select percentile_disc(0.5) within group (order by price) med from raw),
  s as (select listed_price, seen_at from sold_sightings, w where item_id = p_item and world = p_world and seen_at > now() - w.span),
  v as (select price, reporter, seen_at from market_observations, w where kind = 'sale' and verification_status = 'verified' and item_id = p_item and world = p_world and seen_at > now() - w.span)
  select jsonb_build_object(
    'window_days', valid_window(p_days),
    'listings', (select count(*) from raw),
    'median', (select med from m),
    'p25', (select percentile_disc(0.25) within group (order by price) from raw),
    'p75', (select percentile_disc(0.75) within group (order by price) from raw),
    'for_sale_now', (select count(*) from raw where not sold and not gone and last_seen_at > now() - interval '24 hours'),
    'lowest_now', (select min(price) from raw, m where not sold and not gone and last_seen_at > now() - interval '24 hours' and (price * 5 >= m.med or (select count(*) from raw) < 3)),
    'highest', (select max(price) from raw, m where price <= m.med * 5 or (select count(*) from raw) < 3),
    'stale_listings', (select count(*) from raw where not sold and not gone and last_seen_at <= now() - interval '24 hours'),
    'gone_listings', (select count(*) from raw where gone and not sold),
    'unusual', (select count(*) from raw, m where (select count(*) from raw) >= 3 and (price > m.med * 5 or price * 5 < m.med)),
    'repeats_folded', (select coalesce(sum(seen_count - 1), 0) from raw),
    'sold_seen', (select count(*) from s),
    'sold_median', (select percentile_disc(0.5) within group (order by listed_price) from s),
    'sold_p25', (select percentile_disc(0.25) within group (order by listed_price) from s),
    'sold_p75', (select percentile_disc(0.75) within group (order by listed_price) from s),
    'sold_last_seen', (select max(seen_at) from s),
    'sales', (select count(*) from v),
    'sale_median', (select percentile_disc(0.5) within group (order by price) from v),
    'ask_last_seen', (select max(last_seen_at) from raw),
    'first_seen', (select min(last_seen_at) from raw)
  )
$$;
grant execute on function public.item_stats(bigint,text,int) to anon,authenticated;

-- The market index over a window. Volume is rows seen sold; sell-through, the share of listings seen sold, needs 5 of them.
create or replace function public.market_index_window(p_world text default '', lim int default 300, p_days int default 7)
returns table (id bigint, name text, category text, game_id integer, icon_path text, window_days int,
 ask_median bigint, ask_p25 bigint, ask_p75 bigint, listings bigint, stale_listings bigint, unusual bigint, for_sale_now bigint, lowest_now bigint,
 median_24h bigint, median_prev_24h bigint, change_24h_pct numeric,
 sold_seen bigint, sold_median bigint, sold_p25 bigint, sold_p75 bigint, sell_through_pct numeric, sales bigint, sale_median bigint, last_seen timestamptz)
language sql stable set search_path = public as $$
  with w as (select make_interval(days=>valid_window(p_days)) span),
  l as (
    select distinct on (o.item_id, case when o.shop_key = '' then o.reporter::text else o.shop_key end, o.price, o.stats, o.qty)
           o.item_id, o.price, o.last_seen_at, o.sold_at is not null as sold, o.gone_at is not null as gone
    from market_observations o, w
    where o.kind = 'ask' and o.world = p_world and o.last_seen_at > now() - w.span
    order by o.item_id, case when o.shop_key = '' then o.reporter::text else o.shop_key end, o.price, o.stats, o.qty, o.last_seen_at desc
  ), a as (
    select item_id, percentile_disc(0.5) within group (order by price) med, percentile_disc(0.25) within group (order by price) p25,
           percentile_disc(0.75) within group (order by price) p75, count(*) n,
           count(*) filter (where not sold and not gone and last_seen_at > now() - interval '24 hours') for_sale,
           count(*) filter (where not sold and not gone and last_seen_at <= now() - interval '24 hours') stale, max(last_seen_at) last_seen
    from l group by item_id
  ), low as (
    select l.item_id, min(l.price) lowest from l join a on a.item_id = l.item_id
    where not l.sold and not l.gone and l.last_seen_at > now() - interval '24 hours' and (a.n < 3 or l.price * 5 >= a.med) group by l.item_id
  ), odd as (
    select l.item_id, count(*) n from l join a on a.item_id = l.item_id where a.n >= 3 and (l.price > a.med * 5 or l.price * 5 < a.med) group by l.item_id
  ), d as (
    select item_id,
           percentile_disc(0.5) within group (order by price) filter (where seen_at > now() - interval '24 hours') m1,
           count(*) filter (where seen_at > now() - interval '24 hours') n1,
           percentile_disc(0.5) within group (order by price) filter (where seen_at <= now() - interval '24 hours') m0,
           count(*) filter (where seen_at <= now() - interval '24 hours') n0
    from market_observations where kind = 'ask' and world = p_world and seen_at > now() - interval '48 hours' group by item_id
  ), s as (
    select item_id, count(*) n, percentile_disc(0.5) within group (order by listed_price) med, percentile_disc(0.25) within group (order by listed_price) p25,
           percentile_disc(0.75) within group (order by listed_price) p75, max(seen_at) last_seen
    from sold_sightings, w where world = p_world and seen_at > now() - w.span group by item_id
  ), v as (
    select item_id, count(*) n, percentile_disc(0.5) within group (order by price) med, max(seen_at) last_seen
    from market_observations, w where kind = 'sale' and verification_status = 'verified' and world = p_world and seen_at > now() - w.span
    group by item_id
  ), ids as (select item_id from a union select item_id from s union select item_id from v)
  select i.id, i.name, i.category, i.game_id, i.icon_path, valid_window(p_days),
         a.med, a.p25, a.p75, coalesce(a.n, 0), coalesce(a.stale, 0), coalesce(odd.n, 0), coalesce(a.for_sale, 0), low.lowest,
         case when d.n1 >= 3 then d.m1 end, case when d.n0 >= 3 then d.m0 end,
         case when d.n1 >= 3 and d.n0 >= 3 and d.m0 > 0 then round(100.0 * (d.m1 - d.m0) / d.m0, 1) end,
         coalesce(s.n, 0), s.med, s.p25, s.p75,
         case when coalesce(a.n, 0) >= 5 then least(100, round(100.0 * coalesce(s.n, 0) / a.n, 1)) end,
         coalesce(v.n, 0), v.med, greatest(a.last_seen, s.last_seen, v.last_seen)
  from ids join visible_items i on i.id = ids.item_id
  left join a on a.item_id = ids.item_id left join low on low.item_id = ids.item_id left join odd on odd.item_id = ids.item_id
  left join d on d.item_id = ids.item_id left join s on s.item_id = ids.item_id left join v on v.item_id = ids.item_id
  order by coalesce(a.for_sale, 0) desc, coalesce(a.n, 0) + coalesce(s.n, 0) desc, greatest(a.last_seen, s.last_seen, v.last_seen) desc, i.id
  limit least(greatest(lim, 1), 500)
$$;
grant execute on function public.market_index_window(text,int,int) to anon,authenticated;

-- ---- Buy low, sell high ----
-- The lowest credible listing against the item's typical price, after the store's 3% fee. Seen-sold prices are the better target, with
-- 3 of them; otherwise the asking median of 4 listings. Equipment varies by stats, which the client warns about.
create or replace function public.market_flips(p_world text default '', p_days int default 7, lim int default 30)
returns table (id bigint, name text, category text, game_id integer, icon_path text, buy bigint, sell bigint, basis text, samples bigint, profit bigint, roi_pct numeric, last_seen timestamptz)
language sql stable set search_path = public as $$
  with m as (select * from market_index_window(p_world, 500, p_days)),
  t as (select *, case when sold_seen >= 3 then sold_median when listings >= 4 then ask_median end target,
               case when sold_seen >= 3 then 'seen_sold' else 'asking' end kind,
               case when sold_seen >= 3 then sold_seen else listings end n from m),
  c as (select *, (target * 97 / 100)::bigint net from t where target is not null and lowest_now is not null)
  select c.id, c.name, c.category, c.game_id, c.icon_path, c.lowest_now, c.target, c.kind, c.n, c.net - c.lowest_now,
         round(100.0 * (c.net - c.lowest_now) / c.lowest_now, 1), c.last_seen
  from c where c.net > c.lowest_now
  order by round(100.0 * (c.net - c.lowest_now) / c.lowest_now, 1) desc, c.id
  limit least(greatest(lim, 1), 100)
$$;
grant execute on function public.market_flips(text,int,int) to anon,authenticated;

-- ---- Rankings ----
create table if not exists public.character_rankings(
 id bigint generated always as identity primary key,
 world text not null default '' check(char_length(world)<=32),
 name text not null check(name ~ '^[A-Za-z0-9]{2,12}$'),
 job text not null check(char_length(job) between 3 and 24),
 level smallint not null check(level between 1 and 200),
 reporter uuid not null references auth.users(id) on delete cascade,
 first_seen timestamptz not null default now(),
 last_seen timestamptz not null default now()
);
create unique index if not exists character_rankings_name on public.character_rankings(world,lower(name));
create index if not exists character_rankings_level on public.character_rankings(world,level desc,last_seen desc);
alter table public.character_rankings enable row level security;
create or replace view public.public_rankings as select id,world,name,job,level,first_seen,last_seen from character_rankings;
grant select on public.public_rankings to anon,authenticated;

-- Publishing is one's own choice, from the Companion, and a character belongs to whoever published it first. Levels only rise.
create or replace function public.report_character(p_world text,p_name text,p_job text,p_level int)
returns bigint language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();v_row character_rankings;
begin
 if v_user is null then raise exception 'sign-in required' using errcode='42501'; end if;
 if p_name !~ '^[A-Za-z0-9]{2,12}$' then raise exception 'character name not valid' using errcode='22023'; end if;
 if p_level is null or p_level not between 1 and 200 then raise exception 'level not valid' using errcode='22023'; end if;
 select * into v_row from character_rankings where world=p_world and lower(name)=lower(p_name);
 if found then
  if v_row.reporter<>v_user then raise exception 'published by another player' using errcode='P0001'; end if;
  update character_rankings set level=greatest(level,p_level),job=p_job,name=p_name,last_seen=now() where id=v_row.id;
  return v_row.id;
 end if;
 if (select count(*) from character_rankings where reporter=v_user)>=10 then raise exception 'too many characters' using errcode='P0001'; end if;
 insert into character_rankings(world,name,job,level,reporter) values(p_world,p_name,p_job,p_level,v_user) returning id into v_row.id;
 return v_row.id;
end $$;
create or replace function public.remove_character(p_name text,p_world text default '') returns boolean language sql security definer set search_path=public as $$
 with d as (delete from character_rankings where world=p_world and lower(name)=lower(p_name) and (reporter=auth.uid() or is_admin()) returning 1) select exists(select 1 from d)
$$;
revoke all on function public.report_character(text,text,text,int),public.remove_character(text,text) from public,anon;
grant execute on function public.report_character(text,text,text,int),public.remove_character(text,text) to authenticated;
