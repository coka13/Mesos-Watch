-- PayPal and crypto (NOWPayments) payments for megaphones, sponsor slots and donations. Rows are written only by the
-- payment Edge Functions (service role) and admins; buyers can read their own. A row becomes paid only after the provider
-- confirms it on the server (supabase/functions/paypal-capture, supabase/functions/nowpayments-ipn).

alter table public.megaphones add column if not exists provider text not null default 'stripe';
do $$ begin
  alter table public.megaphones add constraint megaphones_provider_check check (provider in ('stripe', 'paypal', 'crypto'));
exception when duplicate_object then null; end $$;

-- ---- Sponsor slots: a banner (title, https link, optional https image) shown in the sponsor box for the days bought. ----
create table if not exists public.sponsor_plans (
  id text primary key,
  label text not null,
  days integer not null check (days > 0),
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'usd',
  active boolean not null default true,
  sort integer not null default 0
);
insert into public.sponsor_plans (id, label, days, price_cents, sort) values
  ('s7', '7 days', 7, 1500, 1), ('s30', '30 days', 30, 4500, 2)
on conflict (id) do nothing;
alter table public.sponsor_plans enable row level security;
drop policy if exists "anyone reads sponsor plans" on public.sponsor_plans;
create policy "anyone reads sponsor plans" on public.sponsor_plans for select using (active);

create table if not exists public.sponsors (
  id uuid primary key default gen_random_uuid(),
  buyer uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 40),
  url text not null check (url ~ '^https://[^\s]{4,}$' and char_length(url) <= 300),
  image_url text check (image_url is null or (image_url ~ '^https://[^\s]{4,}$' and char_length(image_url) <= 300)),
  plan_id text not null references public.sponsor_plans (id),
  days integer not null,
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'usd',
  provider text not null check (provider in ('paypal', 'crypto')),
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment', 'paid_pending_review', 'scheduled', 'rejected', 'refunded', 'cancelled', 'removed')),
  checkout_session text unique,
  payment_intent text,
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  reject_reason text check (char_length(reject_reason) <= 200),
  starts_at timestamptz,
  ends_at timestamptz,
  check ((status = 'scheduled') = (starts_at is not null and ends_at is not null))
);
create index if not exists sponsors_live on public.sponsors (status, starts_at, ends_at);
alter table public.sponsors enable row level security;
drop policy if exists "buyers see own sponsor slots" on public.sponsors;
create policy "buyers see own sponsor slots" on public.sponsors for select using (buyer = auth.uid() or public.is_admin());
grant select on public.sponsors to authenticated;
grant select on public.sponsor_plans to anon, authenticated;

-- What visitors see: only banners inside their paid window, without buyer or payment data.
create or replace view public.live_sponsors as
  select id, title, url, image_url, ends_at from public.sponsors
  where status = 'scheduled' and starts_at <= now() and ends_at > now();
grant select on public.live_sponsors to anon, authenticated;

-- At most p_slots sponsors show at once (one is picked at random per page view). A new one starts when a slot is free.
create or replace function public.approve_sponsor(p_id uuid, p_slots integer default 3)
returns public.sponsors language plpgsql security definer set search_path = public as $$
declare s sponsors; t timestamptz; v_start timestamptz;
begin
  if not (public.is_admin() or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role') then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_slots < 1 or p_slots > 20 then raise exception 'Slots must be between 1 and 20'; end if;
  perform pg_advisory_xact_lock(hashtext('sponsor-schedule'));
  select * into s from sponsors where id = p_id for update;
  if s.id is null then raise exception 'not found'; end if;
  if s.status <> 'paid_pending_review' then raise exception 'sponsor slot is %', s.status; end if;
  if s.paid_at is null or s.checkout_session is null or s.payment_intent is null then raise exception 'Verified payment required'; end if;
  for t in select x from (select now() as x union select ends_at from sponsors where status = 'scheduled' and ends_at > now()) c order by x loop
    if (select count(*) from sponsors o where o.status = 'scheduled' and o.starts_at < t + make_interval(days => s.days) and o.ends_at > t) < p_slots then
      v_start := t; exit;
    end if;
  end loop;
  v_start := coalesce(v_start, now());
  update sponsors set status = 'scheduled', reviewed_at = now(), reviewed_by = auth.uid(), reject_reason = null,
    starts_at = v_start, ends_at = v_start + make_interval(days => s.days)
  where id = p_id returning * into s;
  return s;
end $$;
revoke all on function public.approve_sponsor(uuid, integer) from public;
grant execute on function public.approve_sponsor(uuid, integer) to authenticated, service_role;

-- Reject a paid slot before it runs, or take a running one down. Refunds are made in the PayPal / NOWPayments dashboard.
create or replace function public.moderate_sponsor(p_id uuid, p_action text, p_reason text default '')
returns public.sponsors language plpgsql security definer set search_path = public as $$
declare s sponsors;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select * into s from sponsors where id = p_id for update;
  if s.id is null then raise exception 'not found'; end if;
  if p_action = 'reject' and s.status not in ('paid_pending_review', 'awaiting_payment') then raise exception 'Cannot reject a % sponsor slot', s.status; end if;
  if p_action = 'remove' and s.status <> 'scheduled' then raise exception 'Only scheduled sponsor slots can be removed'; end if;
  if p_action = 'refunded' and s.status not in ('paid_pending_review', 'scheduled', 'rejected', 'removed') then raise exception 'Cannot mark a % slot refunded', s.status; end if;
  if p_action not in ('reject', 'remove', 'refunded') then raise exception 'Unknown action'; end if;
  update sponsors set status = case p_action when 'reject' then 'rejected' when 'remove' then 'removed' else 'refunded' end,
    starts_at = null, ends_at = null, reviewed_at = now(), reviewed_by = auth.uid(), reject_reason = nullif(left(btrim(coalesce(p_reason, '')), 200), '')
  where id = p_id returning * into s;
  return s;
end $$;
revoke all on function public.moderate_sponsor(uuid, text, text) from public, anon;
grant execute on function public.moderate_sponsor(uuid, text, text) to authenticated;

-- ---- Donations ----
create table if not exists public.donations (
  id uuid primary key default gen_random_uuid(),
  donor uuid references auth.users (id) on delete set null,
  amount_cents integer not null check (amount_cents between 100 and 50000),
  currency text not null default 'usd',
  name text not null default '' check (char_length(name) <= 30),
  message text not null default '' check (char_length(message) <= 140),
  public boolean not null default false,
  provider text not null check (provider in ('paypal', 'crypto')),
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment', 'paid', 'cancelled', 'refunded')),
  checkout_session text unique,
  payment_intent text,
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table public.donations enable row level security;
drop policy if exists "donors see own donations" on public.donations;
create policy "donors see own donations" on public.donations for select using (donor = auth.uid() or public.is_admin());
grant select on public.donations to authenticated;

-- Thank-you list: only paid donations whose donor chose to be shown, never amounts or payment data.
create or replace view public.donor_wall as
  select coalesce(nullif(name, ''), 'Anonymous Mapler') as name, message, paid_at from public.donations
  where status = 'paid' and public and livemode order by paid_at desc limit 30;
grant select on public.donor_wall to anon, authenticated;

-- Admin overview of donations and sponsor slots (admins only through the tables' row security).
create or replace view public.sponsor_queue with (security_invoker = true) as
  select *, case when status = 'scheduled' and ends_at <= now() then 'expired'
                 when status = 'scheduled' and starts_at > now() then 'queued'
                 when status = 'scheduled' then 'live' else status end as display_status
  from public.sponsors;
grant select on public.sponsor_queue to authenticated;
