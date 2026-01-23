// Required imports
import express from 'express';
import dotenv from 'dotenv';
import { logMessage } from './logging.js';
import { parseWeatherData } from './dataparser.js';
import fetch from 'node-fetch';

// ===== Setup =====

// Set up environment variables
dotenv.config();
const apiKey = process.env.API_KEY;
const port = process.env.PORT || 3000;
const loglevel = process.env.LOG_LEVEL || 'info';
if (!process.env.OWM_API_KEY){
    console.error("Error: OWM_API_KEY is not set in environment variables.");
    process.exit(1);
} else {
    console.log("OWM API key initialized as " + process.env.OWM_API_KEY.substring(0, 4) + "****");
}

// Set up the Express app
const app = express();
app.use(express.json());

// Helper to safely fetch SPC outlook JSON with content-type and timeout checks
async function fetchSpcOutlook(url, label) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type')?.toLowerCase() || '';
        const bodyText = await response.text();

        if (!contentType.includes('application/json') && !contentType.includes('application/geo+json')) {
            throw new Error(`Unexpected content-type ${contentType || 'unknown'}; body starts with "${bodyText.slice(0, 80)}"`);
        }

        let parsed;
        try {
            parsed = JSON.parse(bodyText);
        } catch (parseErr) {
            throw new Error(`Invalid JSON: ${parseErr.message}; body starts with "${bodyText.slice(0, 80)}"`);
        }

        return { data: parsed, status: 'OK' };
    } catch (err) {
        if (err.name === 'AbortError') {
            logMessage(`SPC outlook fetch timeout (${label}): request exceeded 5 seconds`, 'warn', loglevel);
            return { data: null, status: 'FETCH TIMEOUT' };
        }
        logMessage(`Error fetching SPC outlook (${label}): ${err.message}`, 'error', loglevel);
        return { data: null, status: 'FETCH ERROR' };
    } finally {
        clearTimeout(timeout);
    }
}


// ===== Endpoints =====

// Home route

app.get('/', (req, res) => {
    try {
        res.json({ status: "OK" });
        logMessage(`Received request at /`, 'debug', loglevel);
    } catch (err) {
        logMessage(`Uncaught error at /: ${err.message}`, 'error', loglevel);
        res.status(500).json({ status: "ERROR", code: 500, message: err.message });
    }
});


app.get('/onecall', async (req, res) => {
    logMessage(`Received request at /onecall`, 'debug', loglevel);
    try {
        const requestApiKey = req.query.key;
        if (requestApiKey !== apiKey) {
            logMessage(`Unauthorized access attempt to /onecall with API key: ${requestApiKey}`, 'warn', loglevel);
            res.status(401).json({ status: "ERROR", code: 401, message: "Invalid API key" });
            return;
        }

        const lat = req.query.lat;
        const lon = req.query.lon;

        if (!lat || !lon) {
            res.status(400).json({ status: "ERROR", code: 400, message: "Missing lat or lon parameter" });
            return;
        }

        let raw_owm = null;
        let raw_nws = null;
        let raw_alerts = null;
        let spcRiskD1 = null;
        let spcRiskD2 = null;
        let spcRiskD3 = null;
        let nws_status = "NOT FETCHED";
        let owm_status = "NOT FETCHED";
        let alerts_status = "NOT FETCHED";
        let spc_d1_status = "NOT FETCHED";
        let spc_d2_status = "NOT FETCHED";
        let spc_d3_status = "NOT FETCHED";

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            try {
                const owmResponse = await fetch(`https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&appid=${process.env.OWM_API_KEY}`, { signal: controller.signal });
                clearTimeout(timeout);
                raw_owm = await owmResponse.json();
                owm_status = "OK";
            } catch (fetchErr) {
                clearTimeout(timeout);
                if (fetchErr.name === 'AbortError') {
                    logMessage(`OpenWeatherMap fetch timeout: request exceeded 5 seconds`, 'warn', loglevel);
                    owm_status = "FETCH TIMEOUT";
                } else {
                    logMessage(`Error fetching data from OpenWeatherMap: ${fetchErr.message}`, 'error', loglevel);
                    owm_status = "FETCH ERROR";
                }
                raw_owm = {};
            }
        } catch (err) {
            logMessage(`Error fetching data from OpenWeatherMap: ${err.message}`, 'error', loglevel);
            raw_owm = {};
            owm_status = "FETCH ERROR";
        }

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            try {
                const nwsResponse = await fetch(`https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}&FcstType=json`, { signal: controller.signal });
                clearTimeout(timeout);
                raw_nws = await nwsResponse.json();
                nws_status = "OK";
            } catch (fetchErr) {
                clearTimeout(timeout);
                if (fetchErr.name === 'AbortError') {
                    logMessage(`NWS fetch timeout: request exceeded 5 seconds`, 'warn', loglevel);
                    nws_status = "FETCH TIMEOUT";
                } else if (fetchErr.toString().includes("is not valid JSON")) {
                    // No NWS data available for this location
                    logMessage(`No NWS data available for lat: ${lat}, lon: ${lon}`, 'debug', loglevel);
                    nws_status = "NO DATA";
                } else {
                    logMessage(`Error fetching data from NWS: ${fetchErr.message}`, 'error', loglevel);
                    nws_status = "FETCH ERROR";
                }
                raw_nws = {};
            }
        } catch (err) {
            logMessage(`Error fetching data from NWS: ${err.message}`, 'error', loglevel);
            raw_nws = {};
            nws_status = "FETCH ERROR";
        }

        if (nws_status == "OK"){
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);
                try {
                    const alertsResponse = await fetch(`https://api.weather.gov/alerts/active/zone/${raw_nws?.location?.zone || ''}`, { signal: controller.signal });
                    clearTimeout(timeout);
                    raw_alerts = await alertsResponse.json();
                    alerts_status = "OK";
                } catch (fetchErr) {
                    clearTimeout(timeout);
                    if (fetchErr.name === 'AbortError') {
                        logMessage(`NWS alerts fetch timeout: request exceeded 5 seconds`, 'warn', loglevel);
                        alerts_status = "FETCH TIMEOUT";
                    } else {
                        logMessage(`Error fetching alert data from NWS: ${fetchErr.message}`, 'error', loglevel);
                        alerts_status = "FETCH ERROR";
                    }
                    raw_alerts = {};
                }
            } catch (err) {
                logMessage(`Error fetching alert data from NWS: ${err.message}`, 'error', loglevel);
                alerts_status = "FETCH ERROR";
                raw_alerts = {};
            }
            const day1 = await fetchSpcOutlook('https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson', 'day1');
            spcRiskD1 = day1.data;
            spc_d1_status = day1.status;

            const day2 = await fetchSpcOutlook('https://www.spc.noaa.gov/products/outlook/day2otlk_cat.nolyr.geojson', 'day2');
            spcRiskD2 = day2.data;
            spc_d2_status = day2.status;

            const day3 = await fetchSpcOutlook('https://www.spc.noaa.gov/products/outlook/day3otlk_cat.nolyr.geojson', 'day3');
            spcRiskD3 = day3.data;
            spc_d3_status = day3.status;
        }

        // SPC polygons are [lon, lat]; build the point accordingly and ensure numeric types
        const response = parseWeatherData([
            parseFloat(lon),
            parseFloat(lat)
        ], raw_owm, raw_nws, raw_alerts, [spcRiskD1, spcRiskD2, spcRiskD3]);

        res.json({ status: {
            owm: owm_status,
            nws: nws_status,
            alerts: alerts_status,
            spc: {
                day1: spc_d1_status,
                day2: spc_d2_status,
                day3: spc_d3_status
            }
        }, data: response });

    } catch (err) {
        logMessage(`Uncaught error at /onecall: ${err.message}`, 'error', loglevel);
        res.status(500).json({ status: "ERROR", code: 500, message: err.message });
    }
});


// ===== Startup =====

// Start the server
app.listen(port, () => {
    console.log(`SparkRadarWXAPI running on port http://localhost:${port}`);
    logMessage(`Server started on port ${port}`, 'info', loglevel);
});

// Handle uncaught errors
app.on('error', (err) => {
    logMessage(`Internal uncaught error: ${err.message}`, 'error', loglevel);
});