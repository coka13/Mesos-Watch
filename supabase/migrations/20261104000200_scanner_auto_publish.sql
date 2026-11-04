-- The FM Scanner publishes automatically, without a review step, so the database enforces what it may publish:
--  * a scanner listing must name a known item: scanner OCR never creates items (sold sightings already work this way);
--  * an asking price later seen as a greyed-out (sold) row in the same shop and place is marked sold: it leaves current
--    listings but stays in price history, and the sold sighting keeps the listed price apart from confirmed sales;
--  * the same row listed again after it sold is a new listing, not a duplicate of the sold one.

alter table public.observations add column if not exists sold_at timestamptz;
-- The view is select *: recreated so it carries the new column.
create or replace view public.market_observations with(security_invoker=true) as select * from observations where verification_status<>'rejected';
grant select on public.market_observations to anon,authenticated;

create or replace function public.observation_scanner_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 new.sold_at:=null;
 if new.capture_source='scanner' and not exists(select 1 from items where name_key=norm_name(regexp_replace(btrim(new.item_name),'\s+',' ','g'))) then
  return null;
 end if;
 return new;
end $$;
-- Fires before observations_guard (triggers run in name order), which would otherwise create the item.
drop trigger if exists observation_scanner_guard on public.observations;
create trigger observation_scanner_guard before insert on public.observations for each row execute function public.observation_scanner_guard();

-- As in 20261101000000, with sold listings left out of the duplicate check.
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
               and o.price = new.price and o.stats = new.stats and o.shop_key = new.shop_key and o.sold_at is null
               and o.seen_at > now() - case when new.kind = 'ask' then interval '6 hours' else interval '10 minutes' end) then
    return null;
  end if;
  return new;
end $$;

-- As in 20261104000100, and the matching asking price (same shop, place, item, price, quantity and stats, last 24 hours)
-- is marked sold, also when this sighting itself is a duplicate.
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
   and (case when new.shop_key='' then o.reporter=new.reporter and o.shop_key='' else o.shop_key=new.shop_key end)
   and o.seen_at>now()-interval '24 hours';
 if exists(select 1 from sold_sightings s where s.world=new.world and s.item_id=new.item_id and s.listed_price=new.listed_price
   and s.qty=new.qty and s.stats=new.stats and s.channel=new.channel and s.map=new.map
   and (case when new.shop_key='' then s.reporter=new.reporter and s.shop_key='' else s.shop_key=new.shop_key end)
   and s.seen_at>now()-interval '24 hours') then return null; end if;
 return new;
end $$;

-- Current listings are the asking prices not seen sold since.
create or replace function public.current_listings(p_item bigint, p_world text default '', lim int default 50)
returns table (price bigint, qty integer, stats jsonb, shop_title text, map text, channel smallint, seen_at timestamptz, sightings bigint,
 location_type text, room smallint, location_source text, seller_name text)
language sql stable set search_path = public as $$
  select max(price), max(qty), stats, max(shop_title), max(map), max(channel), max(seen_at), count(*),
   max(location_type), max(room), max(location_source), max(seller_name)
  from market_observations
  where kind = 'ask' and item_id = p_item and world = p_world and seen_at > now() - interval '24 hours' and sold_at is null
  group by case when shop_key = '' then reporter::text else shop_key end, price, stats
  order by max(price), max(seen_at) desc
  limit least(greatest(lim, 1), 200)
$$;
grant execute on function public.current_listings(bigint,text,int) to anon,authenticated;
