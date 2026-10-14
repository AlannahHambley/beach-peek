# Changelog — Beach Peek site + data job

Newest first. Dates are when the change went live.

## 2026-10-14 — rain from the county's gauges
- New per-beach `rain`: { gauge, gaugeId, miles, last72in, source } — the 3-day total at
  the nearest low, near-coast Santa Barbara County Flood Control gauge (read hourly from
  rain.cosbpw.net). The app shows a rain caution at 0.2 in or more. If the gauge page can't
  be read, `rain` is null and nothing breaks.

## 2026-10-14 — real buoy water temperature; tides yesterday → tomorrow (`10ec11d`)
- NOAA buoy 46053 sends water temperature on alternate rows; the job read only the newest
  row, so it always fell back to Open-Meteo's estimate. Each buoy value now comes from the
  newest row that has it (within 3 hours).
- Tide predictions span yesterday to tomorrow (`tide.hilo` now has ~12 points), so the tide
  after the day's last high/low and just after midnight is worked out, not held flat.

## 2026-10-14 — privacy page: tar answers
- The draft policy now lists the app's "Was it actually tarry?" answers as kept on the
  phone. `e5fe6aa`.

## 2026-10-13 — privacy policy page (draft)
- `privacy.html`: the draft privacy policy, published at Alannah's request and linked from
  the app. Generated from the app repo's `PRIVACY.md` by `tools/privacy-page.js`; edit it
  there, never here. `9a73981`.

## 2026-10-13 — the job retries a feed that hiccups
- One HTTP 503 from Open-Meteo failed the 18:50 UTC run (Alannah got GitHub's failure
  email; the site kept its last good data). Downloads now get two more tries on a 5xx, a
  429 or a dropped connection before the run fails. `cc6850a`.

## 2026-10-13 — eight beaches the county doesn't sample (`c1436f3`)
- Added Devereux, Campus Point, More Mesa, Mesa Lane, Thousand Steps, West Beach, Miramar and
  Rincon. Each has its own weather, waves and tide, and **borrows the water reading of the
  nearest county sample point**, marked `water.sampled: false` with
  `water.borrowedFrom: { id, name, miles }`. County beaches now carry `water.sampled: true`.
  In `index.json` they are listed under a new **`unsampled`** array, NOT under `beaches`,
  so the web app and older app versions (which treat every listed beach as county-tested)
  don't show them. Nothing renamed or removed.

## 2026-10-12 — rip alerts fixed; fuller county readings
_git: `a7b64ae`_
- **Fix:** only rip-current, beach-hazard and high-surf alerts count as a rip warning.
  Before, when there was no such alert the job fell back to the first alert of any kind.
- **Added to each beach file** (nothing renamed or removed):
  `water.entero`, `water.totalColiform`, `water.ratioExceeded`, `water.notes` (the county's
  own note for that week), and `rip.description`, `rip.instruction`, `rip.issued`,
  `rip.sender` (the National Weather Service wording).

## 2026-10-10 — first live version
_git: `dc7cff8`_
- Hourly data job → one file per beach (16 county sample points) → GitHub Pages.
- Web app: Home, Rankings and Map on live data; installable; works offline.
