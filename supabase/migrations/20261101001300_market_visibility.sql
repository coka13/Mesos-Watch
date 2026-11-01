create view public.market_observations with(security_invoker=true) as select * from observations where verification_status<>'rejected';
grant select on public.market_observations to anon,authenticated;
create or replace function public.ask_prices(p_item bigint, p_world text, p_since timestamptz)
returns table (price bigint) language sql stable set search_path = public as $$
  select distinct on (reporter, shop_key, price, stats) price from market_observations
  where kind = 'ask' and item_id = p_item and world = p_world and seen_at > p_since
$$;

create or replace function public.current_listings(p_item bigint, p_world text default '', lim int default 50)
returns table (price bigint, qty integer, stats jsonb, shop_title text, map text, channel smallint, seen_at timestamptz, sightings bigint)
language sql stable set search_path = public as $$
  select max(price), max(qty), stats, max(shop_title), max(map), max(channel), max(seen_at), count(*)
  from market_observations
  where kind = 'ask' and item_id = p_item and world = p_world and seen_at > now() - interval '24 hours'
  group by case when shop_key = '' then reporter::text else shop_key end, price, stats
  order by max(price), max(seen_at) desc
  limit least(greatest(lim, 1), 200)
$$;

create or replace function public.item_variations(p_item bigint, p_world text default '')
returns table (stats jsonb, median bigint, low bigint, n bigint, last_seen timestamptz)
language sql stable set search_path = public as $$
  select stats, percentile_disc(0.5) within group (order by price), min(price), count(*), max(seen_at)
  from market_observations where kind = 'ask' and item_id = p_item and world = p_world and seen_at > now() - interval '30 days' and stats <> '{}'::jsonb
  group by stats order by count(*) desc limit 30
$$;

create or replace function public.item_summary(p_item bigint, p_world text default '')
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'verified_sales_only',true,
    'lowest_ask_24h', (select min(price) from market_observations where kind = 'ask' and item_id = p_item and world = p_world and seen_at > now() - interval '24 hours'),
    'median_ask_7d', (select percentile_disc(0.5) within group (order by price) from ask_prices(p_item, p_world, now() - interval '7 days')),
    'median_ask_prev_7d', (select percentile_disc(0.5) within group (order by price) from market_observations
                           where kind = 'ask' and item_id = p_item and world = p_world and seen_at between now() - interval '14 days' and now() - interval '7 days'),
    'asks_24h', (select count(*) from market_observations where kind = 'ask' and item_id = p_item and world = p_world and seen_at > now() - interval '24 hours'),
    'asks_7d', (select count(*) from market_observations where kind = 'ask' and item_id = p_item and world = p_world and seen_at > now() - interval '7 days'),
    'reporters_7d', (select count(distinct reporter) from market_observations where item_id = p_item and world = p_world and seen_at > now() - interval '7 days'),
    'sales_30d', (select count(*) from market_observations where kind = 'sale' and verification_status='verified' and item_id = p_item and world = p_world and seen_at > now() - interval '30 days'),
    'sale_reporters_30d', (select count(distinct reporter) from market_observations where kind = 'sale' and verification_status='verified' and item_id = p_item and world = p_world and seen_at > now() - interval '30 days'),
    'median_sale_30d', (select percentile_disc(0.5) within group (order by price) from market_observations where kind = 'sale' and verification_status='verified' and item_id = p_item and world = p_world and seen_at > now() - interval '30 days'),
    'estimated_value', (select case when count(*) >= 3 and count(distinct reporter) >= 2 then percentile_disc(0.5) within group (order by price) end
                        from market_observations where kind = 'sale' and verification_status='verified' and item_id = p_item and world = p_world and seen_at > now() - interval '30 days'),
    'last_seen', (select max(seen_at) from market_observations where item_id = p_item and world = p_world)
  )
$$;

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
    from market_observations o where (o.kind='ask' or o.verification_status='verified') and o.item_id = p_item and o.world = p_world and o.seen_at > now() - v_since
    group by 1, 2 order by 1, 2;
end $$;

create or replace function public.search_items(q text, p_world text default '', lim int default 50, p_offset int default 0)
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
    from market_observations o where o.kind = 'ask' and o.world = p_world and o.seen_at > now() - interval '7 days' and o.item_id in (select m.id from m)
    group by o.item_id
  )
  select m.id, m.name, m.category, m.subcategory, m.icon_path, m.game_id, s.median_ask, s.low_ask, coalesce(s.asks_7d, 0), s.last_seen
  from m left join stats s on s.item_id = m.id
  order by m.rank_kind desc, coalesce(s.asks_7d, 0) desc, m.sim desc, m.name, m.id   -- id last: a stable order, so pages never overlap
  limit least(greatest(lim, 1), 50) offset greatest(p_offset, 0)
$$;
grant execute on function public.search_items(text, text, int, int) to anon, authenticated;
create or replace function public.market_trends(p_world text default '', lim int default 30)
returns table (id bigint, name text, category text, game_id integer, icon_path text, median_now bigint, median_prev bigint, change_pct numeric, asks_7d bigint, last_seen timestamptz)
language sql stable set search_path = public as $$
  with now_w as (
    select item_id, percentile_disc(0.5) within group (order by price) as med, count(*) as n, max(seen_at) as last_seen
    from market_observations where kind = 'ask' and world = p_world and seen_at > now() - interval '7 days' group by item_id
  ), prev_w as (
    select item_id, percentile_disc(0.5) within group (order by price) as med, count(*) as n
    from market_observations where kind = 'ask' and world = p_world and seen_at between now() - interval '14 days' and now() - interval '7 days' group by item_id
  )
  select i.id, i.name, i.category, i.game_id, i.icon_path, n.med, p.med,
         case when p.med is not null and p.n >= 3 and n.n >= 3 then round(100.0 * (n.med - p.med) / p.med, 1) end,
         n.n, n.last_seen
  from now_w n join visible_items i on i.id = n.item_id left join prev_w p on p.item_id = n.item_id
  order by n.n desc limit least(greatest(lim, 1), 100)
$$;
grant execute on function public.market_trends(text, int) to anon, authenticated;
