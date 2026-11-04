-- Store Watcher publishes the owner's store list: rows still for sale and rows already sold (greyed out in the game).
-- A sold listing stays on the public store page with a Sold badge until it expires like any other listing.
alter table public.player_listings add column if not exists sold boolean not null default false;
grant insert(sold),update(sold) on public.player_listings to authenticated;
create or replace view public.public_player_listings as
 select l.id,l.store_id,l.item_id,l.qty,l.price,l.stats,l.updated_at,l.expires_at,
 case when l.observation_id is null then 'user-published' else 'observation-assisted; user-published' end as source,
 i.name as item_name,i.game_id,i.icon_path,i.category,l.sold
 from player_listings l join player_stores s on s.id=l.store_id join visible_items i on i.id=l.item_id
 where s.active and l.active and l.expires_at>now();
grant select on public.public_player_listings to anon,authenticated;
