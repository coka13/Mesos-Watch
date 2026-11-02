# Mesos-Watch — local platform continuation

The existing static HTML/CSS/JavaScript application is preserved. This checkout extends it with reviewed market evidence, player stores, a trading calculator, watchlists, in-app alerts, market reports, Cash Shop candidate review, and payment reliability improvements.

**Local implementation only. Nothing in this checkout has been deployed or applied to production.** The production backup, invalid-listing selection, original screenshot acceptance, complete verified Classic/NX catalog and external service acceptance are still blocked. See LOCAL-RELEASE.md and SETUP.md before applying any changes.

## Run locally

- `npm ci` installs the locked development dependencies.
- `npm test` runs legacy OCR/SQL regressions and current-platform integration tests.
- `npm run verify` checks syntax, referenced assets, duplicate HTML IDs and common secret patterns.
- `npm run preview` serves localhost port 8187. This preview intentionally overrides config.js with an empty configuration so it cannot connect to production data or payments. A PORT environment variable can select another port.

The deployed assets would be `dist/`. No build step is required. Supabase supplies PostgreSQL, auth, Storage, Realtime and Deno payment functions. Do not replace the external database with a new service merely to preview the UI.

## Data distinctions

- Scanner observations are asking prices, never guaranteed available inventory.
- My Store (Sold Items layout): a sale is verified only when a new Sold Items record (read the same by two OCR passes), a mesos increase equal to the sale price less the 3% store fee, and either the player's listed price or the buyer seen entering in shop chat all agree. Balance changes without a record are listed as "not a sale"; partial evidence is listed as uncertain. Only verified sales reach Discord. The starting balance is fixed for the session.
- My Store OCR agreement is corroboration only. Submitted sale reports remain unverified until an admin reviews supporting evidence. Only reviewed sales enter sale valuation/history.
- Public player listings are user-published and expire after 24 hours unless updated. Observation-assisted entries are explicitly labelled; assistance does not verify seller ownership or inventory.
- Catalog imports preserve existing identities and records. New candidates require Classic release review with a source and timestamp. Legacy verified flags alone do not prove release availability.
- NX prices in captured candidates are a separate currency from mesos observations.
- Price alerts are in-app, checked while the Alerts page is open; no unattended notification service is configured.

## Capture and integrations

Browser screen sharing always uses a user-initiated picker. Auto Select processes a shared frame locally to find regions; ongoing My Store OCR reads selected sold-item/total information, balance and optional chat. Full-frame region localization is not a guarantee that unrelated pixels are never locally processed. Chat selection is still a manual fallback. Original screenshot/live acceptance remains necessary.

Guided Cash Shop capture reads one manually selected card at a time and displays raw OCR locally for correction. Only reviewed structured fields are submitted; neither full frames nor raw OCR are uploaded. Candidate acceptance requires an admin, a verified game ID and a release-source URL. Missing icons need permitted assets; no fake item-specific icon is claimed.

Discord webhooks stay in page memory. Explicit 429 rejections can retry; uncertain sends never automatically retry. Payment code stays in sandbox by default, verifies webhook signatures and payment amounts, surfaces database failures, and prevents duplicate activation. No actual message or checkout was created in this run.
