# Mesos-Watch setup

The website is the static `dist/` folder. Everything shared (prices, items, megaphones) lives in Supabase. Steps marked ✅ were already done for project `nnfnlqgdzfcxtrnjpyzn` as of 2026-11-01.

## 1. Database ✅

Both files in `supabase/migrations/` have been run. To set up a new project, paste them into Supabase → SQL Editor in filename order and run each.

## 2. Anonymous sign-ins ✅

Authentication → Sign In / Providers → **Allow anonymous sign-ins** is on. Visitors get an anonymous ID when they share prices. Nobody is asked to log in.

## 3. Import the item catalog (needed for icons, stats and name matching)

Run this once from the project folder, in PowerShell. The service role key is under Project Settings → API. It bypasses every security rule, so keep it out of `config.js`, chat messages and git.

```powershell
$env:SUPABASE_URL = 'https://nnfnlqgdzfcxtrnjpyzn.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = '<service role key>'
npm run import-catalog
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
```

This makes one request to the [OSMS Data Explorer](https://osmsdataexplorer.com) dataset and upserts about 2,100 MapleStory Classic World items (untradeable and quest items are left out). The data is CC BY 4.0; item pages show the credit. Re-run it after a game patch to add new items. Re-running it is safe.

No service role key at hand? `node supabase/import-catalog.mjs --sql catalog.sql` writes the same import as SQL. Paste it into the SQL Editor and run it. It also removes leftover items from the old GMS v83 catalog that no prices refer to.

- **NX items:** the dataset has no NX (cash) items, and no public MapleStory Classic NX list exists. NX items therefore come from the shops themselves: a name the scanner reads that isn't in the catalog becomes a community item, and its picture is cropped from the shop. It shows in search once two players have seen it. In Settings → Admin, confirm it with type **NX** (the default) or fix a misread name.
- **meowdb.com:** don't import from it. Its reuse policy requires written permission first (contact@meowdb.com, four-line email described at meowdb.com/reuse).

### Automatic updates after game patches

Run `supabase/migrations/20261101000300_catalog_autosync.sql` once in the SQL Editor. It turns on Supabase's `pg_net` and `pg_cron` extensions and schedules two jobs:

- **Daily download (06:17 UTC):** fetches the item list.
- **Apply job (every 5 minutes):** applies a download that changed, using the same rules as `import-catalog.mjs`.

Unchanged lists are skipped. A download that fails or looks truncated is logged and never applied, so the catalog can't be wiped. Settings → Admin shows the last runs and has an **Update now** button.

To check the schedule, run `select jobname, schedule from cron.job;`. Both jobs should be listed.

## 4. Logo ✅

`dist/logo.png` is the header logo (transparent background, 256 px tall). `dist/icon-32.png` is the browser tab icon and `dist/icon-180.png` the home-screen icon. To change them, replace the files and keep the names.

## 5. Admin account (moderating megaphones, verifying items)

1. Authentication → Users → **Add user** with your email. Copy the user's UID.
2. In the SQL Editor, run `insert into public.admins values ('<UID>');`.
3. Authentication → URL Configuration: add your site URL, and `http://127.0.0.1:8080` for local use, to the redirect URLs.
4. On the site, go to Settings → Admin, enter the email and open the sign-in link it sends.

## 6. Paid megaphones (Stripe, test mode first)

These need the Supabase CLI (`npm i -g supabase`) and a Stripe account in **test mode**.

```powershell
supabase login
supabase link --project-ref nnfnlqgdzfcxtrnjpyzn
supabase secrets set STRIPE_SECRET_KEY=sk_test_... SITE_ORIGINS=https://your-site.example,http://127.0.0.1:8080
supabase functions deploy megaphone-checkout
supabase functions deploy megaphone-admin
supabase functions deploy stripe-webhook --no-verify-jwt
```

Then add the webhook in Stripe:

1. In Stripe, go to Developers → Webhooks → **Add endpoint**: `https://nnfnlqgdzfcxtrnjpyzn.supabase.co/functions/v1/stripe-webhook`.
2. Select the events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired` and `charge.refunded`.
3. Copy the signing secret and run `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...`.

Optional secrets:

- `MEGAPHONE_AUTO_APPROVE=true`: messages that pass the automatic checks go live right after payment, without review.
- `MEGAPHONE_SLOTS=8`: how many megaphones can be live at once. The Megaphones page says 8, so change that text too if you change this.
- `STRIPE_ALLOW_LIVE=true`: required before a live `sk_live_` key is accepted. Until then the functions refuse live keys, so real money can't be taken by accident.

Prices are set in the `megaphone_plans` table: $1 for 1 h, $2 for 2.5 h, $4 for 6 h, $7 for 12 h and $12 for 24 h. To change them, update that table. The Megaphones page reads it, but the "How it works" text in `dist/index.html` lists the prices too.

## 7. Worlds (optional)

To keep separate prices per game world, list the worlds in `dist/config.js`, for example `worlds: ['Bera', 'Scania']`. The world picker then appears in the header.

## Run and test locally

- Serve `dist/` over localhost, for example `node ../serve-mesos.cjs`. It must send `.mjs` files as `text/javascript`.
- `npm install` once, then `npm test`. It runs the screen-reading checks (including real OCR output from a store screenshot) and the database tests in PGlite.
