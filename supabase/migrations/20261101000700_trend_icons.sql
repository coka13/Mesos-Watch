-- The trends lists draw item pictures, but market_trends never returned game_id, so every cash item fell back to a
-- placeholder while the same item showed its real sprite in the live feed.

drop function if exists public.market_trends(text, int);
create or replace function public.market_trends(p_world text default '', lim int default 30)
returns table (id bigint, name text, category text, game_id integer, icon_path text, median_now bigint, median_prev bigint, change_pct numeric, asks_7d bigint, last_seen timestamptz)
language sql stable set search_path = public as $$
  with now_w as (
    select item_id, percentile_disc(0.5) within group (order by price) as med, count(*) as n, max(seen_at) as last_seen
    from observations where kind = 'ask' and world = p_world and seen_at > now() - interval '7 days' group by item_id
  ), prev_w as (
    select item_id, percentile_disc(0.5) within group (order by price) as med, count(*) as n
    from observations where kind = 'ask' and world = p_world and seen_at between now() - interval '14 days' and now() - interval '7 days' group by item_id
  )
  select i.id, i.name, i.category, i.game_id, i.icon_path, n.med, p.med,
         case when p.med is not null and p.n >= 3 and n.n >= 3 then round(100.0 * (n.med - p.med) / p.med, 1) end,
         n.n, n.last_seen
  from now_w n join visible_items i on i.id = n.item_id left join prev_w p on p.item_id = n.item_id
  order by n.n desc limit least(greatest(lim, 1), 100)
$$;
grant execute on function public.market_trends(text, int) to anon, authenticated;
