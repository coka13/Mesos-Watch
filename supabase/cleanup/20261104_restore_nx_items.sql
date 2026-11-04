-- Puts back the NX items removed by 20261104_unreleased_items.sql. on_sale=false in the cash shop data does not mean an
-- item is missing from Classic: Mystery Fashion Crates (regular, Founder's, Halloween) hand out NX items that are not sold
-- directly. The 15-minute EXP coupons stay removed; 20261104_unreleased_items_rollback.sql still restores them.
-- Run:  node scripts/run-sql.mjs supabase/cleanup/20261104_restore_nx_items.sql
begin;
insert into public.items
  (id, game_id, name, category, subcategory, base_stats, icon_path, icon_hash, source, source_url, verified, first_seen,
   release_status, last_verified_at, verification_source) overriding system value
  select id, game_id, name, category, subcategory, base_stats, icon_path, icon_hash, source, source_url, verified, first_seen,
         release_status, last_verified_at, verification_source
  from cleanup_archive.items_20261104_unreleased
  where category = 'cash' and id not in (select id from public.items);
delete from cleanup_archive.items_20261104_unreleased where category = 'cash';
commit;
