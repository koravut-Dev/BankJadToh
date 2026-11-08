// Weather for the "Classic" theme. Uses Open-Meteo (free, no account or API key).
// Privacy: only the latitude/longitude of the city the user picked is sent, never anything else, and only while the feature is on.
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

/** WMO weather code + day/night -> one of: sun, night, cloud, rain, storm, snow, fog */
function kindOf(code, isDay) {
  const c = Number(code);
  if (c >= 95) return 'storm';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
  if (c === 45 || c === 48) return 'fog';
  if (c === 2 || c === 3) return 'cloud';
  return isDay ? 'sun' : 'night'; // 0 clear, 1 mostly clear
}

const getJson = async (url, f = fetch) => {
  const res = await f(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
};

/** Look a city up by name (Thai or English). */
async function searchPlaces(q, lang = 'th', f = fetch) {
  const name = String(q || '').trim().slice(0, 60);
  if (name.length < 2) return [];
  const j = await getJson(`${GEO}?name=${encodeURIComponent(name)}&count=6&language=${lang === 'en' ? 'en' : 'th'}&format=json`, f);
  return (j.results || []).map((r) => ({ name: r.name, area: [r.admin1, r.country].filter(Boolean).join(', '), lat: Math.round(r.latitude * 100) / 100, lon: Math.round(r.longitude * 100) / 100 }));
}

/** Current conditions for a saved place. */
async function current(place, f = fetch) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) throw new Error('no place');
  const j = await getJson(`${FORECAST}?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,weather_code,is_day,cloud_cover&daily=sunrise,sunset&forecast_days=1&timezone=auto`, f);
  const c = j.current;
  if (!c) throw new Error('no data');
  const d = j.daily || {};
  return {
    kind: kindOf(c.weather_code, c.is_day === 1), temp: Math.round(c.temperature_2m), code: c.weather_code, isDay: c.is_day === 1, at: Date.now(), place: place.name,
    cloud: Number.isFinite(c.cloud_cover) ? c.cloud_cover : null,
    // minutes after local midnight at the place, plus its UTC offset: the UI can then follow the sun all day without refetching
    sunriseMin: minutesOf((d.sunrise || [])[0]), sunsetMin: minutesOf((d.sunset || [])[0]), utcOffset: Number.isFinite(j.utc_offset_seconds) ? j.utc_offset_seconds : null,
  };
}

/** "2026-11-06T06:20" -> 380 (minutes after local midnight), or null. */
function minutesOf(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(String(iso || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}


const { skyAt } = require('../renderer/skymath'); // sun maths lives next to the page that uses it

module.exports = { kindOf, searchPlaces, current, minutesOf, skyAt };
