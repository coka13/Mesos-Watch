# Local setup and controlled release

Status: source changes are local only. Do not treat historical checkmarks or catalog SQL seed files as proof of production setup. There are sixteen numbered migrations (00000–01500); the original eight are preserved unchanged.

## Production state (read-only audit, 2026-11-02)

Checked through the public API with the anon key (no private access was available: `SUPABASE_DB_URL` in `.env.local` is empty).

- Applied: migrations 00000–00700. Not applied: 00800–01500 and 20261102000100 (`player_stores`, `watchlist`, `market_observations` and the other new tables do not exist yet). `megaphone_plans` already holds the three packages ($1.99/30 min, $3.99/2 h, $5.99/6 h).
- `items`: 3,444 rows (equip 1,192 · use 345 · setup 231 · etc 253 · NX 1,423), all kept.
- `observations`: 5 rows, all incorrect (see Cleanup). `megaphones`: 0 rows.

## Deployment order

1. Put the Session pooler connection string in `.env.local` as `SUPABASE_DB_URL` (never commit it).
2. Back up: `node scripts/phase1-audit.mjs` writes a read-only JSON snapshot of every table to `../phase1-private-backup`. Also take a Supabase dashboard backup.
3. Run the cleanup (below), then apply the missing migrations in filename order with `node scripts/run-sql.mjs supabase/migrations/<file>`, starting at 20261101000800 and ending with 20261102000100. Read item 4 under Prerequisites first: 00800 hides catalog items until their release status is reviewed.
4. Redeploy the `megaphone-checkout` function (it now accepts an optional `item_id`) after 20261102000100 is applied.
5. Publish `dist/`.

## Prerequisites before production changes

1. Finish the Phase 1 production inventory and full backup, including protected users, catalog, legitimate sales, campaign/payment records, Storage binaries and service configuration. Verify restoration in an isolated project. The source ZIP/Git bundle are not database backups.
2. Determine applied migration versions from the actual database. Do not rerun historical SQL files or old catalog/NX seed scripts blindly: earlier import migrations contain destructive synchronization logic that the new preservation migration replaces.
3. Restore a private staging copy, disable outgoing notifications/schedules and Stripe live mode, and apply only missing migrations in order using the provider migration workflow. Test there before a controlled production release.
4. Review the release-status transition: migration 008 preserves all existing rows/flags but sets release_status to unverified by default. Search visibility requires both verified=true and an explicit released/available/discontinued status. Review existing verified catalog records and attach real verification sources before expecting them in public search. Do not bulk mark an unverified catalog as released.
5. Keep new client assets and migrations compatible: the new scanner writes confidence/capture_source, community pages require their new tables/RPCs, and home recent data uses market_observations. Deploy the matching schema before the new frontend, after staged validation.

## Database changes

- 008: preservation-first catalog apply, source approval gate, release status and verification metadata.
- 009: reported/verified/rejected observations; admin evidence review and verified-sale valuation.
- 010: registered owner-managed stores/listings, public sanitized views, 24-hour expiry and recent comparable asking-price spreads.
- 011: owner-private watchlists, threshold-crossing alert events, rate-limited reports and admin report review.
- 012: requested Basic/Premium/Featured packages, verified-payment approval prerequisites and retirement of unpaid code-based test ads. Existing plans and campaign records remain.
- 013: rejected observations withheld from market aggregates/listings without deletion.
- 014–015: structured Cash Shop candidates and admin acceptance with ID/source checks; NX currency remains separate.

No migration deletes the catalog, users, legitimate sales, payments or existing reports. Review newly added restrictive foreign keys before any future account deletion. All migrations here remain unapplied externally.

## Private configuration

Frontend config.js may contain only the Supabase project URL, public anon key, optional worlds, public icon source and support links. Never put service credentials, Stripe secrets or Discord webhook URLs in published assets.

Provider secrets for payment functions: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY (test key), STRIPE_WEBHOOK_SECRET and SITE_ORIGINS. Optional MEGAPHONE_AUTO_APPROVE=false and MEGAPHONE_SLOTS=8. STRIPE_ALLOW_LIVE must remain unset/false until a separate production payment release is authorized and tested.

Enable anonymous contributor sign-in and email OTP accounts. Configure exact localhost/staging/production auth redirect URLs. Set admins explicitly in public.admins through an authorized provider interface. Store/watchlist/report writes require an email account; anonymous scanner contributors cannot publish public stores.

Deploy the existing megaphone-checkout, megaphone-admin and stripe-webhook functions through the provider workflow only after staging checks. The Stripe webhook endpoint needs signature verification in the function and the provider's supported unauthenticated-webhook configuration. Subscribe to checkout completion/asynchronous success/expiration and full refund events. Test signed webhook retries, failed database writes and refunds in sandbox. These were not exercised against Stripe in this run.

## Catalog source approval

Do not scrape NiaDB. Its current reuse policy requires permission for whole catalogs and crawling: https://meowdb.com/reuse . OSMS licensing and Classic/NX completeness still require independent confirmation; attribution in old documentation is not proof of permission.

After recording actual source permission and scope, an authorized operator can set site_settings key catalog_source_approved to true in the approved environment. The import CLI also requires CATALOG_SOURCE_APPROVED=true before even downloading. Scheduled requests and apply are gated. New imported names remain candidates for admin release review, not automatically verified releases. Do not run old generated catalog.sql/nx-items SQL artifacts as a shortcut.

## Cleanup

`supabase/cleanup/20261102_incorrect_listings.sql` removes exactly the 5 audited listings (ids 1–5, read from the owner's own store window by an earlier reader version; their prices don't match the store). It copies them to `cleanup_archive.observations_20261102` first, aborts without changes if the rows differ from the audit, and touches nothing else. Market figures are computed from `observations` on each request, so they reset with it; there is no stored aggregate or browser cache to clear. Item pages then show "No market data available yet" until new scans arrive.

```powershell
node scripts/run-sql.mjs supabase/cleanup/20261102_incorrect_listings.sql
```

To stop the same mistake recurring, the scanner no longer submits a shop window that shows the owner's controls (Sold Items / Open Store / Close Store). `scripts/preview-cleanup.mjs` remains for previewing other explicit ID selections.

## Rollback

For local recovery use the checkpoint branches and Git bundle in the delivery report, in a new directory. Restore source privately; avoid reset --hard on any active checkout. No external rollback is needed for this run.

For a later database rollout, take provider snapshots and schema-only exports of replaced functions/views before applying migrations; validate the reverse definitions against the staging restore. New tables/columns should be retained during an application rollback to preserve newly collected data. Disable writers/cron first and prefer a forward compatibility fix. A schema rollback that drops new data is not supplied or authorized. No production restore or database down-migration has been tested; do not claim the new schema is restore-verified.
