-- Undo 20261102_incorrect_listings.sql: puts the archived listings (and any archived review decisions) back with their ids.
-- Run:  node scripts/run-sql.mjs supabase/cleanup/20261102_incorrect_listings_rollback.sql
begin;
-- The insert trigger stamps the current user and time; restoring must keep the original reporter and seen_at.
alter table public.observations disable trigger observations_guard;
insert into public.observations overriding system value
  select * from cleanup_archive.observations_20261102
  where id not in (select id from public.observations);
alter table public.observations enable trigger observations_guard;
do $$ begin
  if to_regclass('cleanup_archive.observation_reviews_20261102') is not null and to_regclass('public.observation_reviews') is not null then
    execute 'insert into public.observation_reviews overriding system value select * from cleanup_archive.observation_reviews_20261102';
  end if;
end $$;
drop table cleanup_archive.observations_20261102;
drop table if exists cleanup_archive.observation_reviews_20261102;
commit;
