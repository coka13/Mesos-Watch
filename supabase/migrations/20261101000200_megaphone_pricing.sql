-- Megaphone pricing: $1 per hour, cheaper per hour the longer you buy. The first plans are retired, not deleted
-- (past megaphones reference them); checkout only offers active plans.
update public.megaphone_plans set active = false where id in ('m30', 'h2', 'h6');
insert into public.megaphone_plans (id, label, minutes, price_cents, sort, active) values
  ('p60', '1 hour', 60, 100, 1, true),
  ('p150', '2.5 hours', 150, 200, 2, true),
  ('p360', '6 hours', 360, 400, 3, true),
  ('p720', '12 hours', 720, 700, 4, true),
  ('p1440', '24 hours', 1440, 1200, 5, true)
on conflict (id) do update set label = excluded.label, minutes = excluded.minutes, price_cents = excluded.price_cents, sort = excluded.sort, active = true;
