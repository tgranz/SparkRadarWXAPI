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
            const owmResponse = await fetch(`https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&appid=${process.env.OWM_API_KEY}`);
            raw_owm = await owmResponse.json();
            owm_status = "OK";
        } catch (err) {
            logMessage(`Error fetching data from OpenWeatherMap: ${err.message}`, 'error', loglevel);
            res.status(500).json({ status: "ERROR", code: 500, message: "Failed to fetch data from OpenWeatherMap" });
            return;
        }

        try {
            const nwsResponse = await fetch(`https://forecast.weather.gov/MapClick.php?lat=${lat}&lon=${lon}&FcstType=json`);
            raw_nws = await nwsResponse.json();
            nws_status = "OK";
        } catch (err) {
            if (err.toString().includes("is not valid JSON")) {
                // No NWS data available for this location
                logMessage(`No NWS data available for lat: ${lat}, lon: ${lon}`, 'debug', loglevel);
                raw_nws = {};
                nws_status = "NO DATA";

            } else {
                logMessage(`Error fetching data from NWS: ${err.message}`, 'error', loglevel);
                res.status(500).json({ status: "ERROR", code: 500, message: "Failed to fetch data from NWS" });
                nws_status = "FETCH ERROR";
                return;
            }
        }

        if (nws_status == "OK"){
            try {
                const alertsResponse = await fetch(`https://api.weather.gov/alerts/active/zone/${raw_nws?.location?.zone || ''}`);
                raw_alerts = await alertsResponse.json();
                alerts_status = "OK";
            } catch (err) {
                logMessage(`Error fetching alert data from NWS: ${err.message}`, 'error', loglevel);
                alerts_status = "FETCH ERROR";
                return;
            }
            try {
                const spcResponse = await fetch('https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson');
                spcRiskD1 = await spcResponse.json();
                spc_d1_status = "OK";
            } catch (err){
                logMessage(`Error fetching SPC outlook data: ${err.message}`, 'error', loglevel);
                spcRiskD1 = null;
                spc_d1_status = "FETCH ERROR";
            }
            try {
                const spcResponse = await fetch('https://www.spc.noaa.gov/products/outlook/day2otlk_cat.nolyr.geojson');
                spcRiskD2 = await spcResponse.json();
                spc_d2_status = "OK";
            } catch (err){
                logMessage(`Error fetching SPC outlook data: ${err.message}`, 'error', loglevel);
                spcRiskD2 = null;
                spc_d2_status = "FETCH ERROR";
            }
            try {
                const spcResponse = await fetch('https://www.spc.noaa.gov/products/outlook/day3otlk_cat.nolyr.geojson');
                spcRiskD3 = await spcResponse.json();
                spc_d3_status = "OK";
            } catch (err){
                logMessage(`Error fetching SPC outlook data: ${err.message}`, 'error', loglevel);
                spcRiskD3 = null;
                spc_d3_status = "FETCH ERROR";
            }
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