-- Test megaphones without a payment provider. Whoever knows the test code (set by the site owner, empty = off) can post a
-- free megaphone that goes live at once for 10 minutes, marked as a test. Paid megaphones are unchanged.
--   Turn on:  insert into site_settings values ('megaphone_test_code', 'pick-a-secret') on conflict (key) do update set value = excluded.value;
--   Turn off: delete from site_settings where key = 'megaphone_test_code';
create table if not exists public.site_settings (key text primary key, value text not null default '');
alter table public.site_settings enable row level security;  -- no policies: only the owner (SQL Editor) and security-definer functions read it

alter table public.megaphones add column if not exists test boolean not null default false;

create or replace function public.post_test_megaphone(p_code text, p_message text, p_sender text default '', p_world text default '', p_plan text default null)
returns public.megaphones language plpgsql security definer set search_path = public as $$
declare v_code text; m megaphones; v_start timestamptz; v_plan text;
begin
  if auth.uid() is null then raise exception 'sign-in required' using errcode = '42501'; end if;
  select value into v_code from site_settings where key = 'megaphone_test_code';
  if coalesce(v_code, '') = '' then raise exception 'Test megaphones are turned off.' using errcode = '42501'; end if;
  if p_code is distinct from v_code then raise exception 'Wrong test code.' using errcode = '42501'; end if;
  if (select count(*) from megaphones where buyer = auth.uid() and test and created_at > now() - interval '1 hour') >= 3 then
    raise exception 'At most 3 test megaphones an hour.' using errcode = 'P0001';
  end if;
  select id into v_plan from megaphone_plans where id = p_plan and active;
  if v_plan is null then select id into v_plan from megaphone_plans where active order by sort limit 1; end if;
  perform pg_advisory_xact_lock(hashtext('megaphone-schedule'));
  v_start := megaphone_slot_start(10);
  insert into megaphones (buyer, message, sender, world, plan_id, minutes, price_cents, status, test, livemode, paid_at, reviewed_at, reviewed_by, starts_at, ends_at)
  values (auth.uid(), btrim(p_message), btrim(coalesce(p_sender, '')), left(coalesce(p_world, ''), 32), v_plan, 10, 0, 'scheduled', true, false, now(), now(), auth.uid(),
          v_start, v_start + interval '10 minutes')
  returning * into m;
  return m;
end $$;
revoke all on function public.post_test_megaphone(text, text, text, text, text) from public, anon;
grant execute on function public.post_test_megaphone(text, text, text, text, text) to authenticated;

-- The moderation and "my megaphones" view gains the test flag. Its column order changes, so it is rebuilt.
drop view if exists public.megaphone_queue;
create view public.megaphone_queue with (security_invoker = true) as
  select *, case when status = 'scheduled' and ends_at <= now() then 'expired'
                 when status = 'scheduled' and starts_at > now() then 'queued'
                 when status = 'scheduled' then 'live' else status end as display_status
  from public.megaphones;
grant select on public.megaphone_queue to authenticated;
