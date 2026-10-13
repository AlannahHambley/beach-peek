// Beach Peek — data pipeline (proof of concept).
// Fetches every public feed and writes ONE normalized JSON per monitored beach + index.json.
// This is the shape the app reads. Later this logic moves into a scheduled Firebase Cloud Function.
// Run: node build-beaches.js   (no API keys)

const fs = require('fs');
const path = require('path');

const ARCGIS = 'https://services.arcgis.com/KkJhFbLnXVqahKz2/arcgis/rest/services/Ocean_Water_Quality_Points_Public/FeatureServer/0/query?where=1=1&outFields=*&returnGeometry=true&outSR=4326&f=json';
const NWS_ZONE = 'CAZ039';           // SB south-coast beaches (rip/hazards)
const TIDE_STATION = '9411340';      // Santa Barbara
const OUT = path.join(__dirname, 'out');

const ymd = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).replace(/-/g, '');
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
  for (let i = 0; i < 3; i++) {
    if (i) await wait(4000 * i);
    try {
      const r = await fetch(u, { headers: UA });
      if (r.ok) return r;
      err = new Error('HTTP '+r.status+' '+u.slice(0,60));
      if (r.status < 500 && r.status !== 429) break;   // a 4xx won't fix itself
    } catch(e){ err = e; }
  }
  throw err;
}
async function getJSON(u){ return (await get(u)).json(); }
async function getText(u){ return (await get(u)).text(); }

// nearest NDBC buoy by longitude: 46053 = East SB, 46054 = West SB
function buoyFor(lon){ return lon <= -120.0 ? '46054' : '46053'; }

async function buoyLatest(id){
  try {
    const t = await getText(`https://www.ndbc.noaa.gov/data/realtime2/${id}.txt`);
    const lines = t.split('\n');
    const hdr = lines[0].trim().split(/\s+/);
    const row = lines.find((l,i) => i>1 && l.trim() && !l.startsWith('#')).trim().split(/\s+/);
    const g = k => { const i = hdr.indexOf(k); const v = i>=0 ? row[i] : 'MM'; return v === 'MM' ? null : v; };
    return { wvht_m: g('WVHT') && +g('WVHT'), dpd_s: g('DPD') && +g('DPD'), mwd_deg: g('MWD') && +g('MWD'), wtmp_c: g('WTMP') && +g('WTMP') };
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
      advisory: /warn|close/i.test(f.attributes.Beach_status || ''),
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
  const fc = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,wind_speed_10m,wind_direction_10m,uv_index&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,uv_index&daily=sunrise,sunset,uv_index_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FLos_Angeles&forecast_days=1`);
  const mar = await getJSON(`https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&current=wave_height,wave_period,wave_direction,sea_surface_temperature&hourly=wave_height,wave_period,wave_direction&timezone=America%2FLos_Angeles&forecast_days=1`);
  const fcArr = Array.isArray(fc) ? fc : [fc];
  const marArr = Array.isArray(mar) ? mar : [mar];
  console.log('  open-meteo: forecast '+fcArr.length+' · marine '+marArr.length);

  // 3) shared feeds: NWS alerts + tides + both buoys
  const alerts = await getJSON(`https://api.weather.gov/alerts/active?zone=${NWS_ZONE}`);
  // ONLY alerts about the water count. (This used to fall back to the first alert of any
  // kind, so a heat or wind advisory was reported as a rip warning — fixed 2026-10-12.)
  const about = f => (f.properties.event || '') + ' ' + (f.properties.headline || '') + ' ' + (f.properties.description || '');
  const watery = alerts.features.filter(f => /rip current|beach hazard|high surf/i.test(f.properties.event || ''));
  const rip = watery.find(f => /rip current/i.test(about(f))) || watery[0] || null;
  const tidy = s => (s || '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim() || null;
  const ripOut = rip ? { active: true, event: rip.properties.event, headline: rip.properties.headline,
                         description: tidy(rip.properties.description), instruction: tidy(rip.properties.instruction),
                         issued: rip.properties.sent || null, sender: rip.properties.senderName || null,
                         until: rip.properties.ends || rip.properties.expires, zone: NWS_ZONE } : { active: false };
  const tideJson = await getJSON(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=beachpeek&begin_date=${ymd}&end_date=${ymd}&datum=MLLW&station=${TIDE_STATION}&time_zone=lst_ldt&units=english&interval=hilo&format=json`);
  const tides = (tideJson.predictions || []).map(p => ({ time: p.t, type: p.type === 'H' ? 'high' : 'low', ft: +p.v }));
  const buoys = { '46053': await buoyLatest('46053'), '46054': await buoyLatest('46054') };
  console.log('  rip: '+(ripOut.active?ripOut.event:'none')+' · tides: '+tides.length+' hi/lo · buoys ok\n');

  // 4) normalize per beach
  const updated = new Date().toISOString();
  const index = [], unsampled = [];
  beaches.forEach((b, i) => {
    const cf = fcArr[i] || {}, cm = marArr[i] || {};
    const cur = cf.current || {}, mcur = cm.current || {}, daily = cf.daily || {};
    const fh = cf.hourly || {}, mh = cm.hourly || {};
    const buoy = buoys[buoyFor(b.lon)] || {};
    const waveFt = M2FT(mcur.wave_height);
    const swellDir = mcur.wave_direction ?? buoy.mwd_deg ?? null;
    // water temp: prefer buoy WTMP, fall back to Open-Meteo SST
    const waterF = buoy.wtmp_c != null ? C2F(buoy.wtmp_c) : C2F(mcur.sea_surface_temperature);
    const waterSrc = buoy.wtmp_c != null ? ('NDBC '+buoyFor(b.lon)) : 'Open-Meteo SST (est.)';

    const doc = {
      id: b.id, name: b.name, coords: { lat: b.lat, lon: b.lon },
      updated,
      water: b.water,
      air:   { tempF: cur.temperature_2m ?? null, uv: cur.uv_index ?? null, uvMax: daily.uv_index_max?.[0] ?? null },
      wind:  { mph: cur.wind_speed_10m ?? null, dir: cur.wind_direction_10m ?? null },
      swell: { heightFt: waveFt, periodS: mcur.wave_period ?? buoy.dpd_s ?? null, dir: swellDir, source: 'Open-Meteo Marine' },
      waterTemp: { f: waterF, source: waterSrc },
      tide:  { station: TIDE_STATION, hilo: tides },
      hourly:{ time: fh.time || [], airF: fh.temperature_2m || [], windMph: fh.wind_speed_10m || [],
               windDir: fh.wind_direction_10m || [], uv: fh.uv_index || [], waveFt: (mh.wave_height || []).map(M2FT) },
      sun:   { sunrise: daily.sunrise?.[0] ?? null, sunset: daily.sunset?.[0] ?? null },
      rip:   ripOut,
      tar:   tarEstimate({ waveFt, swellDir, windDir: cur.wind_direction_10m, windMph: cur.wind_speed_10m })
    };
    fs.writeFileSync(path.join(OUT, b.id + '.json'), JSON.stringify(doc, null, 2));
    (b.water.sampled ? index : unsampled).push({ id: b.id, name: b.name, sampled: b.water.sampled, water: b.water.status, waterDaysAgo: b.water.testedDaysAgo,
                 airF: doc.air.tempF, waveFt: doc.swell.heightFt, windMph: doc.wind.mph, waterF: doc.waterTemp.f,
                 tar: doc.tar.level });
  });

  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ updated, zone: NWS_ZONE, tideStation: TIDE_STATION, rip: ripOut, beaches: index, unsampled }, null, 2));
  console.log('  wrote '+(beaches.length+1)+' files to out/\n');
  console.table(index.concat(unsampled).map(b => ({ beach: b.name, water: b.water, airF: b.airF, waveFt: b.waveFt, wind: b.windMph, waterF: b.waterF, tar: b.tar })));
})();
