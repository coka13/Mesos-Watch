-- Retire old packages without deleting referenced plans or campaigns.
update megaphone_plans set active=false;
insert into megaphone_plans(id,label,minutes,price_cents,sort,active)values('basic30','Basic · 30 minutes',30,199,1,true),('premium120','Premium · 2 hours',120,399,2,true),('featured360','Featured · 6 hours',360,599,3,true)
 on conflict(id)do update set label=excluded.label,minutes=excluded.minutes,price_cents=excluded.price_cents,sort=excluded.sort,active=true;
-- Free code-based test ads are retired. Use Stripe sandbox checkout instead.
create or replace function public.post_test_megaphone(p_code text,p_message text,p_sender text default '',p_world text default '',p_plan text default null) returns public.megaphones language plpgsql security definer set search_path=public as $$begin raise exception 'Disabled: use verified Stripe sandbox checkout';end $$;
create or replace view public.live_megaphones as select id,message,sender,world,starts_at,ends_at from megaphones where status='scheduled' and starts_at<=now()and ends_at>now()and not test;
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
  if m.paid_at is null or m.checkout_session is null or m.payment_intent is null or m.price_cents<=0 or m.test then raise exception 'Verified payment required'; end if;
  if p_slots<1 or p_slots>100 then raise exception 'Slots must be between 1 and 100';end if;
  v_start := megaphone_slot_start(m.minutes, p_slots);
  update megaphones set status = 'scheduled', reviewed_at = now(), reviewed_by = auth.uid(),
    starts_at = v_start, ends_at = v_start + make_interval(mins => m.minutes)
  where id = p_id returning * into m;
  return m;
end $$;
revoke all on function public.approve_megaphone(uuid, integer) from public;
grant execute on function public.approve_megaphone(uuid, integer) to authenticated, service_role;
