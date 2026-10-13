# Changelog — Beach Peek site + data job

Newest first. Dates are when the change went live.

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
