-- Paid FM Megaphones. Rows are created and changed only by the Edge Functions (service role) and admins.
create table if not exists public.megaphone_plans (
  id text primary key,
  label text not null,
  minutes integer not null check (minutes > 0),
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'usd',
  active boolean not null default true,
  sort integer not null default 0
);
insert into public.megaphone_plans (id, label, minutes, price_cents, sort) values
  ('m30', '30 minutes', 30, 199, 1), ('h2', '2 hours', 120, 399, 2), ('h6', '6 hours', 360, 599, 3)
on conflict (id) do update set label = excluded.label, minutes = excluded.minutes, price_cents = excluded.price_cents, sort = excluded.sort;
alter table public.megaphone_plans enable row level security;
drop policy if exists "anyone reads plans" on public.megaphone_plans;
create policy "anyone reads plans" on public.megaphone_plans for select using (active);

create table if not exists public.megaphones (
  id uuid primary key default gen_random_uuid(),
  buyer uuid not null references auth.users (id) on delete cascade,
  message text not null check (char_length(message) between 3 and 120),
  sender text not null default '' check (char_length(sender) <= 20),
  world text not null default '' check (char_length(world) <= 32),
  plan_id text not null references public.megaphone_plans (id),
  minutes integer not null,
  price_cents integer not null,
  currency text not null default 'usd',
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
create index if not exists megaphones_live on public.megaphones (status, starts_at, ends_at);
alter table public.megaphones enable row level security;
drop policy if exists "buyers see own megaphones" on public.megaphones;
create policy "buyers see own megaphones" on public.megaphones for select using (buyer = auth.uid() or public.is_admin());

-- What every visitor sees: only messages inside their paid window. Runs as the view owner, exposing no buyer data.
create or replace view public.live_megaphones as
  select id, message, sender, world, starts_at, ends_at from public.megaphones
  where status = 'scheduled' and starts_at <= now() and ends_at > now();
grant select on public.live_megaphones to anon, authenticated;
grant select on public.megaphone_plans to anon, authenticated;
grant select on public.megaphones to authenticated;

-- At most p_slots megaphones are live at once. A newly approved one starts at the earliest moment a slot is free,
-- so every buyer gets their full purchased time in rotation.
create or replace function public.megaphone_slot_start(p_minutes integer, p_slots integer default 8)
returns timestamptz language plpgsql stable set search_path = public as $$
declare t timestamptz;
begin
  for t in
    select x from (select now() as x union select ends_at from megaphones where status = 'scheduled' and ends_at > now()) c order by x
  loop
    if (select count(*) from megaphones m where m.status = 'scheduled'
          and m.starts_at < t + make_interval(mins => p_minutes) and m.ends_at > t) < p_slots then
      return t;
    end if;
  end loop;
  return now();
end $$;

-- Approve a paid megaphone (admin, or the payment webhook when auto-approval is on). Returns the scheduled window.
create or replace function public.approve_megaphone(p_id uuid, p_slots integer default 8)
returns public.megaphones language plpgsql security definer set search_path = public as $$
declare m megaphones; v_start timestamptz;
begin
  -- current_user is this function's owner here, so the caller's role is read from its JWT (the payment webhook uses the service role).
  if not (public.is_admin() or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role') then
    raise exception 'admins only' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('megaphone-schedule'));
  select * into m from megaphones where id = p_id for update;
  if m.id is null then raise exception 'not found'; end if;
  if m.status <> 'paid_pending_review' then raise exception 'megaphone is %', m.status; end if;
  v_start := megaphone_slot_start(m.minutes, p_slots);
  update megaphones set status = 'scheduled', reviewed_at = now(), reviewed_by = auth.uid(),
    starts_at = v_start, ends_at = v_start + make_interval(mins => m.minutes)
  where id = p_id returning * into m;
  return m;
end $$;
revoke all on function public.approve_megaphone(uuid, integer) from public;
grant execute on function public.approve_megaphone(uuid, integer) to authenticated, service_role;

-- Live rotation for an admin's moderation view, and expired history.
create or replace view public.megaphone_queue with (security_invoker = true) as
  select *, case when status = 'scheduled' and ends_at <= now() then 'expired'
                 when status = 'scheduled' and starts_at > now() then 'queued'
                 when status = 'scheduled' then 'live' else status end as display_status
  from public.megaphones;
grant select on public.megaphone_queue to authenticated;
