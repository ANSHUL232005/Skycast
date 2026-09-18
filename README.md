# SKYCAST

This project is a map-driven live weather explorer. You can search by place name, use your current location, or click nearly any point on the world map to inspect live conditions, the next-day forecast, hourly outlook, daily outlook, and forecast-based cloud and wind behavior.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Add your API key:
   ```bash
   copy .env.example .env
   ```

3. Update `.env`:
   ```bash
   OPENWEATHER_API_KEY=your_actual_api_key_here
   FORECAST_WEIGHT=0.82
   ```

4. Optionally test the key:
   ```bash
   node test-api.js
   ```

5. Start the app:
   ```bash
   npm start
   ```

6. Open `http://localhost:3007`

## What improved

- Search by city, use browser geolocation, or click directly on the map for point-by-point weather lookup
- Forecasts are based on live OpenWeatherMap data resolved by exact coordinates
- The map now supports clouds, rain, wind, temperature, pressure, and radar-like overlay toggles
- Map clicks now reverse-resolve to nearby place names when the geocoder can identify them
- Overlay legends explain what each animated layer is showing
- The dashboard now shows hourly outlook, sunrise, sunset, visibility, cloud cover, and wind direction
- A 5-day forecast strip shows highs, lows, and rain probability
- A new Sky Motion section summarizes cloud cover changes, wind trend, and heatwave/coldwave style signals from the live forecast timeline
- The active lookup refreshes automatically every 5 minutes to keep the dashboard current
- Recent-search history and quick chips still work alongside the map
- A local `.env` file is supported, plus `/api/health` exposes config status for quick checks

## Notes

- Best accuracy happens when `OPENWEATHER_API_KEY` is set and the API responds
- The map uses Leaflet with OpenStreetMap tiles, so the browser also needs internet access
- Without a live API key, the app still works for bundled dataset cities as a fallback
- `.env` is ignored locally so your real key stays out of source control
