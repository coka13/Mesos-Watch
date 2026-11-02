-- Structured Cash Shop candidates only. No private frames or chat are stored.
create table public.cash_item_candidates(
 id uuid primary key default gen_random_uuid(),reporter uuid not null default auth.uid() references auth.users(id) on delete restrict,
 name text not null check(length(btrim(name)) between 2 and 60),nx_price integer check(nx_price between 0 and 10000000),
 category text not null check(length(category) between 1 and 40),description text not null default '' check(length(description)<=400),
 source_note text not null check(length(source_note) between 10 and 400),confidence numeric check(confidence between 0 and 100),
 status text not null default 'pending' check(status in ('pending','accepted','rejected')),review_note text,reviewed_at timestamptz,
 created_at timestamptz not null default now());
alter table cash_item_candidates enable row level security;
create policy "own or admin cash candidates"on cash_item_candidates for select to authenticated using(reporter=auth.uid() or is_admin());
create policy "registered cash candidates"on cash_item_candidates for insert to authenticated with check(reporter=auth.uid() and registered_player());
create policy "admin cash review"on cash_item_candidates for update to authenticated using(is_admin())with check(is_admin());
grant select on cash_item_candidates to authenticated;
grant insert(name,nx_price,category,description,source_note,confidence),update(status,review_note,reviewed_at)on cash_item_candidates to authenticated;
create function public.cash_capture_rate_guard()returns trigger language plpgsql security definer set search_path=public as $$
begin
 if(select count(*)from cash_item_candidates where reporter=auth.uid() and created_at>now()-interval '1 day')>=100 then raise exception 'Maximum 100 candidate submissions per day';end if;return new;
end $$;
create trigger cash_capture_rate_guard before insert on cash_item_candidates for each row execute function public.cash_capture_rate_guard();
