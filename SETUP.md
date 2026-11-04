# Local setup and controlled release

Status: source changes are local only. Do not treat historical checkmarks or catalog SQL seed files as proof of production setup. There are sixteen numbered migrations (00000–01500); the original eight are preserved unchanged.

## Production state (applied 2026-11-03)

The 2026-11-02 audit (anon key only) was wrong: production actually had only 00000 and 00100. On 2026-11-03, with `SUPABASE_DB_URL` set:

- Backup snapshot written to `../phase1-private-backup` first; the cleanup removed the 5 incorrect observations (archived in `cleanup_archive`).
- Every migration through 20261102090000 is now applied. 00200–00800, 01200, 01300 and 20261102000100 were applied in one transaction. **00300's pg_cron/pg_net scheduling block was left out on purpose**, so no unattended OSMS download is scheduled (and pg_cron/pg_net stay disabled). The catalog functions exist but stay gated behind `catalog_source_approved`.
- The 3,444 items that were already `verified` were set to `release_status='available'` (`verification_source` notes this) so search looks the same as before 00800. New imports still need review.
- Active megaphone plans are now basic30/premium120/featured360 ($1.99/$3.99/$5.99). Sponsor plans are s7 ($15) and s30 ($45).
- Still to do: deploy the edge functions (step 4 and Payments below) and publish `dist/`.

## Market parity, price sources and NiaDB (applied 2026-11-05)

Applied to production with `run-sql.mjs`: migration `20261104000300_market_parity.sql`, then `supabase/cleanup/20261105_duplicate_listings.sql`. Both are backward compatible with the previously published `dist/`. Publish the new `dist/` to show the new figures; until then the old site keeps working.

- **One listing, one row.** Shop titles are OCR and vary between reads, so a repeat of the same listing (same place, item, price, quantity and stats within 6 hours, from a shop whose title is the same, unread, or similar by trigram ≥ 0.3) now updates `last_seen_at`, `seen_count` and `confirmed_by` on the original instead of adding a row. Sold sightings use the same shop match. The cleanup folded the 6 duplicates already in production (ids 7, 19–22, 24) into their originals; undo with `20261105_duplicate_listings_rollback.sql`.
- **Statistics** (`item_summary`, `price_history`, new `market_index`) count distinct listings and use `percentile_disc`, so every median and middle-half bound is a price that was actually observed.
- **Three kinds of price, never mixed:** asking (FM Scanner listings), seen sold (listed price on a greyed-out row) and confirmed sales (admin-reviewed). Every figure on the site shows its source name, data type and time. Below 3 distinct listings (4 for a middle-half range, 3 seen-sold rows, 3 sales from 2 sellers) the site shows "Insufficient data" instead of a figure. Thresholds live in `dist/price-source.mjs`.
- **NiaDB reference prices** (`reference_prices`) are a separate baseline, shown in the item page's Base item panel and never used in market statistics. NiaDB's reuse policy (https://meowdb.com/reuse) allows individual facts with a link to the specific page, but crawling, its API, its data files and bulk republishing need written permission (email contact@meowdb.com, subject "Permission request: Mesos-Watch"). So:
  - Admins add single figures on an item page (Base item → "Add a reference price from NiaDB"). The NiaDB item-page URL, NiaDB's date and the price type are required; the database rejects other sites and homepage links.
  - Bulk import only from a file NiaDB has permitted: `node scripts/import-reference-prices.mjs --file prices.json --permission "<who granted it, how, when>" [--dry-run]`. It never downloads anything, and it checks every row before writing.
  - No NiaDB data has been imported. Nothing on the site fetches from NiaDB.

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

No migration deletes the catalog, users, legitimate sales, payments or existing reports. Review newly added restrictive foreign keys before any future account deletion.

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

## PayPal and crypto payments (megaphones, sponsor slots, donations)

Stripe doesn't accept Israeli accounts, so the site takes payments through **PayPal** and **crypto via NOWPayments**. The browser only starts a payment. Prices come from the database, and a payment counts only after the server confirms it with the provider: `paypal-capture` captures the order itself, and `nowpayments-ipn` checks the signature, invoice and amount. Megaphones and sponsor banners still need an admin's approval before they go live. Both providers start in **sandbox (test) mode**, so no real money moves until you switch them to live.

1. **Database:** run `supabase/migrations/20261102090000_paypal_crypto_payments.sql`. It adds sponsor slots ($15 for 7 days, $45 for 30 days; change them in `sponsor_plans`) and donations.
2. **PayPal:** at developer.paypal.com, open Apps & Credentials, stay on the Sandbox tab and create an app. Copy its Client ID and Secret.
3. **NOWPayments:** create an account at nowpayments.io (account.sandbox.nowpayments.io for testing). Add a payout wallet, then create an API key and an IPN secret key under Settings → Payments.
4. Set the secrets and deploy the functions:

```powershell
supabase secrets set PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... PAYPAL_ENV=sandbox
supabase secrets set NOWPAYMENTS_API_KEY=... NOWPAYMENTS_IPN_SECRET=... NOWPAYMENTS_ENV=sandbox
supabase functions deploy pay-create
supabase functions deploy paypal-capture
supabase functions deploy nowpayments-ipn --no-verify-jwt
supabase functions deploy megaphone-admin
```

`SITE_ORIGINS` (from the Stripe step) must list your site's address. That's where buyers return to after paying.

**Testing:** PayPal sandbox gives you a test buyer account (Sandbox → Accounts), so you can pay with fake money. NOWPayments sandbox invoices can be marked as paid from its dashboard. Test donations never appear on the public thank-you list.

**Going live:** create a Live app in PayPal and a live NOWPayments key, set them as secrets with `PAYPAL_ENV=live` and `NOWPAYMENTS_ENV=live`, and redeploy.

**Approving and refunding:** sponsor slots and donations appear in Settings → Admin under "Sponsors and donations". PayPal and crypto refunds are made in the PayPal or NOWPayments dashboard. Afterwards, mark the slot refunded on the site. Set `MEGAPHONE_AUTO_APPROVE=true` or `SPONSOR_AUTO_APPROVE=true` to skip the review step.

In `dist/config.js`, `payments.providers` controls which buttons appear, and `stripe: true` shows the Stripe button again.
