# Mesos-Watch

A community price checker for the MapleStory Classic Free Market. Players share their game window in the browser and walk the FM as usual. Every shop they open is read on their own computer, and its prices are added to a shared database that anyone can search.

The site is the static `dist/` folder: no build step, served over HTTPS or localhost. Shared data lives in Supabase (`supabase/`). Setup steps are in [SETUP.md](SETUP.md).

## Sections

- **Price Checker** (home): item search with autocomplete and pictures, and a live feed of fresh prices. Each item page shows:
  - lowest asking price (24 h) and typical asking price (7-day median, compared with last week);
  - estimated value, given only when there are at least 3 confirmed sales from 2 sellers in 30 days, never guessed;
  - when the item was last seen, a 24h/7d/30d/90d history chart, and current listings with shop, FM room and stats;
  - base stats, and price variations for scrolled or upgraded copies.
- **Market Trends**: biggest risers and fallers week on week, and the most-listed items.
- **Live FM Scanner**: share the game window and roam freely. Any shop window on screen is read automatically.
- **Price History**: the full history of one item, as a chart and a table.
- **FM Megaphones**: paid messages shown under the search bar (Stripe checkout, admin review, fair rotation, queued slots).
- **My Store**: watches your own store's Sold Items window, keeps a sales history in this browser, and can contribute confirmed sales.
- **Discord**: optional webhook notifications for My Store sales, one message per new Total Sales value.
- **Settings**: local data, and admin moderation of megaphones and unverified items.

## How screen reading works

Everything uses browser screen sharing and Tesseract.js 6.0.1, loaded on demand from jsDelivr. Nothing clicks, types or reads game memory.

- **Auto Select (My Store)** finds the screen regions from word positions in one full-frame OCR pass, scaled 2–3×:
  - Total Sales: the upper number when Total Sales and Total Received are stacked;
  - the Sold Items list, from its Buyer / Number purchased rows;
  - your mesos balance, a number beside a gold coin.

  It runs again by itself when the store area changes a lot or the total can't be read twice in a row. Manual selection remains as a fallback.
- **Shop scanning** pairs each item-name row with the price row below it ("1 for 24,679 mesos"), and reads the shop title, the FM room and any hovered item's tooltip stats. At full-frame scale the small "1 for" often comes out garbled, so those lines are cropped, enlarged 4× and read twice (contrast and threshold). A listing counts only when both reads agree and two scans in a row match.
- **Item matching**: names are matched to the catalog exactly, by a unique prefix when the game cuts a name off with "…", or by a close fuzzy match that starts the same way and is about as long. Anything else becomes a community item instead of being forced onto the wrong one.

`tests/fixtures/` holds real Tesseract output from a 756×460 store screenshot. `npm test` checks that Auto Select and the shop reader handle it, together with synthetic layouts and the database tests.

## Data honesty

- Asking prices and confirmed sales are separate everywhere.
- One player counts once per item, shop and price in a median.
- Duplicates within 6 hours are ignored, and each player is rate-limited.
- Every figure shows when it was last seen.
- Item data is MapleStory Classic World game data from OSMS Data Explorer (CC BY 4.0, © NEXON), credited on every item page.

## Owner configuration

`dist/config.js` holds the Supabase URL and public anon key, optional worlds, the donation link and the sponsor. Never put the Supabase service role key, Stripe keys or Discord webhooks in it. Stripe and service keys live in Supabase secrets, and webhooks are entered by each visitor.
