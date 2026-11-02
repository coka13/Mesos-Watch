-- Removes the incorrect Free Market listings recorded before the reader fixes, and nothing else.
-- Audit (2026-11-02, read-only via the public API): public.observations held exactly 5 rows, ids 1-5, all 'ask' rows from one
-- reporter on 2026-11-01 15:16-15:19 UTC, read from the player's own store window. Their prices do not match the store
-- screenshot (e.g. Tiger Mask recorded 23,679, shown 19,679) and one name was misread ("Black Coat of Death").
--
-- Reversible: every removed row is first copied to cleanup_archive (not exposed through the API). Undo with
-- 20261102_incorrect_listings_rollback.sql. Items, icons, users, megaphones, payments, player stores and settings are untouched.
-- Market figures (lowest, median, trends, history) are computed from observations on every request, so they reset with it;
-- there are no stored aggregates or caches to clear.
--
-- Run:  node scripts/run-sql.mjs supabase/cleanup/20261102_incorrect_listings.sql
-- It aborts without changing anything if the rows differ from the audit (new data, different ids or prices).
begin;
create schema if not exists cleanup_archive;
revoke all on schema cleanup_archive from public;
do $$ begin
  if to_regclass('cleanup_archive.observations_20261102') is not null then
    raise exception 'cleanup already ran (cleanup_archive.observations_20261102 exists); nothing changed';
  end if;
end $$;
create table cleanup_archive.observations_20261102 as
  select * from public.observations
  where id in (1, 2, 3, 4, 5) and kind = 'ask' and seen_at < '2026-11-02T00:00:00Z';

do $$
declare n int; expected text; got text;
begin
  select count(*) into n from cleanup_archive.observations_20261102;
  if n <> 5 then raise exception 'expected the 5 audited listings, found %; nothing changed', n; end if;
  expected := '1:13086:19679|2:11827:23679|3:13083:20679|4:13104:19679|5:12244:20679';
  select string_agg(id || ':' || item_id || ':' || price, '|' order by id) into got from cleanup_archive.observations_20261102;
  if got <> expected then raise exception 'listings differ from the audit (%); nothing changed', got; end if;
  -- Reports and alert history must survive. Reports block deletion (on delete restrict): stop rather than drop them.
  if to_regclass('public.market_reports') is not null then
    execute 'select count(*) from public.market_reports where observation_id in (1,2,3,4,5)' into n;
    if n > 0 then raise exception '% report(s) reference these listings; resolve them in admin review first. Nothing changed.', n; end if;
  end if;
end $$;

-- Review decisions about these rows (only present once migration 20261101000900 is applied): archive, then remove.
do $$ begin
  if to_regclass('public.observation_reviews') is not null then
    execute 'create table cleanup_archive.observation_reviews_20261102 as select * from public.observation_reviews where observation_id in (select id from cleanup_archive.observations_20261102)';
    execute 'delete from public.observation_reviews where observation_id in (select id from cleanup_archive.observations_20261102)';
  end if;
end $$;

-- player_listings.observation_id and price_alert_events.observation_id are "on delete set null": those rows are kept.
delete from public.observations where id in (select id from cleanup_archive.observations_20261102);
revoke all on all tables in schema cleanup_archive from public;
commit;
