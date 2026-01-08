/**
 * Buses API routes
 * GET /api/buses - Returns buses (routes) that stop at a given stop
 */

const express = require('express');
const router = express.Router();
const tallinnApi = require('../tallinnApi');

/**
 * Natural sort comparator for bus route numbers
 */
function naturalRouteSort(a, b) {
    const regex = /^(\d*)(\D*)$/;
    const matchA = a.match(regex) || ['', a, ''];
    const matchB = b.match(regex) || ['', b, ''];

    const numA = matchA[1] ? parseInt(matchA[1], 10) : Infinity;
    const numB = matchB[1] ? parseInt(matchB[1], 10) : Infinity;

    if (numA !== numB) {
        return numA - numB;
    }

    return (matchA[2] || '').localeCompare(matchB[2] || '');
}

/**
 * GET /api/buses
 * Query params:
 *   - stopId: Stop ID (required)
 * Returns list of bus routes that stop at this stop (from real-time data)
 */
router.get('/', async (req, res) => {
    try {
        const { stopId } = req.query;

        if (!stopId) {
            return res.status(400).json({
                success: false,
                error: 'stopId parameter is required'
            });
        }

        // Get real-time arrivals to see which routes serve this stop
        const { arrivals } = await tallinnApi.getArrivals(stopId);

        // Extract unique route numbers
        const routeSet = new Set(arrivals.map(a => a.route));
        const routeNames = Array.from(routeSet).sort(naturalRouteSort);

        res.json({
            success: true,
            stopId: stopId,
            count: routeNames.length,
            data: routeNames,
            details: arrivals.slice(0, 10) // Return first 10 arrivals as details
        });
    } catch (error) {
        console.error('Error fetching buses:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch buses'
        });
    }
});

module.exports = router;
