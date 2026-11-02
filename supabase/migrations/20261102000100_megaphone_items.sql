-- Optional item reference on a website megaphone, shown with the item's icon. The message itself is unchanged and still
-- checked by the same rules; the item only adds a link and picture. Deleting an item keeps the campaign (set null).
alter table public.megaphones add column if not exists item_id bigint references public.items (id) on delete set null;

-- New columns go at the end so existing readers of live_megaphones keep working.
create or replace view public.live_megaphones as
  select m.id, m.message, m.sender, m.world, m.starts_at, m.ends_at,
         m.item_id, i.name as item_name, i.game_id as item_game_id, i.icon_path as item_icon_path, i.category as item_category
  from megaphones m left join visible_items i on i.id = m.item_id
  where m.status = 'scheduled' and m.starts_at <= now() and m.ends_at > now() and not m.test;
grant select on public.live_megaphones to anon, authenticated;
