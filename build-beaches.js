// Beach Peek — data pipeline (proof of concept).
// Fetches every public feed and writes ONE normalized JSON per monitored beach + index.json.
// This is the shape the app reads. Later this logic moves into a scheduled Firebase Cloud Function.
// Run: node build-beaches.js   (no API keys)

const fs = require('fs');
const path = require('path');

const ARCGIS = 'https://services.arcgis.com/KkJhFbLnXVqahKz2/arcgis/rest/services/Ocean_Water_Quality_Points_Public/FeatureServer/0/query?where=1=1&outFields=*&returnGeometry=true&outSR=4326&f=json';
const NWS_ZONE = 'CAZ039';           // SB south-coast beaches (rip/hazards)
// NOAA tide-prediction stations on our coast. Each beach uses the nearest one (Carpinteria and
// Rincon → Rincon Island; the far-west beaches → Gaviota). Positions from NOAA's station
// metadata API, checked 2026-10-22.
const TIDE_STATIONS = [
  { id: '9411340', name: 'Santa Barbara', lat: 34.4046, lon: -119.6925 },
  { id: '9411270', name: 'Rincon Island', lat: 34.3483, lon: -119.4430 },
  { id: '9411399', name: 'Gaviota',       lat: 34.4694, lon: -120.2283 },
];
const TIDE_STATION = TIDE_STATIONS[0].id;   // the default, kept in index.json for the old web page
const OUT = path.join(__dirname, 'out');

const laDay = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).replace(/-/g, '');
const ymd = laDay(Date.now()), ymdBefore = laDay(Date.now() - 86400e3), ymdAfter = laDay(Date.now() + 4 * 86400e3);   // tides run 4 days out: the app shows today + 2 more
const UA = { 'User-Agent': '(beachpeek pipeline, hello@redbackpackstudios.com)' };
const C2F = c => c == null ? null : +(c * 9 / 5 + 32).toFixed(1);
const M2FT = m => m == null ? null : +(m * 3.28084).toFixed(1);
const slug = s => s.toLowerCase().replace(/@/g, 'at').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Beaches people use that the county does NOT sample. Coordinates from OpenStreetMap
// (checked 2026-10-12). Each one borrows the water reading of the nearest county sample
// point and says so: water.sampled = false, water.borrowedFrom = { id, name, miles }.
// A neighbour's reading is a guide, not a result — bacteria is very local (creek mouths).
const EXTRA = [
  { id: 'devereux',       name: 'Devereux',        lat: 34.4081, lon: -119.8766 },
  { id: 'campus-point',   name: 'Campus Point',    lat: 34.4048, lon: -119.8441 },
  { id: 'more-mesa',      name: 'More Mesa',       lat: 34.4181, lon: -119.8036 },
  { id: 'mesa-lane',      name: 'Mesa Lane',       lat: 34.3974, lon: -119.7308 },
  { id: 'thousand-steps', name: 'Thousand Steps',  lat: 34.3958, lon: -119.7135 },
  { id: 'west-beach',     name: 'West Beach',      lat: 34.4096, lon: -119.6909 },
  { id: 'miramar',        name: 'Miramar',         lat: 34.4195, lon: -119.6304 },
  { id: 'rincon',         name: 'Rincon',          lat: 34.3742, lon: -119.4766 },
];
const milesBetween = (a, b) => {
  const R = 3958.8, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const daysAgo = iso => iso == null ? null : Math.round((Date.now() - new Date(iso)) / 86400000);

// A feed that hiccups (a 5xx, a 429 or a dropped connection) gets two more tries before the
// run fails, so one bad second at a provider doesn't cost an hourly update.
const wait = ms => new Promise(r => setTimeout(r, ms));
async function get(u){
  let err;
  for (let i = 0; i < 5; i++) {        // 5 tries over ~1 min (Open-Meteo timed out on all 3 quick tries, 2026-11-17)
    if (i) await wait([0, 5000, 10000, 20000, 30000][i]);
    try {
      const r = await fetch(u, { headers: UA });
      if (r.ok) return r;
      err = new Error('HTTP '+r.status+' '+u.slice(0,60));
      if (r.status < 500 && r.status !== 429) break;   // a 4xx won't fix itself
    } catch(e){ err = e; }
  }
  throw err;
}
// ---- county rain gauges ----
// Low, near-coast gauges only (Stanwood 670 ft and Goleta Road Yard 285 ft are up in the foothills).
// Positions read from each gauge's page on rain.cosbpw.net, 2026-10-14.
const GAUGES = [
  { id: 73,  name: 'Goleta Fire Station',           lat: 34.4430, lon: -119.8536 },
  { id: 184, name: 'Goleta Water District',         lat: 34.4369, lon: -119.7856 },
  { id: 172, name: 'Santa Barbara City College',    lat: 34.4053, lon: -119.6958 },
  { id: 55,  name: 'Santa Barbara County Building', lat: 34.4261, lon: -119.7035 },
  { id: 47,  name: 'Montecito',                     lat: 34.4275, lon: -119.6404 },
  { id: 181, name: 'Summerland',                    lat: 34.4153, lon: -119.5814 },
  { id: 39,  name: 'Carpinteria Fire Station',      lat: 34.3970, lon: -119.5177 },
];
const RAIN_PAGE = 'https://rain.cosbpw.net/rain/?view=8bc6e88f-eeab-4281-9d92-3d723016e945&view_group=91de5db1-343e-77fd-8c96-dcc48c5f1e53&group=d80f114d-de82-a35d-ff28-ca9aab7e41f2';
// the site wants a session cookie before it shows the table: follow its redirects, keeping cookies
async function getWithCookies(u){
  let jar = {}, url = u;
  for (let i = 0; i < 10; i++) {
    const r = await fetch(url, { headers: { ...UA, Cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ') }, redirect: 'manual' });
    const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
    sc.forEach(c => { const m = c.match(/^([^=]+)=([^;]*)/); if (m) jar[m[1]] = m[2]; });
    if (r.status >= 300 && r.status < 400) { url = new URL(r.headers.get('location'), url).href; continue; }
    if (url !== u && r.ok) { url = u; continue; }          // landed elsewhere with a cookie: ask again
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }
  throw new Error('too many redirects');
}
// { gaugeId: inches in the last 3 days }, or null if the page can't be read.
// Also fills GAUGE_RECENT[gaugeId] with the short windows (15m … 24h) and when they were read: the app
// uses them for 'raining now' and for today's past hours (2026-11-13: every forecast model missed
// an afternoon of rain at Leadbetter that this gauge measured).
const GAUGE_RECENT = {};
async function countyRain3Day(){
  try {
    const html = (await getWithCookies(RAIN_PAGE)).replace(/\s+/g, ' ');
    const out = {};
    html.split('<tr>').slice(1).forEach(row => {
      const m = row.match(/site_id=(\d+)/); if (!m) return;
      const v = [...row.matchAll(/<td>\s*(?:<strong>)?\s*([0-9.]+)(?:in)?\s*(?:<\/strong>)?\s*<\/td>/g)].map(x => +x[1]);
      if (v.length >= 9) out[m[1]] = v[8];               // columns: 15m 30m 1h 3h 6h 12h 24h 48h 3d 7d 30d
      if (v.length >= 7) GAUGE_RECENT[m[1]] = { m15: v[0], h1: v[2], h3: v[3], h6: v[4], h12: v[5], h24: v[6], asOf: new Date().toISOString() };
    });
    return Object.keys(out).length ? out : null;
  } catch (e) { console.log('  rain gauges: ' + e.message); return null; }
}
function rainFor(b, rain3){
  if (!rain3) return null;
  const g = GAUGES.filter(x => rain3[x.id] != null).map(x => ({ x, d: milesBetween(b, x) })).sort((p, q) => p.d - q.d)[0];
  return g ? { gauge: g.x.name, gaugeId: g.x.id, miles: +g.d.toFixed(1), last72in: rain3[g.x.id], recent: GAUGE_RECENT[g.x.id] || null, source: 'Santa Barbara County Flood Control rain gauge, past 3 days' } : null;
}

// ---- the last published files (fallback when Open-Meteo is down) ----
const PAGES = 'https://alannahhambley.github.io/beach-peek/out/';
async function lastPublished(id){ try { const r = await fetch(PAGES + id + '.json?t=' + Date.now(), { headers: UA }); return r.ok ? await r.json() : null; } catch (e) { return null; } }
// rebuild the shape of one Open-Meteo forecast entry from a published beach file (same units: °F, mph, in)
function weatherFromDoc(d){
  if (!d) return {};
  const h = d.hourly || {}, days = d.days || [];
  const t0 = (h.time || [])[0];
  // the local UTC offset for the published day (America/Los_Angeles), so hour stamps line up
  const off = t0 ? (() => { const ms = Date.parse(t0 + 'Z'); const la = new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })); const utc = new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'UTC' })); return Math.round((la - utc) / 1000); })() : -28800;
  return {
    utc_offset_seconds: off,
    current: { temperature_2m: d.air && d.air.tempF, uv_index: d.air && d.air.uv, wind_speed_10m: d.wind && d.wind.mph, wind_direction_10m: d.wind && d.wind.dir },
    hourly: { time: h.time || [], temperature_2m: h.airF || [], wind_speed_10m: h.windMph || [], wind_direction_10m: h.windDir || [], uv_index: h.uv || [], precipitation_probability: h.rainProb || [], precipitation: h.rainIn || [] },
    daily: { time: days.map(x => x.date), sunrise: days.map(x => x.sunrise), sunset: days.map(x => x.sunset), uv_index_max: days.map(x => x.uvMax), precipitation_probability_max: days.map(x => x.rainProbMax), precipitation_sum: days.map(x => x.rainIn) },
  };
}

// ---- waves at the beach: CDIP MOP (Scripps), not the open-ocean model ----
// The open-ocean model (Open-Meteo Marine) read ~3× too high here: the Channel Islands and Point
// Conception block most swell. CDIP's MOP model gives the height just off each stretch of shore
// (~10 m deep), every ~100 m. Checked 2026-11-14 at Leadbetter: CDIP 1.1–2.2 ft, Open-Meteo 3.5–8.5 ft.
// Free for public use, unaltered, credited "Data courtesy of CDIP" with a link (cdip.ucsd.edu
// data_access page). QC: waveFlagPrimary 1 = good, 4 = bad (MOP netCDF doc) — bad ones are skipped.
// mop-points.json = every Santa Barbara County point's position (read once, 2026-11-14).
const MOP_POINTS = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'mop-points.json'), 'utf8')).points; } catch (e) { return []; } })();
const MOP = 'https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/model/MOP_alongshore/';
function mopFor(b){
  const p = MOP_POINTS.map(x => ({ x, d: milesBetween(b, { lat: x[1], lon: x[2] }) })).sort((p1, p2) => p1.d - p2.d)[0];
  return p && p.d < 2 ? { id: p.x[0], miles: +p.d.toFixed(2) } : null;
}
// one CDIP file: [{ t (ms), ft }] for the good records; `last` = only the newest n records
async function mopSeries(file, last){
  const dds = await (await fetch(MOP + file + '.dds', { headers: UA })).text();
  const m = dds.match(/waveTime\[waveTime = (\d+)\]/); if (!m) throw new Error('no waveTime in ' + file);
  const n = +m[1], a = last ? Math.max(0, n - last) : 0, r = encodeURIComponent(`[${a}:1:${n - 1}]`);
  const t = await (await fetch(MOP + file + '.ascii?waveTime' + r + ',waveHs' + r + ',waveFlagPrimary' + r, { headers: UA })).text();
  const v = {};
  for (const x of t.split('-----').pop().matchAll(/(\w+)\[\d+\]\s*\n([^\n]+)/g)) v[x[1]] = x[2].split(/,\s*/).map(Number);
  if (!v.waveTime || !v.waveHs) throw new Error('unreadable ' + file);
  return v.waveTime.map((s, i) => ({ t: s * 1000, ft: v.waveHs[i] * 3.28084, ok: v.waveFlagPrimary ? v.waveFlagPrimary[i] === 1 : true })).filter(p => p.ok && p.ft >= 0 && p.ft < 60);
}
// nowcast (hourly, to the present) + forecast (3-hourly, ~6 days ahead)
async function mopRead(id){
  const [now, fc] = await Promise.all([mopSeries(id + '_nowcast.nc', 36), mopSeries(id + '_forecast.nc', 0).catch(() => [])]);
  return { now, fc };
}
// the height at a moment: the nowcast for the past and now; the forecast after that, nudged to
// meet the latest nowcast and easing back to the plain forecast over 48 h (CDIP's forecast ran
// ~0.5 ft under its own nowcast at Leadbetter on 2026-11-11…14, closing over a couple of days)
function mopAt(s, t){
  if (!s || !s.now.length) return null;
  const last = s.now[s.now.length - 1];
  if (t <= last.t + 30 * 60e3) {
    const near = s.now.reduce((p, q) => (Math.abs(q.t - t) < Math.abs(p.t - t) ? q : p), s.now[0]);
    return Math.abs(near.t - t) <= 90 * 60e3 ? near.ft : null;
  }
  const f = s.fc; if (!f.length) return null;
  const lerp = x => { for (let i = 0; i < f.length - 1; i++) if (x >= f[i].t && x <= f[i + 1].t) return f[i].ft + (f[i + 1].ft - f[i].ft) * (x - f[i].t) / (f[i + 1].t - f[i].t); return null; };
  const base = lerp(t), atLast = lerp(last.t);
  if (base == null) return null;
  const off = atLast == null ? 0 : last.ft - atLast, fade = Math.max(0, 1 - (t - last.t) / (48 * 3600e3));
  return Math.max(0, base + off * fade);
}

async function getJSON(u){ return (await get(u)).json(); }
async function getText(u){ return (await get(u)).text(); }

// nearest NDBC buoy by longitude: 46053 = East SB, 46054 = West SB
function buoyFor(lon){ return lon <= -120.0 ? '46054' : '46053'; }

// Each value comes from the newest row that HAS it, within the last 3 hours. (The buoy sends
// some readings only on alternate rows — water temp, waves — so taking just the newest row
// made a working sensor look "down". Fixed 2026-10-14.)
async function buoyLatest(id){
  try {
    const t = await getText(`https://www.ndbc.noaa.gov/data/realtime2/${id}.txt`);
    const lines = t.split('\n');
    const hdr = lines[0].replace(/^#/, '').trim().split(/\s+/);
    const rows = lines.filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim().split(/\s+/));
    const when = r => Date.UTC(+r[0], +r[1] - 1, +r[2], +r[3], +r[4]);
    const newest = rows.length ? when(rows[0]) : 0;
    const g = k => { const i = hdr.indexOf(k); if (i < 0) return null;
      const r = rows.find(r => r[i] && r[i] !== 'MM' && newest - when(r) <= 3 * 3600e3); return r ? +r[i] : null; };
    return { wvht_m: g('WVHT'), dpd_s: g('DPD'), mwd_deg: g('MWD'), wtmp_c: g('WTMP') };
  } catch(e){ return { error: e.message }; }
}

// SB tar heuristic (labeled ESTIMATE): season + swell dir + surf size + onshore wind
function tarEstimate({ waveFt, swellDir, windDir, windMph }){
  const m = new Date().getMonth(); // 0=Jan
  let score = 0;
  if (m >= 4 && m <= 8) score += 2;        // May–Sep (summer, ~10x winter)
  else if (m === 3 || m === 9) score += 1; // shoulder
  const south = d => d != null && d >= 135 && d <= 225;
  if (south(swellDir)) score += 2;          // S/SE/SW swell pushes channel tar ashore
  if (waveFt != null){ if (waveFt < 2) score += 2; else if (waveFt <= 4) score += 1; else score -= 1; } // calm = worse
  if (south(windDir) && windMph >= 6) score += 1; // afternoon onshore wind
  return { level: score >= 4 ? 'Elevated' : 'Low', score, note: 'estimate from season + swell + surf + wind — fact-check it' };
}

(async () => {
  console.log('Beach Peek pipeline · '+ymd+'\n');
  fs.mkdirSync(OUT, { recursive: true });

  // 1) water quality + coords (the anchor set)
  const wq = await getJSON(ARCGIS);
  const beaches = wq.features.map(f => ({
    id: slug(f.attributes.Beach_Name),
    name: f.attributes.Beach_Name,
    lat: +f.geometry.y.toFixed(5),
    lon: +f.geometry.x.toFixed(5),
    water: {
      status: f.attributes.Beach_status,                       // Open | Warning | Closed
      // county statuses: Open · Warning · Closed · Rain (rain advisory) · "Open *" (open with restrictions)
      advisory: /warn|close|rain/i.test(f.attributes.Beach_status || ''),
      testedDate: f.attributes.StatusDate ? new Date(f.attributes.StatusDate).toISOString().slice(0,10) : null,
      testedDaysAgo: daysAgo(f.attributes.StatusDate),
      ecoli: f.attributes.e_coli_result ?? null,
      // the rest of what the county publishes, so the app can show each reading against the
      // state limit and quote the county's own note (values can be strings like "<10")
      entero: f.attributes.entercoccus_result ?? null,
      totalColiform: f.attributes.total_coliform_result ?? null,
      ratioExceeded: /^y/i.test(f.attributes.exceed_fc_tc_ratio || ''),
      notes: (f.attributes.Notes || '').replace(/\s+/g, ' ').trim() || null,
      source: 'SB County Ocean Water Monitoring'
    }
  }));
  const sampledCount = beaches.length;
  beaches.forEach(b => { b.water.sampled = true; });
  EXTRA.forEach(x => {
    const near = beaches.slice(0, sampledCount).map(b => ({ b, d: milesBetween(x, b) })).sort((p, q) => p.d - q.d)[0];
    beaches.push({ id: x.id, name: x.name, lat: x.lat, lon: x.lon,
      water: { ...near.b.water, sampled: false, borrowedFrom: { id: near.b.id, name: near.b.name, miles: +near.d.toFixed(1) } } });
  });
  console.log('  water quality: '+sampledCount+' sampled beaches + '+EXTRA.length+' that borrow the nearest sample');

  // 2) Open-Meteo forecast + marine — ONE multi-location call each
  const lats = beaches.map(b => b.lat).join(',');
  const lons = beaches.map(b => b.lon).join(',');
  // If Open-Meteo can't be reached (it timed out on four runs overnight 2026-11-17), don't fail the
  // whole run: publish everything else and reuse the last published weather for each beach (its
  // forecast still covers the next days). index.json says so (weatherFrom / weatherUpdated).
  let fc = null, mar = null, weatherFrom = 'live';
  try {
    fc = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,wind_speed_10m,wind_direction_10m,uv_index&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,uv_index,precipitation_probability,precipitation&daily=sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FLos_Angeles&forecast_days=3`);
  } catch (e) { console.log('  open-meteo forecast: ' + e.message + ' — reusing the last published weather'); weatherFrom = 'last'; }
  try {
    mar = await getJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&current=wave_height,wave_period,wave_direction,sea_surface_temperature&hourly=wave_height,wave_period,wave_direction&timezone=America%2FLos_Angeles&forecast_days=3`);
  } catch (e) { console.log('  open-meteo marine: ' + e.message + ' — waves come from CDIP anyway'); }
  const prev = {}, prevIndex = weatherFrom === 'last' ? await lastPublished('index') : null;
  if (weatherFrom === 'last') for (const b of beaches) prev[b.id] = await lastPublished(b.id);
  const fcArr = fc ? (Array.isArray(fc) ? fc : [fc]) : beaches.map(b => weatherFromDoc(prev[b.id]));
  const marArr = mar ? (Array.isArray(mar) ? mar : [mar]) : beaches.map(() => ({}));
  const weatherUpdated = weatherFrom === 'live' ? new Date().toISOString() : ((prevIndex && (prevIndex.weatherUpdated || prevIndex.updated)) || null);
  console.log('  open-meteo: forecast '+(fc ? fcArr.length : 'reused')+' · marine '+(mar ? marArr.length : 'skipped'));

  // 3) shared feeds: NWS alerts + tides + both buoys
  // NWS down (503 on 2026-11-17): keep the last published rip status rather than failing the run
  let alerts = null;
  try { alerts = await getJSON(`https://api.weather.gov/alerts/active?zone=${NWS_ZONE}`); } catch (e) { console.log('  nws alerts: ' + e.message + ' — keeping the last published rip status'); }
  const lastIdx = alerts ? null : (prevIndex || await lastPublished('index'));
  // ONLY alerts about the water count. (This used to fall back to the first alert of any
  // kind, so a heat or wind advisory was reported as a rip warning — fixed 2026-10-12.)
  const about = f => (f.properties.event || '') + ' ' + (f.properties.headline || '') + ' ' + (f.properties.description || '');
  const watery = (alerts ? alerts.features : []).filter(f => /rip current|beach hazard|high surf/i.test(f.properties.event || ''));
  const rip = watery.find(f => /rip current/i.test(about(f))) || watery[0] || null;
  const tidy = s => (s || '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim() || null;
  const ripOut = rip ? { active: true, event: rip.properties.event, headline: rip.properties.headline,
                         description: tidy(rip.properties.description), instruction: tidy(rip.properties.instruction),
                         issued: rip.properties.sent || null, sender: rip.properties.senderName || null,
                         until: rip.properties.ends || rip.properties.expires, zone: NWS_ZONE } : (alerts ? { active: false } : ((lastIdx && lastIdx.rip) || { active: false }));
  // RAIN, measured: Santa Barbara County Flood Control's gauges (rain.cosbpw.net), 3-day totals.
  // Each beach uses its nearest low-elevation coastal gauge. (The weather model invented a
  // 0.38 in shower at Hendry's on 2026-10-14 that no gauge saw, so the model isn't used.)
  const rain3 = await countyRain3Day();
  console.log('  rain gauges: ' + (rain3 ? Object.keys(rain3).length + ' read' : 'skipped'));
  const tides = {};
  for (const st of TIDE_STATIONS) {
    let tideJson = null;
    try { tideJson = await getJSON(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=beachpeek&begin_date=${ymdBefore}&end_date=${ymdAfter}&datum=MLLW&station=${st.id}&time_zone=lst_ldt&units=english&interval=hilo&format=json`);
    } catch (e) { console.log('  tides ' + st.id + ': ' + e.message + ' — reusing the last published tides'); }
    if (tideJson) tides[st.id] = (tideJson.predictions || []).map(p => ({ time: p.t, type: p.type === 'H' ? 'high' : 'low', ft: +p.v }));
    else { const near = beaches.map(b => ({ b, d: milesBetween(b, st) })).sort((p, q) => p.d - q.d)[0]; const doc = near ? (prev[near.b.id] || await lastPublished(near.b.id)) : null; tides[st.id] = (doc && doc.tide && doc.tide.hilo) || []; }
  }
  const tideFor = b => TIDE_STATIONS.map(st => ({ st, d: milesBetween(b, st) })).sort((p, q) => p.d - q.d)[0];
  const buoys = { '46053': await buoyLatest('46053'), '46054': await buoyLatest('46054') };
  console.log('  rip: '+(ripOut.active?ripOut.event:'none')+' · tides: '+TIDE_STATIONS.map(st => st.name+' '+tides[st.id].length).join(', ')+' hi/lo · buoys ok\n');

  // 4) normalize per beach
  // waves at the beach: each beach's nearest CDIP point (several beaches can share one)
  const mopOf = {}, mopData = {};
  beaches.forEach(b => { mopOf[b.id] = mopFor(b); });
  const mopIds = [...new Set(Object.values(mopOf).filter(Boolean).map(m => m.id))];
  for (let k = 0; k < mopIds.length; k += 6) {
    await Promise.all(mopIds.slice(k, k + 6).map(id => mopRead(id).then(s => { mopData[id] = s; }).catch(e => console.log('  cdip ' + id + ': ' + e.message))));
  }
  console.log('  cdip waves: ' + Object.keys(mopData).length + ' of ' + mopIds.length + ' points read');

  const updated = new Date().toISOString();
  const index = [], unsampled = [];
  beaches.forEach((b, i) => {
    const cf = fcArr[i] || {}, cm = marArr[i] || {};
    const cur = cf.current || {}, mcur = cm.current || {}, daily = cf.daily || {};
    const fh = cf.hourly || {}, mh = cm.hourly || {};
    const buoy = buoys[buoyFor(b.lon)] || {};
    // CDIP when we have it, the open-ocean model only as a fallback
    const mop = mopOf[b.id], ms = mop && mopData[mop.id];
    const offMs = (cf.utc_offset_seconds || 0) * 1000, nowMop = ms ? mopAt(ms, Date.now()) : null;
    const hourlyWave = (fh.time || []).map((t, k) => {
      const v = ms ? mopAt(ms, Date.parse(t + 'Z') - offMs) : null;
      return v != null ? +v.toFixed(1) : M2FT((mh.wave_height || [])[k]);
    });
    const waveFt = nowMop != null ? +nowMop.toFixed(1) : M2FT(mcur.wave_height);
    const waveSrc = nowMop != null ? 'CDIP MOP ' + mop.id : 'Open-Meteo Marine';
    const swellDir = mcur.wave_direction ?? buoy.mwd_deg ?? null;
    // water temp: prefer buoy WTMP, fall back to Open-Meteo SST
    const waterF = buoy.wtmp_c != null ? C2F(buoy.wtmp_c) : C2F(mcur.sea_surface_temperature);
    const waterSrc = buoy.wtmp_c != null ? ('NDBC '+buoyFor(b.lon)) : 'Open-Meteo SST (est.)';
    const tn = tideFor(b);

    const doc = {
      id: b.id, name: b.name, coords: { lat: b.lat, lon: b.lon },
      updated,
      water: b.water,
      air:   { tempF: cur.temperature_2m ?? null, uv: cur.uv_index ?? null, uvMax: daily.uv_index_max?.[0] ?? null },
      wind:  { mph: cur.wind_speed_10m ?? null, dir: cur.wind_direction_10m ?? null },
      swell: { heightFt: waveFt, periodS: mcur.wave_period ?? buoy.dpd_s ?? null, dir: swellDir, source: waveSrc, cdip: mop && ms ? { point: mop.id, miles: mop.miles } : null },
      waterTemp: { f: waterF, source: waterSrc },
      tide:  { station: tn.st.id, stationName: tn.st.name, miles: +tn.d.toFixed(1), hilo: tides[tn.st.id] },
      hourly:{ time: fh.time || [], airF: fh.temperature_2m || [], windMph: fh.wind_speed_10m || [],
               windDir: fh.wind_direction_10m || [], uv: fh.uv_index || [], waveFt: hourlyWave,
               rainProb: fh.precipitation_probability || [], rainIn: fh.precipitation || [] },   // 72 hours: today, tomorrow, the day after
      sun:   { sunrise: daily.sunrise?.[0] ?? null, sunset: daily.sunset?.[0] ?? null },
      days:  (daily.time || []).map((d, k) => ({ date: d, sunrise: daily.sunrise?.[k] ?? null, sunset: daily.sunset?.[k] ?? null, uvMax: daily.uv_index_max?.[k] ?? null,
               rainProbMax: daily.precipitation_probability_max?.[k] ?? null, rainIn: daily.precipitation_sum?.[k] ?? null })),
      rip:   ripOut,
      rain:  rainFor(b, rain3),
      tar:   tarEstimate({ waveFt, swellDir, windDir: cur.wind_direction_10m, windMph: cur.wind_speed_10m })
    };
    fs.writeFileSync(path.join(OUT, b.id + '.json'), JSON.stringify(doc, null, 2));
    (b.water.sampled ? index : unsampled).push({ id: b.id, name: b.name, sampled: b.water.sampled, water: b.water.status, waterDaysAgo: b.water.testedDaysAgo,
                 airF: doc.air.tempF, waveFt: doc.swell.heightFt, windMph: doc.wind.mph, waterF: doc.waterTemp.f,
                 tar: doc.tar.level });
  });

  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ updated, weatherFrom, weatherUpdated, zone: NWS_ZONE, tideStation: TIDE_STATION, tideStations: TIDE_STATIONS, rip: ripOut, beaches: index, unsampled }, null, 2));
  console.log('  wrote '+(beaches.length+1)+' files to out/\n');
  console.table(index.concat(unsampled).map(b => ({ beach: b.name, water: b.water, airF: b.airF, waveFt: b.waveFt, wind: b.windMph, waterF: b.waterF, tar: b.tar })));
})();
