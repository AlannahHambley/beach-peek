# Changelog — Beach Peek site + data job

Newest first. Dates are when the change went live.

## 2026-10-12 — eight beaches the county doesn't sample
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
