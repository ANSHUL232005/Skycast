const https = require('https');
const fs = require('fs');
const path = require('path');

loadEnvFile(path.join(__dirname, '.env'));

const API_KEY = process.env.OPENWEATHER_API_KEY || '';
const BASE_URL = 'https://api.openweathermap.org/data/2.5/weather';

if (!API_KEY) {
    console.log('Missing OPENWEATHER_API_KEY. Set it first, then run: node test-api.js');
    process.exit(1);
}

function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return;

    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        if (!key || process.env[key]) continue;

        const rawValue = trimmed.slice(separatorIndex + 1).trim();
        process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
}

function testAPI() {
    const url = `${BASE_URL}?q=London&appid=${API_KEY}&units=metric`;

    https
        .get(url, res => {
            let data = '';

            res.on('data', chunk => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    const parsed = JSON.parse(data);
                    console.log(`API key works. Sample city: ${parsed.name}`);
                } else {
                    console.log(`API key invalid or unavailable. Status: ${res.statusCode}`);
                    console.log(data);
                }
            });
        })
        .on('error', err => {
            console.log(`Network error: ${err.message}`);
        });
}

testAPI();
