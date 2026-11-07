# Mesos-Watch — local platform continuation

The existing static HTML/CSS/JavaScript application is preserved. This checkout extends it with reviewed market evidence, player stores, a trading calculator, in-app price alerts, market reports, Cash Shop candidate review, payment reliability improvements, and the Companion: live EXP, map and quest tracking read in the browser. [PARITY.md](PARITY.md) lists what is done, how it was validated and what is blocked.

**Local implementation only. Nothing in this checkout has been deployed or applied to production.** The production backup, invalid-listing selection, original screenshot acceptance, complete verified Classic/NX catalog and external service acceptance are still blocked. See LOCAL-RELEASE.md and SETUP.md before applying any changes.

## Run locally

- `npm ci` installs the locked development dependencies.
- `npm test` runs legacy OCR/SQL regressions and current-platform integration tests.
- `npm run test:e2e` runs the real pages in installed Chrome and Edge: the Companion and FM Scanner on real game captures with real in-browser OCR, and the market against all migrations in PGlite. Slow (about ten minutes) and needs a network for the OCR engine.
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
- Price alerts are in-app, checked every minute while the site is open in a tab, against open listings seen in the last hour; no unattended notification service is configured.
- A listing is for sale, seen sold, or gone. Gone is inferred from a scan of a shop short enough to be seen whole: never a sale, reversed if the listing is read again, and recorded in `listing_closures`.

## Companion

The Companion reads the status bar from the shared window once a second, in this browser. Nothing it reads is uploaded; sessions stay in local storage until cleared in Settings. Publishing a character to the rankings is a separate, explicit action.

- **Reading.** The HP and MP gauges locate the bar at any capture size, and a small glyph matcher (`dist/hud.mjs`, templates in `dist/hud-glyphs.mjs`, built from real captures by `npm run build-hud-glyphs`) reads its numbers in about 5 ms. Level, job and map name use OCR, only when they may have changed.
- **Trust.** A number counts only if it matches the EXP gauge's fill and repeats on the next frame, and only if amount and percentage imply the same level requirement as the session's other readings. A doubtful digit is refused, never guessed: a skipped frame costs nothing, a wrong number corrupts the session.
- **Maps, monsters and quests** come from the OSMS Data Explorer dataset for this game (`dist/classic-data.json`, CC BY 4.0, rebuilt by `npm run build-classic-data`). Quest hints state only what that data shows. The Forest of Patience, Deep Forest and Construction Site routes and the one party quest follow the map name alone.
- **Recoveries are inferred** from HP or MP jumping up, so potions and healing skills look the same. Quickslot counts could not be read from any capture so far: see PARITY.md.
- `Save a frame` stores one frame on this computer only. Frames of the inventory, a quest map and a visitor's shop are what the reader needs next.

## Capture and integrations

Browser screen sharing always uses a user-initiated picker. Auto Select processes a shared frame locally to find regions; ongoing My Store OCR reads selected sold-item/total information, balance and optional chat. Full-frame region localization is not a guarantee that unrelated pixels are never locally processed. Chat selection is still a manual fallback. Original screenshot/live acceptance remains necessary.

Guided Cash Shop capture reads one manually selected card at a time and displays raw OCR locally for correction. Only reviewed structured fields are submitted; neither full frames nor raw OCR are uploaded. Candidate acceptance requires an admin, a verified game ID and a release-source URL. Missing icons need permitted assets; no fake item-specific icon is claimed.

Discord webhooks stay in page memory. Explicit 429 rejections can retry; uncertain sends never automatically retry. Payment code stays in sandbox by default, verifies webhook signatures and payment amounts, surfaces database failures, and prevents duplicate activation. No actual message or checkout was created in this run.
