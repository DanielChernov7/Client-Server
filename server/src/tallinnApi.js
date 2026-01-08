/**
 * Tallinn Transport API Client
 * Uses official transport.tallinn.ee endpoints
 */

const https = require('https');

const BASE_URL = 'https://transport.tallinn.ee';

// Cache for stops and routes (refresh every hour)
let stopsCache = null;
let siriIdMap = null; // Map stopId -> siriId
let cacheTimestamp = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Fetch data from URL
 */
function fetchData(url) {
    console.log(`[TallinnAPI] Fetching: ${url}`);
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            console.log(`[TallinnAPI] Response status: ${res.statusCode}`);
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`[TallinnAPI] Response length: ${data.length} bytes`);
                resolve(data);
            });
            res.on('error', reject);
        }).on('error', (err) => {
            console.error(`[TallinnAPI] Request error: ${err.message}`);
            reject(err);
        });
    });
}

/**
 * Parse stops.txt CSV data
 * Format: ID;SiriID;Lat;Lng;Stops;Name;Info;Street;Area;City;...
 *
 * There are two types of records:
 * 1. Aggregated stops (ID starts with 'a') - no SiriID, used for display
 * 2. Platform stops - have SiriID, used for API calls
 */
function parseStops(data) {
    const lines = data.trim().split('\n');
    const stops = [];
    const idToSiri = new Map();

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(';');
        if (parts.length < 5) continue;

        const id = parts[0];
        const siriId = parts[1];
        const lat = parseInt(parts[2]) / 100000;
        const lng = parseInt(parts[3]) / 100000;
        const relatedStops = parts[4] ? parts[4].split(',') : [];

        // Build siriId mapping for all stops with siriId
        if (siriId && /^\d+$/.test(siriId)) {
            idToSiri.set(id, siriId);
            // Also map related stops to this siriId if they don't have their own
            for (const relId of relatedStops) {
                if (!idToSiri.has(relId)) {
                    idToSiri.set(relId, siriId);
                }
            }
        }

        // Only include stops with name (full records) for the stops list
        if (parts.length >= 6 && parts[5]) {
            stops.push({
                id: id,
                siriId: siriId || null,
                lat: lat,
                lng: lng,
                stopIds: relatedStops,
                name: parts[5],
                info: parts[6] || '',
                street: parts[7] || '',
                area: parts[8] || '',
                city: parts[9] || ''
            });
        }
    }

    // Store the siriId map globally
    siriIdMap = idToSiri;
    console.log(`[TallinnAPI] Built SiriID map with ${idToSiri.size} entries`);

    return stops;
}

/**
 * Get all stops (cached)
 */
async function getStops() {
    const now = Date.now();
    if (stopsCache && (now - cacheTimestamp) < CACHE_TTL) {
        return stopsCache;
    }

    try {
        const data = await fetchData(`${BASE_URL}/data/stops.txt`);
        stopsCache = parseStops(data);
        cacheTimestamp = now;
        console.log(`Loaded ${stopsCache.length} stops from Tallinn API`);
        return stopsCache;
    } catch (error) {
        console.error('Failed to fetch stops:', error.message);
        return stopsCache || [];
    }
}

/**
 * Get stops by region/area
 */
async function getStopsByRegion(region) {
    const stops = await getStops();
    if (!region) return stops;

    const lowerRegion = region.toLowerCase();
    return stops.filter(s =>
        (s.area && s.area.toLowerCase().includes(lowerRegion)) ||
        (s.city && s.city.toLowerCase().includes(lowerRegion))
    );
}

/**
 * Get unique regions
 */
async function getRegions() {
    const stops = await getStops();
    const regions = new Set();

    stops.forEach(s => {
        if (s.area && s.area !== '0') regions.add(s.area);
    });

    return Array.from(regions).sort();
}

/**
 * Get SiriID for a stop (needed for SIRI API)
 */
async function getSiriId(stopId) {
    // Ensure stops are loaded (which builds the siriIdMap)
    if (!siriIdMap) {
        await getStops();
    }

    // If stopId is already a numeric SiriID, use it directly
    if (/^\d+$/.test(stopId)) {
        return stopId;
    }

    // Look up in the map
    return siriIdMap ? siriIdMap.get(stopId) : null;
}

/**
 * Get stop arrivals from SIRI API
 * Returns real-time arrival information
 */
async function getArrivals(stopId) {
    try {
        // Convert stopId to SiriID for the API
        const siriId = await getSiriId(stopId);
        if (!siriId) {
            console.log(`[TallinnAPI] No SiriID found for stop ${stopId}`);
            return { arrivals: [], timestamp: Date.now() };
        }

        console.log(`[TallinnAPI] getArrivals(${stopId}) -> using SiriID: ${siriId}`);
        const url = `${BASE_URL}/siri-stop-departures.php?stopid=${encodeURIComponent(siriId)}`;
        const data = await fetchData(url);
        const lines = data.trim().split('\n');

        console.log(`[TallinnAPI] Got ${lines.length} lines`);
        if (lines.length <= 3) {
            console.log(`[TallinnAPI] Raw response: ${data.substring(0, 200)}`);
        }

        // First line is header: Transport,RouteNum,ExpectedTimeInSeconds,ScheduleTimeInSeconds,timestamp,version
        if (lines.length <= 1) {
            console.log(`[TallinnAPI] No arrivals data for SiriID ${siriId}`);
            return { arrivals: [], timestamp: Date.now() };
        }

        const arrivals = [];
        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(',');
            if (parts.length >= 4) {
                const transportType = getTransportType(parts[0]);
                const expectedSeconds = parseInt(parts[2]) || 0;
                const scheduleSeconds = parseInt(parts[3]) || 0;

                arrivals.push({
                    transport: transportType,
                    route: parts[1],
                    expectedMinutes: Math.round(expectedSeconds / 60),
                    scheduleMinutes: Math.round(scheduleSeconds / 60),
                    expectedTime: formatTime(expectedSeconds),
                    scheduleTime: formatTime(scheduleSeconds),
                    isRealtime: expectedSeconds !== scheduleSeconds
                });
            }
        }

        // Sort by expected arrival time
        arrivals.sort((a, b) => a.expectedMinutes - b.expectedMinutes);

        return { arrivals, timestamp: Date.now() };
    } catch (error) {
        console.error('Failed to fetch arrivals:', error.message);
        return { arrivals: [], timestamp: Date.now(), error: error.message };
    }
}

/**
 * Get transport type name
 */
function getTransportType(code) {
    const types = {
        '1': 'tram',
        '2': 'bus',
        '3': 'trolley',
        '4': 'train',
        '5': 'ferry'
    };
    return types[code] || 'bus';
}

/**
 * Format seconds to HH:MM
 */
function formatTime(totalSeconds) {
    const now = new Date();
    const arrivalTime = new Date(now.getTime() + totalSeconds * 1000);
    return arrivalTime.toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Get real-time GPS positions
 */
async function getGpsPositions() {
    try {
        const data = await fetchData(`${BASE_URL}/gps.txt`);
        const lines = data.trim().split('\n');
        const positions = [];

        for (const line of lines) {
            const parts = line.split(',');
            if (parts.length >= 10) {
                positions.push({
                    transport: getTransportType(parts[0]),
                    route: parts[1],
                    lng: parseInt(parts[2]) / 100000,
                    lat: parseInt(parts[3]) / 100000,
                    vehicleId: parts[5],
                    speed: parseInt(parts[7]) || 0,
                    destination: parts[9]
                });
            }
        }

        return positions;
    } catch (error) {
        console.error('Failed to fetch GPS:', error.message);
        return [];
    }
}

/**
 * Find nearest stop to coordinates
 */
async function findNearestStop(lat, lng) {
    const stops = await getStops();
    let nearest = null;
    let minDistance = Infinity;

    for (const stop of stops) {
        const distance = getDistance(lat, lng, stop.lat, stop.lng);
        if (distance < minDistance) {
            minDistance = distance;
            nearest = { ...stop, distance_km: Math.round(distance * 100) / 100 };
        }
    }

    return nearest;
}

/**
 * Calculate distance between two points (Haversine formula)
 */
function getDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function toRad(deg) {
    return deg * Math.PI / 180;
}

/**
 * Get routes/buses for a stop
 */
async function getRoutesForStop(stopId) {
    // Get arrivals to see which routes serve this stop
    const { arrivals } = await getArrivals(stopId);
    const routes = [...new Set(arrivals.map(a => a.route))];
    return routes.sort((a, b) => {
        const numA = parseInt(a) || 999;
        const numB = parseInt(b) || 999;
        return numA - numB;
    });
}

module.exports = {
    getStops,
    getStopsByRegion,
    getRegions,
    getArrivals,
    getGpsPositions,
    findNearestStop,
    getRoutesForStop
};
