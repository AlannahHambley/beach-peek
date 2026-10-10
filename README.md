# Beach Peek 🏖️

A glanceable **Santa Barbara County** beach-conditions app: *should we go, and what can we
do there?* — so you never pack up the kids and gear, drive to the beach, and only *then*
find the water's under an E. coli advisory.

**Live app:** https://alannahhambley.github.io/beach-peek/
(Add it to your phone's home screen — it installs like a real app and works offline.)

## How it works
- A GitHub Action re-runs `build-beaches.js` **every hour**, fetching live conditions for
  every monitored SB County beach and writing one JSON per beach to `out/`.
- The site (`index.html`) reads those JSONs and runs the verdict engine — water-safety gate,
  per-activity calls, rankings, and a coast map.
- No API keys, no accounts, no user data. Sources: SB County water monitoring (ArcGIS),
  Open-Meteo (air/wind/UV/swell), NOAA (tides), NWS (rip), NDBC buoys (water temp).

## Run locally
```
node build-beaches.js    # fetch conditions → out/<beach>.json + out/index.json
node serve.js            # open http://localhost:8744/index.html   (if you add serve.js)
```

## Honest notes
- Conditions are estimates from public sources and can lag. **Always follow posted signs
  and lifeguards.** Not a substitute for official warnings.
- Water quality reflects the county's latest (weekly) sample; the app shows its age.
- v1 covers the SB **south coast** (Leadbetter → Carpinteria).

_Built with Claude Code for Red Backpack Studios._
