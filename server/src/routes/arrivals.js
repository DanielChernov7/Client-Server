/**
 * Arrivals API routes
 * GET /api/arrivals - Returns next arrivals for a bus at a stop
 */

const express = require('express');
const router = express.Router();
const { query, table } = require('../db');

// Timezone handling
const TIMEZONE = process.env.TZ || 'Europe/Tallinn';

/**
 * Get current date and time in Tallinn timezone
 * @returns {Object} { date: 'YYYYMMDD', time: 'HH:MM:SS', dayOfWeek: 0-6 }
 */
function getTallinnTime() {
    const now = new Date();

    // Create formatter for Tallinn timezone
    const options = { timeZone: TIMEZONE };

    const dateStr = now.toLocaleDateString('sv-SE', options); // YYYY-MM-DD
    const timeStr = now.toLocaleTimeString('en-GB', { ...options, hour12: false }); // HH:MM:SS

    // Get day of week (0 = Sunday, 1 = Monday, etc.)
    const dayOptions = { timeZone: TIMEZONE, weekday: 'short' };
    const dayName = now.toLocaleDateString('en-US', dayOptions);
    const dayMap = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
    const dayOfWeek = dayMap[dayName] ?? now.getDay();

    return {
        date: dateStr.replace(/-/g, ''), // YYYYMMDD
        dateFormatted: dateStr,
        time: timeStr,
        dayOfWeek: dayOfWeek
    };
}

/**
 * Get tomorrow's date in YYYYMMDD format
 * @param {string} todayStr - Today's date in YYYYMMDD format
 * @returns {string} Tomorrow's date
 */
function getTomorrow(todayStr) {
    const year = parseInt(todayStr.substring(0, 4));
    const month = parseInt(todayStr.substring(4, 6)) - 1;
    const day = parseInt(todayStr.substring(6, 8));

    const date = new Date(year, month, day);
    date.setDate(date.getDate() + 1);

    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');

    return `${y}${m}${d}`;
}

/**
 * Get day of week for a date string
 * @param {string} dateStr - Date in YYYYMMDD format
 * @returns {number} Day of week (0 = Sunday)
 */
function getDayOfWeek(dateStr) {
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1;
    const day = parseInt(dateStr.substring(6, 8));

    return new Date(year, month, day).getDay();
}

/**
 * Get day column name for calendar table
 * @param {number} dayOfWeek - Day of week (0 = Sunday)
 * @returns {string} Column name
 */
function getDayColumn(dayOfWeek) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[dayOfWeek];
}

/**
 * Parse GTFS time string to comparable format
 * GTFS times can be > 24:00:00 for trips past midnight
 * @param {string} timeStr - Time string like "25:30:00"
 * @returns {Object} { hours, minutes, seconds, totalSeconds, isNextDay }
 */
function parseGtfsTime(timeStr) {
    if (!timeStr) return null;

    const parts = timeStr.split(':');
    const hours = parseInt(parts[0] || 0);
    const minutes = parseInt(parts[1] || 0);
    const seconds = parseInt(parts[2] || 0);

    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    const isNextDay = hours >= 24;

    return {
        hours,
        minutes,
        seconds,
        totalSeconds,
        isNextDay,
        normalizedHours: hours % 24,
        display: `${String(hours % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    };
}

/**
 * Convert current time to seconds for comparison
 * @param {string} timeStr - Time string "HH:MM:SS"
 * @returns {number} Total seconds
 */
function timeToSeconds(timeStr) {
    const parts = timeStr.split(':');
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2] || 0);
}

/**
 * Format date for display
 * @param {string} dateStr - Date in YYYYMMDD format
 * @param {string} todayStr - Today's date
 * @param {string} tomorrowStr - Tomorrow's date
 * @returns {string} Display string
 */
function formatDateLabel(dateStr, todayStr, tomorrowStr) {
    if (dateStr === todayStr) return 'Täna'; // Today in Estonian
    if (dateStr === tomorrowStr) return 'Homme'; // Tomorrow in Estonian

    // Format as DD.MM
    const day = dateStr.substring(6, 8);
    const month = dateStr.substring(4, 6);
    return `${day}.${month}`;
}

/**
 * GET /api/arrivals
 * Query params:
 *   - stopId: Stop ID (required)
 *   - route: Route short name (required)
 * Returns next 5 arrivals with date and direction info
 */
router.get('/', async (req, res) => {
    try {
        const { stopId, route } = req.query;

        if (!stopId || !route) {
            return res.status(400).json({
                success: false,
                error: 'stopId and route parameters are required'
            });
        }

        const tallinnTime = getTallinnTime();
        const today = tallinnTime.date;
        const tomorrow = getTomorrow(today);
        const currentTimeSeconds = timeToSeconds(tallinnTime.time);

        // Get stop info
        const stopSql = `
            SELECT stop_id, stop_name, stop_code, stop_lat, stop_lon
            FROM ${table('stops')}
            WHERE stop_id = ?
        `;
        const stopRows = await query(stopSql, [stopId]);

        if (stopRows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Stop not found'
            });
        }

        const stop = stopRows[0];

        // Find route ID
        const routeSql = `
            SELECT route_id, route_short_name, route_long_name
            FROM ${table('routes')}
            WHERE route_short_name = ?
        `;
        const routeRows = await query(routeSql, [route]);

        if (routeRows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Route not found'
            });
        }

        const routeIds = routeRows.map(r => r.route_id);

        // Get active service IDs for today
        const todayDayColumn = getDayColumn(tallinnTime.dayOfWeek);
        const tomorrowDayColumn = getDayColumn(getDayOfWeek(tomorrow));

        // Query for today's and tomorrow's services
        // Check calendar + calendar_dates exceptions
        const arrivals = [];

        // Get arrivals for today (including times > 24:00 from yesterday's service)
        const todayArrivalsSql = `
            SELECT DISTINCT
                st.arrival_time,
                st.departure_time,
                t.trip_id,
                t.trip_headsign,
                t.direction_id,
                r.route_short_name,
                r.route_long_name,
                c.service_id
            FROM ${table('stop_times')} st
            JOIN ${table('trips')} t ON st.trip_id = t.trip_id
            JOIN ${table('routes')} r ON t.route_id = r.route_id
            LEFT JOIN ${table('calendar')} c ON t.service_id = c.service_id
            LEFT JOIN ${table('calendar_dates')} cd ON t.service_id = cd.service_id AND cd.date = ?
            WHERE st.stop_id = ?
              AND r.route_id IN (${routeIds.map(() => '?').join(',')})
              AND (
                  (c.${todayDayColumn} = 1 AND c.start_date <= ? AND c.end_date >= ? AND (cd.exception_type IS NULL OR cd.exception_type != 2))
                  OR cd.exception_type = 1
              )
            ORDER BY st.arrival_time ASC
        `;

        const todayParams = [today, stopId, ...routeIds, today, today];
        const todayArrivals = await query(todayArrivalsSql, todayParams);

        // Process today's arrivals
        for (const arr of todayArrivals) {
            const parsed = parseGtfsTime(arr.arrival_time);
            if (!parsed) continue;

            // For times >= 24:00, this is technically "tomorrow" in real clock time
            if (parsed.isNextDay) {
                // This arrival shows on tomorrow's date but from today's service
                arrivals.push({
                    time: parsed.display,
                    arrival_time_raw: arr.arrival_time,
                    totalSeconds: parsed.totalSeconds,
                    date: tomorrow,
                    trip_headsign: arr.trip_headsign,
                    direction_id: arr.direction_id,
                    route_short_name: arr.route_short_name,
                    route_long_name: arr.route_long_name,
                    isFromPreviousDayService: false
                });
            } else if (parsed.totalSeconds >= currentTimeSeconds) {
                // Regular arrival today
                arrivals.push({
                    time: parsed.display,
                    arrival_time_raw: arr.arrival_time,
                    totalSeconds: parsed.totalSeconds,
                    date: today,
                    trip_headsign: arr.trip_headsign,
                    direction_id: arr.direction_id,
                    route_short_name: arr.route_short_name,
                    route_long_name: arr.route_long_name,
                    isFromPreviousDayService: false
                });
            }
        }

        // If we don't have 5 arrivals, get tomorrow's arrivals too
        if (arrivals.length < 5) {
            const tomorrowArrivalsSql = `
                SELECT DISTINCT
                    st.arrival_time,
                    st.departure_time,
                    t.trip_id,
                    t.trip_headsign,
                    t.direction_id,
                    r.route_short_name,
                    r.route_long_name,
                    c.service_id
                FROM ${table('stop_times')} st
                JOIN ${table('trips')} t ON st.trip_id = t.trip_id
                JOIN ${table('routes')} r ON t.route_id = r.route_id
                LEFT JOIN ${table('calendar')} c ON t.service_id = c.service_id
                LEFT JOIN ${table('calendar_dates')} cd ON t.service_id = cd.service_id AND cd.date = ?
                WHERE st.stop_id = ?
                  AND r.route_id IN (${routeIds.map(() => '?').join(',')})
                  AND (
                      (c.${tomorrowDayColumn} = 1 AND c.start_date <= ? AND c.end_date >= ? AND (cd.exception_type IS NULL OR cd.exception_type != 2))
                      OR cd.exception_type = 1
                  )
                ORDER BY st.arrival_time ASC
            `;

            const tomorrowParams = [tomorrow, stopId, ...routeIds, tomorrow, tomorrow];
            const tomorrowArrivals = await query(tomorrowArrivalsSql, tomorrowParams);

            for (const arr of tomorrowArrivals) {
                const parsed = parseGtfsTime(arr.arrival_time);
                if (!parsed) continue;

                // Skip times >= 24:00 for tomorrow (those would be day after tomorrow)
                if (parsed.isNextDay) continue;

                arrivals.push({
                    time: parsed.display,
                    arrival_time_raw: arr.arrival_time,
                    totalSeconds: parsed.totalSeconds + 86400, // Add 24h for sorting
                    date: tomorrow,
                    trip_headsign: arr.trip_headsign,
                    direction_id: arr.direction_id,
                    route_short_name: arr.route_short_name,
                    route_long_name: arr.route_long_name,
                    isFromPreviousDayService: false
                });
            }
        }

        // Sort by total seconds and take first 5
        arrivals.sort((a, b) => a.totalSeconds - b.totalSeconds);
        const nextArrivals = arrivals.slice(0, 5);

        // Format response
        const result = nextArrivals.map(arr => ({
            time: arr.time,
            dateLabel: formatDateLabel(arr.date, today, tomorrow),
            date: arr.date,
            headsign: arr.trip_headsign || arr.route_long_name || '',
            direction: arr.direction_id,
            route: arr.route_short_name
        }));

        res.json({
            success: true,
            stop: {
                stop_id: stop.stop_id,
                stop_name: stop.stop_name,
                stop_code: stop.stop_code,
                stop_lat: parseFloat(stop.stop_lat),
                stop_lon: parseFloat(stop.stop_lon)
            },
            route: route,
            currentTime: tallinnTime.time,
            currentDate: tallinnTime.dateFormatted,
            count: result.length,
            data: result
        });
    } catch (error) {
        console.error('Error fetching arrivals:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch arrivals'
        });
    }
});

module.exports = router;
