// Beach Peek — live feed verification.
// Proves each public feed returns the fields the app needs. Node 18+ (global fetch).
// Run: node verify-feeds.js   (hits real endpoints; no keys)

const LAT = 34.4017, LON = -119.6919;      // Leadbetter Beach, Santa Barbara
const BUOY = '46053';                       // East Santa Barbara
const TIDE_STATIONS = ['9411340', '9411270', '9411399'];   // Santa Barbara · Rincon Island · Gaviota
const NWS_ZONE = 'CAZ039';                  // SB south coast beaches
const ARCGIS = 'https://services.arcgis.com/KkJhFbLnXVqahKz2/arcgis/rest/services/Ocean_Water_Quality_Points_Public/FeatureServer/0/query?where=1=1&outFields=*&f=json';

const ymd = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).replace(/-/g, '');

function line(s){ console.log(s); }
async function getJSON(url){ const r = await fetch(url, { headers: { 'User-Agent': '(beachpeek, test)' } }); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }
async function getText(url){ const r = await fetch(url, { headers: { 'User-Agent': '(beachpeek, test)' } }); if(!r.ok) throw new Error('HTTP '+r.status); return r.text(); }

async function run(name, fn){
  try { await fn(); line('  ✅ ' + name + ' OK\n'); }
  catch(e){ line('  ❌ ' + name + ' FAILED: ' + e.message + '\n'); }
}

(async () => {
  line('Beach Peek feed check — Leadbetter ('+LAT+','+LON+') · '+ymd+'\n');

  await run('Open-Meteo forecast (air/wind/UV/sun)', async () => {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,wind_speed_10m,wind_direction_10m,uv_index&daily=sunrise,sunset,uv_index_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FLos_Angeles&forecast_days=1`;
    const d = await getJSON(u);
    line('     air '+d.current.temperature_2m+'°F · wind '+d.current.wind_speed_10m+' mph @'+d.current.wind_direction_10m+'° · UV '+d.current.uv_index);
    line('     sunrise '+d.daily.sunrise[0]+' · sunset '+d.daily.sunset[0]+' · UV max '+d.daily.uv_index_max[0]);
  });

  await run('Open-Meteo Marine (swell)', async () => {
    const u = `https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LON}&current=wave_height,wave_period,wave_direction,sea_surface_temperature&timezone=America%2FLos_Angeles`;
    const d = await getJSON(u);
    const c = d.current, ft = (c.wave_height*3.28084).toFixed(1);
    line('     wave '+c.wave_height+' m ('+ft+' ft) @ '+c.wave_period+'s, '+c.wave_direction+'° · SST '+c.sea_surface_temperature+'°');
  });

  await run('NWS alerts (rip / beach hazards)', async () => {
    const d = await getJSON(`https://api.weather.gov/alerts/active?zone=${NWS_ZONE}`);
    line('     active alerts: '+d.features.length);
    d.features.slice(0,3).forEach(f => line('      • '+f.properties.event+' — '+(f.properties.headline||'').slice(0,70)));
    if(!d.features.length) line('      (none active right now — endpoint works)');
  });

  await run('NDBC buoy '+BUOY+' (water temp + swell)', async () => {
    const t = await getText(`https://www.ndbc.noaa.gov/data/realtime2/${BUOY}.txt`);
    const rows = t.split('\n').filter(r => r && !r.startsWith('#'));
    const hdr = t.split('\n')[0].trim().split(/\s+/);
    const latest = rows[0].trim().split(/\s+/);
    const pick = (k) => { const i = hdr.indexOf(k); return i>=0 ? latest[i] : '—'; };
    line('     latest: WVHT '+pick('WVHT')+' m · DPD '+pick('DPD')+' s · MWD '+pick('MWD')+'° · WTMP '+pick('WTMP')+'°C');
  });

  for (const TIDE_STATION of TIDE_STATIONS) await run('NOAA tides (station '+TIDE_STATION+', hi/lo)', async () => {
    const u = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=beachpeek&begin_date=${ymd}&end_date=${ymd}&datum=MLLW&station=${TIDE_STATION}&time_zone=lst_ldt&units=english&interval=hilo&format=json`;
    const d = await getJSON(u);
    (d.predictions||[]).forEach(p => line('      '+p.t+'  '+(p.type==='H'?'HIGH':'low ')+'  '+p.v+' ft'));
    if(!d.predictions) throw new Error('no predictions: '+JSON.stringify(d).slice(0,120));
  });

  await run('County water quality (ArcGIS)', async () => {
    const d = await getJSON(ARCGIS);
    line('     monitored points: '+d.features.length);
    // show the attribute keys once (so we can map the status + name fields)
    const a0 = d.features[0].attributes;
    line('     fields: '+Object.keys(a0).join(', '));
    d.features.slice(0,4).forEach(f => {
      const a = f.attributes;
      const name = a.Name || a.NAME || a.StationName || a.Station || a.Beach || '?';
      const status = a.Status || a.STATUS || a.Posting || a.Advisory || a.Result || '?';
      line('      • '+name+' → '+status);
    });
  });

  line('done.');
})();
