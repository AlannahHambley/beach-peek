# Beach Peek — site + data job

The public half of Beach Peek: an hourly job that gathers Santa Barbara County beach
conditions from public sources into one small file per beach, and a simple web app that
reads them. The native phone app is a separate, private repo and reads the same files.

## ⛔ This repository is PUBLIC, and everything in it is published

GitHub Pages serves this whole folder to the world. Before adding or changing a file:
- **No secrets, tokens, keys or passwords. Ever.** The job needs none; every source is free
  and keyless.
- **No personal details** — no personal email addresses, phone numbers, home locations,
  family names or photos.
- **Ask Alannah before adding a new kind of content** (documents, images, anything not
  already here). A push is a publication.

## ⛔ Ground truth: verify, don't recall

Before stating whether a file, feature, config or setup exists — or its current status —
CHECK the repo (`ls` / `grep` / `git log` / read the file). Never assert repo or setup state
from memory alone. If you haven't looked this session, say "let me check" and look.

## What's here
- `build-beaches.js` — the data job. Fetches the county water-quality feed, Open-Meteo
  (weather and marine), NOAA tides, National Weather Service alerts and two NOAA buoys, and
  writes `out/<beach>.json` plus `out/index.json`. Node 20, no dependencies, no keys.
- `.github/workflows/update.yml` — runs the job every hour and on each push to `main`, then
  deploys the folder to GitHub Pages.
- `index.html`, `sw.js`, `manifest.webmanifest`, icons — the web app.
- `verify-feeds.js`, `serve.js` — local helpers.

## Rules for the data job
- **The phone app depends on the shape of `out/*.json`.** Add fields; never rename or remove
  one without changing the app first. Record every change in `CHANGELOG.md`.
- **Never guess.** A reading that can't be fetched is written as `null`, so the app can say
  "unavailable". Don't fill gaps with defaults.
- **Only water alerts count as a rip warning**: rip current, beach hazard, high surf.
  (It once fell back to any alert, and a heat advisory showed as a rip warning.)
- **Safety data is reported as the source gives it**, with its date. The county tests each
  beach about once a week; the file carries the test date and age.
- **Run it locally before pushing** (`node build-beaches.js`) and look at one output file.

## Workflow
- Small, clear commits to `main`; a push deploys within a few minutes.
- Record changes in `CHANGELOG.md` (date + what changed + why).
- Rollback = revert the commit; never rewrite history.

## The studio
Beach Peek is a Red Backpack Studios app. Studio rules, lessons and the app's design
record live in the private workspace, not here.
