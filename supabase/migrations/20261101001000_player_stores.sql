-- Public pages contain only deliberately published fields; owner tables remain private under RLS.
create function public.registered_player() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from auth.users where id=auth.uid() and coalesce(email,'')<>'')
$$;
revoke all on function public.registered_player() from public,anon;
grant execute on function public.registered_player() to authenticated;
create table public.player_stores(
 id uuid primary key default gen_random_uuid(),owner uuid not null default auth.uid() references auth.users(id) on delete restrict,
 character_name text not null check(length(btrim(character_name)) between 2 and 40),
 name text not null check(length(btrim(name)) between 2 and 60),world text not null check(length(world) between 1 and 32),
 channel smallint not null check(channel between 1 and 40),room smallint not null check(room between 1 and 99),
 description text not null default '' check(length(description)<=1000),active boolean not null default true,
 updated_at timestamptz not null default now());
create table public.player_listings(
 id uuid primary key default gen_random_uuid(),store_id uuid not null references public.player_stores(id) on delete cascade,
 item_id bigint not null references public.items(id) on delete restrict,qty integer not null check(qty between 1 and 9999),
 price bigint not null check(price between 1 and 100000000000),stats jsonb not null default '{}' check(jsonb_typeof(stats)='object' and length(stats::text)<=600),
 observation_id bigint references public.observations(id) on delete set null,
 active boolean not null default true,updated_at timestamptz not null default now(),expires_at timestamptz not null default (now()+interval '24 hours'));
create index player_listings_store on public.player_listings(store_id);
alter table public.player_stores enable row level security;
alter table public.player_listings enable row level security;
create policy "owners read stores" on public.player_stores for select to authenticated using(owner=auth.uid());
create policy "registered owners create stores" on public.player_stores for insert to authenticated with check(owner=auth.uid() and registered_player());
create policy "owners update stores" on public.player_stores for update to authenticated using(owner=auth.uid()) with check(owner=auth.uid() and registered_player());
create policy "owners remove stores" on public.player_stores for delete to authenticated using(owner=auth.uid());
create policy "owners read listings" on public.player_listings for select to authenticated using(exists(select 1 from player_stores where id=store_id and owner=auth.uid()));
create policy "owners create listings" on public.player_listings for insert to authenticated with check(registered_player() and exists(select 1 from player_stores where id=store_id and owner=auth.uid()));
create policy "owners update listings" on public.player_listings for update to authenticated using(exists(select 1 from player_stores where id=store_id and owner=auth.uid())) with check(registered_player() and exists(select 1 from player_stores where id=store_id and owner=auth.uid()));
create policy "owners remove listings" on public.player_listings for delete to authenticated using(exists(select 1 from player_stores where id=store_id and owner=auth.uid()));
grant select,delete on public.player_stores,public.player_listings to authenticated;
grant insert(character_name,name,world,channel,room,description,active),update(character_name,name,world,channel,room,description,active) on public.player_stores to authenticated;
grant insert(store_id,item_id,qty,price,stats,observation_id,active),update(item_id,qty,price,stats,observation_id,active) on public.player_listings to authenticated;
create function public.player_publication_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 new.updated_at:=now();
 if tg_table_name='player_stores' then
  if tg_op='INSERT' and (select count(*) from player_stores where owner=auth.uid())>=5 then raise exception 'Maximum 5 stores'; end if;
 else
  if not exists(select 1 from visible_items where id=new.item_id) then raise exception 'Choose a verified Classic item'; end if;
  if tg_op='INSERT' and (select count(*) from player_listings where store_id=new.store_id)>=200 then raise exception 'Maximum 200 listings per store'; end if;
  if new.observation_id is not null and not exists(select 1 from observations o join player_stores s on s.id=new.store_id where o.id=new.observation_id and o.item_id=new.item_id and o.kind='ask' and o.world=s.world and o.price=new.price and o.stats=new.stats and o.seen_at>now()-interval '24 hours') then raise exception 'Observation must match item, price, world and stats and be recent'; end if;
  new.expires_at:=now()+interval '24 hours';
 end if;
 return new;
end $$;
create trigger player_store_guard before insert or update on public.player_stores for each row execute function public.player_publication_guard();
create trigger player_listing_guard before insert or update on public.player_listings for each row execute function public.player_publication_guard();
create view public.public_player_stores as select id,character_name,name,world,channel,room,description,updated_at from player_stores where active;
create view public.public_player_listings as
 select l.id,l.store_id,l.item_id,l.qty,l.price,l.stats,l.updated_at,l.expires_at,
 case when l.observation_id is null then 'user-published' else 'observation-assisted; user-published' end as source,
 i.name as item_name,i.game_id,i.icon_path,i.category
 from player_listings l join player_stores s on s.id=l.store_id join visible_items i on i.id=l.item_id
 where s.active and l.active and l.expires_at>now();
grant select on public.public_player_stores,public.public_player_listings to anon,authenticated;
create function public.market_opportunities(p_world text default '') returns table(item_id bigint,name text,game_id integer,icon_path text,category text,stats jsonb,lowest bigint,highest bigint,shops bigint,last_seen timestamptz)
language sql stable set search_path=public as $$
 select o.item_id,i.name,i.game_id,i.icon_path,i.category,o.stats,min(o.price),max(o.price),count(distinct o.shop_key),max(o.seen_at)
 from observations o join visible_items i on i.id=o.item_id
 where o.kind='ask' and o.world=p_world and o.seen_at>now()-interval '1 hour' and o.stats<>'{}'::jsonb and o.shop_key<>'' and o.verification_status<>'rejected'
 group by o.item_id,i.name,i.game_id,i.icon_path,i.category,o.stats
 having count(distinct o.shop_key)>=2 and max(o.price)>min(o.price)
 order by max(o.price)::numeric/min(o.price) desc limit 30
$$;
grant execute on function public.market_opportunities(text) to anon,authenticated;
