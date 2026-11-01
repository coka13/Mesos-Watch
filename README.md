# MESOS - WATCH

Static browser app. Serve `dist/` over HTTPS or localhost. No build step.

## Owner configuration

Edit `dist/config.js` to set the donation URL and optional direct sponsor. Only HTTPS links are accepted. Do not insert Discord webhooks in source code. Webhooks are entered by each visitor and stay in page memory. There is no AdSense integration until an approved publisher account and ad unit details are supplied. No donations or advertising income are active by default.

## Monitoring

Uses native browser screen sharing and Tesseract.js 6.0.1 loaded on demand from jsDelivr. The user marks the cumulative sales total and sold-item list. Two matching OCR observations of an increased total trigger a Discord webhook. Unreadable totals are skipped; decreases pause monitoring. Multiple purchases can be grouped. The amount is the difference between cumulative totals; whether it includes tax depends on the selected game counter. Item names must agree across grayscale and thresholded passes with adequate confidence before inclusion in an alert; uncertain names remain marked for review. A full-resolution item crop is still needed to validate recognition of the user's exact game text. Save item crop exports the selected pixels without rescaling.

Reader 3 displays text in larger Arial for legibility; this does not change the game's font or train the OCR engine. Font research: https://maplestory.nexon.com/Media/Font . Recognition guidance: https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html . The official downloadable MapleStory typeface is not bundled. No automatic spelling corrections are invented for truncated or misread item names.

Window capture can freeze when the game is minimized. Hidden browser tabs can be throttled. Screen-reading accuracy, live sale detection, and Discord delivery require end-to-end validation with the actual game and a user-supplied webhook. No account system, server-side history, or game interaction.

Automatic location scans the shared frame for Sold Items and Total Sales / Total Received labels. Personal balance detection looks for a separate numeric field beside a gold coin, scoped to inventory when its title is readable. Ambiguous fields stay unresolved. Auto-location runs on connection or with Auto-detect windows; rescan after moving in-game windows. The balance is read on each monitoring check and is never a sale trigger. These location heuristics have synthetic regression coverage; live-game accuracy still requires validation.

Run `node check.mjs` for deterministic detection checks.
