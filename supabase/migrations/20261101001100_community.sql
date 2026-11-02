create table public.watchlist(
 id uuid primary key default gen_random_uuid(),owner uuid not null default auth.uid() references auth.users(id) on delete restrict,
 item_id bigint not null references items(id) on delete restrict,world text not null default '' check(length(world)<=32),
 stats jsonb not null default '{}' check(jsonb_typeof(stats)='object' and length(stats::text)<=600),
 threshold bigint check(threshold between 1 and 100000000000),direction text not null default 'below' check(direction in ('below','above')),
 last_met boolean not null default false,last_alert_at timestamptz,created_at timestamptz not null default now(),unique(owner,item_id,world,stats));
create table public.price_alert_events(
 id uuid primary key default gen_random_uuid(),owner uuid not null references auth.users(id) on delete restrict,
 watch_id uuid not null references watchlist(id) on delete cascade,observation_id bigint references observations(id) on delete set null,
 price bigint not null,created_at timestamptz not null default now(),read_at timestamptz,unique(watch_id,observation_id));
alter table watchlist enable row level security;alter table price_alert_events enable row level security;
create policy "watch own" on watchlist for all to authenticated using(owner=auth.uid()) with check(owner=auth.uid() and registered_player());
create policy "alerts own" on price_alert_events for select to authenticated using(owner=auth.uid());
create policy "mark own alerts read" on price_alert_events for update to authenticated using(owner=auth.uid()) with check(owner=auth.uid());
grant select,delete on watchlist to authenticated;
grant insert(item_id,world,stats,threshold,direction),update(threshold,direction) on watchlist to authenticated;
grant select on price_alert_events to authenticated;grant update(read_at) on price_alert_events to authenticated;
create function public.watchlist_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from visible_items where id=new.item_id) then raise exception 'Choose a verified Classic item'; end if;
 if tg_op='INSERT' and (select count(*) from watchlist where owner=auth.uid())>=200 then raise exception 'Maximum 200 watched items'; end if;
 if tg_op='UPDATE' and (new.threshold is distinct from old.threshold or new.direction<>old.direction)then new.last_met:=false;end if;
 return new;
end $$;
create trigger watchlist_guard before insert or update on watchlist for each row execute function public.watchlist_guard();
create function public.evaluate_price_alerts() returns integer language plpgsql security definer set search_path=public as $$
declare w watchlist;o observations;met boolean;total integer:=0;
begin
 if not registered_player()then raise exception 'Registered account required' using errcode='42501';end if;
 for w in select * from watchlist where owner=auth.uid() and threshold is not null for update skip locked loop
  select * into o from observations where item_id=w.item_id and world=w.world and stats=w.stats and kind='ask' and verification_status<>'rejected' and seen_at>now()-interval '1 hour' order by seen_at desc,id desc limit 1;
  met:=o.id is not null and case when w.direction='below' then o.price<=w.threshold else o.price>=w.threshold end;
  if met and not w.last_met and (w.last_alert_at is null or w.last_alert_at<now()-interval '30 minutes')then
   insert into price_alert_events(owner,watch_id,observation_id,price)values(auth.uid(),w.id,o.id,o.price)on conflict do nothing;
   if found then total:=total+1;update watchlist set last_alert_at=now() where id=w.id;end if;
  end if;
  update watchlist set last_met=met where id=w.id;
 end loop;return total;
end $$;
revoke all on function public.evaluate_price_alerts() from public,anon;grant execute on function public.evaluate_price_alerts() to authenticated;
create table public.market_reports(
 id uuid primary key default gen_random_uuid(),reporter uuid not null default auth.uid() references auth.users(id) on delete restrict,
 observation_id bigint references observations(id) on delete restrict,megaphone_id uuid references megaphones(id) on delete restrict,
 reason text not null check(length(btrim(reason)) between 10 and 1000),status text not null default 'open' check(status in ('open','dismissed','actioned')),
 reviewed_by uuid references auth.users(id) on delete restrict,review_note text,created_at timestamptz not null default now(),reviewed_at timestamptz,
 check((observation_id is not null)::integer+(megaphone_id is not null)::integer=1));
alter table market_reports enable row level security;
create policy "own or admin reports" on market_reports for select to authenticated using(reporter=auth.uid() or is_admin());
create policy "registered report" on market_reports for insert to authenticated with check(reporter=auth.uid() and registered_player());
grant select on market_reports to authenticated;grant insert(observation_id,megaphone_id,reason) on market_reports to authenticated;
create function public.report_rate_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (select count(*) from market_reports where reporter=auth.uid() and created_at>now()-interval '1 day')>=20 then raise exception 'Maximum 20 reports per day';end if;
 if exists(select 1 from market_reports where reporter=auth.uid() and status='open' and (observation_id=new.observation_id or megaphone_id=new.megaphone_id))then raise exception 'Already reported; awaiting review';end if;
 return new;
end $$;
create trigger report_rate_guard before insert on market_reports for each row execute function public.report_rate_guard();
create function public.review_market_report(p_id uuid,p_status text,p_note text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not is_admin()then raise exception 'admins only' using errcode='42501';end if;
 if p_status not in ('dismissed','actioned') or length(btrim(p_note)) not between 10 and 1000 then raise exception 'Review decision and note required';end if;
 update market_reports set status=p_status,review_note=p_note,reviewed_by=auth.uid(),reviewed_at=now() where id=p_id and status='open';
 if not found then raise exception 'Report not open';end if;
end $$;
revoke all on function public.review_market_report(uuid,text,text) from public,anon;grant execute on function public.review_market_report(uuid,text,text) to authenticated;
create function public.recent_fm_rooms(p_world text default '') returns table(map text,channel smallint,last_seen timestamptz,observations bigint,contributors bigint) language sql stable set search_path=public as $$
 select map,channel,max(seen_at),count(*),count(distinct reporter)from observations where kind='ask' and world=p_world and map<>'' and seen_at>now()-interval '24 hours' and verification_status<>'rejected' group by map,channel order by max(seen_at)desc limit 30
$$;
grant execute on function public.recent_fm_rooms(text)to anon,authenticated;
