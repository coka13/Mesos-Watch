-- Folds 6 duplicate FM Scanner listings into the listings they repeat, and nothing else.
-- Audit (2026-11-05): one player's scanner published the same shop's rows twice because the shop title was read
-- differently each time ("LeoTsuwubasal", then "Clac e" or nothing), and a pre-location listing was published twice
-- (title "Interr Iy", then nothing). Same reporter, item, price, quantity, stats and place, minutes apart:
--   7 -> 6 (Sapphire Earrings 7,679)   19 -> 17 (Sky Sneak Pants 2,500)   20 -> 12 (Dark Master Sergeant 3,400)
--   21 -> 13 (Blue Jewelry Boots 2,000) 22 -> 14 (Blue Jewelry Boots 1,800) 24 -> 16 (Gold Earrings 4,000)
-- Each duplicate becomes one more sighting of its original (seen_count, last_seen_at), as migration 20261104000300 now
-- does on insert, and is removed. Requires that migration.
--
-- Reversible: duplicates and the originals' previous counters are copied to cleanup_archive first. Undo with
-- 20261105_duplicate_listings_rollback.sql.
--
-- Run:  node scripts/run-sql.mjs supabase/cleanup/20261105_duplicate_listings.sql
-- It aborts without changing anything if the rows differ from the audit or anything references them.
begin;
create schema if not exists cleanup_archive;
revoke all on schema cleanup_archive from public;
do $$ begin
  if to_regclass('cleanup_archive.observations_20261105_duplicates') is not null then
    raise exception 'cleanup already ran (cleanup_archive.observations_20261105_duplicates exists); nothing changed';
  end if;
end $$;
create table cleanup_archive.observations_20261105_pairs(dup bigint primary key, original bigint not null);
insert into cleanup_archive.observations_20261105_pairs values (7,6),(19,17),(20,12),(21,13),(22,14),(24,16);
create table cleanup_archive.observations_20261105_duplicates as
  select * from public.observations where id in (select dup from cleanup_archive.observations_20261105_pairs);
create table cleanup_archive.observations_20261105_originals as
  select id, seen_count, last_seen_at from public.observations where id in (select original from cleanup_archive.observations_20261105_pairs);

do $$
declare expected text; got text; n int;
begin
  expected := '6:Sapphire Earrings:7679:Interr Iy|7:Sapphire Earrings:7679:|12:Dark Master Sergeant:3400:LeoTsuwubasal|'
           || '13:Blue Jewelry Boots:2000:LeoTsuwubasal|14:Blue Jewelry Boots:1800:LeoTsuwubasal|16:Gold Earrings:4000:LeoTsuwubasal|'
           || '17:Sky Sneak Pants:2500:LeoTsuwubasal|19:Sky Sneak Pants:2500:|20:Dark Master Sergeant:3400:Clac e|'
           || '21:Blue Jewelry Boots:2000:Clac e|22:Blue Jewelry Boots:1800:Clac e|24:Gold Earrings:4000:Clac e';
  select string_agg(id || ':' || item_name || ':' || price || ':' || shop_title, '|' order by id) into got
    from public.observations where id in (select dup from cleanup_archive.observations_20261105_pairs union select original from cleanup_archive.observations_20261105_pairs);
  if got is distinct from expected then raise exception 'rows differ from the audit (%); nothing changed', got; end if;
  -- Each pair: same reporter, kind, world, item, price, quantity, stats and place; neither sold, rejected or reviewed.
  select count(*) into n from cleanup_archive.observations_20261105_pairs p
    join public.observations d on d.id = p.dup join public.observations o on o.id = p.original
   where d.reporter = o.reporter and d.kind = 'ask' and o.kind = 'ask' and d.world = o.world and d.item_id = o.item_id
     and d.price = o.price and d.qty = o.qty and d.stats = o.stats and d.channel is not distinct from o.channel and d.map = o.map
     and d.sold_at is null and o.sold_at is null and d.verification_status = 'reported' and o.verification_status = 'reported'
     and d.seen_at > o.seen_at and d.seen_at < o.seen_at + interval '6 hours';
  if n <> 6 then raise exception 'only % of 6 pairs are exact repeats; nothing changed', n; end if;
  select count(*) into n from public.observation_reviews where observation_id in (select dup from cleanup_archive.observations_20261105_pairs);
  if n <> 0 then raise exception 'duplicates have % evidence review(s); nothing changed', n; end if;
end $$;

update public.observations o set seen_count = o.seen_count + d.seen_count, last_seen_at = greatest(o.last_seen_at, d.last_seen_at)
  from cleanup_archive.observations_20261105_pairs p join cleanup_archive.observations_20261105_duplicates d on d.id = p.dup
 where o.id = p.original;
delete from public.observations where id in (select dup from cleanup_archive.observations_20261105_pairs);
commit;
