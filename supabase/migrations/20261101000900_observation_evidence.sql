-- Existing reported sales remain intact but never become verified automatically.
alter table public.observations add column if not exists verification_status text not null default 'reported' check(verification_status in ('reported','verified','rejected'));
alter table public.observations add column if not exists confidence numeric check(confidence between 0 and 100);
alter table public.observations add column if not exists capture_source text not null default 'unknown' check(capture_source in ('unknown','scanner','store','manual'));
grant insert(confidence,capture_source) on public.observations to authenticated;
create function public.observation_evidence_guard() returns trigger language plpgsql set search_path=public as $$
begin new.verification_status:='reported'; return new; end $$;
create trigger observation_evidence_guard before insert on public.observations for each row execute function public.observation_evidence_guard();
create table public.observation_reviews(
 id bigint generated always as identity primary key,
 observation_id bigint not null references public.observations(id) on delete restrict,
 reviewer uuid not null references auth.users(id) on delete restrict,
 decision text not null check(decision in ('verified','rejected')), reason text not null check(length(reason) between 10 and 1000),created_at timestamptz not null default now());
alter table public.observation_reviews enable row level security;
create policy "admins read evidence reviews" on public.observation_reviews for select to authenticated using(public.is_admin());
grant select on public.observation_reviews to authenticated;
create function public.review_observation(p_id bigint,p_decision text,p_reason text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_admin() then raise exception 'admins only' using errcode='42501'; end if;
 if p_decision not in ('verified','rejected') or length(btrim(p_reason)) not between 10 and 1000 then raise exception 'Valid decision and evidence reason required'; end if;
 perform 1 from observations where id=p_id for update;
 if not found then raise exception 'Observation not found'; end if;
 insert into observation_reviews(observation_id,reviewer,decision,reason)values(p_id,auth.uid(),p_decision,btrim(p_reason));
 update observations set verification_status=p_decision where id=p_id;
end $$;
revoke all on function public.review_observation(bigint,text,text) from public,anon;
grant execute on function public.review_observation(bigint,text,text) to authenticated;
create or replace function public.item_summary(p_item bigint, p_world text default '')
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'verified_sales_only',true,
    'lowest_ask_24h', (select min(price) from observations where kind = 'ask' and item_id = p_item and world = p_world and seen_at > now() - interval '24 hours'),
    'median_ask_7d', (select percentile_disc(0.5) within group (order by price) from ask_prices(p_item, p_world, now() - interval '7 days')),
    'median_ask_prev_7d', (select percentile_disc(0.5) within group (order by price) from observations
                           where kind = 'ask' and item_id = p_item and world = p_world and seen_at between now() - interval '14 days' and now() - interval '7 days'),
    'asks_24h', (select count(*) from observations where kind = 'ask' and item_id = p_item and world = p_world and seen_at > now() - interval '24 hours'),
    'asks_7d', (select count(*) from observations where kind = 'ask' and item_id = p_item and world = p_world and seen_at > now() - interval '7 days'),
    'reporters_7d', (select count(distinct reporter) from observations where item_id = p_item and world = p_world and seen_at > now() - interval '7 days'),
    'sales_30d', (select count(*) from observations where kind = 'sale' and verification_status='verified' and item_id = p_item and world = p_world and seen_at > now() - interval '30 days'),
    'sale_reporters_30d', (select count(distinct reporter) from observations where kind = 'sale' and verification_status='verified' and item_id = p_item and world = p_world and seen_at > now() - interval '30 days'),
    'median_sale_30d', (select percentile_disc(0.5) within group (order by price) from observations where kind = 'sale' and verification_status='verified' and item_id = p_item and world = p_world and seen_at > now() - interval '30 days'),
    'estimated_value', (select case when count(*) >= 3 and count(distinct reporter) >= 2 then percentile_disc(0.5) within group (order by price) end
                        from observations where kind = 'sale' and verification_status='verified' and item_id = p_item and world = p_world and seen_at > now() - interval '30 days'),
    'last_seen', (select max(seen_at) from observations where item_id = p_item and world = p_world)
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
    from observations o where (o.kind='ask' or o.verification_status='verified') and o.item_id = p_item and o.world = p_world and o.seen_at > now() - v_since
    group by 1, 2 order by 1, 2;
end $$;
