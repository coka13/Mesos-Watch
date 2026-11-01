# MesosWatch

Static browser app. Serve `dist/` over HTTPS or localhost. No build step.

## Owner configuration

Edit `dist/config.js` to set the donation URL and optional direct sponsor. Only HTTPS links are accepted. Do not insert Discord webhooks in source code. Webhooks are entered by each visitor and stay in page memory. There is no AdSense integration until an approved publisher account and ad unit details are supplied. No donations or advertising income are active by default.

## Monitoring

Uses native browser screen sharing and Tesseract.js 6.0.1 loaded on demand from jsDelivr. The user marks the cumulative sales total and sold-item list. Two matching OCR observations of an increased total trigger a Discord webhook. Unreadable totals are skipped; decreases pause monitoring. Multiple purchases can be grouped. The amount is the difference between cumulative totals; whether it includes tax depends on the selected game counter. Item names are best-effort differences in recognized rows. Changed quantities or OCR errors may appear as new rows. Real game calibration remains required; no screenshot of this user's shop was supplied.

Window capture can freeze when the game is minimized. Hidden browser tabs can be throttled. Screen-reading accuracy, live sale detection, and Discord delivery require end-to-end validation with the actual game and a user-supplied webhook. No account system, server-side history, or game interaction.

Run `node check.mjs` for deterministic detection checks.
