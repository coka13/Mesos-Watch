-- Undoes 20261105_duplicate_listings.sql: restores the 6 duplicate listings with their original ids and the originals'
-- previous counters, then drops the archive.
--   node scripts/run-sql.mjs supabase/cleanup/20261105_duplicate_listings_rollback.sql
begin;
do $$ begin
  if to_regclass('cleanup_archive.observations_20261105_duplicates') is null then
    raise exception 'nothing to roll back (cleanup_archive.observations_20261105_duplicates does not exist)';
  end if;
end $$;
-- Restored as archived: the insert triggers would refuse or merge them, so they are switched off for this statement only.
alter table public.observations disable trigger user;
insert into public.observations overriding system value select * from cleanup_archive.observations_20261105_duplicates;
alter table public.observations enable trigger user;
update public.observations o set seen_count = a.seen_count, last_seen_at = a.last_seen_at
  from cleanup_archive.observations_20261105_originals a where o.id = a.id;
drop table cleanup_archive.observations_20261105_duplicates;
drop table cleanup_archive.observations_20261105_originals;
drop table cleanup_archive.observations_20261105_pairs;
commit;
