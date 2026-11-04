-- Undo 20261104_gm_test_items.sql: puts the archived items back with their ids (name_key is generated, so it is left out).
-- Run:  node scripts/run-sql.mjs supabase/cleanup/20261104_gm_test_items_rollback.sql
begin;
insert into public.items
  (id, game_id, name, category, subcategory, base_stats, icon_path, icon_hash, source, source_url, verified, first_seen,
   release_status, last_verified_at, verification_source) overriding system value
  select id, game_id, name, category, subcategory, base_stats, icon_path, icon_hash, source, source_url, verified, first_seen,
         release_status, last_verified_at, verification_source
  from cleanup_archive.items_20261104
  where id not in (select id from public.items);
drop table cleanup_archive.items_20261104;
commit;
