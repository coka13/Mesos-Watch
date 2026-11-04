-- Removes the 11 GM-only and test items from the catalog, and nothing else.
-- Audit (2026-11-04): all 3,444 items match the MapleStory Classic World dataset (OSMS Data Explorer items.json and
-- cash_shop.json) by game id and name. These 11 are in the game files but players cannot obtain them (GM tools and
-- test entries). No observations, icon votes, player listings, watchlist entries or megaphones reference them.
-- NX items marked on_sale=false were kept on purpose: they may have been sold in an earlier rotation and still trade.
--
-- Reversible: the rows are first copied to cleanup_archive (not exposed through the API). Undo with
-- 20261104_gm_test_items_rollback.sql.
--
-- Run:  node scripts/run-sql.mjs supabase/cleanup/20261104_gm_test_items.sql
-- It aborts without changing anything if the rows differ from the audit or anything references them.
begin;
create schema if not exists cleanup_archive;
revoke all on schema cleanup_archive from public;
do $$ begin
  if to_regclass('cleanup_archive.items_20261104') is not null then
    raise exception 'cleanup already ran (cleanup_archive.items_20261104 exists); nothing changed';
  end if;
end $$;
create table cleanup_archive.items_20261104 as
  select * from public.items
  where game_id in (1007669, 2023000, 2023001, 2100001, 2100002, 2100003, 2100004, 2100005, 2100006, 2190002, 3040000);

do $$
declare n int; expected text; got text;
begin
  expected := '12432:1007669|4962:2023000|4963:2023001|5205:2100001|5206:2100002|5207:2100003|5208:2100004|5209:2100005|5210:2100006|5213:2190002|5380:3040000';
  select string_agg(id || ':' || game_id, '|' order by game_id) into got from cleanup_archive.items_20261104;
  if got is distinct from expected then raise exception 'items differ from the audit (%); nothing changed', got; end if;
  select (select count(*) from public.observations where item_id in (select id from cleanup_archive.items_20261104))
       + (select count(*) from public.icon_votes where item_id in (select id from cleanup_archive.items_20261104))
       + (select count(*) from public.player_listings where item_id in (select id from cleanup_archive.items_20261104))
       + (select count(*) from public.watchlist where item_id in (select id from cleanup_archive.items_20261104))
       + (select count(*) from public.megaphones where item_id in (select id from cleanup_archive.items_20261104))
    into n;
  if n > 0 then raise exception '% row(s) now reference these items; nothing changed', n; end if;
end $$;

delete from public.items where id in (select id from cleanup_archive.items_20261104);
revoke all on all tables in schema cleanup_archive from public;
commit;
