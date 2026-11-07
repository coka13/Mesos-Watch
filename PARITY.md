# Feature parity with maplestory.watch

maplestory.watch is the functional benchmark. Nothing was copied from it: no code, data, interface or wording. What each feature does here was built independently, from this project's own captures and the OSMS Data Explorer dataset.

## How the reference was inspected

Only the text of its public pages was read: `/`, `/market`, `/ranking`, `/about`, `/privacy`, `/terms`, `robots.txt` and the sitemap. Its terms forbid scripts, headless browsers and reading the market index by automated means, and `robots.txt` closes `/api/` and `/auth/`, so no automation, API call, sign-in or listing data was used. Interactive behaviour after sign-in, live market values and exact recognition behaviour could not be observed, and are unknown rather than assumed.

## Status

- **Done:** works end to end, validated on real captures or the real SQL.
- **Limited:** works, but validated only on stand-in input or a narrow sample.
- **Partial:** part of the feature exists.
- **Blocked:** cannot be finished yet, for the reason given.

### Companion

| Feature | Status | Notes |
|---|---|---|
| Share the game window, release it when done | Done | Chrome and Edge. Sharing really ends on Stop, unless the scanner or Store Watcher is using it |
| EXP and percentage | Done | Real captures, 90 display scalings: 74 exact, 16 refused, 0 wrong. Three captures, none at native resolution |
| EXP/min last minute, average, best minute; time to level | Done | The level's EXP requirement comes from the screen, so no table is needed |
| Level-ups, deaths, pauses, covered bar, repeated frames | Done | Rule tests, and the browser on frames spliced from real digits |
| Level | Limited | OCR read correctly on every capture, but only level 32 appears in them |
| Job | Limited | Snapped to the game's 15 jobs. Only Cleric appears in the captures |
| Character name | Limited | OCR is unreliable, so two reads must agree, and the field can be typed |
| Sessions, training history, readings, EXP chart | Done | Kept in this browser; cleared in Settings |
| Map name | Limited | FM rooms are validated on real captures. Named maps run on titles printed over the real panel: no real capture of one exists |
| Minimap with position | Done | From the shared window |
| Monsters on the map | Done | Level, HP, EXP and spawns from the Classic dataset |
| Party Quest progress | Limited | First Time Together, 7 stages. Rule tests only: no real capture of it exists |
| Jump Quest progress | Limited | 8 routes. Rule tests and printed titles in the browser. Hints state what the game data shows; puzzle solutions are not in the data, so none are given |
| Pop-out window | Done | Document Picture-in-Picture, tested in Chrome and Edge. Hidden where unavailable |
| Pause, resume, new session, stop | Done | |
| Plain-language checks | Done | Conditions measured here. HDR cannot be measured directly, so it is advice under "status bar not found" |
| What the reader sees, Save a frame | Done | Frames stay on this computer |
| Tracking in a background tab | Limited | Uses worker timers. Not verified in a truly hidden tab |
| Potion counter | Blocked | Quickslot digits sit on the icons and could not be read on any capture. "Recoveries (inferred)", from HP and MP rising, stands in for it and cannot tell a potion from a healing skill. Needs clear captures of the quickslot with changing counts |
| Mesos used and picked up | Blocked | Needs a capture of the inventory window |

### Market

| Feature | Status | Notes |
|---|---|---|
| Market index, search, sort, type filter | Done | Best match, volume, sold price, 24 h change, for sale, last seen, and more |
| Time windows | Done | 1, 7, 14, 30 or 90 days, on the index and item pages |
| Typical price, range, lowest, volume, sell-through | Done | Distinct listings; insufficient data is said, never filled in |
| Stale listings, repeat sightings, outliers | Done | Counted and shown. A price 5x from the median is flagged and left out of the lowest price |
| Item pages: price history, where to buy, recent sold | Done | Asking, seen sold and confirmed sales stay apart, each with source and time |
| Sold listings vs active | Done | Greyed-out rows are read in a second pass, on real pixels |
| Listing lifecycle | Limited | For sale, sold or gone. The SQL is tested. The scanner's closing step only runs on shops of three rows or fewer, which no capture shows |
| Price alerts and target prices | Done | In-app, checked each minute while a tab is open. Nothing is sent while the site is closed |
| Buy low, sell high | Done | After the 3% store fee, with its basis named. Misreads are not bargains |
| Profit, ROI, break-even | Done | Filled from the item's own prices |
| Live price check while shopping | Done | Shows the prices read from the open shop before channel verification. If the market database is connected, compares recognized items against seven-day asking prices |
| Reporting a listing, admin review | Done | Reports, sale evidence and community items tested. Megaphone actions need the deployed payment functions |
| Refreshing | Done | The index refreshes each minute. Supabase Realtime is wired, but not exercised by the browser tests |
| Reference prices (NiaDB) | Done | Admin entry only, one linked figure at a time. Nothing is scraped |
| Seller names | Partial | Stored and shown when known, but the scanner does not read them: no capture of a visitor's shop exists |
| Inventory detection | Blocked | The inventory shows icons, and names appear only on hover. Needs inventory and tooltip captures |

### Scanner and Store Watcher

| Feature | Status | Notes |
|---|---|---|
| Item names, quantities, prices | Done | Real capture, in the browser |
| Greyed-out rows as sold | Done | Real capture. Rows whose re-reads disagree are held back: 3 of 5 published in the test |
| Channel and world | Done | From the Change Channel grid |
| FM room, named maps such as Hidden Street | Done | FM rooms on real captures; named maps by the same reader |
| Automatic publishing | Done | Only with a complete location and two agreeing reads |
| The player's own store is never published | Done | Recognised from its button colours, so OCR is not needed |
| Duplicates | Done | One listing, one row, across players and title misreads |
| A visitor's shop window | Limited | No real capture exists. Tests use a real capture with the owner's buttons painted out |
| A shop with every row sold | Partial | The second pass needs one readable row to find the list |
| Store Watcher Auto Select | Partial | The balance reads. On small captures the store list can need manual selection, which is offered |
| Your own store against typical prices | Limited | Store Watcher compares active rows with exact catalog names against the same world's seven-day asking median, when there are at least three listings. It shows the sample count and freshness. A connected market database is required for comparisons |
| Local Store Watcher review | Done | Scan my store reads the selected item area before checking the account or database. Publication still requires a fresh location reading, a catalog match and a signed-in account |

### Site

| Feature | Status | Notes |
|---|---|---|
| Rankings | Limited | Opt-in and self-reported: rank, character, job, level, seen, job filter, 50 per page. No fame, and no verified seal |
| Character verification | Blocked | The reference has players whisper a code to its in-game character. That needs a game account online, which is not something a website can do alone |
| Discord sign-in | Blocked | Email sign-in does the same job here. Discord needs a Discord application and the Supabase provider set up by the owner |
| Linked partner sites | Blocked | No partners exist |
| Update banner, site notice, browser notices | Done | |
| About, privacy, terms | Partial | Settings has privacy and sources. A terms page is the owner's to write |

## What is needed to finish

Use **Save a frame** in the Companion, at the game's normal window size, for:

1. A party quest stage and a jump quest stage, with the minimap open.
2. Another player's shop, with some rows sold.
3. The inventory open, and a tooltip on an item.
4. The quickslot before and after using potions.
5. EXP values with digits not yet seen, at native resolution.

Each new capture can be added to `scripts/make-hud-glyphs.mjs` or `tests/fixtures`. Then limited items here can move to done.

## Running the checks

`npm test`, `npm run test:ocr`, `npm run test:e2e` (Chrome and Edge) and `npm run verify`.
