// This file will read in OWM and NWS data and merge them into a single response
// that averages + combines the data to return the most accurate forecast.

import { logMessage } from './logging.js';
import dotenv from 'dotenv';
dotenv.config();
var loglevel = process.env.LOG_LEVEL || 'info';

function safeParseInt(value) {
    const parsed = parseInt(value);
    return (isNaN(parsed) || parsed == null) ? null : parsed;
}

function safeParseFloat(value, places=2) {
    const parsed = parseFloat(value, places);
    return (isNaN(parsed) || parsed == null) ? null : parsed;
}

function getSpcIndex(label) {
    switch (label) {
        case 'MRGL': return '1';
        case 'SLGT': return '2';
        case 'ENH': return '3';
        case 'MDT': return '4';
        case 'HIGH': return '5';
        default: return '0';
    }
}

const pointInRing = (point, ring) => {
    const [px, py] = point;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
    }
    return inside;
};

const pointInPolygon = (point, polygon) => {
    if (!Array.isArray(polygon) || polygon.length === 0) return false;
    const inOuter = pointInRing(point, polygon[0]);
    if (!inOuter) return false;
    for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(point, polygon[i])) return false;
    }
    return true;
};

function findColorForAlert(event) {
    switch(event) {
    case "Air Quality Alert":
        return "#768b00";
    case "Avalanche Warning":
        return "#ff00ff";
    case "Dust Advisory":
        return "#706e00";
    case "Dust Storm Warning":
        return "#776b00";
    case "Flash Flood Emergency":
        return "#00ff00";
    case "Flash Flood Warning":
        return "#00ff00";
    case "Flood Advisory":
        return "#00538b";
    case "Flood Warning":
        return "#1E90FF";
    case "Flood Watch":
        return "#60fd82";
    case "Marine Weather Statement":
        return "#690083";
    case "PDS Tornado Warning":
        return "#e900dd";
    case "Severe Thunderstorm Warning":
        return "#f1a500";
    case "Snow Squall Warning":
        return "#0096aa";
    case "Special Marine Warning":
        return "#8b3300";
    case "Special Weather Statement":
        return "#eeff00";
    case "Tornado Emergency":
        return "#9f00e9";
    case "Tornado Warning":
        return "#e90000";
    case "Tropical Storm Watch":
        return "#3f0072";
    case "Winter Storm Warning":
        return "#00d4ff";
    case "Winter Weather Advisory":
        return "#0087af";
    case "Winter Storm Watch":
        return "#00aaff";
    case "Ice Storm Warning":
        return "#0047ab";
    case "High Wind Warning":
        return "#ff8000";
    case "Extreme Cold Warning":
        return "#00ffff";
    case "Heat Advisory":
        return "#ff7000";
    case "Heat Warning":
        return "#ff2000";
    case "Red Flag Warning":
        return "#ff00c8ff";
    case "Extreme Wind Warning":
        return "#d400ffff";
    default:
        if (event.includes("Warning")) {
            return "#FF0000";
        } else if (event.includes("Watch")) {
            return "#FFA500";
        } else {
            return "#FFCC00";
        }
    }
}


function parseWeatherCondition(conditiontext) {
    // Guess based on the conditiontext what the condition is and convert
    // it to a standard human-readable condition and code.

    /* Code formatting:
    1st digit: General type (
        clear=1,
        mostlyclear=2,
        partlyclear=3,
        mostlycloudy=4,
        cloudy=5,
        precipitation=6,
        haze=7,
        fog=8
        )
    2nd digit: Intensity (
        none/notapplicable=0,
        light=1,
        moderate=2,
        heavy=3
        )
    3rd digit: Additional info (
        none/notapplicable=0,
        snowshower=1,
        rainshower=2,
        stormshower=3,
        )

    */

    logMessage(`Parsing weather condition from text: ${conditiontext}`, 'debug', loglevel);

    if (!conditiontext || conditiontext.length === 0) {
        return null;
    } else if (conditiontext.toLowerCase().includes("shower")) {
        // Find intensity
        if (conditiontext.toLowerCase().includes("light")) {
            if (conditiontext.toLowerCase().includes("rain")) {
                return { condition: "Light Rain Showers", code: 612 };
            } else if (conditiontext.toLowerCase().includes("snow")) {
                return { condition: "Light Snow Showers", code: 611 };
            }
        } else if (conditiontext.toLowerCase().includes("heavy")) {
            if (conditiontext.toLowerCase().includes("rain")) {
                return { condition: "Heavy Rain Showers", code: 632 };
            } else if (conditiontext.toLowerCase().includes("snow")) {
                return { condition: "Heavy Snow Showers", code: 631 };
            }
        } else {
            // Moderate or unspecified
            if (conditiontext.toLowerCase().includes("rain")) {
                return { condition: "Rain Showers", code: 622 };
            } else if (conditiontext.toLowerCase().includes("snow")) {
                return { condition: "Snow Showers", code: 621 };
            }
        }
    } else if (conditiontext.toLowerCase().includes("rain")) {
        // Find intensity
        if (conditiontext.toLowerCase().includes("light")) {
            return { condition: "Light Rain", code: 611 };
        } else if (conditiontext.toLowerCase().includes("heavy")) {
            return { condition: "Heavy Rain", code: 613 };
        } else {
            return { condition: "Rain", code: 612 };
        }
    } else if (conditiontext.toLowerCase().includes("snow")) {
        // Find intensity
        if (conditiontext.toLowerCase().includes("light")) {
            return { condition: "Light Snow", code: 621 };
        } else if (conditiontext.toLowerCase().includes("heavy")) {
            return { condition: "Heavy Snow", code: 623 };
        } else {
            return { condition: "Snow", code: 622 };
        }
    } else if (conditiontext.toLowerCase().includes("storm") || conditiontext.toLowerCase().includes("thunder")) {
        // Find intensity
        if (conditiontext.toLowerCase().includes("light")) {
            return { condition: "Light Storm", code: 631 };
        } else if (conditiontext.toLowerCase().includes("heavy")) {
            return { condition: "Heavy Storm", code: 633 };
        } else {
            return { condition: "Storm", code: 632 };
        }
    } else if (conditiontext.toLowerCase().includes("fog") || conditiontext.toLowerCase().includes("mist")) {
        return { condition: "Fog", code: 800 };
    } else if (conditiontext.toLowerCase().includes("haze") || conditiontext.toLowerCase().includes("hazy")) {
        return { condition: "Haze", code: 700 };
    } else if (conditiontext.toLowerCase().includes("cloud")) {
        if (conditiontext.toLowerCase().includes("mostly")) {
            return { condition: "Mostly Cloudy", code: 540 };
        } else if (conditiontext.toLowerCase().includes("partly") || conditiontext.toLowerCase().includes("broken")) {
            return { condition: "Partly Cloudy", code: 330 };
        } else {
            return { condition: "Cloudy", code: 500 };
        }
    } else if (conditiontext.toLowerCase().includes("clear") || conditiontext.toLowerCase().includes("sun") || conditiontext.toLowerCase().includes("fair")) {
        if (conditiontext.toLowerCase().includes("mostly")) {
            return { condition: "Mostly Clear", code: 240 };
        } else if (conditiontext.toLowerCase().includes("partly")) {
            return { condition: "Partly Cloudy", code: 330 };
        } else {
            return { condition: "Clear", code: 100 };
        }
    } else {
        return null;
    }
}

export function parseWeatherData(point, raw_owm, raw_nws, raw_alerts, spc_outlooks, raw_mcd) {
    var parsedData = {};
    var parsedalerts = [];

    // Parse SPC Risks
    var risks = [];
    var i = 0;

    if (spc_outlooks && Array.isArray(spc_outlooks)) {
        spc_outlooks.forEach((outlook) => {
            let bestFeature = null;
            outlook?.features?.forEach((feature) => {
                if (!feature?.geometry || !feature?.properties) return;
                const { geometry, properties } = feature;

                const checkPolygon = (polyCoords) => {
                    if (pointInPolygon(point, polyCoords)) {
                        if (!bestFeature || (properties.DN ?? 0) > (bestFeature.properties.DN ?? 0)) {
                            bestFeature = feature;
                        }
                    }
                };

                if (geometry.type === 'Polygon') {
                    checkPolygon(geometry.coordinates);
                } else if (geometry.type === 'MultiPolygon') {
                    geometry.coordinates.forEach((poly) => checkPolygon(poly));
                }
            });

            if (bestFeature) {
                const { LABEL, LABEL2, fill, stroke } = bestFeature.properties;
                risks.push({
                    date: new Date(new Date().setDate(new Date().getDate() + i)).toISOString().split('T')[0],
                    level: LABEL,
                    description: LABEL2,
                    color: fill,
                    altcolor: stroke
                });
            } else {
                risks.push({
                    date: new Date(new Date().setDate(new Date().getDate() + i)).toISOString().split('T')[0],
                    level: "NONE",
                    description: "No thunderstorms forecast for this location.",
                    color: null,
                    altcolor: null
                });
            }
            i++;
        });
    }

    // Parse mesoscale discussions (filter to active for current location)
    var parsedMcds = [];
    try {
        const now = new Date();
        raw_mcd?.data?.features?.forEach((mcd) => {
            const geometry = mcd?.geometry;
            if (!geometry) return;

            // Extract expiry HHMM from folderpath like "MD 0045 Active Till 2345 UTC"
            let timeStr = null;
            const folder = mcd?.properties?.folderpath || '';
            if (folder.includes('Till')) {
                timeStr = folder.split('Till')[1]?.replace('UTC', '')?.trim() || null;
            }

            let expiresIso = null;
            let expiresDate = null;
            if (timeStr && /^\d{4}$/.test(timeStr)) {
                const issueDate = new Date(mcd?.properties?.idp_filedate);
                if (!isNaN(issueDate.getTime())) {
                    const hh = parseInt(timeStr.slice(0, 2), 10);
                    const mm = parseInt(timeStr.slice(2, 4), 10);
                    expiresDate = new Date(Date.UTC(
                        issueDate.getUTCFullYear(),
                        issueDate.getUTCMonth(),
                        issueDate.getUTCDate(),
                        hh, mm, 0
                    ));
                    expiresIso = expiresDate.toISOString();
                }
            }

            // Spatial filter: point must be inside polygon (support Polygon and MultiPolygon)
            let containsPoint = false;
            if (geometry.type === 'Polygon') {
                containsPoint = pointInPolygon(point, geometry.coordinates);
            } else if (geometry.type === 'MultiPolygon') {
                for (const poly of geometry.coordinates) {
                    if (pointInPolygon(point, poly)) { containsPoint = true; break; }
                }
            }

            // Temporal filter: if expiry known, require now <= expiry
            const isActiveByTime = expiresDate ? now <= expiresDate : true;

            if (containsPoint && isActiveByTime) {
                parsedMcds.push({
                    geometry: geometry,
                    number: parseInt((mcd?.properties?.name || '').replace('MD ', '')) || null,
                    issued: (new Date(mcd?.properties?.idp_filedate)).toISOString() || null,
                    expires: expiresIso || null,
                    url: mcd?.properties?.popupinfo || null,
                    title: mcd?.properties?.folderpath || mcd?.properties?.name || null,
                });
            }
        });
    } catch (e) {
        logMessage(`Unable to parse MCDs: ${e.message}`, 'warn', loglevel);
    }

    // Parse alerts
    try {
        raw_alerts?.features?.forEach((alert) => {
            if (alert?.properties?.event.toLowerCase().includes("outlook")) { return; }

            parsedalerts.push({
                properties: {
                    id: alert?.properties?.id || null,
                    issued: alert?.properties?.sent || null,
                    start: alert?.properties?.effective || null,
                    end: alert?.properties?.expires || null,
                    severity: alert?.properties?.severity || null,
                },
                product: {
                    areas: alert?.properties?.areaDesc || null,
                    event: alert?.properties?.event || null,
                    color: findColorForAlert(alert?.properties?.event || '') || null,
                    headline: alert?.properties?.headline || null,
                    description: alert?.properties?.description.replace(/\n\n/g, "\n").replace(/\n/g, " ") || null,
                    instructions: alert?.properties?.instruction.replace(/\n\n/g, "\n").replace(/\n/g, " ") || null,
                }
            });
        });
    } catch (e) {
        logMessage(`Unable to parse alerts: ${e.message}`, 'warn', loglevel);
    }

    // Parse minutely forecast
    var minutelyforecast = [];
    try {
        raw_owm?.minutely?.forEach((minute) => {
            minutelyforecast.push({
                time: new Date((minute?.dt || 0) * 1000).toISOString() || null,
                precipitation: safeParseFloat(minute?.precipitation) || 0, // %
            });
        });
    } catch (e) {
        logMessage(`Unable to parse minutely forecast: ${e.message}`, 'warn', loglevel);
    }

    // Parse hourly forecast
    var hourlyforecast = [];
    try {
        raw_owm?.hourly?.forEach((hour) => {
            hourlyforecast.push({
                time: new Date((hour?.dt || 0) * 1000).toISOString() || null,
                temperature: safeParseFloat(hour?.temp) || null, // Kelvin
                feels_like: safeParseFloat(hour?.feels_like) || null, // Kelvin
                humidity: safeParseInt(hour?.humidity) || null, // %
                wind_speed: safeParseFloat(hour?.wind_speed) || null, // m/s
                wind_direction: safeParseInt(hour?.wind_deg) || null, // degrees
                condition: parseWeatherCondition(hour?.weather[0]?.description || null) || { condition: "Unknown", code: 0, raw: hour?.weather[0]?.description },
                cloud_cover: safeParseInt(hour?.clouds) || null, // %
                precipitation_probability: safeParseInt(hour?.pop * 100) || 0, // %
            });
        });
    } catch (e) {
        logMessage(`Unable to parse hourly forecast: ${e.message}`, 'warn', loglevel);
    }

    // Parse daily forecast
    // OWM is iterated, but NWS should be used with OWM as a fallback
    var dailyforecast = [];
    var nwsindex = -1;
    try {
        raw_owm?.daily?.forEach((day) => {
            nwsindex++;
            var conditionDay;
            var conditionNight;
            var highTemp;
            var lowTemp;
            var precipitationProbabilityDay;
            var precipitationProbabilityNight;
            var description;

            // Safe access helpers
            const nwsTempLabel = Array.isArray(raw_nws?.time?.tempLabel) && raw_nws.time.tempLabel.length > nwsindex ? raw_nws.time.tempLabel[nwsindex] : null;
            const nwsWeather = Array.isArray(raw_nws?.data?.weather) && raw_nws.data.weather.length > nwsindex ? raw_nws.data.weather[nwsindex] : null;
            const nwsWeatherNext = Array.isArray(raw_nws?.data?.weather) && raw_nws.data.weather.length > (nwsindex + 1) ? raw_nws.data.weather[nwsindex + 1] : null;
            const nwsTempValue = Array.isArray(raw_nws?.data?.temperature) && raw_nws.data.temperature.length > nwsindex ? raw_nws.data.temperature[nwsindex] : null;
            const nwsTempValueNext = Array.isArray(raw_nws?.data?.temperature) && raw_nws.data.temperature.length > (nwsindex + 1) ? raw_nws.data.temperature[nwsindex + 1] : null;
            const nwsPop = Array.isArray(raw_nws?.data?.pop) && raw_nws.data.pop.length > nwsindex ? raw_nws.data.pop[nwsindex] : 0;
            const nwsPopNext = Array.isArray(raw_nws?.data?.pop) && raw_nws.data.pop.length > (nwsindex + 1) ? raw_nws.data.pop[nwsindex + 1] : 0;
            const nwsText = Array.isArray(raw_nws?.data?.text) && raw_nws.data.text.length > nwsindex ? raw_nws.data.text[nwsindex] : null;
            const dayWeatherDesc = Array.isArray(day?.weather) && day.weather.length > 0 ? day.weather[0]?.description : null;

            if (raw_nws && nwsTempLabel === "High") {
                // Daytime segment
                conditionDay = parseWeatherCondition(nwsWeather || null) || parseWeatherCondition(dayWeatherDesc || null) || { condition: "Unknown", code: 0, raw: dayWeatherDesc };
                conditionNight = parseWeatherCondition(nwsWeatherNext || null) || { condition: "Unknown", code: 0, raw: nwsWeatherNext };
                highTemp = safeParseFloat(nwsTempValue * 5/9 + 273.15) || safeParseFloat(day?.temp?.max) || null;
                lowTemp = safeParseFloat(nwsTempValueNext * 5/9 + 273.15) || safeParseFloat(day?.temp?.min) || null;
                precipitationProbabilityDay = safeParseInt(nwsPop) || null;
                precipitationProbabilityNight = safeParseInt(nwsPopNext) || null;
                description = nwsText || null;
                nwsindex++; // Skip the next index as it was just used for nighttime
            } else if (raw_nws && nwsTempLabel === "Low") {
                // Nighttime segment
                conditionDay = parseWeatherCondition(dayWeatherDesc || null) || { condition: "Unknown", code: 0, raw: dayWeatherDesc };
                conditionNight = parseWeatherCondition(nwsWeather || null) || { condition: "Unknown", code: 0, raw: nwsWeather };
                highTemp = safeParseFloat(day?.temp?.max) || null;
                lowTemp = safeParseFloat(nwsTempValue * 5/9 + 273.15) || safeParseFloat(day?.temp?.min) || null;
                precipitationProbabilityDay = null;
                precipitationProbabilityNight = safeParseInt(nwsPop) || null;
                description = nwsText || null;
            } else {
                // No NWS data available for this day, or at all
                conditionDay = parseWeatherCondition(dayWeatherDesc || null) || { condition: "Unknown", code: 0, raw: dayWeatherDesc };
                conditionNight = { condition: "Unknown", code: 0, raw: null };
                highTemp = safeParseFloat(day?.temp?.max) || null;
                lowTemp = safeParseFloat(day?.temp?.min) || null;
                precipitationProbabilityDay = null;
                precipitationProbabilityNight = null;
                description = null;
            }

            dailyforecast.push({
                date: new Date((day?.dt || 0) * 1000).toISOString().split('T')[0] || null,
                condition: conditionDay,
                sunrise: new Date((day?.sunrise || 0) * 1000).toISOString() || null,
                sunset: new Date((day?.sunset || 0) * 1000).toISOString() || null,
                high: highTemp, // Kelvin
                low: lowTemp, // Kelvin
                precipitation_probability: precipitationProbabilityDay, // %
                wind_speed: safeParseFloat(day?.wind_speed) || null, // m/s
                wind_direction: safeParseInt(day?.wind_deg) || null, // degrees
                description: description,
                night: {
                    condition: conditionNight,
                    precipitation_probability: precipitationProbabilityNight, // %
                }
            });
        });
    } catch (e) {
        logMessage(`Unable to parse daily forecast: ${e.message}`, 'warn', loglevel);
    }

    // Parse current conditions
    var sunrise;
    try {
        sunrise = new Date((raw_owm?.current?.sunrise || 0) * 1000).toISOString();
        if (sunrise === "1970-01-01T00:00:00.000Z") { sunrise = null; }
    } catch (e) { sunrise = null; }
    var sunset;
    try {
        sunset = new Date((raw_owm?.current?.sunset || 0) * 1000).toISOString();
        if (sunset === "1970-01-01T00:00:00.000Z") { sunset = null; }
    } catch (e) { sunset = null; }
    var temperature;
    try {
        temperature = (((raw_nws?.currentobservation?.Temp || 0) - 32) * 5/9 ) + 273.15; // F to Kelvin
        if (isNaN(temperature) || temperature === 255.37222222222223) { temperature = null; }
    } catch (e) { temperature = null; }
    var windspeed;
    try {
        windspeed = (raw_nws?.currentobservation?.Winds || 0) * 0.44704; // mph to m/s
        if (isNaN(windspeed) || windspeed === 0) { windspeed = null; }
    } catch (e) { windspeed = null; }
    var windgust;
    try {
        windgust = (raw_nws?.currentobservation?.Gust || 0) * 0.44704; // mph to m/s
        if (isNaN(windgust) || windgust === 0) { windgust = null; }
    } catch (e) { windgust = null; }
    var dewpoint;
    try {
        dewpoint = (((raw_nws?.currentobservation?.Dewp || 0) - 32) * 5/9 ) + 273.15; // F to Kelvin
        if (isNaN(dewpoint) || dewpoint === 255.37222222222223) { dewpoint = null; }
    } catch (e) { dewpoint = null; }
    var visibility;
    try {
        visibility = (raw_nws?.currentobservation?.Visibility || 0) * 1.60934; // miles to kilometers
        if (isNaN(visibility) || visibility === 0) { 
            visibility = ((raw_owm?.current?.visibility / 1000) || 0) * 1.60934; // miles to kilometers
            if (isNaN(visibility) || visibility === 0) { visibility = null; }
        }
    } catch (e) { visibility = null; }
    var pressure;
    try {
        pressure = (raw_nws?.currentobservation?.SLP || 0) * 33.8639; // inHg to hPa (mb)
        if (isNaN(pressure) || pressure === 0) {
            pressure = raw_owm?.current?.pressure || 0; // hPa (mb)
            if (isNaN(pressure) || pressure === 0) { pressure = null; }
        }
    } catch (e) { pressure = null; }


    parsedData = {
        location: {
            wfo: raw_nws?.location?.wfo || null,
            nearest_radar: raw_nws?.location?.radar || 'international',
            sunrise: sunrise || null,
            sunset: sunset || null,
        },
        current: {
            temperature: (typeof temperature === 'number' && !isNaN(temperature))
                ? safeParseFloat(temperature.toFixed(2))
                : safeParseFloat(raw_owm?.current?.temp) || null, // Kelvin
            dew_point: (typeof dewpoint === 'number' && !isNaN(dewpoint))
                ? safeParseFloat(dewpoint.toFixed(2))
                : safeParseFloat(raw_owm?.current?.dew_point) || null, // Kelvin
            humidity: safeParseInt(raw_owm?.current?.humidity) || null, // %
            wind_speed: (typeof windspeed === 'number' && !isNaN(windspeed) && windspeed !== 0)
                ? safeParseFloat(windspeed)
                : safeParseFloat(raw_owm?.current?.wind_speed) || null, // m/s
            wind_gust: (typeof windgust === 'number' && !isNaN(windgust) && windgust !== 0)
                ? safeParseFloat(windgust)
                : safeParseFloat(raw_owm?.current?.wind_gust) || null, // m/s
            wind_direction: safeParseInt(raw_nws?.currentobservation?.Windd) || safeParseInt(raw_owm?.current?.wind_deg) || null, // degrees
            condition: parseWeatherCondition(raw_nws?.currentobservation?.Weather || null) || parseWeatherCondition(raw_owm?.current?.weather[0]?.description || null) || { condition: "Unknown", code: 0, raw: raw_nws?.currentobservation?.Weather || raw_owm?.current?.weather[0]?.description || null },
            cloud_cover: safeParseInt(raw_owm?.current?.clouds) || null, // %
            visibility: (typeof visibility === 'number' && !isNaN(visibility) && visibility !== 0)
                ? safeParseFloat(visibility)
                : safeParseFloat(raw_owm?.current?.visibility) || null, // kilometers
            pressure: (typeof pressure === 'number' && !isNaN(pressure) && pressure !== 0)
                ? safeParseFloat(pressure.toFixed(2))
                : safeParseFloat(raw_owm?.current?.pressure) || null, // hPa (mb)
        },
        alerts: parsedalerts,
        mesoscale_discussions: parsedMcds || [],
        forecasts: {
            spc: risks || [],
            minutely: minutelyforecast || [],
            hourly: hourlyforecast || [],
            daily: dailyforecast || [],
        }
    };

    logMessage(`Parsed weather data.`, 'debug', loglevel);
    return parsedData;
}