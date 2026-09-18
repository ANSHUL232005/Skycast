const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');

function loadEnvFile() {
    const envPath = path.join(__dirname, '../.env');
    if (!fs.existsSync(envPath)) return;

    const content = fs.readFileSync(envPath, 'utf-8').replace(/^\uFEFF/, '');
    content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) return;

        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        if (key && process.env[key] == null) {
            process.env[key] = value;
        }
    });
}

loadEnvFile();

const app = express();
const port = process.env.PORT || 3007;
const data = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../data/weather-data.json'), 'utf-8').replace(/^\uFEFF/, '')
);
const API_KEY = process.env.OPENWEATHER_API_KEY || '6c3af102954a8b1824e96a8517226222';
const WEATHER_URL = 'https://api.openweathermap.org/data/2.5/weather';
const FORECAST_URL = 'https://api.openweathermap.org/data/2.5/forecast';
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_URL = 'https://api.openweathermap.org/geo/1.0/direct';
const REVERSE_GEOCODING_URL = 'https://api.openweathermap.org/geo/1.0/reverse';
const WEATHER_TILE_URL = 'https://tile.openweathermap.org/map';
const RADAR_TILE_URL = 'https://maps.openweathermap.org/maps/2.0/radar';
const MAX_CITY_LENGTH = 80;
const LOCATION_LABEL_OVERRIDES = {
    
};

const templates = {
    india: {
        type: 'city',
        country: 'India',
        region: 'General',
        history: Array.from({ length: 5 }, (_, index) => ({
            day: index + 1,
            temp: 28 + index,
            humidity: 60,
            description: 'sunny'
        }))
    },
    global: {
        type: 'city',
        country: 'Global',
        region: 'Temperate',
        history: Array.from({ length: 5 }, (_, index) => ({
            day: index + 1,
            temp: 20 + index,
            humidity: 60,
            description: 'clear'
        }))
    }
};

function shouldRetryWithIpv4(error) {
    return ['EACCES', 'ENETUNREACH', 'ETIMEDOUT', 'ECONNRESET'].includes(error?.code);
}

function performHttpsRequest(url, handlers) {
    const attempts = [{ family: undefined }, { family: 4 }];

    return new Promise((resolve, reject) => {
        let attemptIndex = 0;
        const requestUrl = new URL(url);

        function runAttempt() {
            const attempt = attempts[attemptIndex];
            const options = {
                protocol: requestUrl.protocol,
                hostname: requestUrl.hostname,
                port: requestUrl.port || 443,
                path: `${requestUrl.pathname}${requestUrl.search}`,
                method: 'GET'
            };

            if (attempt.family) {
                options.family = attempt.family;
            }

            const request = https
                .get(options, response => {
                    handlers.onResponse(response, resolve, reject);
                })
                .on('error', error => {
                    attempt.error = error.code || error.message || 'request-error';

                    if (!attempt.family && shouldRetryWithIpv4(error) && attemptIndex < attempts.length - 1) {
                        attemptIndex += 1;
                        return runAttempt();
                    }

                    error.requestAttempts = attempts.map(entry => ({
                        family: entry.family || 'auto',
                        error: entry.error || null
                    }));
                    reject(error);
                });

            request.setTimeout(10000, () => {
                const timeoutError = new Error('Weather API timed out');
                timeoutError.code = 'ETIMEDOUT';
                request.destroy(timeoutError);
            });
        }

        runAttempt();
    });
}

function fetchJson(url) {
    return performHttpsRequest(url, {
        onResponse(response, resolve, reject) {
            let body = '';

            response.on('data', chunk => {
                body += chunk;
            });

            response.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    if (response.statusCode !== 200) {
                        const error = new Error(parsed?.message || 'Weather API request failed');
                        error.statusCode = response.statusCode;
                        return reject(error);
                    }
                    resolve(parsed);
                } catch (error) {
                    reject(error);
                }
            });
        }
    });
}

function fetchBinary(url) {
    return performHttpsRequest(url, {
        onResponse(response, resolve, reject) {
            const chunks = [];

            response.on('data', chunk => {
                chunks.push(chunk);
            });

            response.on('end', () => {
                if (response.statusCode !== 200) {
                    const error = new Error(`Tile request failed with status ${response.statusCode}`);
                    error.statusCode = response.statusCode;
                    return reject(error);
                }

                resolve({
                    body: Buffer.concat(chunks),
                    contentType: response.headers['content-type'] || 'image/png',
                    cacheControl: response.headers['cache-control'] || 'public, max-age=600'
                });
            });
        }
    });
}

function clampNumber(value, min, max, fallback = null) {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

function roundNumber(value, fallback = null) {
    return Number.isFinite(value) ? Math.round(value) : fallback;
}

function average(values) {
    return values.length
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null;
}

function averageFloat(values) {
    return values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;
}

function weightedAverage(entries) {
    const validEntries = entries.filter(
        entry => Number.isFinite(entry?.value) && Number.isFinite(entry?.weight) && entry.weight > 0
    );
    if (!validEntries.length) return null;

    const totalWeight = validEntries.reduce((sum, entry) => sum + entry.weight, 0);
    if (!totalWeight) return null;

    return validEntries.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight;
}

function normalizeQuery(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function sanitizeCity(value) {
    return String(value || '')
        .trim()
        .replace(/\s*,\s*/g, ', ')
        .replace(/\s+/g, ' ');
}

function splitLocationTerms(value) {
    return sanitizeCity(value)
        .split(',')
        .map(part => normalizeQuery(part))
        .filter(Boolean);
}

function capitalizeWords(value) {
    return String(value || '').replace(/\b\w/g, char => char.toUpperCase());
}

function formatLocationLabel(location) {
    return [location?.name, location?.state, location?.country].filter(Boolean).join(', ');
}

function normalizeResolvedLocation(location) {
    if (!location?.name) return location;

    const override = LOCATION_LABEL_OVERRIDES[normalizeQuery(location.name)];
    if (!override) return location;

    const normalizedState = normalizeQuery(location.state);
    const normalizedCountry = normalizeQuery(location.country);
    const isExpectedRegion = !normalizedState
        || normalizedState === 'haryana'
        || normalizedCountry === 'in'
        || normalizedCountry === 'india';

    return isExpectedRegion ? { ...location, ...override } : location;
}

function calculateCoordinateDistance(latA, lonA, latB, lonB) {
    if (![latA, lonA, latB, lonB].every(Number.isFinite)) return Number.POSITIVE_INFINITY;

    const latDelta = latA - latB;
    const lonDelta = lonA - lonB;
    return Math.sqrt(latDelta * latDelta + lonDelta * lonDelta);
}

function isMoreSpecificLocation(candidate, referenceName) {
    const candidateName = normalizeQuery(candidate?.name);
    const reference = normalizeQuery(referenceName);
    if (!candidateName || !reference) return false;
    if (candidateName === reference) return false;

    return !candidateName.includes('district') && !candidateName.includes('division');
}

function selectPreciseReverseLocation(candidates, lat, lon, providerName) {
    if (!Array.isArray(candidates) || !candidates.length) return null;

    const distinctCandidates = candidates.filter(candidate => isMoreSpecificLocation(candidate, providerName));
    const pool = distinctCandidates.length ? distinctCandidates : candidates;

    return [...pool]
        .sort((left, right) => {
            const leftDistance = calculateCoordinateDistance(Number(left?.lat), Number(left?.lon), lat, lon);
            const rightDistance = calculateCoordinateDistance(Number(right?.lat), Number(right?.lon), lat, lon);
            if (leftDistance !== rightDistance) return leftDistance - rightDistance;

            const leftLabelLength = formatLocationLabel(left).length;
            const rightLabelLength = formatLocationLabel(right).length;
            return leftLabelLength - rightLabelLength;
        })[0];
}

function scoreReverseGeocodeCandidate(candidate, lat, lon, providerName) {
    const distance = calculateCoordinateDistance(Number(candidate?.lat), Number(candidate?.lon), lat, lon);
    let score = 0;

    if (Number.isFinite(distance)) {
        if (distance <= 0.05) score += 90;
        else if (distance <= 0.15) score += 65;
        else if (distance <= 0.35) score += 35;
        else if (distance <= 0.7) score += 12;
    }

    if (isSameLocationFamily(candidate?.name, providerName)) score += 95;
    if (locationTier(candidate) >= 2) score += 12;
    if (isAdministrativeArea(candidate)) score -= 18;

    return score;
}

function selectPrimaryReverseLocation(candidates, lat, lon, providerName) {
    if (!Array.isArray(candidates) || !candidates.length) return null;

    return [...candidates]
        .map(candidate => ({
            candidate,
            score: scoreReverseGeocodeCandidate(candidate, lat, lon, providerName)
        }))
        .sort((left, right) => {
            if (left.score !== right.score) return right.score - left.score;

            const leftDistance = calculateCoordinateDistance(
                Number(left.candidate?.lat),
                Number(left.candidate?.lon),
                lat,
                lon
            );
            const rightDistance = calculateCoordinateDistance(
                Number(right.candidate?.lat),
                Number(right.candidate?.lon),
                lat,
                lon
            );
            return leftDistance - rightDistance;
        })[0]?.candidate || null;
}

function buildPreciseMapLabel(location, fallbackCountryCode) {
    const normalizedLocation = normalizeResolvedLocation(location);
    return [
        normalizedLocation?.name,
        normalizedLocation?.state,
        normalizedLocation?.country || fallbackCountryCode
    ]
        .filter(Boolean)
        .join(', ');
}

function isSameLocationFamily(leftName, rightName) {
    const left = normalizeQuery(leftName);
    const right = normalizeQuery(rightName);
    if (!left || !right) return false;
    if (left === right) return true;

    return left.includes(right) || right.includes(left);
}

function isAdministrativeArea(location) {
    const name = normalizeQuery(location?.name);
    if (!name) return false;

    return ['district', 'division', 'region', 'county', 'province', 'state'].some(token => name.includes(token));
}

function locationTier(location) {
    const normalizedState = normalizeQuery(location?.state);
    const normalizedCountry = normalizeQuery(location?.country);
    const name = normalizeQuery(location?.name);

    if (!name) return 0;
    if (normalizedState && normalizedCountry) return 3;
    if (normalizedState || normalizedCountry) return 2;
    return 1;
}

function findNearestDatasetLocation(lat, lon, countryCode = '') {
    const normalizedCountryCode = normalizeQuery(countryCode);
    return data.cities
        .filter(city => Number.isFinite(city?.lat) && Number.isFinite(city?.lon))
        .map(city => ({
            city,
            distance: calculateCoordinateDistance(Number(city.lat), Number(city.lon), lat, lon)
        }))
        .filter(entry => Number.isFinite(entry.distance))
        .sort((left, right) => {
            if (left.distance !== right.distance) return left.distance - right.distance;

            const leftCountryBonus = normalizeQuery(left.city.country) === normalizedCountryCode ? -1 : 0;
            const rightCountryBonus = normalizeQuery(right.city.country) === normalizedCountryCode ? -1 : 0;
            return leftCountryBonus - rightCountryBonus;
        })[0]?.city || null;
}

function resolveLocationConfidence({ reverseLocation, preciseLocation, providerName, datasetLocation }) {
    const providerMatchesReverse = isSameLocationFamily(providerName, reverseLocation?.name);
    const providerMatchesPrecise = isSameLocationFamily(providerName, preciseLocation?.name);
    const datasetMatchesProvider = isSameLocationFamily(datasetLocation?.name, providerName);
    const datasetMatchesPrecise = isSameLocationFamily(datasetLocation?.name, preciseLocation?.name);

    if (providerMatchesReverse && (providerMatchesPrecise || datasetMatchesProvider)) return 'high';
    if (providerMatchesReverse || providerMatchesPrecise || datasetMatchesPrecise) return 'medium';
    return 'guarded';
}

function extractCandidateAliases(location) {
    const localNames = location?.local_names && typeof location.local_names === 'object'
        ? Object.values(location.local_names)
        : [];

    return [location?.name, location?.state, location?.country, ...localNames]
        .map(value => normalizeQuery(value))
        .filter(Boolean);
}

function findLocation(query) {
    const normalized = normalizeQuery(query);
    const exactMatch = data.cities.find(city => normalizeQuery(city.name) === normalized);
    if (exactMatch) return { ...exactMatch, matchSource: 'dataset' };

    const partialMatch = data.cities.find(city => normalizeQuery(city.name).includes(normalized));
    if (partialMatch) return { ...partialMatch, matchSource: 'dataset' };

    return null;
}

function buildTemplateLocation(name, country) {
    const key = String(country || '').toLowerCase() === 'india' ? 'india' : 'global';
    return {
        name,
        ...templates[key],
        country: country || templates[key].country,
        matchSource: 'template'
    };
}

function scoreGeocodingCandidate(location, query, preferredLocation) {
    const normalizedQuery = normalizeQuery(query);
    const queryTerms = splitLocationTerms(query);
    const aliases = extractCandidateAliases(location);
    const primaryName = normalizeQuery(location?.name || '');
    const stateName = normalizeQuery(location?.state || '');
    const countryName = normalizeQuery(location?.country || '');
    const preferredName = normalizeQuery(preferredLocation?.name || '');
    const preferredCountry = normalizeQuery(preferredLocation?.country || '');

    let score = 0;

    if (primaryName === normalizedQuery) score += 120;
    if (aliases.includes(normalizedQuery)) score += 100;
    if (primaryName.startsWith(normalizedQuery)) score += 60;
    if (primaryName.includes(normalizedQuery)) score += 45;

    for (const term of queryTerms) {
        if (term === primaryName) score += 40;
        else if (aliases.includes(term)) score += 24;
        else if (primaryName.includes(term) || stateName.includes(term) || countryName.includes(term)) score += 14;
    }

    if (preferredName && primaryName === preferredName) score += 80;
    if (preferredCountry && countryName === preferredCountry) score += 55;
    if (preferredLocation && Number.isFinite(Number(preferredLocation.lat)) && Number.isFinite(Number(preferredLocation.lon))) {
        const distance = calculateCoordinateDistance(
            Number(location?.lat),
            Number(location?.lon),
            Number(preferredLocation.lat),
            Number(preferredLocation.lon)
        );
        if (Number.isFinite(distance)) {
            if (distance <= 0.2) score += 80;
            else if (distance <= 0.6) score += 40;
            else if (distance <= 1.5) score += 18;
        }
    }

    score += locationTier(location) * 6;
    if (isAdministrativeArea(location)) score -= 22;
    if (stateName) score += 4;
    if (Number.isFinite(Number(location?.lat)) && Number.isFinite(Number(location?.lon))) score += 2;

    return score;
}

function selectBestLocation(candidates, query, preferredLocation) {
    if (!Array.isArray(candidates) || !candidates.length) return null;

    return [...candidates]
        .map(location => ({
            location,
            score: scoreGeocodingCandidate(location, query, preferredLocation)
        }))
        .sort((a, b) => b.score - a.score)
        .map(entry => entry.location)[0];
}

function buildResolvedLocationLabel({ displayName, reverseLocation, forecastCityName, weatherCityName, countryCode }) {
    if (displayName) return displayName;

    const normalizedReverseLocation = normalizeResolvedLocation(reverseLocation);
    const providerName = forecastCityName || weatherCityName || '';
    const reverseMatchesProvider = isSameLocationFamily(normalizedReverseLocation?.name, providerName);

    if (normalizedReverseLocation?.name && reverseMatchesProvider) {
        return [
            normalizedReverseLocation.name,
            normalizedReverseLocation.state,
            normalizedReverseLocation.country || countryCode
        ]
            .filter(Boolean)
            .join(', ');
    }

    if (providerName) {
        return [
            providerName,
            normalizedReverseLocation?.state,
            countryCode || normalizedReverseLocation?.country
        ]
            .filter(Boolean)
            .join(', ');
    }

    return [
        normalizedReverseLocation?.name,
        normalizedReverseLocation?.state,
        normalizedReverseLocation?.country || countryCode
    ]
        .filter(Boolean)
        .join(', ');
}

function determinePrimaryLocation({
    displayName,
    reverseLocation,
    preciseLocation,
    forecastCityName,
    weatherCityName,
    countryCode,
    datasetLocation,
    source = 'search'
}) {
    if (displayName) return displayName;

    const providerLabel = buildResolvedLocationLabel({
        displayName: '',
        reverseLocation,
        forecastCityName,
        weatherCityName,
        countryCode
    });

    const normalizedPrecise = normalizeResolvedLocation(preciseLocation);
    const normalizedDataset = normalizeResolvedLocation(datasetLocation);
    const isCurrentLocation = source === 'current-location';

    if (isCurrentLocation && normalizedPrecise?.name) {
        const preciseLabel = buildPreciseMapLabel(normalizedPrecise, countryCode || normalizedPrecise?.country || '');
        const preciseLooksUsable = !isAdministrativeArea(normalizedPrecise)
            && (normalizedPrecise.state || normalizedPrecise.country);

        if (preciseLooksUsable) {
            return preciseLabel;
        }
    }

    if (isSameLocationFamily(providerLabel, normalizedPrecise?.name)) {
        return buildPreciseMapLabel(normalizedPrecise, countryCode || normalizedPrecise?.country || '');
    }

    if (isSameLocationFamily(providerLabel, normalizedDataset?.name)) {
        return [
            normalizedDataset.name,
            normalizedDataset.state || reverseLocation?.state,
            normalizedDataset.country || countryCode
        ]
            .filter(Boolean)
            .join(', ');
    }

    return providerLabel;
}

function parseCoordinate(value, min, max) {
    const parsed = parseFloat(value);
    return clampNumber(parsed, min, max, null);
}

function getDateKeyFromUnix(timestampSeconds, timezoneOffsetSeconds) {
    return new Date((timestampSeconds + timezoneOffsetSeconds) * 1000).toISOString().slice(0, 10);
}

function getLocalTimeParts(timestampSeconds, timezoneOffsetSeconds) {
    const shiftedDate = new Date((timestampSeconds + timezoneOffsetSeconds) * 1000);
    return {
        dateKey: shiftedDate.toISOString().slice(0, 10),
        hour: shiftedDate.getUTCHours(),
        minute: shiftedDate.getUTCMinutes()
    };
}

function formatLocalTime(timestampSeconds, timezoneOffsetSeconds) {
    const parts = getLocalTimeParts(timestampSeconds, timezoneOffsetSeconds);
    return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

function parseIsoDateTimeParts(value) {
    if (!value || typeof value !== 'string') {
        return { dateKey: '', hour: 0, minute: 0 };
    }

    const [datePart, timePart = '00:00'] = value.split('T');
    const [hour = '0', minute = '0'] = timePart.split(':');
    return {
        dateKey: datePart,
        hour: parseInt(hour, 10) || 0,
        minute: parseInt(minute, 10) || 0
    };
}

function formatVisibility(meters) {
    if (!Number.isFinite(meters)) return null;
    return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
}

function toCompassDirection(degrees) {
    if (!Number.isFinite(degrees)) return 'Variable';
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return directions[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

function buildHourlyForecast(list, timezoneOffsetSeconds) {
    if (!Array.isArray(list)) return [];

    return list.slice(0, 8).map(item => ({
        time: formatLocalTime(item.dt, timezoneOffsetSeconds),
        date: getDateKeyFromUnix(item.dt, timezoneOffsetSeconds),
        temp: roundNumber(item.main?.temp),
        feelsLike: roundNumber(item.main?.feels_like),
        min: roundNumber(item.main?.temp_min),
        max: roundNumber(item.main?.temp_max),
        humidity: item.main?.humidity ?? null,
        windSpeed: item.wind?.speed ?? null,
        windDeg: item.wind?.deg ?? null,
        windDirection: toCompassDirection(item.wind?.deg),
        clouds: item.clouds?.all ?? null,
        pop: Math.round((item.pop || 0) * 100),
        description: capitalizeWords(item.weather?.[0]?.description || 'No forecast')
    }));
}

function buildDailyForecast(list, timezoneOffsetSeconds) {
    if (!Array.isArray(list) || !list.length) return [];

    const grouped = new Map();
    for (const item of list) {
        const dateKey = getDateKeyFromUnix(item.dt, timezoneOffsetSeconds);
        if (!grouped.has(dateKey)) grouped.set(dateKey, []);
        grouped.get(dateKey).push(item);
    }

    return [...grouped.entries()]
        .slice(0, 5)
        .map(([date, entries]) => ({
            date,
            label: new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric'
            }),
            min: roundNumber(Math.min(...entries.map(item => item.main.temp_min))),
            max: roundNumber(Math.max(...entries.map(item => item.main.temp_max))),
            humidity: average(entries.map(item => item.main.humidity)),
            windSpeed: averageFloat(entries.map(item => item.wind?.speed ?? 0)),
            pop: Math.round(Math.max(...entries.map(item => (item.pop || 0) * 100))),
            description: capitalizeWords(entries[Math.floor(entries.length / 2)]?.weather?.[0]?.description || 'No forecast')
        }));
}

function pickTomorrowForecast(list, timezoneOffsetSeconds, currentTimestampSeconds) {
    if (!Array.isArray(list) || !list.length) return null;

    const nowTimestamp = currentTimestampSeconds || Math.floor(Date.now() / 1000);
    const currentDateKey = getDateKeyFromUnix(nowTimestamp, timezoneOffsetSeconds);
    const targetDateKey = [...new Set(list.map(item => getDateKeyFromUnix(item.dt, timezoneOffsetSeconds)))]
        .filter(dateKey => dateKey > currentDateKey)
        .sort()[0];
    const pool = targetDateKey
        ? list.filter(item => getDateKeyFromUnix(item.dt, timezoneOffsetSeconds) === targetDateKey)
        : list.slice(0, 8);

    if (!pool.length) return null;

    const currentLocalTime = getLocalTimeParts(nowTimestamp, timezoneOffsetSeconds);
    const bestMatch = pool.reduce((best, item) => {
        const localParts = getLocalTimeParts(item.dt, timezoneOffsetSeconds);
        const distance = Math.abs((localParts.hour * 60 + localParts.minute) - (currentLocalTime.hour * 60 + currentLocalTime.minute));
        const bestDistance = best
            ? Math.abs(
                (getLocalTimeParts(best.dt, timezoneOffsetSeconds).hour * 60 +
                    getLocalTimeParts(best.dt, timezoneOffsetSeconds).minute) -
                    (currentLocalTime.hour * 60 + currentLocalTime.minute)
            )
            : Infinity;
        return distance < bestDistance ? item : best;
    }, null);

    return {
        temp: roundNumber(bestMatch.main?.temp),
        min: roundNumber(Math.min(...pool.map(item => item.main.temp_min))),
        max: roundNumber(Math.max(...pool.map(item => item.main.temp_max))),
        humidity: average(pool.map(item => item.main.humidity)),
        description: capitalizeWords(bestMatch.weather?.[0]?.description || 'No forecast'),
        samples: pool.length,
        date: targetDateKey || getDateKeyFromUnix(pool[0].dt, timezoneOffsetSeconds),
        time: formatLocalTime(bestMatch.dt, timezoneOffsetSeconds),
        precipitationChance: Math.round((bestMatch.pop || 0) * 100),
        confidence: pool.length >= 6 ? 'very high' : pool.length >= 4 ? 'high' : 'medium'
    };
}

function buildHistoryFromDataset(datasetHistory, liveTemp, liveHumidity, liveDescription) {
    const baseHistory = datasetHistory.slice(-4).map((entry, index) => ({
        day: index + 1,
        temp: entry.temp,
        humidity: entry.humidity,
        description: entry.description
    }));

    baseHistory.push({
        day: baseHistory.length + 1,
        temp: liveTemp,
        humidity: liveHumidity,
        description: liveDescription
    });

    return baseHistory;
}

function predictTemp(history) {
    const n = history.length;
    const sumX = history.reduce((sum, day) => sum + day.day, 0);
    const sumY = history.reduce((sum, day) => sum + day.temp, 0);
    const sumXY = history.reduce((sum, day) => sum + day.day * day.temp, 0);
    const sumXX = history.reduce((sum, day) => sum + day.day * day.day, 0);
    const denominator = n * sumXX - sumX * sumX;

    if (!denominator) return roundNumber(sumY / n, history[n - 1]?.temp ?? 0);

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;
    return roundNumber(slope * (history[n - 1].day + 1) + intercept, history[n - 1]?.temp ?? 0);
}

function estimateConditionAdjustment(liveData, tomorrow) {
    if (!liveData || !tomorrow) return 0;

    let adjustment = 0;

    const humidity = tomorrow.humidity ?? liveData.humidity ?? 0;
    const precipitationChance = tomorrow.precipitationChance ?? 0;
    const clouds = averageFloat((liveData.hourly || []).slice(0, 6).map(item => item.clouds ?? 0)) ?? 0;
    const wind = averageFloat((liveData.hourly || []).slice(0, 6).map(item => item.windSpeed ?? 0)) ?? liveData.windSpeed ?? 0;

    if (humidity >= 85 && precipitationChance >= 50) adjustment -= 1.4;
    else if (humidity >= 75 && precipitationChance >= 35) adjustment -= 0.8;

    if (clouds <= 25 && precipitationChance <= 20) adjustment += 0.7;
    else if (clouds >= 80 && precipitationChance <= 20) adjustment -= 0.5;

    if (wind >= 8) adjustment -= 0.5;

    return adjustment;
}

function predictTomorrowTemperature({
    currentTemp,
    modelPrediction,
    liveData,
    tomorrow,
    consensusTemp = null,
    consensusCurrentTemp = null,
    providerAgreement = 'standard'
}) {
    if (!tomorrow) {
        const anchorCurrent = Number.isFinite(consensusCurrentTemp) ? consensusCurrentTemp : currentTemp;
        return {
            predictedTemp: Number.isFinite(consensusTemp)
                ? roundNumber(consensusTemp * 0.68 + modelPrediction * 0.22 + anchorCurrent * 0.1, modelPrediction)
                : roundNumber(modelPrediction * 0.85 + anchorCurrent * 0.15, modelPrediction),
            method: 'trend-model',
            confidence: 'medium'
        };
    }

    const anchor = Number.isFinite(consensusTemp) ? consensusTemp : tomorrow.temp;
    const min = Number.isFinite(tomorrow.min) ? tomorrow.min : anchor - 2;
    const max = Number.isFinite(tomorrow.max) ? tomorrow.max : anchor + 2;
    const nearTermTemps = (liveData?.hourly || []).slice(0, 4).map(item => item.temp).filter(Number.isFinite);
    const nearTermAverage = averageFloat(nearTermTemps);
    const stabilizedCurrent = Number.isFinite(consensusCurrentTemp)
        ? weightedAverage([
            { value: currentTemp, weight: 0.7 },
            { value: consensusCurrentTemp, weight: 0.3 }
        ])
        : currentTemp;
    const drift = Number.isFinite(nearTermAverage) ? nearTermAverage - stabilizedCurrent : 0;
    const conditionAdjustment = estimateConditionAdjustment(liveData, tomorrow);

    const anchorWeight = providerAgreement === 'very high'
        ? 0.6
        : providerAgreement === 'high'
          ? 0.57
          : providerAgreement === 'medium'
            ? 0.52
            : 0.48;
    const modelWeight = providerAgreement === 'low' ? 0.31 : 0.24;
    const rangeWeight = providerAgreement === 'low' ? 0.15 : 0.12;
    const currentWeight = 1 - anchorWeight - modelWeight - rangeWeight;

    let blended =
        anchor * anchorWeight +
        modelPrediction * modelWeight +
        ((min + max) / 2) * rangeWeight +
        (stabilizedCurrent + drift) * currentWeight +
        conditionAdjustment;

    const lowerBound = min - 1;
    const upperBound = max + 1;
    blended = clampNumber(blended, lowerBound, upperBound, anchor);

    const spread = Math.abs(modelPrediction - anchor);
    const confidence = spread <= 1 ? 'high' : spread <= 3 ? 'medium' : 'guarded';

    return {
        predictedTemp: roundNumber(blended, anchor),
        method: 'bounded-hybrid',
        confidence
    };
}

function calibrateCurrentTemperature(liveData, providerComparison = null) {
    if (!liveData) {
        return {
            value: null,
            method: 'dataset',
            confidence: 'low',
            note: 'Using the dataset reading because live calibration data is unavailable.',
            components: {
                rawTemp: null,
                feelsLike: null,
                shortTermAvg: null
            }
        };
    }

    const shortTermAvg = averageFloat((liveData.hourly || []).slice(0, 3).map(item => item.temp).filter(Number.isFinite));
    const rawTemp = liveData.temp;
    const feelsLike = liveData.feelsLike;
    const providerCurrentTemp = providerComparison?.consensusCurrentTemp;
    const currentAgreement = providerComparison?.currentAgreement || 'standard';
    const humidityFactor = liveData.humidity >= 80 ? 0.18 : liveData.humidity >= 65 ? 0.12 : 0.06;
    const windFactor = liveData.windSpeed >= 8 ? 0.14 : liveData.windSpeed >= 5 ? 0.1 : 0.04;
    const agreementAdjustment = currentAgreement === 'very high'
        ? -0.03
        : currentAgreement === 'high'
          ? -0.02
          : currentAgreement === 'low'
            ? 0.03
            : 0;
    const apparentWeight = clampNumber(Math.max(humidityFactor, windFactor) + agreementAdjustment, 0.03, 0.17, 0.09);
    const base = weightedAverage([
        { value: rawTemp, weight: currentAgreement === 'low' ? 0.74 : 0.66 },
        { value: shortTermAvg, weight: currentAgreement === 'low' ? 0.18 : 0.2 },
        { value: providerCurrentTemp, weight: currentAgreement === 'low' ? 0.08 : 0.14 }
    ]) ?? rawTemp;
    const calibrated = base * (1 - apparentWeight) + feelsLike * apparentWeight;
    const maxDrift = Number.isFinite(providerCurrentTemp) && Math.abs(providerCurrentTemp - rawTemp) <= 1.5
        ? 1.2
        : Number.isFinite(providerCurrentTemp) && Math.abs(providerCurrentTemp - rawTemp) <= 2.5
          ? 1.6
          : 2;
    const bounded = clampNumber(calibrated, rawTemp - maxDrift, rawTemp + maxDrift, rawTemp);
    const warmBiasCorrection = bounded > rawTemp
        ? currentAgreement === 'very high'
            ? 0.05
            : currentAgreement === 'high'
              ? 0.12
              : 0.22
        : 0;
    const displayAdjusted = bounded - warmBiasCorrection;
    const value = roundNumber(displayAdjusted, rawTemp);
    const providerDelta = Number.isFinite(providerCurrentTemp) ? Math.abs(providerCurrentTemp - rawTemp) : null;

    return {
        value,
        method: Number.isFinite(providerCurrentTemp) ? 'provider-calibrated' : 'hybrid-air',
        confidence: Math.abs(value - rawTemp) <= 1 && (providerDelta == null || providerDelta <= 2.5) ? 'high' : 'medium',
        note: Number.isFinite(providerCurrentTemp)
            ? 'Current temperature is anchored to the live air reading, checked against the near-term trend, and lightly cross-checked with an independent provider before any feels-like adjustment is applied.'
            : 'Current temperature is stabilized with the near-term forecast to reduce noisy provider drift.',
        components: {
            rawTemp,
            feelsLike,
            shortTermAvg: roundNumber(shortTermAvg),
            providerCurrentTemp: roundNumber(providerCurrentTemp, null),
            warmBiasCorrection: Number(warmBiasCorrection.toFixed(2)),
            apparentWeight: Number(apparentWeight.toFixed(2))
        }
    };
}

function buildTemperatureInsight(calibratedTemp, rawTemp, feelsLike) {
    if (!Number.isFinite(calibratedTemp) || !Number.isFinite(rawTemp) || !Number.isFinite(feelsLike)) {
        return 'Temperature calibration details are unavailable.';
    }

    if (Math.abs(feelsLike - calibratedTemp) < Math.abs(feelsLike - rawTemp)) {
        return 'The displayed temperature has been nudged toward comfort conditions, but it is still bounded close to the raw air reading.';
    }

    if (calibratedTemp !== rawTemp) {
        return 'The displayed temperature has been stabilized using nearby forecast conditions.';
    }

    return 'The displayed temperature already aligns well with the live signals.';
}

function analyzeAtmosphere(current, hourly, tomorrow) {
    if (!hourly.length) {
        return {
            headline: 'Atmospheric trend analysis is unavailable for this location.',
            cloudMovement: 'No cloud-motion forecast is available yet.',
            windMovement: 'No wind-trend forecast is available yet.',
            thermalSignal: 'No temperature signal is available yet.',
            alerts: [],
            confidence: 'low'
        };
    }

    const earlyWindow = hourly.slice(0, Math.min(3, hourly.length));
    const lateWindow = hourly.slice(Math.max(0, hourly.length - 3));
    const earlyClouds = averageFloat(earlyWindow.map(item => item.clouds ?? 0)) ?? 0;
    const lateClouds = averageFloat(lateWindow.map(item => item.clouds ?? 0)) ?? 0;
    const cloudDelta = Math.round(lateClouds - earlyClouds);
    const earlyWind = averageFloat(earlyWindow.map(item => item.windSpeed ?? 0)) ?? 0;
    const lateWind = averageFloat(lateWindow.map(item => item.windSpeed ?? 0)) ?? 0;
    const peakWind = Math.max(...hourly.map(item => item.windSpeed ?? 0), current.windSpeed ?? 0);
    const maxTemp = Math.max(...[current.temp, ...hourly.map(item => item.temp), tomorrow?.temp].filter(Number.isFinite));
    const minTemp = Math.min(...[current.temp, ...hourly.map(item => item.temp), tomorrow?.temp].filter(Number.isFinite));

    const alerts = [];
    if (peakWind >= 12) alerts.push('Strong-wind potential');
    if ((tomorrow?.precipitationChance ?? 0) >= 60) alerts.push('Rain band likely');
    if (maxTemp >= 40) alerts.push('Heatwave risk');
    if (minTemp <= 0) alerts.push('Coldwave risk');

    return {
        headline: 'Forecast-based cloud, wind, and temperature behavior',
        cloudMovement: cloudDelta >= 15
            ? `Cloud cover is thickening by about ${cloudDelta}% across the next forecast blocks.`
            : cloudDelta <= -15
              ? `Skies should open up as cloud cover drops by about ${Math.abs(cloudDelta)}%.`
              : 'Cloud cover should stay fairly steady through the next several hours.',
        windMovement: lateWind - earlyWind >= 2
            ? `Winds are expected to build from ${earlyWind.toFixed(1)} to ${lateWind.toFixed(1)} m/s.`
            : earlyWind - lateWind >= 2
              ? `Winds should ease from ${earlyWind.toFixed(1)} to ${lateWind.toFixed(1)} m/s.`
              : `Winds look fairly steady with a peak near ${peakWind.toFixed(1)} m/s.`,
        thermalSignal: maxTemp >= 35
            ? `A hot spell is developing, with temperatures reaching about ${maxTemp}C.`
            : minTemp <= 0
              ? `Coldwave-style stress is possible with temperatures dropping near ${minTemp}C.`
              : maxTemp - minTemp >= 12
                ? `A sharp temperature swing is likely, spanning about ${maxTemp - minTemp}C across the forecast window.`
                : 'No major heat or cold stress signal stands out right now.',
        alerts,
        confidence: hourly.length >= 8 ? 'high' : 'medium'
    };
}

function buildForecastLabel(forecastTemp, currentTemp) {
    if (forecastTemp > currentTemp) return 'warmer';
    if (forecastTemp < currentTemp) return 'cooler';
    return 'similar';
}

function buildProviderComparison(openWeatherProvider, openMeteoProvider) {
    const providers = [openWeatherProvider, openMeteoProvider].filter(Boolean);

    const temps = providers
        .map(provider => provider.forecastTemp)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

    const consensusTemp = temps.length
        ? temps.length % 2 === 1
            ? temps[(temps.length - 1) / 2]
            : roundNumber((temps[temps.length / 2 - 1] + temps[temps.length / 2]) / 2, temps[0])
        : null;
    const spread = temps.length > 1 ? temps[temps.length - 1] - temps[0] : null;
    const agreement = spread == null
        ? (providers.length ? 'standard' : 'low')
        : spread <= 1
          ? 'very high'
          : spread <= 2
            ? 'high'
            : spread <= 4
              ? 'medium'
              : 'low';

    const currentTemps = providers
        .map(provider => provider.currentTemp)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
    const consensusCurrentTemp = weightedAverage([
        { value: openWeatherProvider?.currentTemp, weight: 0.65 },
        { value: openMeteoProvider?.currentTemp, weight: 0.35 }
    ]);
    const currentSpread = currentTemps.length > 1 ? currentTemps[currentTemps.length - 1] - currentTemps[0] : null;
    const currentAgreement = currentSpread == null
        ? (currentTemps.length ? 'standard' : 'low')
        : currentSpread <= 1
          ? 'very high'
          : currentSpread <= 2
            ? 'high'
            : currentSpread <= 4
              ? 'medium'
              : 'low';

    return {
        selectedModel: providers.length > 1 ? 'consensus' : providers[0]?.key || 'dataset',
        consensusTemp,
        consensusCurrentTemp: roundNumber(consensusCurrentTemp, null),
        spread,
        agreement,
        currentSpread,
        currentAgreement,
        providers
    };
}

function buildLiveStatus(liveData, error) {
    if (liveData) {
        return {
            ok: true,
            provider: 'OpenWeatherMap',
            message: 'Live weather, location lookup, and forecast timeline are active.'
        };
    }

    if (!error) {
        return {
            ok: false,
            provider: 'Dataset',
            message: 'Live data is unavailable, so the app is using the bundled fallback dataset.'
        };
    }

    if (error.code === 'MISSING_API_KEY') {
        return {
            ok: false,
            provider: 'Dataset',
            message: 'No API key was found, so results are using the local dataset only.'
        };
    }

    if (error.statusCode === 404) {
        return {
            ok: false,
            provider: 'Dataset',
            message: 'That location was not found in the live weather service.'
        };
    }

    return {
        ok: false,
        provider: 'Dataset',
        message: 'Live weather is temporarily unavailable, so results are using local data.'
    };
}

function createUpstreamError(message, meta = {}) {
    const error = new Error(message);
    Object.assign(error, meta);
    return error;
}

function serializeError(error) {
    if (!error) return null;

    return {
        message: error.message || 'Unknown error',
        code: error.code || null,
        statusCode: error.statusCode || null,
        stage: error.stage || null,
        details: error.details || null,
        requestAttempts: Array.isArray(error.requestAttempts) ? error.requestAttempts : null,
        fallback: error.fallback
            ? {
                message: error.fallback.message || 'Fallback error',
                code: error.fallback.code || null,
                statusCode: error.fallback.statusCode || null,
                stage: error.fallback.stage || null,
                requestAttempts: Array.isArray(error.fallback.requestAttempts) ? error.fallback.requestAttempts : null
            }
            : null
    };
}

async function fetchLocation(city, preferredLocation = null) {
    if (!API_KEY) {
        throw createUpstreamError('Missing OPENWEATHER_API_KEY', {
            code: 'MISSING_API_KEY',
            stage: 'geocoding'
        });
    }

    const geocodingUrl = `${GEOCODING_URL}?q=${encodeURIComponent(city)}&limit=6&appid=${API_KEY}`;
    const results = await fetchJson(geocodingUrl);
    const location = selectBestLocation(results, city, preferredLocation);

    if (!location) {
        throw createUpstreamError('Location not found', {
            statusCode: 404,
            stage: 'geocoding'
        });
    }

    return location;
}

async function reverseGeocode(lat, lon, providerName = '') {
    if (!API_KEY) return null;

    try {
        const results = await fetchJson(`${REVERSE_GEOCODING_URL}?lat=${lat}&lon=${lon}&limit=5&appid=${API_KEY}`);
        if (!Array.isArray(results) || !results.length) return null;

        return {
            primary: selectPrimaryReverseLocation(results, lat, lon, providerName),
            precise: selectPreciseReverseLocation(results, lat, lon, providerName),
            candidates: results
        };
    } catch (error) {
        return null;
    }
}

async function fetchWeatherByCoordinates(lat, lon, searchMeta = {}) {
    if (!API_KEY) {
        throw createUpstreamError('Missing OPENWEATHER_API_KEY', {
            code: 'MISSING_API_KEY',
            stage: 'weather'
        });
    }

    const weatherUrl = `${WEATHER_URL}?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`;
    const forecastUrl = `${FORECAST_URL}?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`;
    let weather;
    try {
        weather = await fetchJson(weatherUrl);
    } catch (error) {
        throw createUpstreamError(error.message || 'Current weather request failed', {
            code: error.code || null,
            statusCode: error.statusCode || null,
            stage: 'weather',
            requestAttempts: error.requestAttempts || null
        });
    }
    let forecast = null;
    try {
        forecast = await fetchJson(forecastUrl);
    } catch (error) {
        forecast = null;
    }

    const timezoneOffset = forecast?.city?.timezone ?? weather.timezone ?? 0;
    const currentTimestamp = weather.dt || Math.floor(Date.now() / 1000);
    const reverseLookup = searchMeta.skipReverseLookup ? null : await reverseGeocode(lat, lon, weather.name);
    const reverseLocation = reverseLookup?.primary || null;
    const preciseLocation = reverseLookup?.precise || reverseLocation;
    const datasetLocation = findNearestDatasetLocation(lat, lon, weather.sys?.country || reverseLocation?.country || '');
    const hourly = buildHourlyForecast(forecast?.list || [], timezoneOffset);
    const tomorrow = pickTomorrowForecast(forecast?.list || [], timezoneOffset, currentTimestamp);
    const daily = buildDailyForecast(forecast?.list || [], timezoneOffset);
    const resolvedName = determinePrimaryLocation({
        displayName: searchMeta.displayName,
        reverseLocation,
        preciseLocation,
        forecastCityName: forecast?.city?.name,
        weatherCityName: weather.name,
        countryCode: weather.sys?.country,
        datasetLocation,
        source: searchMeta.source || 'search'
    });
    const locationConfidence = resolveLocationConfidence({
        reverseLocation,
        preciseLocation,
        providerName: forecast?.city?.name || weather.name,
        datasetLocation
    });

    return {
        name: resolvedName,
        resolvedLocation: {
            name: resolvedName,
            country: weather.sys?.country || reverseLocation?.country || '',
            confidence: locationConfidence
        },
        mapLocation: preciseLocation
            ? {
                name: preciseLocation.name || '',
                state: preciseLocation.state || '',
                country: preciseLocation.country || weather.sys?.country || '',
                label: buildPreciseMapLabel(preciseLocation, weather.sys?.country || ''),
                confidence: locationConfidence
            }
            : null,
        providerLocation: {
            name: forecast?.city?.name || weather.name || '',
            country: weather.sys?.country || ''
        },
        country: weather.sys?.country || reverseLocation?.country || '',
        temp: roundNumber(weather.main?.temp),
        feelsLike: roundNumber(weather.main?.feels_like),
        humidity: weather.main?.humidity ?? null,
        pressure: weather.main?.pressure ?? null,
        windSpeed: weather.wind?.speed ?? null,
        windDeg: weather.wind?.deg ?? null,
        windDirection: toCompassDirection(weather.wind?.deg),
        visibility: weather.visibility ?? null,
        clouds: weather.clouds?.all ?? null,
        sunrise: weather.sys?.sunrise ? formatLocalTime(weather.sys.sunrise, timezoneOffset) : null,
        sunset: weather.sys?.sunset ? formatLocalTime(weather.sys.sunset, timezoneOffset) : null,
        description: capitalizeWords(weather.weather?.[0]?.description || 'Unknown'),
        updatedAt: formatLocalTime(currentTimestamp, timezoneOffset),
        timezoneOffset,
        coordinates: {
            lat: Number(lat.toFixed(4)),
            lon: Number(lon.toFixed(4))
        },
        forecast: tomorrow,
        hourly,
        daily,
        locationAccuracy: locationConfidence,
        atmosphere: analyzeAtmosphere(
            {
                temp: roundNumber(weather.main?.temp),
                windSpeed: weather.wind?.speed ?? null
            },
            hourly,
            tomorrow
        )
    };
}

async function fetchWeatherByQuery(city, searchMeta = {}) {
    if (!API_KEY) {
        throw createUpstreamError('Missing OPENWEATHER_API_KEY', {
            code: 'MISSING_API_KEY',
            stage: 'weather-query'
        });
    }

    const weatherUrl = `${WEATHER_URL}?q=${encodeURIComponent(city)}&appid=${API_KEY}&units=metric`;
    const forecastUrl = `${FORECAST_URL}?q=${encodeURIComponent(city)}&appid=${API_KEY}&units=metric`;
    let weather;
    try {
        weather = await fetchJson(weatherUrl);
    } catch (error) {
        throw createUpstreamError(error.message || 'Direct weather query failed', {
            code: error.code || null,
            statusCode: error.statusCode || null,
            stage: 'weather-query',
            requestAttempts: error.requestAttempts || null
        });
    }
    let forecast = null;
    try {
        forecast = await fetchJson(forecastUrl);
    } catch (error) {
        forecast = null;
    }

    const timezoneOffset = forecast?.city?.timezone ?? weather.timezone ?? 0;
    const currentTimestamp = weather.dt || Math.floor(Date.now() / 1000);
    const hourly = buildHourlyForecast(forecast?.list || [], timezoneOffset);
    const tomorrow = pickTomorrowForecast(forecast?.list || [], timezoneOffset, currentTimestamp);
    const daily = buildDailyForecast(forecast?.list || [], timezoneOffset);

    return {
        name: searchMeta.displayName || formatLocationLabel({
            name: weather.name,
            state: '',
            country: weather.sys?.country
        }),
        country: weather.sys?.country || '',
        temp: roundNumber(weather.main?.temp),
        feelsLike: roundNumber(weather.main?.feels_like),
        humidity: weather.main?.humidity ?? null,
        pressure: weather.main?.pressure ?? null,
        windSpeed: weather.wind?.speed ?? null,
        windDeg: weather.wind?.deg ?? null,
        windDirection: toCompassDirection(weather.wind?.deg),
        visibility: weather.visibility ?? null,
        clouds: weather.clouds?.all ?? null,
        sunrise: weather.sys?.sunrise ? formatLocalTime(weather.sys.sunrise, timezoneOffset) : null,
        sunset: weather.sys?.sunset ? formatLocalTime(weather.sys.sunset, timezoneOffset) : null,
        description: capitalizeWords(weather.weather?.[0]?.description || 'Unknown'),
        updatedAt: formatLocalTime(currentTimestamp, timezoneOffset),
        timezoneOffset,
        coordinates: weather.coord
            ? {
                lat: Number(Number(weather.coord.lat).toFixed(4)),
                lon: Number(Number(weather.coord.lon).toFixed(4))
            }
            : null,
        forecast: tomorrow,
        hourly,
        daily,
        atmosphere: analyzeAtmosphere(
            {
                temp: roundNumber(weather.main?.temp),
                windSpeed: weather.wind?.speed ?? null
            },
            hourly,
            tomorrow
        )
    };
}

async function fetchWeatherByCity(city) {
    const preferredLocation = findLocation(city);
    try {
        const location = await fetchLocation(city, preferredLocation);
        return fetchWeatherByCoordinates(location.lat, location.lon, {
            displayName: formatLocationLabel(location),
            skipReverseLookup: true
        });
    } catch (error) {
        try {
            return await fetchWeatherByQuery(city, {
                displayName: preferredLocation ? formatLocationLabel(preferredLocation) : ''
            });
        } catch (fallbackError) {
            throw createUpstreamError(fallbackError.message || error.message || 'City lookup failed', {
                code: fallbackError.code || error.code || null,
                statusCode: fallbackError.statusCode || error.statusCode || null,
                stage: fallbackError.stage || error.stage || 'city-lookup',
                details: {
                    city,
                    geocodingStage: error.stage || null,
                    queryStage: fallbackError.stage || null
                },
                requestAttempts: fallbackError.requestAttempts || error.requestAttempts || null,
                fallback: fallbackError
            });
        }
    }
}

async function fetchOpenMeteoComparison(lat, lon) {
    const url =
        `${OPEN_METEO_FORECAST_URL}?latitude=${lat}&longitude=${lon}` +
        '&timezone=auto&forecast_days=3' +
        '&current=temperature_2m' +
        '&hourly=temperature_2m,precipitation_probability' +
        '&daily=temperature_2m_max,temperature_2m_min';

    const forecast = await fetchJson(url);
    const today = forecast.current?.time?.slice(0, 10) || '';
    const currentParts = parseIsoDateTimeParts(forecast.current?.time);
    const tomorrowHourlyIndexes = (forecast.hourly?.time || [])
        .map((time, index) => ({ time, index }))
        .filter(item => parseIsoDateTimeParts(item.time).dateKey > today);

    let forecastTemp = null;
    let rainChance = null;

    if (tomorrowHourlyIndexes.length && Array.isArray(forecast.hourly?.temperature_2m)) {
        const nearest = tomorrowHourlyIndexes.reduce((best, item) => {
            const parts = parseIsoDateTimeParts(item.time);
            const distance = Math.abs(parts.hour * 60 + parts.minute - (currentParts.hour * 60 + currentParts.minute));
            const bestParts = best ? parseIsoDateTimeParts(best.time) : { hour: 0, minute: 0 };
            const bestDistance = best
                ? Math.abs(bestParts.hour * 60 + bestParts.minute - (currentParts.hour * 60 + currentParts.minute))
                : Infinity;
            return distance < bestDistance ? item : best;
        }, null);

        if (nearest) {
            forecastTemp = roundNumber(forecast.hourly.temperature_2m[nearest.index]);
            rainChance = roundNumber(forecast.hourly.precipitation_probability?.[nearest.index], null);
        }
    }

    const tomorrowIndex = (forecast.daily?.time || []).findIndex(date => date > today);
    const min = tomorrowIndex >= 0 ? roundNumber(forecast.daily.temperature_2m_min?.[tomorrowIndex], null) : null;
    const max = tomorrowIndex >= 0 ? roundNumber(forecast.daily.temperature_2m_max?.[tomorrowIndex], null) : null;

    if (!Number.isFinite(forecastTemp) && Number.isFinite(min) && Number.isFinite(max)) {
        forecastTemp = roundNumber((min + max) / 2, null);
    }

    return {
        key: 'openmeteo',
        name: 'Open-Meteo',
        currentTemp: roundNumber(forecast.current?.temperature_2m, null),
        forecastTemp,
        min,
        max,
        rainChance,
        description: 'Independent forecast reference',
        source: 'Open-Meteo'
    };
}

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        apiKeyConfigured: Boolean(API_KEY),
        liveProvider: 'OpenWeatherMap',
        mapLookup: true
    });
});

app.get('/api/weather', async (req, res) => {
    const city = sanitizeCity(req.query.city);
    const lat = parseCoordinate(req.query.lat, -90, 90);
    const lon = parseCoordinate(req.query.lon, -180, 180);
    const requestSource = normalizeQuery(req.query.source || '') || 'search';
    const hasCoordinates = lat !== null && lon !== null;

    if (!city && !hasCoordinates) {
        return res.status(400).json({ error: 'City or map coordinates required' });
    }

    if (city && city.length > MAX_CITY_LENGTH) {
        return res.status(400).json({ error: 'City name is too long' });
    }

    const datasetCity = city ? findLocation(city) : null;
    let liveData = null;
    let openMeteoData = null;
    let liveError = null;
    let source = 'Dataset-assisted estimate';
    let accuracy = datasetCity ? 'medium' : 'low';

    try {
        liveData = hasCoordinates
            ? await fetchWeatherByCoordinates(lat, lon, { displayName: city || '', source: requestSource })
            : await fetchWeatherByCity(city);
        source = 'OpenWeatherMap live conditions + forecast analysis';
        accuracy = liveData.forecast?.confidence === 'very high' ? 'very high' : 'high';
    } catch (error) {
        liveError = error;
        if (process.env.WEATHER_DEBUG === '1') {
            console.warn('[weather-live-fallback]', serializeError(error));
        }
    }

    if (!liveData && !datasetCity) {
        const notFound = liveError?.statusCode === 404;
        return res.status(notFound ? 404 : 503).json({
            error: notFound
                ? `No weather data found for "${city || `${req.query.lat}, ${req.query.lon}`}".`
                : 'Weather data is unavailable right now. Please try again shortly.'
        });
    }

    const baselineLocation = datasetCity || buildTemplateLocation(liveData.name, liveData.country);
    const lastHistoryEntry = baselineLocation.history[baselineLocation.history.length - 1];
    const rawCurrentTemp = liveData ? liveData.temp : lastHistoryEntry.temp;
    const currentHumidity = liveData ? liveData.humidity : lastHistoryEntry.humidity;
    const currentDescription = liveData ? liveData.description : capitalizeWords(lastHistoryEntry.description);
    const liveForecast = liveData?.forecast || null;
    const openWeatherProvider = liveData
        ? {
            key: 'openweather',
            name: 'OpenWeatherMap',
            currentTemp: liveData.temp,
            forecastTemp: liveForecast?.temp ?? null,
            min: liveForecast?.min ?? null,
            max: liveForecast?.max ?? null,
            rainChance: liveForecast?.precipitationChance ?? null,
            description: liveForecast?.description || liveData.description,
            source: 'OpenWeatherMap'
        }
        : null;

    if (liveData?.coordinates) {
        try {
            openMeteoData = await fetchOpenMeteoComparison(liveData.coordinates.lat, liveData.coordinates.lon);
            if (openMeteoData) {
                source = 'Consensus forecast from OpenWeatherMap + Open-Meteo';
            }
        } catch (error) {
            openMeteoData = null;
        }
    }

    const providerComparison = buildProviderComparison(openWeatherProvider, openMeteoData);
    const calibration = liveData
        ? calibrateCurrentTemperature(liveData, providerComparison)
        : {
            value: rawCurrentTemp,
            method: 'dataset',
            confidence: 'low',
            note: 'Using the dataset reading because live calibration data is unavailable.',
            components: {
                rawTemp: rawCurrentTemp,
                feelsLike: rawCurrentTemp,
                shortTermAvg: null,
                providerCurrentTemp: null
            }
        };
    const currentTemp = calibration.value ?? rawCurrentTemp;
    const forecastBaseTemp = rawCurrentTemp;
    const modelHistory = buildHistoryFromDataset(
        baselineLocation.history,
        forecastBaseTemp,
        currentHumidity,
        currentDescription
    );
    const modelPrediction = predictTemp(modelHistory);
    const forecastEngine = predictTomorrowTemperature({
        currentTemp,
        modelPrediction,
        liveData,
        tomorrow: liveForecast,
        consensusTemp: providerComparison.consensusTemp,
        consensusCurrentTemp: providerComparison.consensusCurrentTemp,
        providerAgreement: providerComparison.agreement
    });
    const forecastTemp = forecastEngine.predictedTemp;
    const liveStatus = buildLiveStatus(liveData, liveError);
    const liveErrorReason = serializeError(liveError);
    if (liveData) {
        accuracy = providerComparison.agreement === 'very high' && providerComparison.currentAgreement !== 'low'
            ? 'very high'
            : providerComparison.agreement === 'high' || providerComparison.currentAgreement === 'high'
              ? 'high'
              : 'medium';
    }

    res.json({
        city: liveData?.name || baselineLocation.name,
        resolvedLocation: liveData?.resolvedLocation || {
            name: liveData?.name || baselineLocation.name,
            country: liveData?.country || baselineLocation.country
        },
        mapLocation: liveData?.mapLocation || null,
        providerLocation: liveData?.providerLocation || null,
        locationAccuracy: liveData?.locationAccuracy || (liveData ? 'medium' : 'low'),
        type: baselineLocation.type,
        country: liveData?.country || baselineLocation.country,
        region: baselineLocation.region,
        coordinates: liveData?.coordinates || null,
        currentTemp,
        rawCurrentTemp,
        currentHumidity,
        description: currentDescription,
        feelsLike: liveData?.feelsLike ?? currentTemp,
        currentTemperatureCalibration: {
            ...calibration,
            insight: buildTemperatureInsight(currentTemp, rawCurrentTemp, liveData?.feelsLike ?? currentTemp)
        },
        pressure: liveData?.pressure ?? null,
        windSpeed: liveData?.windSpeed ?? null,
        windDirection: liveData?.windDirection ?? 'Variable',
        visibility: liveData?.visibility != null ? formatVisibility(liveData.visibility) : null,
        clouds: liveData?.clouds ?? null,
        sunrise: liveData?.sunrise ?? null,
        sunset: liveData?.sunset ?? null,
        updatedAt: liveData?.updatedAt ?? null,
        forecastTemp,
        predictedTemp: forecastTemp,
        modelPrediction,
        predictionMeta: {
            method: forecastEngine.method,
            confidence: forecastEngine.confidence,
            providerAgreement: providerComparison.agreement,
            currentAgreement: providerComparison.currentAgreement
        },
        selectedModel: providerComparison.selectedModel,
        forecast: buildForecastLabel(forecastTemp, currentTemp),
        tomorrow: liveForecast,
        hourly: liveData?.hourly || [],
        daily: liveData?.daily || [],
        providerComparison,
        atmosphere: liveData?.atmosphere || analyzeAtmosphere({ temp: currentTemp, windSpeed: null }, [], null),
        accuracy,
        source,
        fallback: !liveData,
        liveErrorReason,
        fallbackNote: liveData
            ? ''
            : 'Live API data is unavailable, so this result is based on the local weather dataset.',
        liveStatus
    });
});

app.get('/api/map-layer/:layer/:z/:x/:y.png', async (req, res) => {
    if (!API_KEY) {
        return res.status(503).json({ error: 'Missing OPENWEATHER_API_KEY' });
    }

    const allowedLayers = new Set(['clouds_new', 'precipitation_new', 'wind_new', 'temp_new', 'pressure_new']);
    const { layer, z, x, y } = req.params;
    if (!allowedLayers.has(layer)) {
        return res.status(400).json({ error: 'Unsupported map layer' });
    }

    try {
        const tile = await fetchBinary(`${WEATHER_TILE_URL}/${layer}/${z}/${x}/${y}.png?appid=${API_KEY}`);
        res.setHeader('Content-Type', tile.contentType);
        res.setHeader('Cache-Control', tile.cacheControl);
        res.send(tile.body);
    } catch (error) {
        res.status(502).json({ error: 'Unable to load weather layer tile' });
    }
});

app.get('/api/radar/:z/:x/:y.png', async (req, res) => {
    if (!API_KEY) {
        return res.status(503).json({ error: 'Missing OPENWEATHER_API_KEY' });
    }

    const { z, x, y } = req.params;
    const tm = Math.floor(Date.now() / 600000) * 600;

    try {
        const tile = await fetchBinary(`${RADAR_TILE_URL}/${z}/${x}/${y}?appid=${API_KEY}&tm=${tm}`);
        res.setHeader('Content-Type', tile.contentType);
        res.setHeader('Cache-Control', tile.cacheControl);
        res.send(tile.body);
    } catch (error) {
        try {
            const fallbackTile = await fetchBinary(
                `${WEATHER_TILE_URL}/precipitation_new/${z}/${x}/${y}.png?appid=${API_KEY}`
            );
            res.setHeader('Content-Type', fallbackTile.contentType);
            res.setHeader('Cache-Control', fallbackTile.cacheControl);
            res.send(fallbackTile.body);
        } catch (fallbackError) {
            res.status(502).json({ error: 'Unable to load radar tile' });
        }
    }
});

app.listen(port, () => {
    console.log(`Weather app running at http://localhost:${port}`);
});
