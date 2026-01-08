/**
 * Arrivals API routes
 * GET /api/arrivals - Returns next arrivals for a bus at a stop
 * Uses real-time SIRI API from transport.tallinn.ee
 */

const express = require('express');
const router = express.Router();
const tallinnApi = require('../tallinnApi');

/**
 * Get current date and time in Tallinn timezone
 */
function getTallinnTime() {
    const now = new Date();
    const options = { timeZone: 'Europe/Tallinn' };

    const dateStr = now.toLocaleDateString('sv-SE', options);
    const timeStr = now.toLocaleTimeString('en-GB', { ...options, hour12: false });

    return {
        date: dateStr.replace(/-/g, ''),
        dateFormatted: dateStr,
        time: timeStr
    };
}

/**
 * GET /api/arrivals
 * Query params:
 *   - stopId: Stop ID (required)
 *   - route: Route short name (optional - filters by route)
 * Returns real-time arrivals
 */
router.get('/', async (req, res) => {
    try {
        const { stopId, route } = req.query;

        if (!stopId) {
            return res.status(400).json({
                success: false,
                error: 'stopId parameter is required'
            });
        }

        const tallinnTime = getTallinnTime();

        // Get stop info
        const stops = await tallinnApi.getStops();
        const stop = stops.find(s => s.stopIds.includes(stopId) || s.id === stopId);

        // Get real-time arrivals
        const { arrivals } = await tallinnApi.getArrivals(stopId);

        // Filter by route if specified
        let filteredArrivals = arrivals;
        if (route) {
            filteredArrivals = arrivals.filter(a => a.route === route);
        }

        // Format response
        const result = filteredArrivals.slice(0, 10).map(arr => ({
            time: arr.expectedTime,
            scheduleTime: arr.scheduleTime,
            expectedMinutes: arr.expectedMinutes,
            dateLabel: 'Täna',
            date: tallinnTime.date,
            headsign: '',
            direction: null,
            route: arr.route,
            transport: arr.transport,
            isRealtime: arr.isRealtime
        }));

        res.json({
            success: true,
            stop: stop ? {
                stop_id: stopId,
                stop_name: stop.name,
                stop_code: stop.id,
                stop_lat: stop.lat,
                stop_lon: stop.lng
            } : { stop_id: stopId },
            route: route || 'all',
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
