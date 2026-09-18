const body = document.body;
const cityInput = document.getElementById('city');
const weatherDiv = document.getElementById('weather');
const searchButton = document.getElementById('search');
const locateButton = document.getElementById('locate-me');
const themeToggle = document.getElementById('theme-toggle');
const themeStatus = document.getElementById('theme-status');
const temperatureMood = document.getElementById('temperature-mood');
const searchSignal = document.getElementById('search-signal');
const mapSignal = document.getElementById('map-signal');
const modelSignal = document.getElementById('model-signal');
const clockHourHand = document.getElementById('clock-hour');
const clockMinuteHand = document.getElementById('clock-minute');
const clockSecondHand = document.getElementById('clock-second');
const clockDigital = document.getElementById('clock-digital');
const clockDate = document.getElementById('clock-date');
const recentSearchesContainer = document.getElementById('recent-searches');
const clearHistoryButton = document.getElementById('clear-history');
const mapStatus = document.getElementById('map-status');
const overlayLegend = document.getElementById('overlay-legend');
const quickSearchButtons = Array.from(document.querySelectorAll('.chip'));
const layerButtons = Array.from(document.querySelectorAll('.layer-chip'));
const mapPanel = document.querySelector('.map-panel');

const RECENT_SEARCHES_KEY = 'weather-app-recent-searches';
const THEME_MODE_KEY = 'weather-app-theme-mode';
const DEGREE_HTML = '&deg;C';
const AUTO_REFRESH_MS = 300000;
const MAP_LAYERS = {
    clouds: '/api/map-layer/clouds_new/{z}/{x}/{y}.png',
    precipitation: '/api/map-layer/precipitation_new/{z}/{x}/{y}.png',
    wind: '/api/map-layer/wind_new/{z}/{x}/{y}.png',
    temperature: '/api/map-layer/temp_new/{z}/{x}/{y}.png',
    pressure: '/api/map-layer/pressure_new/{z}/{x}/{y}.png',
    radar: '/api/radar/{z}/{x}/{y}.png'
};
const OVERLAY_LEGENDS = {
    clouds: {
        title: 'Cloud coverage',
        note: 'Lighter tones indicate thinner cloud cover. Bright whites indicate denser cloud fields.',
        colors: ['#d8eef9', '#abd4ef', '#7aaad7', '#4f79b6', '#2d467c']
    },
    precipitation: {
        title: 'Rain intensity',
        note: 'Blue-to-violet bands indicate increasing precipitation intensity.',
        colors: ['#dff6ff', '#7fd3ff', '#2f9cff', '#2557d6', '#5e2ca5']
    },
    wind: {
        title: 'Wind speed',
        note: 'Cooler colors mean lighter wind. Warmer colors show stronger wind corridors.',
        colors: ['#d4f7ef', '#8de2c1', '#40c99b', '#efb84a', '#e25a3b']
    },
    temperature: {
        title: 'Surface temperature',
        note: 'Blue shades are cooler zones. Orange and red shades are warmer zones.',
        colors: ['#2f58ff', '#5ba8ff', '#f0dd71', '#f89e43', '#de4937']
    },
    pressure: {
        title: 'Pressure pattern',
        note: 'Lower-pressure areas can hint at unsettled weather, while higher pressure is usually steadier.',
        colors: ['#d9ebff', '#97c1ff', '#627be8', '#7d4ac7', '#a33788']
    },
    radar: {
        title: 'Radar-style precipitation',
        note: 'Uses the radar tile when available and falls back to the live precipitation layer otherwise.',
        colors: ['#dff6ff', '#7fd3ff', '#2f9cff', '#2557d6', '#5e2ca5']
    },
    none: {
        title: 'Overlay off',
        note: 'Base map only. Click any point to inspect the exact weather there.',
        colors: []
    }
};

let map = null;
let marker = null;
let overlayLayer = null;
let lastQuery = null;
let autoRefreshTimer = null;
let activeThemeMode = loadThemeMode();
let activeTemperatureTone = 'mild';

searchButton.addEventListener('click', () => getWeatherByCity());
locateButton.addEventListener('click', useCurrentLocation);
themeToggle.addEventListener('click', toggleThemeMode);
cityInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        getWeatherByCity();
    }
});

quickSearchButtons.forEach(button => {
    button.addEventListener('click', () => {
        cityInput.value = button.dataset.city || '';
        getWeatherByCity(button.dataset.city || '');
    });
});

clearHistoryButton.addEventListener('click', () => {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
    renderRecentSearches();
});

layerButtons.forEach(button => {
    button.addEventListener('click', () => setMapOverlay(button.dataset.layer || 'none'));
});

applyThemeMode(activeThemeMode);
applyTemperatureTone(activeTemperatureTone);
startClock();
renderRecentSearches();
initializeMap();
startAutoRefreshLoop();

function initializeMap() {
    if (typeof L === 'undefined') {
        mapStatus.textContent = 'Map could not load in this browser session.';
        return;
    }

    map = L.map('weather-map', {
        worldCopyJump: true
    }).setView([20.5937, 78.9629], 3);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    marker = L.marker([20.5937, 78.9629]).addTo(map);
    marker.bindPopup('Search or click the map to inspect weather.').openPopup();

    map.on('click', event => {
        const { lat, lng } = event.latlng;
        getWeatherByCoordinates(lat, lng);
    });

    setMapOverlay('clouds');
}

function loadRecentSearches() {
    try {
        return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]');
    } catch (error) {
        return [];
    }
}

function startClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

function updateClock() {
    if (!clockHourHand || !clockMinuteHand || !clockSecondHand || !clockDigital || !clockDate) return;

    const now = new Date();
    const seconds = now.getSeconds();
    const minutes = now.getMinutes();
    const hours = now.getHours();

    const secondRotation = seconds * 6;
    const minuteRotation = minutes * 6 + seconds * 0.1;
    const hourRotation = (hours % 12) * 30 + minutes * 0.5;

    clockHourHand.style.transform = `translateX(-50%) rotate(${hourRotation}deg)`;
    clockMinuteHand.style.transform = `translateX(-50%) rotate(${minuteRotation}deg)`;
    clockSecondHand.style.transform = `translateX(-50%) rotate(${secondRotation}deg)`;
    clockDigital.textContent = now.toLocaleTimeString('en-GB', { hour12: false });
    clockDate.textContent = now.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
    });
}

function saveRecentSearch(city) {
    const normalized = city.trim();
    if (!normalized) return;

    const updated = [normalized, ...loadRecentSearches().filter(item => item.toLowerCase() !== normalized.toLowerCase())]
        .slice(0, 6);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    renderRecentSearches();
}

function renderRecentSearches() {
    const recent = loadRecentSearches();
    if (!recent.length) {
        recentSearchesContainer.innerHTML = '<p class="recent-empty">No searches yet.</p>';
        return;
    }

    recentSearchesContainer.innerHTML = recent
        .map(
            city => `<button class="recent-chip" type="button" data-city="${escapeHtml(city)}">${escapeHtml(city)}</button>`
        )
        .join('');

    recentSearchesContainer.querySelectorAll('.recent-chip').forEach(button => {
        button.addEventListener('click', () => {
            cityInput.value = button.dataset.city || '';
            getWeatherByCity(button.dataset.city || '');
        });
    });
}

function loadThemeMode() {
    const stored = localStorage.getItem(THEME_MODE_KEY);
    return stored === 'dark' ? 'dark' : 'light';
}

function toggleThemeMode() {
    activeThemeMode = activeThemeMode === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_MODE_KEY, activeThemeMode);
    applyThemeMode(activeThemeMode);
}

function applyThemeMode(mode) {
    body.dataset.mode = mode;
    themeToggle.setAttribute('aria-pressed', String(mode === 'dark'));
    themeToggle.querySelector('.theme-toggle-label').textContent = mode === 'dark' ? 'Light mode' : 'Dark mode';
    updateThemeStatus();
}

function applyTemperatureTone(tone) {
    activeTemperatureTone = tone;
    body.dataset.tempTone = tone;
    updateThemeStatus();
    updateTemperatureMood();
}

function updateThemeStatus() {
    if (!themeStatus) return;
    const modeLabel = activeThemeMode === 'dark' ? 'Dark mode' : 'Light mode';
    const toneLabel = capitalizeWords(activeTemperatureTone);
    themeStatus.textContent = `${modeLabel} - ${toneLabel} theme`;
}

function updateTemperatureMood(place, temp) {
    if (!temperatureMood) return;

    const toneCopy = {
        cold: 'Cool palette active for low-temperature conditions.',
        mild: 'Balanced palette active for moderate conditions.',
        warm: 'Warm palette active for hotter conditions.'
    };

    if (place && Number.isFinite(temp)) {
        temperatureMood.textContent = `${place} is shaping the interface around ${temp}${String.fromCharCode(176)}C. ${toneCopy[activeTemperatureTone]}`;
        return;
    }

    temperatureMood.textContent = 'Theme responds to the selected place.';
}

function getTemperatureTone(temp) {
    if (!Number.isFinite(temp)) return 'mild';
    if (temp <= 16) return 'cold';
    if (temp >= 30) return 'warm';
    return 'mild';
}

function renderLoading(label) {
    body.classList.add('is-fetching');
    weatherDiv.className = 'weather-card loading-state';
    weatherDiv.innerHTML = `
        <div class="loading-pulse"></div>
        <p>Checking ${escapeHtml(label)} and mapping the latest weather signals...</p>
    `;
    updateSignalTile(searchSignal, 'Searching', 'is-busy');
    updateSignalTile(modelSignal, 'Syncing', 'is-busy');
}

function renderError(message) {
    body.classList.remove('is-fetching');
    weatherDiv.className = 'weather-card error-state';
    weatherDiv.innerHTML = `<p>${escapeHtml(message)}</p>`;
    updateSignalTile(searchSignal, 'Needs retry', 'is-alert');
}

function renderWeather(data) {
    body.classList.remove('is-fetching');
    const accuracyLabel = data.accuracy ? `${data.accuracy} confidence` : 'standard confidence';
    const locationConfidence = data.locationAccuracy || data.resolvedLocation?.confidence || 'standard';
    const temperatureConfidence = calibrationLabel(data.currentTemperatureCalibration?.confidence || 'standard');
    const forecastConfidence = calibrationLabel(data.predictionMeta?.confidence || 'standard');
    const providerAgreement = calibrationLabel(data.predictionMeta?.providerAgreement || data.providerComparison?.agreement || 'standard');
    const tomorrowTemp = typeof data.tomorrow?.temp === 'number'
        ? `${data.tomorrow.temp}${DEGREE_HTML}`
        : `${data.forecastTemp}${DEGREE_HTML}`;
    const tomorrowRange = data.tomorrow
        ? `${data.tomorrow.min}${DEGREE_HTML} to ${data.tomorrow.max}${DEGREE_HTML}`
        : `${data.forecastTemp - 1}${DEGREE_HTML} to ${data.forecastTemp + 1}${DEGREE_HTML}`;
    const trendCopy =
        data.forecast === 'warmer'
            ? 'Tomorrow trends warmer than the current reading.'
            : data.forecast === 'cooler'
              ? 'Tomorrow trends cooler than the current reading.'
              : 'Tomorrow looks close to the current reading.';

    const hourlyMarkup = Array.isArray(data.hourly) && data.hourly.length
        ? data.hourly
            .map(item => `
                <article class="hour-card">
                    <p class="label">${escapeHtml(item.time)}</p>
                    <strong>${item.temp}${DEGREE_HTML}</strong>
                    <p>${escapeHtml(item.description)}</p>
                    <p>${item.windDirection} wind ${item.windSpeed ?? 'N/A'} m/s</p>
                    <p>Rain ${item.pop}%</p>
                </article>
            `)
            .join('')
        : '<p class="recent-empty">Hourly forecast unavailable.</p>';
    const dailyMarkup = Array.isArray(data.daily) && data.daily.length
        ? data.daily
            .map(item => `
                <article class="metric-box daily-card">
                    <p class="label">${escapeHtml(item.label)}</p>
                    <strong>${item.max}${DEGREE_HTML} / ${item.min}${DEGREE_HTML}</strong>
                    <p>${escapeHtml(item.description)}</p>
                    <p>Rain ${item.pop}%</p>
                </article>
            `)
            .join('')
        : '<p class="recent-empty">5-day forecast unavailable.</p>';
    const providerMarkup = Array.isArray(data.providerComparison?.providers) && data.providerComparison.providers.length
        ? data.providerComparison.providers
            .map(provider => `
                <article class="metric-box provider-card">
                    <p class="label">${escapeHtml(provider.name)}</p>
                    <strong>${provider.forecastTemp != null ? `${provider.forecastTemp}${DEGREE_HTML}` : 'N/A'}</strong>
                    <p>Now ${provider.currentTemp != null ? `${provider.currentTemp}${DEGREE_HTML}` : 'N/A'}</p>
                    <p>${escapeHtml(provider.description || 'No summary')}</p>
                    <p>${provider.min != null && provider.max != null ? `${provider.min}${DEGREE_HTML} to ${provider.max}${DEGREE_HTML}` : 'Range unavailable'}</p>
                </article>
            `)
            .join('')
        : '<p class="recent-empty">Only one provider is available for this lookup.</p>';

    const alertsMarkup = data.atmosphere?.alerts?.length
        ? data.atmosphere.alerts
            .map(alert => `<span class="signal-badge">${escapeHtml(alert)}</span>`)
            .join('')
        : '<span class="signal-badge">No severe signal detected</span>';
    const calibration = data.currentTemperatureCalibration || null;
    const rawTempMarkup = Number.isFinite(data.rawCurrentTemp)
        ? `${data.rawCurrentTemp}${DEGREE_HTML}`
        : 'N/A';
    const calibrationConfidence = calibration?.confidence
        ? `${calibration.confidence} calibration`
        : 'standard calibration';
    const resolvedPlace = data.resolvedLocation?.name || data.city;
    const tone = getTemperatureTone(data.currentTemp);

    applyTemperatureTone(tone);
    updateTemperatureMood(data.city, data.currentTemp);
    updateSignalTile(searchSignal, data.city, 'is-live');
    updateSignalTile(mapSignal, data.coordinates ? 'Geo-linked' : 'Dataset view', data.coordinates ? 'is-live' : 'is-idle');
    updateSignalTile(
        modelSignal,
        data.predictionMeta?.method ? capitalizeLabel(data.predictionMeta.method) : 'Standby',
        data.predictionMeta?.confidence === 'high'
            ? 'is-live'
            : data.predictionMeta?.confidence === 'guarded'
              ? 'is-alert'
              : 'is-idle'
    );

    weatherDiv.className = `weather-card weather-ready accuracy-${data.accuracy || 'medium'}`;
    weatherDiv.innerHTML = `
        <div class="weather-topline">
            <div>
                <p class="label">Now in</p>
                <h2>${escapeHtml(data.city)} <span>${escapeHtml(data.country)}</span></h2>
                <p class="location-caption">Resolved place: ${escapeHtml(resolvedPlace)}</p>
            </div>
            <div class="badge-stack">
                <div class="accuracy-badge">${escapeHtml(accuracyLabel)}</div>
                <div class="calibration-badge">${escapeHtml(calibrationConfidence)}</div>
            </div>
        </div>

        <div class="hero-metrics">
            <div class="hero-temp">${data.currentTemp}${DEGREE_HTML}</div>
            <div class="hero-copy">
                <p>${escapeHtml(data.description)}</p>
                <p>Feels like ${data.feelsLike}${DEGREE_HTML}</p>
                <p>Raw air temp ${rawTempMarkup}</p>
                <p>${escapeHtml(formatCoordinateLabel(data.coordinates))}</p>
                ${data.mapLocation?.label ? `<p>Map pinpoint ${escapeHtml(data.mapLocation.label)}</p>` : ''}
            </div>
        </div>

        <div class="confidence-strip">
            <article class="confidence-card confidence-${confidenceTone(locationConfidence)}">
                <p class="label">Location</p>
                <strong>${escapeHtml(calibrationLabel(locationConfidence))}</strong>
                <p>${escapeHtml(data.providerLocation?.name || data.city)}</p>
            </article>
            <article class="confidence-card confidence-${confidenceTone(temperatureConfidence)}">
                <p class="label">Temperature</p>
                <strong>${escapeHtml(temperatureConfidence)}</strong>
                <p>${escapeHtml(calibration?.method || 'hybrid calibration')}</p>
            </article>
            <article class="confidence-card confidence-${confidenceTone(forecastConfidence)}">
                <p class="label">Forecast</p>
                <strong>${escapeHtml(forecastConfidence)}</strong>
                <p>${escapeHtml(providerAgreement)} provider agreement</p>
            </article>
        </div>

        <div class="metric-grid">
            <article class="metric-box">
                <p class="label">Humidity</p>
                <strong>${data.currentHumidity}%</strong>
            </article>
            <article class="metric-box">
                <p class="label">Wind</p>
                <strong>${data.windSpeed != null ? `${data.windSpeed} m/s ${escapeHtml(data.windDirection || '')}` : 'N/A'}</strong>
            </article>
            <article class="metric-box">
                <p class="label">Pressure</p>
                <strong>${data.pressure != null ? `${data.pressure} hPa` : 'N/A'}</strong>
            </article>
            <article class="metric-box">
                <p class="label">Calibrated now</p>
                <strong>${data.currentTemp}${DEGREE_HTML}</strong>
            </article>
            <article class="metric-box">
                <p class="label">Location accuracy</p>
                <strong>${escapeHtml(calibrationLabel(locationConfidence))}</strong>
            </article>
            <article class="metric-box">
                <p class="label">Region</p>
                <strong>${escapeHtml(data.region)}</strong>
            </article>
            <article class="metric-box">
                <p class="label">Visibility</p>
                <strong>${escapeHtml(data.visibility || 'N/A')}</strong>
            </article>
            <article class="metric-box">
                <p class="label">Clouds</p>
                <strong>${data.clouds != null ? `${data.clouds}%` : 'N/A'}</strong>
            </article>
            <article class="metric-box">
                <p class="label">Sunrise</p>
                <strong>${escapeHtml(data.sunrise || 'N/A')}</strong>
            </article>
            <article class="metric-box">
                <p class="label">Sunset</p>
                <strong>${escapeHtml(data.sunset || 'N/A')}</strong>
            </article>
        </div>

        <div class="forecast-panel">
            <div>
                <p class="label">Tomorrow forecast (${escapeHtml(data.selectedModel || 'live')})</p>
                <h3>${data.forecastTemp}${DEGREE_HTML}</h3>
                <p>${escapeHtml(trendCopy)}</p>
            </div>
            <div class="forecast-side">
                <p><strong>Forecast anchor:</strong> ${tomorrowTemp}</p>
                <p><strong>Expected range:</strong> ${tomorrowRange}</p>
                <p><strong>Rain chance:</strong> ${data.tomorrow?.precipitationChance ?? 0}%</p>
                <p><strong>Provider spread:</strong> ${data.providerComparison?.spread != null ? `${data.providerComparison.spread}${DEGREE_HTML}` : 'N/A'}</p>
                <p><strong>Last updated:</strong> ${escapeHtml(data.updatedAt || 'Live')}</p>
            </div>
        </div>

        ${calibration ? `
            <section class="temperature-panel">
                <div class="section-header">
                    <div>
                        <p class="label">Temperature correction</p>
                        <h3>Current reading alignment</h3>
                    </div>
                    <p class="section-note">${escapeHtml(calibration.method || 'hybrid')}</p>
                </div>
                <div class="temperature-grid">
                    <article class="metric-box">
                        <p class="label">Displayed now</p>
                        <strong>${data.currentTemp}${DEGREE_HTML}</strong>
                    </article>
                    <article class="metric-box">
                        <p class="label">Raw provider</p>
                        <strong>${rawTempMarkup}</strong>
                    </article>
                    <article class="metric-box">
                        <p class="label">Feels like</p>
                        <strong>${data.feelsLike}${DEGREE_HTML}</strong>
                    </article>
                    <article class="metric-box">
                        <p class="label">Short-term avg</p>
                        <strong>${Number.isFinite(calibration.components?.shortTermAvg) ? `${calibration.components.shortTermAvg}${DEGREE_HTML}` : 'N/A'}</strong>
                    </article>
                </div>
                <p class="temperature-note">${escapeHtml(calibration.note || '')}</p>
                <p class="temperature-note">${escapeHtml(calibration.insight || '')}</p>
            </section>
        ` : ''}

        <section class="provider-panel">
            <div class="section-header">
                <div>
                    <p class="label">Provider comparison</p>
                    <h3>Consensus tracker</h3>
                </div>
                <p class="section-note">${escapeHtml(data.providerComparison?.agreement || 'standard')} agreement</p>
            </div>
            <div class="provider-grid">${providerMarkup}</div>
        </section>

        <section class="sky-panel">
            <div class="section-header">
                <div>
                    <p class="label">Sky Motion</p>
                    <h3>${escapeHtml(data.atmosphere?.headline || 'Atmospheric trend analysis')}</h3>
                </div>
                <p class="section-note">${escapeHtml(data.atmosphere?.confidence || 'standard')} confidence</p>
            </div>
            <div class="sky-grid">
                <article class="sky-box">
                    <p class="label">Cloud movement</p>
                    <p>${escapeHtml(data.atmosphere?.cloudMovement || 'Unavailable')}</p>
                </article>
                <article class="sky-box">
                    <p class="label">Wind behavior</p>
                    <p>${escapeHtml(data.atmosphere?.windMovement || 'Unavailable')}</p>
                </article>
                <article class="sky-box">
                    <p class="label">Heat / cold signal</p>
                    <p>${escapeHtml(data.atmosphere?.thermalSignal || 'Unavailable')}</p>
                </article>
            </div>
            <div class="signal-badges">${alertsMarkup}</div>
        </section>

        <section class="hourly-panel">
            <div class="section-header">
                <div>
                    <p class="label">Next 5 days</p>
                    <h3>Daily forecast</h3>
                </div>
                <p class="section-note">Highs, lows, and rain potential</p>
            </div>
            <div class="daily-grid">${dailyMarkup}</div>
        </section>

        <section class="hourly-panel">
            <div class="section-header">
                <div>
                    <p class="label">Next 24 hours</p>
                    <h3>Hourly outlook</h3>
                </div>
                <p class="section-note">Provider-backed timeline</p>
            </div>
            <div class="hourly-grid">${hourlyMarkup}</div>
        </section>

        ${data.tomorrow ? `
            <div class="detail-strip">
                <span>${escapeHtml(data.tomorrow.description)}</span>
                <span>${data.tomorrow.humidity}% humidity</span>
                <span>${data.tomorrow.samples} forecast samples</span>
                <span>${escapeHtml(data.tomorrow.date)}</span>
                <span>${escapeHtml(data.tomorrow.time)}</span>
                <span>${data.tomorrow.confidence} forecast match</span>
            </div>
        ` : ''}

        ${data.liveStatus?.message ? `<p class="live-status">${escapeHtml(data.liveStatus.message)}</p>` : ''}
        ${data.fallback ? `<p class="notice">${escapeHtml(data.fallbackNote)}</p>` : ''}
        <p class="source">${escapeHtml(data.source)}</p>
    `;
}

function calibrationLabel(value) {
    return capitalizeLabel(String(value || 'standard'));
}

function confidenceTone(value) {
    const normalized = String(value || '').toLowerCase();
    if (normalized.includes('very high') || normalized.includes('high')) return 'high';
    if (normalized.includes('guarded') || normalized.includes('low')) return 'low';
    return 'medium';
}

function scrollToWeatherCard() {
    if (!weatherDiv) return;

    weatherDiv.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
    });
}

async function getWeatherByCity(prefilledCity) {
    const city = (prefilledCity || cityInput.value).trim();
    if (!city) {
        renderError('Please enter a city name.');
        return;
    }

    cityInput.value = city;
    mapStatus.textContent = `Searching for ${city}...`;
    renderLoading(city);
    lastQuery = {
        type: 'city',
        city
    };
    await fetchWeather(`/api/weather?city=${encodeURIComponent(city)}`, {
        saveLabel: city,
        scrollToWeather: true
    });
}

async function getWeatherByCoordinates(lat, lon, source = 'map') {
    const isCurrentLocation = source === 'current-location';
    const label = isCurrentLocation ? 'your current location' : `map point ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    mapStatus.textContent = `Inspecting ${label}`;
    renderLoading(label);
    lastQuery = {
        type: 'coordinates',
        lat,
        lon
    };
    await fetchWeather(`/api/weather?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&source=${encodeURIComponent(source)}`, {
        mapPoint: { lat, lon }
    });
}

function useCurrentLocation() {
    if (!navigator.geolocation) {
        renderError('Geolocation is not supported in this browser.');
        return;
    }

    mapStatus.textContent = 'Finding your current location...';
    renderLoading('your current location');

    navigator.geolocation.getCurrentPosition(
        position => {
            const { latitude, longitude } = position.coords;
            lastQuery = {
                type: 'coordinates',
                lat: latitude,
                lon: longitude
            };
            getWeatherByCoordinates(latitude, longitude, 'current-location');
        },
        error => {
            renderError('Unable to access your location.');
            mapStatus.textContent = error.message || 'Location access denied.';
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 300000
        }
    );
}

async function fetchWeather(url, options = {}) {
    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
            renderError(data.error || 'Weather not found.');
            mapStatus.textContent = data.error || 'Location unavailable.';
            return;
        }

        renderWeather(data);
        if (options.saveLabel) {
            saveRecentSearch(options.saveLabel);
        }

        const coords = data.coordinates || options.mapPoint;
        if (coords && map) {
            updateMap(coords.lat, coords.lon, buildMapPopupLabel(data));
        }

        if (options.scrollToWeather) {
            scrollToWeatherCard();
        }

        mapStatus.textContent = data.coordinates
            ? buildMapStatusLabel(data)
            : data.city;
        resetAutoRefreshLoop();
    } catch (error) {
        renderError('Unable to connect to the backend.');
        mapStatus.textContent = 'Weather lookup failed.';
    }
}

function updateMap(lat, lon, label) {
    if (!map || !marker) return;
    marker.setLatLng([lat, lon]);
    marker.bindPopup(escapeHtml(label)).openPopup();
    map.flyTo([lat, lon], 6, {
        duration: 1.2
    });
}

function buildMapPopupLabel(data) {
    const preciseLabel = data.mapLocation?.label;
    if (!preciseLabel) return data.city;
    if (preciseLabel === data.city) return preciseLabel;
    return `${preciseLabel} (${data.city})`;
}

function buildMapStatusLabel(data) {
    if (!data.coordinates) return data.city;

    const preciseLabel = data.mapLocation?.label;
    const baseLabel = preciseLabel && preciseLabel !== data.city
        ? `${preciseLabel} near ${data.city}`
        : preciseLabel || data.city;

    return `${baseLabel} at ${data.coordinates.lat.toFixed(2)}, ${data.coordinates.lon.toFixed(2)}`;
}

function setMapOverlay(layerKey) {
    if (!map) return;

    animateOverlaySwitch();

    if (overlayLayer) {
        map.removeLayer(overlayLayer);
        overlayLayer = null;
    }

    layerButtons.forEach(button => {
        button.classList.toggle('is-active', button.dataset.layer === layerKey);
    });

    if (layerKey === 'none') {
        renderOverlayLegend('none');
        mapStatus.textContent = 'Overlay turned off. Click anywhere to inspect that point.';
        updateSignalTile(mapSignal, 'Overlay off', 'is-idle');
        return;
    }

    const urlTemplate = MAP_LAYERS[layerKey];
    if (!urlTemplate) return;

    overlayLayer = L.tileLayer(urlTemplate, {
        opacity: layerKey === 'radar' ? 0.45 : 0.55,
        maxZoom: layerKey === 'radar' ? 7 : 18,
        attribution: 'Weather overlays © OpenWeatherMap'
    }).addTo(map);

    renderOverlayLegend(layerKey);
    mapStatus.textContent = `${capitalizeLabel(layerKey)} overlay active. Click anywhere to inspect that point.`;
    updateSignalTile(mapSignal, capitalizeLabel(layerKey), 'is-live');
}

function renderOverlayLegend(layerKey) {
    const legend = OVERLAY_LEGENDS[layerKey] || OVERLAY_LEGENDS.none;
    if (!overlayLegend) return;

    const scale = legend.colors.length
        ? `
            <div class="legend-scale">
                ${legend.colors.map(color => `<span class="legend-stop" style="background:${color}"></span>`).join('')}
            </div>
        `
        : '';

    overlayLegend.classList.toggle('is-hidden', layerKey === 'none');
    overlayLegend.innerHTML = `
        <p class="legend-title">${escapeHtml(legend.title)}</p>
        ${scale}
        <p class="legend-note">${escapeHtml(legend.note)}</p>
    `;
}

function animateOverlaySwitch() {
    if (!mapPanel) return;
    mapPanel.classList.add('is-switching');
    setTimeout(() => {
        mapPanel.classList.remove('is-switching');
    }, 320);
}

function startAutoRefreshLoop() {
    resetAutoRefreshLoop();
}

function resetAutoRefreshLoop() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
    }

    autoRefreshTimer = setInterval(() => {
        refreshLastQuery();
    }, AUTO_REFRESH_MS);
}

function refreshLastQuery() {
    if (!lastQuery) return;

    if (lastQuery.type === 'city' && lastQuery.city) {
        fetchWeather(`/api/weather?city=${encodeURIComponent(lastQuery.city)}`);
        return;
    }

    if (lastQuery.type === 'coordinates') {
        fetchWeather(
            `/api/weather?lat=${lastQuery.lat.toFixed(4)}&lon=${lastQuery.lon.toFixed(4)}`,
            { mapPoint: { lat: lastQuery.lat, lon: lastQuery.lon } }
        );
    }
}

function formatCoordinateLabel(coordinates) {
    if (!coordinates) return 'Coordinates unavailable';
    return `Lat ${coordinates.lat.toFixed(2)}, Lon ${coordinates.lon.toFixed(2)}`;
}

function capitalizeLabel(value) {
    return String(value).replace(/(^\w|_\w)/g, match => match.replace('_', ' ').toUpperCase());
}

function capitalizeWords(value) {
    return String(value).replace(/\b\w/g, char => char.toUpperCase());
}

function updateSignalTile(element, value, stateClass) {
    if (!element) return;

    element.classList.remove('is-live', 'is-alert', 'is-busy', 'is-idle');
    if (stateClass) {
        element.classList.add(stateClass);
    }

    const strong = element.querySelector('strong');
    if (strong) {
        strong.textContent = value;
    }
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
