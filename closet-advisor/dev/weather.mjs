// One real call to an outside service (IST 300 D09): today's weather from Open-Meteo, the kind of
// input a "what to wear" outfit suggestion could use. Free, non-commercial use needs no key.
// OPEN_METEO_KEY, if set in .env, switches to Open-Meteo's keyed customer address instead.
// The key's value is never printed.
// Usage: npm run weather [-- --bad]   (--bad sends a request Open-Meteo should refuse)
const SYRACUSE = { latitude: 43.0481, longitude: -76.1474 };
const key = process.env.OPEN_METEO_KEY || '';
const bad = process.argv.includes('--bad');

const params = new URLSearchParams({
  latitude: String(bad ? 999 : SYRACUSE.latitude),
  longitude: String(SYRACUSE.longitude),
  current: 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',
  daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  temperature_unit: 'fahrenheit',
  wind_speed_unit: 'mph',
  timezone: 'America/New_York',
  forecast_days: '1',
});
if (key) params.set('apikey', key);
const url = `https://${key ? 'customer-api' : 'api'}.open-meteo.com/v1/forecast?${params}`;

console.log(`GET ${url.replace(/apikey=[^&]+/, 'apikey=YOUR_KEY_HERE')}`);
const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
const body = await res.json().catch(() => null);
console.log(`Status: ${res.status}`);
console.log(JSON.stringify(body, null, 2));

if (res.ok && body?.current) {
  const feels = body.current.apparent_temperature;
  const rain = body.daily?.precipitation_probability_max?.[0] ?? 0;
  const layer = feels < 55 ? 'add a jacket over the top' : 'a top, bottoms and shoes are enough';
  console.log(`\nFor an outfit: it feels like ${Math.round(feels)}°F, so ${layer}${rain >= 50 ? `, and there's a ${rain}% chance of rain` : ''}.`);
} else {
  process.exitCode = 1;
}
