-- Where to find a listing. Every FM Scanner listing carries a structured location: world, channel, and either an FM room
-- (location_type FM_ROOM, "Free Market <8>") or a named map such as one on Hidden Street (NAMED_MAP, map holds its name),
-- with whether it was read from the screen (AUTO) or typed by the player (MANUAL) and how confident the reading was.
-- Scanner listings without a complete location are refused: the scanner keeps them as unpublished drafts.
-- Greyed-out (sold) shop rows are not asking prices and not confirmed sales; they go to sold_sightings, apart from
-- observations, so price history, estimated values and moderation are unchanged.

create or replace function public.valid_fm_location(p_channel smallint,p_type text,p_room smallint,p_map text)
returns boolean language sql immutable set search_path=public as $$
 select coalesce(p_channel between 1 and 40,false) and (
  (p_type='FM_ROOM' and coalesce(p_room between 1 and 99,false)) or
  (p_type='NAMED_MAP' and p_room is null and char_length(btrim(coalesce(p_map,''))) between 3 and 40))
$$;

alter table public.observations
 add column if not exists location_type text not null default '' check(location_type in ('','FM_ROOM','NAMED_MAP')),
 add column if not exists room smallint check(room between 1 and 99),
 add column if not exists location_source text not null default '' check(location_source in ('','AUTO','MANUAL')),
 add column if not exists location_confidence smallint check(location_confidence between 0 and 100),
 add column if not exists seller_name text not null default '' check(char_length(seller_name)<=40);
grant insert(location_type,room,location_source,location_confidence,seller_name) on public.observations to authenticated;

create or replace function public.observation_location_guard() returns trigger language plpgsql set search_path=public as $$
begin
 if new.capture_source='scanner' then
  if new.kind<>'ask' then raise exception 'scanner sold rows are sold sightings, not sales' using errcode='22023'; end if;
  if not valid_fm_location(new.channel,new.location_type,new.room,new.map) then
   raise exception 'location required: channel and FM room or map name' using errcode='22023'; end if;
  if new.location_source not in ('AUTO','MANUAL') then raise exception 'location source required' using errcode='22023'; end if;
 elsif new.location_type<>'' and not valid_fm_location(new.channel,new.location_type,new.room,new.map) then
  raise exception 'incomplete location' using errcode='22023';
 end if;
 if new.location_type='FM_ROOM' and new.room is not null then new.map:='Free Market '||new.room; end if;
 return new;
end $$;
drop trigger if exists observation_location_guard on public.observations;
create trigger observation_location_guard before insert on public.observations for each row execute function public.observation_location_guard();

-- The view is select *: recreated so it carries the new columns.
create or replace view public.market_observations with(security_invoker=true) as select * from observations where verification_status<>'rejected';
grant select on public.market_observations to anon,authenticated;

drop function if exists public.current_listings(bigint,text,int);
create function public.current_listings(p_item bigint, p_world text default '', lim int default 50)
returns table (price bigint, qty integer, stats jsonb, shop_title text, map text, channel smallint, seen_at timestamptz, sightings bigint,
 location_type text, room smallint, location_source text, seller_name text)
language sql stable set search_path = public as $$
  select max(price), max(qty), stats, max(shop_title), max(map), max(channel), max(seen_at), count(*),
   max(location_type), max(room), max(location_source), max(seller_name)
  from market_observations
  where kind = 'ask' and item_id = p_item and world = p_world and seen_at > now() - interval '24 hours'
  group by case when shop_key = '' then reporter::text else shop_key end, price, stats
  order by max(price), max(seen_at) desc
  limit least(greatest(lim, 1), 200)
$$;
grant execute on function public.current_listings(bigint,text,int) to anon,authenticated;

-- Greyed-out rows seen in other players' shops: the item, its displayed price and where. Not evidence of what a buyer paid.
create table if not exists public.sold_sightings(
 id bigint generated always as identity primary key,
 reporter uuid not null default auth.uid() references auth.users(id) on delete cascade,
 world text not null default '' check(char_length(world)<=32),
 channel smallint not null check(channel between 1 and 40),
 location_type text not null check(location_type in ('FM_ROOM','NAMED_MAP')),
 room smallint check(room between 1 and 99),
 map text not null default '' check(char_length(map)<=40),
 location_source text not null check(location_source in ('AUTO','MANUAL')),
 location_confidence smallint check(location_confidence between 0 and 100),
 shop_key text not null default '' check(char_length(shop_key)<=64),
 shop_title text not null default '' check(char_length(shop_title)<=40),
 seller_name text not null default '' check(char_length(seller_name)<=40),
 item_id bigint not null references public.items(id) on delete cascade,
 item_name text not null check(char_length(item_name) between 2 and 60),
 listed_price bigint not null check(listed_price between 1 and 100000000000),
 qty integer not null default 1 check(qty between 1 and 9999),
 stats jsonb not null default '{}' check(jsonb_typeof(stats)='object' and char_length(stats::text)<=600),
 confidence smallint check(confidence between 0 and 100),
 seen_at timestamptz not null default now(),
 check(public.valid_fm_location(channel,location_type,room,map))
);
create index if not exists sold_sightings_item_seen on public.sold_sightings(item_id,world,seen_at desc);
alter table public.sold_sightings enable row level security;
drop policy if exists "anyone reads sold sightings" on public.sold_sightings;
create policy "anyone reads sold sightings" on public.sold_sightings for select using(true);
drop policy if exists "players add own sold sightings" on public.sold_sightings;
create policy "players add own sold sightings" on public.sold_sightings for insert to authenticated with check(reporter=auth.uid());
drop policy if exists "admins remove sold sightings" on public.sold_sightings;
create policy "admins remove sold sightings" on public.sold_sightings for delete using(public.is_admin());
grant select on public.sold_sightings to anon,authenticated;
grant insert(world,channel,location_type,room,map,location_source,location_confidence,shop_key,shop_title,seller_name,item_name,listed_price,qty,stats,confidence) on public.sold_sightings to authenticated;
grant delete on public.sold_sightings to authenticated;

-- Fixed time and reporter, rate limit, only catalog/known items (a sold row never creates an item), and the same greyed-out
-- row seen again by anyone within 24 hours is the same sighting.
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
 if exists(select 1 from sold_sightings s where s.world=new.world and s.item_id=new.item_id and s.listed_price=new.listed_price
   and s.qty=new.qty and s.stats=new.stats and s.channel=new.channel and s.map=new.map
   and (case when new.shop_key='' then s.reporter=new.reporter and s.shop_key='' else s.shop_key=new.shop_key end)
   and s.seen_at>now()-interval '24 hours') then return null; end if;
 return new;
end $$;
drop trigger if exists sold_sightings_guard on public.sold_sightings;
create trigger sold_sightings_guard before insert on public.sold_sightings for each row execute function public.sold_sightings_guard();

-- Player stores: an FM room or a named map, never neither.
alter table public.player_stores alter column room drop not null;
alter table public.player_stores add column if not exists map_name text not null default '' check(char_length(map_name)<=40);
alter table public.player_stores drop constraint if exists player_stores_location;
alter table public.player_stores add constraint player_stores_location check((room is not null and map_name='') or (room is null and char_length(btrim(map_name))>=3));
grant insert(map_name),update(map_name) on public.player_stores to authenticated;
create or replace view public.public_player_stores as select id,character_name,name,world,channel,room,description,updated_at,map_name from player_stores where active;
grant select on public.public_player_stores to anon,authenticated;
