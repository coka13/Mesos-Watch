-- Search results in pages, so the dropdown can scroll through every matching item (it loads the next page as you scroll).
-- Replaces the 3-argument search_items; the old one stopped at 25 results.
drop function if exists public.search_items(text, text, int);

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
    from observations o where o.kind = 'ask' and o.world = p_world and o.seen_at > now() - interval '7 days' and o.item_id in (select m.id from m)
    group by o.item_id
  )
  select m.id, m.name, m.category, m.subcategory, m.icon_path, m.game_id, s.median_ask, s.low_ask, coalesce(s.asks_7d, 0), s.last_seen
  from m left join stats s on s.item_id = m.id
  order by m.rank_kind desc, coalesce(s.asks_7d, 0) desc, m.sim desc, m.name, m.id   -- id last: a stable order, so pages never overlap
  limit least(greatest(lim, 1), 50) offset greatest(p_offset, 0)
$$;
grant execute on function public.search_items(text, text, int, int) to anon, authenticated;
